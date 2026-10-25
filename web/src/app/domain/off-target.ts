import { HourRow, Perf, RegionRow, SearchTermRow, ServiceArea, ServiceHours } from './models';

/**
 * Entrega fora do alvo: quanto do gasto foi para termos, regiões e horários que não combinam com o
 * que a pessoa informou sobre o negócio. O valor em reais é calculado sobre dados da conta; a IA só
 * aponta termos a confirmar e nunca entra no total.
 *
 * Os recortes se sobrepõem (um clique pode estar numa região fora da área e num termo ruim), por isso o
 * resultado é uma faixa: do maior recorte (piso) à soma deles (teto).
 */

export type OffTargetKind = 'TERM' | 'REGION' | 'HOURS';

export interface OffTargetItem extends Perf {
  id: string;
  kind: OffTargetKind;
  label: string;
  /** Regra que o item contraria, em palavras da pessoa. */
  rule: string;
}

export interface OffTargetGroup {
  kind: OffTargetKind;
  title: string;
  items: OffTargetItem[];
  cost: number;
  clicks: number;
  conversions: number;
}

export interface AiTermVerdict {
  term: string;
  reason: string;
  evidence: string[];
}

export interface ReviewItem extends OffTargetItem {
  evidence: string[];
}

export interface OffTargetReport {
  periodCost: number;
  groups: OffTargetGroup[];
  /** Maior recorte avaliado: o mínimo que já se sabe estar fora do alvo. */
  floor: number;
  /** Soma dos recortes: o máximo, se nenhum clique se repetir entre eles. */
  ceiling: number;
  floorShare: number | null;
  ceilingShare: number | null;
  /** Termos que a IA marcou como contrários ao contexto. Ficam fora da faixa até a pessoa confirmar. */
  toConfirm: { items: ReviewItem[]; cost: number };
  /** O que não pôde ser avaliado, e como passar a avaliar. */
  notes: string[];
}

export interface OffTargetInput {
  terms: readonly Pick<
    SearchTermRow,
    'term' | 'impressions' | 'clicks' | 'cost' | 'conversions' | 'category' | 'categoryReason' | 'alreadyNegative'
  >[];
  regions: readonly RegionRow[];
  hours: readonly HourRow[];
  serviceArea: ServiceArea;
  serviceHours: ServiceHours | null;
  /** Gasto total do período (campanhas), base do percentual. */
  periodCost: number;
  ai?: readonly AiTermVerdict[];
}

const zero = (): Perf => ({ impressions: 0, clicks: 0, cost: 0, conversions: 0 });
const add = (a: Perf, b: Perf): Perf => ({
  impressions: a.impressions + b.impressions,
  clicks: a.clicks + b.clicks,
  cost: a.cost + b.cost,
  conversions: a.conversions + b.conversions,
});

type TermLike = OffTargetInput['terms'][number];

/** Um termo pode aparecer em várias campanhas: soma tudo por texto. */
function termTotals(terms: readonly TermLike[]): Map<string, TermLike & Perf> {
  const out = new Map<string, TermLike & Perf>();
  for (const t of terms) {
    const prev = out.get(t.term);
    out.set(t.term, prev ? { ...prev, ...add(prev, t), alreadyNegative: prev.alreadyNegative && t.alreadyNegative } : { ...t });
  }
  return out;
}

export const REVIEW_LIMIT = 40;

/**
 * Termos que valem a avaliação da IA: gastaram, não converteram, não são negativas nem marca,
 * e nenhuma regra da conta já os classificou. Os que mais gastaram primeiro.
 */
export function termsForReview(terms: readonly TermLike[], limit = REVIEW_LIMIT): Array<TermLike & Perf> {
  return [...termTotals(terms).values()]
    .filter(
      (t) =>
        t.cost > 0 &&
        t.conversions <= 0 &&
        !t.alreadyNegative &&
        (t.category === 'GENERAL' || t.category === 'COMPETITOR'),
    )
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit);
}

