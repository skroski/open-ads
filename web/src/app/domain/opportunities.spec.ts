import { describe, expect, it } from 'vitest';
import { asOpportunity, opportunityCategory, opportunityStatus } from './opportunities';

describe('opportunities', () => {
  it('prioriza medição antes de classificar a oportunidade', () => {
    expect(opportunityCategory('TRACKING', 'HIGH')).toBe('MEASUREMENT');
    expect(opportunityCategory('DATA_QUALITY', 'LOW')).toBe('MEASUREMENT');
  });

  it('trata desperdício como economia e baixa confiança como experimento', () => {
    expect(opportunityCategory('WASTE', 'LOW')).toBe('ECONOMY');
    expect(opportunityCategory('LANDING_PAGE', 'LOW')).toBe('EXPERIMENT');
    expect(opportunityCategory('CONTENT', 'MEDIUM')).toBe('GROWTH');
  });

  it('mantém o estágio de decisão de uma recomendação', () => {
    expect(opportunityStatus('OPEN')).toBe('REVIEW');
    expect(opportunityStatus('ACCEPTED')).toBe('TESTING');
    expect(opportunityStatus('DONE')).toBe('APPLIED');
    expect(opportunityStatus('DISMISSED')).toBe('DISMISSED');
    expect(asOpportunity({ category: 'WASTE', status: 'OPEN', priority: 88, confidence: 'HIGH' })).toMatchObject({
      category: 'ECONOMY',
      status: 'REVIEW',
    });
  });
});
