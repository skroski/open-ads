import { Hypothesis, HypothesisKind, Recommendation } from './models';

export type HypothesisDraft = Omit<Hypothesis, 'id' | 'accountId'>;

/** Limite do "Auto mágico": poucas hipóteses por vez, para não virar uma fila ilegível. */
export const AUTO_DRAFT_LIMIT = 5;

export function hypothesisKindOf(category: Recommendation['category']): HypothesisKind {
  return category === 'LANDING_PAGE' ? 'LANDING_URL' : category === 'CONTENT' ? 'CONTENT' : category === 'CAMPAIGN' ? 'BID' : 'OTHER';
}

export function hypothesisTitle(r: Pick<Recommendation, 'title'>): string {
  return `Validar: ${r.title}`;
}

/** Rascunho de hipótese a partir de uma recomendação. Não altera nada na conta de anúncios. */
export function hypothesisFromRecommendation(
  r: Pick<Recommendation, 'category' | 'title' | 'action' | 'problem' | 'entity'>,
  createdAt: string,
): HypothesisDraft {
  return {
    createdAt,
    kind: hypothesisKindOf(r.category),
    title: hypothesisTitle(r),
    statement: `Se executarmos “${r.action}”, esperamos melhorar o resultado definido para esta oportunidade, porque ${r.problem.toLowerCase()}`,
    campaignId: r.entity?.type === 'campaign' ? r.entity.id : undefined,
    method: 'EXPERIMENT',
    status: 'DRAFT',
    minLiftPct: 10,
  };
}

/**
 * Escolhe as recomendações em aberto, mais prioritárias e ainda sem hipótese com o mesmo título.
 * Recomendações já aceitas, aplicadas ou descartadas ficam de fora.
 */
export function pickForAutoDraft<T extends Pick<Recommendation, 'title' | 'priority'> & { status: string }>(
  recommendations: readonly T[],
  existingTitles: readonly string[],
  limit = AUTO_DRAFT_LIMIT,
): T[] {
  const taken = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  return recommendations
    .filter((r) => r.status === 'OPEN' && !taken.has(hypothesisTitle(r).toLowerCase()))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}
