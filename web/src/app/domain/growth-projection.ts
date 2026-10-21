/**
 * Cenário de descoberta de novas palavras. Não é uma previsão do Google Ads:
 * aplica CTR e taxa de conversão observados à demanda e à cobertura assumida
 * pela pessoa. A origem e as premissas devem acompanhar qualquer exibição.
 */
export interface GrowthProjectionInput {
  /** Desempenho observado da campanha escolhida no período atual. */
  impressions: number;
  clicks: number;
  conversions: number;
  /** Soma de buscas médias mensais das ideias escolhidas no Planejador. */
  monthlySearches: number;
  /** Parcela da demanda selecionada que se imagina capturar (0 a 1). */
  captureShare: number;
  /** Faixa de CPC de topo fornecida pelo Planejador, quando disponível. */
  lowCpc: number | null;
  highCpc: number | null;
}

export interface GrowthProjection {
  observedCtr: number;
  observedConversionRate: number | null;
  estimatedClicks: number;
  estimatedConversions: number | null;
  estimatedLowCost: number | null;
  estimatedHighCost: number | null;
}

export function projectKeywordExpansion(input: GrowthProjectionInput): GrowthProjection | null {
  if (input.impressions <= 0 || input.clicks <= 0 || input.monthlySearches <= 0) return null;
  const captureShare = Math.max(0, Math.min(1, input.captureShare));
  const observedCtr = input.clicks / input.impressions;
  const estimatedClicks = input.monthlySearches * captureShare * observedCtr;
  const observedConversionRate = input.conversions > 0 ? input.conversions / input.clicks : null;
  return {
    observedCtr,
    observedConversionRate,
    estimatedClicks,
    estimatedConversions: observedConversionRate === null ? null : estimatedClicks * observedConversionRate,
    estimatedLowCost: input.lowCpc === null ? null : estimatedClicks * input.lowCpc,
    estimatedHighCost: input.highCpc === null ? null : estimatedClicks * input.highCpc,
  };
}