function groupOf(kind: OffTargetKind, title: string, items: OffTargetItem[]): OffTargetGroup {
  const sorted = [...items].sort((a, b) => b.cost - a.cost);
  return {
    kind,
    title,
    items: sorted,
    cost: sorted.reduce((s, i) => s + i.cost, 0),
    clicks: sorted.reduce((s, i) => s + i.clicks, 0),
    conversions: sorted.reduce((s, i) => s + i.conversions, 0),
  };
}

const WEEKDAY = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

export function computeOffTarget(input: OffTargetInput): OffTargetReport {
  const notes: string[] = [];
  const groups: OffTargetGroup[] = [];
  const totals = termTotals(input.terms);

  // Termos: só os que a lista "sem intenção de compra" da conta já reconhece e que ainda não são negativas.
  const termItems: OffTargetItem[] = [...totals.values()]
    .filter((t) => t.category === 'UNQUALIFIED' && !t.alreadyNegative && t.cost > 0)
    .map((t) => ({ id: `term:${t.term}`, kind: 'TERM' as const, label: t.term, rule: t.categoryReason, ...pick(t) }));
  groups.push(groupOf('TERM', 'Termos sem intenção de compra', termItems));

  // Regiões: só se a pessoa disse onde atende.
  if (input.serviceArea.regionIds.length) {
    const inArea = new Set(input.serviceArea.regionIds);
    const byRegion = new Map<string, { name: string; perf: Perf }>();
    for (const r of input.regions) {
      if (inArea.has(r.regionId)) continue;
      const e = byRegion.get(r.regionId) ?? { name: r.regionName, perf: zero() };
      e.perf = add(e.perf, r);
      byRegion.set(r.regionId, e);
    }
    const items = [...byRegion]
      .filter(([, e]) => e.perf.cost > 0)
      .map(([id, e]) => ({
        id: `region:${id}`,
        kind: 'REGION' as const,
        label: e.name,
        rule: 'Fora da área de atendimento que você configurou.',
        ...e.perf,
      }));
    groups.push(groupOf('REGION', 'Regiões fora da área atendida', items));
  } else {
    notes.push('Regiões não avaliadas: informe onde a empresa atende em Configurações.');
  }

  // Horários: só se a pessoa informou o horário de atendimento.
  const sh = input.serviceHours;
  if (sh) {
    let outside = zero();
    for (const h of input.hours) {
      if (h.hour < sh.startHour || h.hour >= sh.endHour || !sh.weekdays.includes(h.weekday)) outside = add(outside, h);
    }
    const rule = `Fora do horário de atendimento (${sh.weekdays.map((d) => WEEKDAY[d]).join(', ')}, ${sh.startHour}h às ${sh.endHour}h).`;
    const items: OffTargetItem[] =
      outside.cost > 0 ? [{ id: 'hours:outside', kind: 'HOURS', label: 'Fora do horário de atendimento', rule, ...outside }] : [];
    groups.push(groupOf('HOURS', 'Fora do horário de atendimento', items));
  } else {
    notes.push('Horários não avaliados: informe o horário de atendimento em Configurações.');
  }

  const costs = groups.map((g) => g.cost);
  const floor = Math.max(0, ...costs);
  const ceiling = costs.reduce((a, b) => a + b, 0);
  const share = (v: number): number | null => (input.periodCost > 0 ? Math.min(1, v / input.periodCost) : null);

  // Sugestões da IA: só termos existentes e que nenhuma regra já tenha apanhado.
  const taken = new Set(termItems.map((i) => i.label));
  const review: ReviewItem[] = [];
  for (const v of input.ai ?? []) {
    const t = totals.get(v.term);
    if (!t || taken.has(v.term) || t.alreadyNegative || t.cost <= 0) continue;
    taken.add(v.term);
    review.push({ id: `ai:${v.term}`, kind: 'TERM', label: v.term, rule: v.reason, evidence: v.evidence, ...pick(t) });
  }
  review.sort((a, b) => b.cost - a.cost);

  return {
    periodCost: input.periodCost,
    groups,
    floor,
    ceiling,
    floorShare: share(floor),
    ceilingShare: share(ceiling),
    toConfirm: { items: review, cost: review.reduce((s, i) => s + i.cost, 0) },
    notes,
  };
}

function pick(p: Perf): Perf {
  return { impressions: p.impressions, clicks: p.clicks, cost: p.cost, conversions: p.conversions };
}
