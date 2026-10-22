import { describe, expect, it } from 'vitest';
import { projectKeywordExpansion } from './growth-projection';

describe('projectKeywordExpansion', () => {
  const base = {
    impressions: 10_000,
    clicks: 500,
    conversions: 25,
    monthlySearches: 2_000,
    captureShare: 0.2,
    lowCpc: 3,
    highCpc: 5,
  };

  it('aplica as taxas observadas e a cobertura assumida sem prometer resultado', () => {
    expect(projectKeywordExpansion(base)).toEqual({
      observedCtr: 0.05,
      observedConversionRate: 0.05,
      estimatedClicks: 20,
      estimatedConversions: 1,
      estimatedLowCost: 60,
      estimatedHighCost: 100,
    });
  });

  it('não cria projeção sem uma base de impressões, cliques e demanda', () => {
    expect(projectKeywordExpansion({ ...base, clicks: 0 })).toBeNull();
    expect(projectKeywordExpansion({ ...base, impressions: 0 })).toBeNull();
    expect(projectKeywordExpansion({ ...base, monthlySearches: 0 })).toBeNull();
  });

  it('mantém conversões indisponíveis quando a campanha não tem base observada', () => {
    const scenario = projectKeywordExpansion({ ...base, conversions: 0, lowCpc: null, highCpc: null });
    expect(scenario).toMatchObject({ observedConversionRate: null, estimatedConversions: null, estimatedLowCost: null, estimatedHighCost: null });
  });
});
