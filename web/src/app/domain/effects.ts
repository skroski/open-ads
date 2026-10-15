import { addDays, diffDays, isoDate } from './dates';
import { mean, normalCdf, twoProportionTest } from './stats';
import { ChangeEntry, Confidence, DailyRow, Perf, SeriesPoint } from './models';
import { ZERO_PERF, addPerf, costPer } from './metrics';

/**
 * Efeito de uma mudança: compara o período imediatamente antes com o imediatamente
 * depois, no mesmo escopo (campanha ou conta). Nunca afirma causa sozinho:
 *  - lista outras mudanças no mesmo intervalo (fatores de confusão);
 *  - quando é uma campanha, compara com as demais campanhas (grupo de controle),
 *    para descontar sazonalidade e variações da conta inteira.
 */

export type EffectVerdict = 'WAITING' | 'IMPROVED' | 'WORSENED' | 'NO_CLEAR_EFFECT' | 'NOT_EVALUABLE';

export interface PeriodStats extends Perf {
  from: string;
  to: string;
  days: number;
  conversionRate: number;
  costPerConversion: number | null;
}

export interface EffectResult {
  verdict: EffectVerdict;
  before?: PeriodStats;
  after?: PeriodStats;
  /** Variação relativa da taxa de conversão (depois vs. antes). */
  rateLift: number | null;
  /** Variação relativa do custo por conversão. */
  costPerConversionChange: number | null;
  pValue: number | null;
  /** Variação relativa da taxa de conversão nas campanhas de controle, quando existem. */
  controlLift: number | null;
  confounders: ChangeEntry[];
  confidence: Confidence;
  /** Piorou de forma estatisticamente relevante. */
  regression: boolean;
  /** Data em que haverá dados suficientes. */
  waitUntil?: string;
  note: string;
}

export interface EffectOptions {
  /** Dias de cada janela (padrão 14). */
  windowDays?: number;
  /** Mínimo de dias depois da mudança para avaliar (padrão 7). */
  minDaysAfter?: number;
  /** Mínimo de cliques em cada janela (padrão 30). */
  minClicks?: number;
  /** Hoje, para testes. */
  today?: string;
}

function stats(rows: readonly DailyRow[], from: string, to: string): PeriodStats {
  let p = ZERO_PERF;
  for (const r of rows) {
    if (r.date >= from && r.date <= to) p = addPerf(p, r);
  }
  return {
    ...p,
    from,
    to,
    days: Math.max(1, diffDays(from, to) + 1),
    conversionRate: p.clicks > 0 ? p.conversions / p.clicks : 0,
    costPerConversion: costPer(p.cost, p.conversions),
  };
}

function relative(after: number, before: number): number | null {
  return before > 0 ? (after - before) / before : null;
}

function overlaps(a: ChangeEntry, b: ChangeEntry): boolean {
  return !a.campaignId || !b.campaignId || a.campaignId === b.campaignId;
}

