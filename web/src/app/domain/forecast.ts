import { FORECAST, SUFFICIENCY_WINDOW_DAYS } from './config';
import { addDays, parseIsoDate } from './dates';
import { Confidence, DailyRow } from './models';
import { deriveConfidence } from './provenance';
import { Sufficiency, evaluateSufficiency, summarizeHistory } from './sufficiency';

/**
 * Previsão de cliques, custo e conversões para os próximos dias. É cálculo sobre o histórico da
 * conta (nível + tendência amortecida + ritmo semanal), não opinião e não promessa do Google.
 * Antes de exibir qualquer número, o método é testado em dias que já aconteceram nesta conta:
 * a faixa provável e o erro mostrado vêm desses testes, e erro alto esconde a previsão.
 */

export type ForecastMetric = 'clicks' | 'cost' | 'conversions';

export const METRIC_LABEL: Record<ForecastMetric, string> = {
  clicks: 'Cliques',
  cost: 'Custo',
  conversions: 'Conversões',
};

/** Contagens têm ruído mínimo de Poisson mesmo quando o histórico recente foi muito regular. */
const COUNT_METRICS: readonly ForecastMetric[] = ['clicks', 'conversions'];
const Z80 = 1.2816;

export const METHOD_TEXT =
  'Nível e tendência amortecida sobre o ritmo de cada dia da semana (últimas 8 semanas). A faixa provável (80%) vem dos erros do próprio método em dias passados desta conta.';

export interface ForecastPoint {
  date: string;
  value: number;
  low: number;
  high: number;
}

export interface ForecastReady {
  status: 'ready';
  metric: ForecastMetric;
  horizon: number;
  points: ForecastPoint[];
  total: { value: number; low: number; high: number };
  /** Erro médio relativo do total previsto nos testes com dias passados (0–2). */
  error: number;
  tests: number;
  confidence: Confidence;
  basis: { from: string; to: string; days: number };
}

export type ForecastResult =
  | ForecastReady
  | { status: 'insufficient'; sufficiency: Sufficiency }
  | { status: 'blocked'; reason: string }
  | { status: 'unstable'; error: number; tests: number };

// ───────────────────────── Série diária ─────────────────────────

export interface DailySeries {
  start: string;
  values: number[];
}

/** Soma por dia, do primeiro dia com impressões até `end`, preenchendo dias sem linha com zero. */
export function dailySeries(rows: readonly DailyRow[], metric: ForecastMetric, end: string): DailySeries | null {
  const from = addDays(end, -(SUFFICIENCY_WINDOW_DAYS - 1));
  const byDay = new Map<string, number>();
  let first: string | null = null;
  for (const r of rows) {
    if (r.date < from || r.date > end) continue;
    byDay.set(r.date, (byDay.get(r.date) ?? 0) + r[metric]);
    if (r.impressions > 0 && (first === null || r.date < first)) first = r.date;
  }
  if (first === null) return null;
  const values: number[] = [];
  for (let d = first; d <= end; d = addDays(d, 1)) values.push(byDay.get(d) ?? 0);
  return { start: first, values };
}

// ───────────────────────── Método ─────────────────────────

/**
 * Fator de cada dia da semana (média 1), medido contra a média móvel centrada de 7 dias para que
 * a tendência não seja confundida com ritmo semanal. Dia quase sem atividade vira 0: o painel prevê "parado".
 */
function seasonalIndex(values: readonly number[], startDow: number): number[] {
  const span = FORECAST.seasonWeeks * 7;
  const first = Math.max(3, values.length - span);
  const sum = new Array<number>(7).fill(0);
  const count = new Array<number>(7).fill(0);
  for (let i = first; i <= values.length - 4; i++) {
    let window = 0;
    for (let k = i - 3; k <= i + 3; k++) window += values[k];
    const cma = window / 7;
    if (cma <= 0) continue;
    const d = (startDow + i) % 7;
    sum[d] += values[i] / cma;
    count[d] += 1;
  }
  if (!count.some((c) => c > 0)) return new Array<number>(7).fill(0);
  const raw = sum.map((s, d) => (count[d] ? s / count[d] : 1));
  const norm = raw.reduce((a, b) => a + b, 0) / 7;
  return raw.map((r) => {
    const v = r / norm;
    return v < 0.1 ? 0 : v;
  });
}

/** Holt amortecido sobre a série sem o ritmo semanal; devolve `horizon` dias seguintes. */
export function holtForecast(values: readonly number[], startDow: number, horizon: number): number[] {
  const idx = seasonalIndex(values, startDow);
  const { alpha, beta, phi } = FORECAST;
  const z = values.map((v, i) => (idx[(startDow + i) % 7] > 0 ? v / idx[(startDow + i) % 7] : null));
  const seed = z.filter((v): v is number => v !== null).slice(0, 7);
  if (!seed.length) return new Array<number>(horizon).fill(0);
  let level = seed.reduce((a, b) => a + b, 0) / seed.length;
  let trend = 0;
  for (const obs of z) {
    if (obs === null) continue;
    const prev = level;
    level = alpha * obs + (1 - alpha) * (prev + phi * trend);
    trend = beta * (level - prev) + (1 - beta) * phi * trend;
  }
  const out: number[] = [];
  let damp = 0;
  let power = 1;
  for (let h = 1; h <= horizon; h++) {
    power *= phi;
    damp += power;
    out.push(Math.max(0, level + trend * damp) * idx[(startDow + values.length + h - 1) % 7]);
  }
  return out;
}

