import { Perf } from './models';

export const ZERO_PERF: Perf = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };

export function addPerf(a: Perf, b: Perf): Perf {
  return {
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    cost: a.cost + b.cost,
    conversions: a.conversions + b.conversions,
  };
}

export function sumPerf(rows: readonly Perf[]): Perf {
  let impressions = 0;
  let clicks = 0;
  let cost = 0;
  let conversions = 0;
  for (const r of rows) {
    impressions += r.impressions;
    clicks += r.clicks;
    cost += r.cost;
    conversions += r.conversions;
  }
  return { impressions, clicks, cost, conversions };
}

/** Razões como fração 0..1 (use o pipe `percent` para exibir). */
export function ctr(p: Perf): number {
  return p.impressions > 0 ? p.clicks / p.impressions : 0;
}

export function cpc(p: Perf): number {
  return p.clicks > 0 ? p.cost / p.clicks : 0;
}

export function conversionRate(p: Perf): number {
  return p.clicks > 0 ? p.conversions / p.clicks : 0;
}

/** Custo por unidade de resultado. `null` quando não há resultado (nunca zero). */
export function costPer(cost: number, units: number): number | null {
  return units > 0 ? cost / units : null;
}

/** Custo mensalizado (30 dias) a partir do custo de uma janela. */
export function monthly(cost: number, windowDays: number): number {
  return windowDays > 0 ? (cost / windowDays) * 30 : cost;
}

export function safeDiv(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Soma por chave, devolvendo um Map<chave, Perf>. */
export function groupPerf<T extends Perf>(rows: readonly T[], keyOf: (row: T) => string): Map<string, Perf> {
  const out = new Map<string, Perf>();
  for (const row of rows) {
    const key = keyOf(row);
    const prev = out.get(key) ?? ZERO_PERF;
    out.set(key, addPerf(prev, row));
  }
  return out;
}
