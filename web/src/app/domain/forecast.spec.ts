import { FORECAST } from './config';
import { addDays, parseIsoDate } from './dates';
import { dailySeries, forecastMetric, holtForecast, horizonFor, quantile } from './forecast';
import { DailyRow } from './models';

const END = '2026-10-24';

/** Série de `n` dias terminando em END; `fn(i, date)` devolve o valor do dia i (0 = mais antigo). */
function series(n: number, fn: (i: number, date: string) => number, over: Partial<DailyRow> = {}): DailyRow[] {
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(END, -(n - 1 - i));
    const v = fn(i, date);
    return { date, campaignId: '1', campaignName: 'C', impressions: 1000, clicks: v, cost: v * 2, conversions: v / 10, ...over };
  });
}

const weekday = (date: string): number => parseIsoDate(date).getDay();
const weekly = (date: string): number => (weekday(date) === 0 || weekday(date) === 6 ? 20 : 100);

// Gerador pseudoaleatório fixo, para o teste não variar entre execuções.
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('horizonFor / quantile', () => {
  it('horizonte cresce com o histórico até 14 dias e deixa 8 pontos de teste', () => {
    expect(horizonFor(42)).toBe(7);
    expect(horizonFor(49)).toBe(14);
    expect(horizonFor(90)).toBe(14);
    expect(horizonFor(30)).toBe(0);
  });

  it('quantil interpola', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe('dailySeries', () => {
  it('começa no primeiro dia com impressões e preenche buracos com zero', () => {
    const rows = [...series(10, () => 5)].filter((r) => r.date !== addDays(END, -4));
    const s = dailySeries(rows, 'clicks', END)!;
    expect(s.values).toHaveLength(10);
    expect(s.values[5]).toBe(0);
  });

  it('sem impressões não há série', () => {
    expect(dailySeries(series(10, () => 5, { impressions: 0 }), 'clicks', END)).toBeNull();
  });
});

describe('forecastMetric — conta regular', () => {
  const rows = series(90, (_, d) => weekly(d));
  const r = forecastMetric(rows, 'cost', END);

  it('prevê o ritmo semanal, a partir de amanhã, por 14 dias', () => {
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.horizon).toBe(14);
    expect(r.points[0].date).toBe(addDays(END, 1));
    for (const p of r.points) expect(p.value).toBeCloseTo(weekly(p.date) * 2, 0);
  });

  it('o erro nos testes com dias passados é quase zero e a faixa é estreita', () => {
    if (r.status !== 'ready') throw new Error('esperava ready');
    expect(r.error).toBeLessThan(0.02);
    expect(r.tests).toBe(FORECAST.backtestOrigins);
    expect(r.total.high - r.total.low).toBeLessThan(r.total.value * 0.05);
    expect(r.confidence.level).toBe('HIGH');
  });
});

describe('forecastMetric — tendência e dias parados', () => {
  it('tendência de alta continua, mas amortecida', () => {
    const rows = series(90, (i) => 50 + i);
    const r = forecastMetric(rows, 'clicks', END);
    if (r.status !== 'ready') throw new Error('esperava ready');
    expect(r.points[0].value).toBeGreaterThan(139);
    // amortecida: bem abaixo de manter 1 clique a mais por dia durante 14 dias
    expect(r.points[13].value).toBeLessThan(139 + 14 + 1);
  });

  it('dia da semana sem atividade é previsto como zero', () => {
    const rows = series(90, (_, d) => (weekday(d) === 0 ? 0 : 60));
    const r = forecastMetric(rows, 'clicks', END);
    if (r.status !== 'ready') throw new Error('esperava ready');
    const sunday = r.points.find((p) => weekday(p.date) === 0)!;
    expect(sunday.value).toBe(0);
    expect(sunday.low).toBe(0);
  });

  it('nunca prevê valor negativo, mesmo com queda forte', () => {
    const falling = Array.from({ length: 60 }, (_, i) => Math.max(0, 120 - 2.5 * i));
    for (const v of holtForecast(falling, 0, 14)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('forecastMetric — contagens pequenas', () => {
  it('conversões com 1 por dia ganham faixa de Poisson, mesmo sem variação', () => {
    const rows = series(90, () => 10, { conversions: 1 });
    const r = forecastMetric(rows, 'conversions', END);
    if (r.status !== 'ready') throw new Error('esperava ready');
    expect(r.points[0].low).toBeLessThan(r.points[0].value);
    expect(r.points[0].high).toBeGreaterThan(r.points[0].value);
    expect(r.total.high).toBeGreaterThan(r.total.value + 3);
  });
});

describe('forecastMetric — quando não deve prever', () => {
  it('poucos dias: insuficiente, com o que falta e o prazo', () => {
    const r = forecastMetric(series(20, () => 10), 'clicks', END);
    expect(r.status).toBe('insufficient');
    if (r.status !== 'insufficient' || r.sufficiency.status !== 'insufficient') return;
    expect(r.sufficiency.missing.activeDays).toBe(FORECAST.minHistoryDays - 20);
  });

  it('rastreamento quebrado bloqueia conversões, mas não cliques', () => {
    const rows = series(90, () => 10, { conversions: 1 });
    expect(forecastMetric(rows, 'conversions', END, { trackingBroken: true }).status).toBe('blocked');
    expect(forecastMetric(rows, 'clicks', END, { trackingBroken: true }).status).toBe('ready');
  });

  it('série instável: o erro nos testes passa do limite e a previsão fica escondida', () => {
    const r = rng(7);
    // semanas alternando entre regimes muito diferentes
    const rows = series(90, (i) => (Math.floor(i / 7) % 2 === 0 ? 200 : 10) * (0.8 + r() * 0.4));
    const out = forecastMetric(rows, 'clicks', END);
    expect(out.status).toBe('unstable');
    if (out.status === 'unstable') expect(out.error).toBeGreaterThan(FORECAST.maxError);
  });
});
