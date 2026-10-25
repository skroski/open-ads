import { SUFFICIENCY_RULES, SUFFICIENCY_WINDOW_DAYS, SufficiencyFeature, SufficiencyRule } from './config';
import { addDays } from './dates';
import { DailyRow } from './models';

/**
 * Porta de suficiência: antes de projetar ou sugerir qualquer coisa, confere se a conta tem
 * dado para sustentar a conclusão. Sem dado, devolve o que falta e quanto tempo levará
 * no ritmo atual, em vez de um número sem base.
 */

export interface HistorySummary {
  /** Dias com impressões dentro da janela. */
  activeDays: number;
  clicks: number;
  conversions: number;
  windowDays: number;
  /** Ritmo dos últimos dias, para estimar quando o dado que falta chegará. */
  recentClicksPerDay: number;
  recentConversionsPerDay: number;
}

export interface Missing {
  activeDays: number;
  clicks: number;
  conversions: number;
}

export type Sufficiency =
  /** `ratio` = quantas vezes o mínimo foi atingido (≥ 1); alimenta a confiança. */
  | { status: 'ready'; ratio: number }
  | { status: 'insufficient'; missing: Missing; etaDays: number | null }
  | { status: 'blocked'; reason: string };

export function summarizeHistory(
  daily: readonly DailyRow[],
  end: string,
  windowDays: number = SUFFICIENCY_WINDOW_DAYS,
  recentDays = 14,
): HistorySummary {
  const start = addDays(end, -(windowDays - 1));
  const recentStart = addDays(end, -(recentDays - 1));
  const active = new Set<string>();
  let clicks = 0;
  let conversions = 0;
  let recentClicks = 0;
  let recentConversions = 0;
  for (const r of daily) {
    if (r.date < start || r.date > end) continue;
    clicks += r.clicks;
    conversions += r.conversions;
    if (r.impressions > 0) active.add(r.date);
    if (r.date >= recentStart) {
      recentClicks += r.clicks;
      recentConversions += r.conversions;
    }
  }
  return {
    activeDays: active.size,
    clicks,
    conversions,
    windowDays,
    recentClicksPerDay: recentClicks / recentDays,
    recentConversionsPerDay: recentConversions / recentDays,
  };
}

export interface EvaluateOptions {
  /** Há indício de medição de conversão quebrada. */
  trackingBroken?: boolean;
  rule?: SufficiencyRule;
}

export function evaluateSufficiency(
  feature: SufficiencyFeature,
  h: HistorySummary,
  options: EvaluateOptions = {},
): Sufficiency {
  if (options.trackingBroken && feature !== 'FORECAST_VOLUME') {
    return {
      status: 'blocked',
      reason: 'O rastreamento de conversões teve falha recente; qualquer número baseado em conversões ficaria enganoso.',
    };
  }
  const rule = options.rule ?? SUFFICIENCY_RULES[feature];
  const missing: Missing = {
    activeDays: Math.max(0, rule.minActiveDays - h.activeDays),
    clicks: Math.max(0, rule.minClicks - h.clicks),
    conversions: Math.max(0, rule.minConversions - h.conversions),
  };

  if (missing.activeDays || missing.clicks || missing.conversions) {
    const waits: Array<number | null> = [];
    if (missing.activeDays) waits.push(missing.activeDays);
    if (missing.clicks) waits.push(h.recentClicksPerDay > 0 ? missing.clicks / h.recentClicksPerDay : null);
    if (missing.conversions) waits.push(h.recentConversionsPerDay > 0 ? missing.conversions / h.recentConversionsPerDay : null);
    const etaDays = waits.some((w) => w === null) ? null : Math.ceil(Math.max(...(waits as number[])));
    return { status: 'insufficient', missing, etaDays };
  }

  const ratios: number[] = [];
  if (rule.minActiveDays) {
    // Janela cheia: não existe mais histórico para ter dentro dela, então não rebaixa a confiança.
    const raw = h.activeDays / rule.minActiveDays;
    ratios.push(h.activeDays >= h.windowDays * 0.95 ? Math.max(3, raw) : raw);
  }
  if (rule.minClicks) ratios.push(h.clicks / rule.minClicks);
  if (rule.minConversions) ratios.push(h.conversions / rule.minConversions);
  return { status: 'ready', ratio: ratios.length ? Math.min(...ratios) : 1 };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Texto curto, em linguagem simples, do que falta e de quando deve chegar. */
export function describeShortfall(s: Sufficiency): string {
  if (s.status === 'blocked') return s.reason;
  if (s.status === 'ready') return 'Há dados suficientes.';
  const parts: string[] = [];
  const days = Math.ceil(s.missing.activeDays);
  if (days) parts.push(plural(days, 'dia de histórico', 'dias de histórico'));
  const clicks = Math.ceil(s.missing.clicks);
  if (clicks) parts.push(plural(clicks, 'clique', 'cliques'));
  const conv = Math.ceil(s.missing.conversions);
  if (conv) parts.push(plural(conv, 'conversão', 'conversões'));
  const eta =
    s.etaDays === null
      ? 'Sem ritmo recente para estimar o prazo.'
      : `No ritmo atual, cerca de ${plural(s.etaDays, 'dia', 'dias')}.`;
  return `Faltam ${parts.join(' e ')}. ${eta}`;
}
