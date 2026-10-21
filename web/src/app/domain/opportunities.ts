import { RecommendationCategory, RecommendationStatus } from './models';

/** Como a Central agrupa recomendações sem alterar a evidência de origem. */
export type OpportunityCategory = 'ECONOMY' | 'GROWTH' | 'MEASUREMENT' | 'EXPERIMENT';

export type OpportunityStatus = 'REVIEW' | 'TESTING' | 'APPLIED' | 'DISMISSED';

export interface OpportunitySource {
  category: RecommendationCategory;
  status: RecommendationStatus;
  priority: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface Opportunity extends Omit<OpportunitySource, 'category' | 'status'> {
  category: OpportunityCategory;
  status: OpportunityStatus;
}

/**
 * Medição vem antes de escala. O restante preserva a categoria analítica,
 * evitando vender como "economia" uma mudança que ainda é uma hipótese.
 */
export function opportunityCategory(category: RecommendationCategory, confidence: OpportunitySource['confidence']): OpportunityCategory {
  if (category === 'TRACKING' || category === 'DATA_QUALITY') return 'MEASUREMENT';
  if (category === 'WASTE') return 'ECONOMY';
  if (confidence === 'LOW') return 'EXPERIMENT';
  return 'GROWTH';
}

export function opportunityStatus(status: RecommendationStatus): OpportunityStatus {
  switch (status) {
    case 'ACCEPTED':
      return 'TESTING';
    case 'DONE':
      return 'APPLIED';
    case 'DISMISSED':
      return 'DISMISSED';
    default:
      return 'REVIEW';
  }
}

export function asOpportunity(source: OpportunitySource): Opportunity {
  return {
    ...source,
    category: opportunityCategory(source.category, source.confidence),
    status: opportunityStatus(source.status),
  };
}