export function evaluateChange(
  change: ChangeEntry,
  daily: readonly DailyRow[],
  allChanges: readonly ChangeEntry[],
  options: EffectOptions = {},
): EffectResult {
  const windowDays = options.windowDays ?? 14;
  const minAfter = options.minDaysAfter ?? 7;
  const minClicks = options.minClicks ?? 30;
  const today = options.today ?? isoDate(new Date());
  const yesterday = addDays(today, -1);
  const changeDay = change.at.slice(0, 10);

  const lastDataDay = yesterday;
  const afterFrom = addDays(changeDay, 1);
  const daysAvailable = diffDays(afterFrom, lastDataDay) + 1;

  const waitUntil = addDays(changeDay, minAfter);
  if (daysAvailable < minAfter) {
    return {
      verdict: 'WAITING',
      rateLift: null,
      costPerConversionChange: null,
      pValue: null,
      controlLift: null,
      confounders: [],
      confidence: { level: 'LOW', reasons: ['Ainda não passaram dias suficientes.'] },
      regression: false,
      waitUntil,
      note: `Faltam dados: avalie a partir de ${waitUntil}.`,
    };
  }

  const afterDays = Math.min(windowDays, daysAvailable);
  const afterTo = addDays(afterFrom, afterDays - 1);
  const beforeTo = addDays(changeDay, -1);
  const beforeFrom = addDays(beforeTo, -(afterDays - 1));

  const scoped = change.campaignId ? daily.filter((r) => r.campaignId === change.campaignId) : daily;
  const before = stats(scoped, beforeFrom, beforeTo);
  const after = stats(scoped, afterFrom, afterTo);

  const confounders = allChanges.filter((c) => {
    if (c.id === change.id) return false;
    const day = c.at.slice(0, 10);
    return day >= beforeFrom && day <= afterTo && day !== changeDay && overlaps(change, c);
  });
  // Mudanças no mesmo dia também confundem.
  allChanges
    .filter((c) => c.id !== change.id && c.at.slice(0, 10) === changeDay && overlaps(change, c))
    .forEach((c) => confounders.push(c));

  if (before.clicks < minClicks || after.clicks < minClicks) {
    return {
      verdict: 'NOT_EVALUABLE',
      before,
      after,
      rateLift: null,
      costPerConversionChange: null,
      pValue: null,
      controlLift: null,
      confounders,
      confidence: { level: 'LOW', reasons: ['Poucos cliques antes ou depois da mudança.'] },
      regression: false,
      note: `Poucos cliques para medir (antes: ${before.clicks}, depois: ${after.clicks}; mínimo ${minClicks}).`,
    };
  }

  const test = twoProportionTest(before.conversions, before.clicks, after.conversions, after.clicks);
  const rateLift = relative(after.conversionRate, before.conversionRate);
  const cpcChange =
    before.costPerConversion !== null && after.costPerConversion !== null
      ? relative(after.costPerConversion, before.costPerConversion)
      : null;

  // Grupo de controle: as outras campanhas no mesmo período.
  let controlLift: number | null = null;
  if (change.campaignId) {
    const others = daily.filter((r) => r.campaignId !== change.campaignId);
    const cb = stats(others, beforeFrom, beforeTo);
    const ca = stats(others, afterFrom, afterTo);
    if (cb.clicks >= 100 && ca.clicks >= 100) controlLift = relative(ca.conversionRate, cb.conversionRate);
  }

  const significant = test.valid && test.pValue < 0.05;
  let verdict: EffectVerdict = 'NO_CLEAR_EFFECT';
  if (significant && test.diff > 0) verdict = 'IMPROVED';
  if (significant && test.diff < 0) verdict = 'WORSENED';

  // Se o controle andou na mesma direção e com tamanho parecido, o efeito não é da mudança.
  let controlExplains = false;
  if (verdict !== 'NO_CLEAR_EFFECT' && controlLift !== null && rateLift !== null) {
    controlExplains = Math.sign(controlLift) === Math.sign(rateLift) && Math.abs(controlLift) >= Math.abs(rateLift) * 0.7;
    if (controlExplains) verdict = 'NO_CLEAR_EFFECT';
  }

  const reasons: string[] = [];
  let level: Confidence['level'] = 'LOW';
  if (verdict === 'NO_CLEAR_EFFECT') {
    reasons.push(
      controlExplains
        ? 'O grupo de controle (outras campanhas) variou de forma parecida no mesmo período.'
        : test.valid
          ? 'A diferença observada é compatível com variação normal.'
          : 'Poucos eventos para um teste confiável.',
    );
  } else {
    level = test.pValue < 0.01 ? 'HIGH' : 'MEDIUM';
    reasons.push(`Diferença estatisticamente relevante (p = ${test.pValue.toFixed(3).replace('.', ',')}).`);
    if (controlLift !== null) reasons.push('As demais campanhas não explicam a variação.');
  }
  if (confounders.length) {
    // Uma outra mudança limita a confiança a "média"; duas ou mais a derrubam para "baixa".
    level = confounders.length >= 2 ? 'LOW' : level === 'HIGH' ? 'MEDIUM' : level;
    reasons.push(`${confounders.length} outra(s) mudança(s) no mesmo intervalo dificultam atribuir o efeito.`);
  }

  const direction = verdict === 'IMPROVED' ? 'melhorou' : verdict === 'WORSENED' ? 'piorou' : 'não mudou de forma clara';
  return {
    verdict,
    before,
    after,
    rateLift,
    costPerConversionChange: cpcChange,
    pValue: test.valid ? test.pValue : null,
    controlLift,
    confounders,
    confidence: { level, reasons },
    regression: verdict === 'WORSENED',
    note: `A taxa de conversão ${direction} entre os ${afterDays} dias antes e os ${afterDays} dias depois da mudança.`,
  };
}

// ───────────────────────── Séries diárias (conteúdo, páginas) ─────────────────────────

export interface SeriesEffect {
  verdict: EffectVerdict;
  beforeMean: number;
  afterMean: number;
  /** Variação relativa da média diária (depois vs. antes). */
  lift: number | null;
  /** Variação relativa no grupo de controle (ex.: o site inteiro). */
  controlLift: number | null;
  /** Variação da página descontada a variação do controle. */
  adjustedLift: number | null;
  pValue: number | null;
  confounders: ChangeEntry[];
  confidence: Confidence;
  note: string;
}

export interface SeriesEffectOptions {
  windowDays?: number;
  minDays?: number;
  today?: string;
  confounders?: ChangeEntry[];
}

function window(series: readonly SeriesPoint[], from: string, to: string): number[] {
  return series.filter((p) => p.date >= from && p.date <= to).map((p) => p.value);
}

function variance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
}