/** Quantil por interpolação linear (q entre 0 e 1). */
export function quantile(values: readonly number[], q: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

const sum = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0);

/** Erro relativo simétrico entre dois totais (0 = igual, 2 = totalmente diferente). */
function relativeError(actual: number, forecast: number): number {
  const d = actual + forecast;
  return d === 0 ? 0 : (2 * Math.abs(actual - forecast)) / d;
}

/** Maior horizonte que ainda deixa pelo menos 8 pontos de partida para testar o método. */
export function horizonFor(days: number): number {
  return Math.max(0, Math.min(FORECAST.maxHorizonDays, Math.floor(days / 3), days - 35));
}

interface Tests {
  /** Erro (real − previsto) de cada dia do horizonte, por ponto de partida. */
  byDay: number[][];
  /** Erro (real − previsto) do total do horizonte, por ponto de partida. */
  total: number[];
  /** Erro relativo do total nos até 4 testes mais recentes, espaçados em 7 dias. */
  recentErrors: number[];
}

function runTests(values: readonly number[], startDow: number, horizon: number): Tests {
  const n = values.length;
  const byDay: number[][] = Array.from({ length: horizon }, () => []);
  const total: number[] = [];
  for (let o = FORECAST.minTrainDays; o <= n - horizon; o++) {
    const f = holtForecast(values.slice(0, o), startDow, horizon);
    const a = values.slice(o, o + horizon);
    for (let h = 0; h < horizon; h++) byDay[h].push(a[h] - f[h]);
    total.push(sum(a) - sum(f));
  }
  const recentErrors: number[] = [];
  for (let k = 0; k < FORECAST.backtestOrigins; k++) {
    const o = n - horizon - 7 * k;
    if (o < FORECAST.minTrainDays) break;
    recentErrors.push(
      relativeError(sum(values.slice(o, o + horizon)), sum(holtForecast(values.slice(0, o), startDow, horizon))),
    );
  }
  return { byDay, total, recentErrors };
}

function band(value: number, residuals: readonly number[], count: boolean): { low: number; high: number } {
  let low = Math.max(0, value + quantile(residuals, FORECAST.intervalLow));
  let high = value + quantile(residuals, FORECAST.intervalHigh);
  if (count) {
    low = Math.min(low, Math.max(0, value - Z80 * Math.sqrt(value)));
    high = Math.max(high, value + Z80 * Math.sqrt(value));
  }
  return { low: Math.min(low, value), high: Math.max(high, value) };
}

// ───────────────────────── API ─────────────────────────

export interface ForecastOptions {
  /** Há indício de medição de conversão quebrada. */
  trackingBroken?: boolean;
}

export function forecastMetric(
  daily: readonly DailyRow[],
  metric: ForecastMetric,
  end: string,
  options: ForecastOptions = {},
): ForecastResult {
  const feature = metric === 'conversions' ? 'FORECAST_CONVERSIONS' : 'FORECAST_VOLUME';
  const sufficiency = evaluateSufficiency(feature, summarizeHistory(daily, end), {
    trackingBroken: options.trackingBroken,
  });
  if (sufficiency.status === 'blocked') return { status: 'blocked', reason: sufficiency.reason };
  if (sufficiency.status === 'insufficient') return { status: 'insufficient', sufficiency };

  const series = dailySeries(daily, metric, end);
  const days = series?.values.length ?? 0;
  const horizon = horizonFor(days);
  if (!series || horizon < 7) {
    const missing = Math.max(1, FORECAST.minHistoryDays - days);
    return {
      status: 'insufficient',
      sufficiency: { status: 'insufficient', missing: { activeDays: missing, clicks: 0, conversions: 0 }, etaDays: missing },
    };
  }

  const startDow = parseIsoDate(series.start).getDay();
  const tests = runTests(series.values, startDow, horizon);
  const error = sum(tests.recentErrors) / Math.max(1, tests.recentErrors.length);
  if (error > FORECAST.maxError) return { status: 'unstable', error, tests: tests.recentErrors.length };

  const isCount = COUNT_METRICS.includes(metric);
  const f = holtForecast(series.values, startDow, horizon);
  const points = f.map((value, h) => ({ date: addDays(end, h + 1), value, ...band(value, tests.byDay[h], isCount) }));
  const totalValue = sum(f);

  return {
    status: 'ready',
    metric,
    horizon,
    points,
    total: { value: totalValue, ...band(totalValue, tests.total, isCount) },
    error,
    tests: tests.recentErrors.length,
    confidence: deriveConfidence({ ratio: sufficiency.ratio, backtestError: error }),
    basis: { from: series.start, to: end, days },
  };
}