/**
 * Efeito de uma publicação ou atualização sobre uma série diária (ex.: cliques
 * orgânicos da página). Não atribui o crescimento à publicação por padrão: desconta
 * a variação do controle (o site inteiro, no mesmo período) e avisa sobre outras mudanças.
 */
export function evaluateSeriesChange(
  series: readonly SeriesPoint[],
  control: readonly SeriesPoint[] | null,
  at: string,
  options: SeriesEffectOptions = {},
): SeriesEffect {
  const windowDays = options.windowDays ?? 28;
  const minDays = options.minDays ?? 14;
  const today = options.today ?? isoDate(new Date());
  const day = at.slice(0, 10);
  const confounders = options.confounders ?? [];

  const lastData = addDays(today, -3); // o Search Console atrasa 2–3 dias
  const afterFrom = addDays(day, 1);
  const available = diffDays(afterFrom, lastData) + 1;
  const empty = {
    beforeMean: 0,
    afterMean: 0,
    lift: null,
    controlLift: null,
    adjustedLift: null,
    pValue: null,
    confounders,
  };

  if (available < minDays) {
    return {
      verdict: 'WAITING',
      ...empty,
      confidence: { level: 'LOW', reasons: ['Ainda não há dias suficientes depois da mudança.'] },
      note: `Avalie a partir de ${addDays(day, minDays + 3)}: conteúdo leva semanas para mostrar efeito.`,
    };
  }

  const n = Math.min(windowDays, available);
  const afterTo = addDays(afterFrom, n - 1);
  const beforeTo = addDays(day, -1);
  const beforeFrom = addDays(beforeTo, -(n - 1));
  const before = window(series, beforeFrom, beforeTo);
  const after = window(series, afterFrom, afterTo);

  if (before.length < minDays || after.length < minDays) {
    return {
      verdict: 'NOT_EVALUABLE',
      ...empty,
      confidence: { level: 'LOW', reasons: ['A série tem poucos dias com dados antes ou depois.'] },
      note: 'Dados diários insuficientes para comparar antes e depois.',
    };
  }

  const m1 = mean(before);
  const m2 = mean(after);
  const lift = m1 > 0 ? (m2 - m1) / m1 : null;

  let controlLift: number | null = null;
  if (control && control.length) {
    const c1 = mean(window(control, beforeFrom, beforeTo));
    const c2 = mean(window(control, afterFrom, afterTo));
    controlLift = c1 > 0 ? (c2 - c1) / c1 : null;
  }
  const adjustedLift = lift !== null ? lift - (controlLift ?? 0) : null;

  const se = Math.sqrt(variance(before) / before.length + variance(after) / after.length);
  const z = se > 0 ? (m2 - m1) / se : 0;
  const pValue = se > 0 ? 2 * (1 - normalCdf(Math.abs(z))) : null;

  let verdict: EffectVerdict = 'NO_CLEAR_EFFECT';
  if (pValue !== null && pValue < 0.05 && adjustedLift !== null && Math.abs(adjustedLift) >= 0.1) {
    verdict = adjustedLift > 0 ? 'IMPROVED' : 'WORSENED';
  }

  const reasons: string[] = [];
  let level: Confidence['level'] = verdict === 'NO_CLEAR_EFFECT' ? 'LOW' : pValue !== null && pValue < 0.01 ? 'HIGH' : 'MEDIUM';
  if (controlLift !== null && Math.abs(controlLift) >= 0.1) {
    reasons.push(
      `O site inteiro também variou ${(controlLift * 100).toFixed(0).replace('-', '−')}% no período; descontamos isso.`,
    );
  } else if (controlLift === null) {
    level = level === 'HIGH' ? 'MEDIUM' : 'LOW';
    reasons.push('Sem grupo de controle: sazonalidade e tendência do site não foram descontadas.');
  }
  if (confounders.length) {
    level = confounders.length >= 2 ? 'LOW' : level === 'HIGH' ? 'MEDIUM' : level;
    reasons.push(`${confounders.length} outra(s) mudança(s) no período: não dá para atribuir tudo a esta.`);
  }
  if (verdict === 'NO_CLEAR_EFFECT') reasons.unshift('A variação é compatível com oscilação normal.');
  else reasons.unshift(`Diferença relevante (p = ${(pValue ?? 0).toFixed(3).replace('.', ',')}).`);

  const dir = verdict === 'IMPROVED' ? 'subiu' : verdict === 'WORSENED' ? 'caiu' : 'não mudou de forma clara';
  return {
    verdict,
    beforeMean: m1,
    afterMean: m2,
    lift,
    controlLift,
    adjustedLift,
    pValue,
    confounders,
    confidence: { level, reasons },
    note: `A média diária ${dir} entre os ${n} dias antes e os ${n} dias depois, já descontada a variação do site.`,
  };
}
