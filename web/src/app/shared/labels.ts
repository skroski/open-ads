import {
  ConfidenceLevel,
  DataSource,
  Epistemic,
  InsufficientReason,
  MatchType,
  TermCategory,
  KeywordCategory,
  Verdict,
} from '../domain/models';

export const VERDICT_LABEL: Record<Verdict, string> = {
  PROBABLE_WASTE: 'Desperdício provável',
  TRACKING_FAILURE: 'Possível falha de rastreamento',
  INSUFFICIENT_DATA: 'Falta de dados',
  ABOVE_TARGET: 'Acima da meta',
  PERFORMING: 'Dentro da meta',
};

/** Classes completas (o Tailwind precisa enxergar cada nome inteiro no código-fonte). */
export const VERDICT_CLASS: Record<Verdict, string> = {
  PROBABLE_WASTE: 'badge badge-soft badge-error',
  TRACKING_FAILURE: 'badge badge-soft badge-warning',
  INSUFFICIENT_DATA: 'badge badge-soft',
  ABOVE_TARGET: 'badge badge-soft badge-accent',
  PERFORMING: 'badge badge-soft badge-success',
};

export const EPISTEMIC_LABEL: Record<Epistemic, string> = {
  FACT: 'Fato',
  HYPOTHESIS: 'Hipótese',
  UNAVAILABLE: 'Indisponível',
};

export const EPISTEMIC_CLASS: Record<Epistemic, string> = {
  FACT: 'badge badge-outline',
  HYPOTHESIS: 'badge badge-soft badge-info',
  UNAVAILABLE: 'badge badge-dash',
};

export const EPISTEMIC_HELP: Record<Epistemic, string> = {
  FACT: 'Medido nos dados da conta.',
  HYPOTHESIS: 'Explicação plausível que ainda precisa ser verificada.',
  UNAVAILABLE: 'Informação que falta e que mudaria a conclusão.',
};

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  HIGH: 'Confiança alta',
  MEDIUM: 'Confiança média',
  LOW: 'Confiança baixa',
};

export const CONFIDENCE_CLASS: Record<ConfidenceLevel, string> = {
  HIGH: 'badge badge-soft badge-success',
  MEDIUM: 'badge badge-soft badge-warning',
  LOW: 'badge badge-ghost',
};

export const SOURCE_LABEL: Record<DataSource, string> = {
  GOOGLE_ADS: 'Google Ads',
  GA4: 'Google Analytics',
  SEARCH_CONSOLE: 'Search Console',
  SITE: 'Site',
  CRM: 'CRM',
  CONFIG: 'Configuração',
  CALCULATION: 'Cálculo',
};

export const INSUFFICIENT_LABEL: Record<InsufficientReason, string> = {
  LOW_VOLUME: 'Poucos cliques para concluir',
  IMMATURE: 'Período ainda dentro do ciclo de venda',
  NO_GOAL_DATA: 'Sem dados do estágio-meta',
  NO_CONFIG: 'Falta configurar',
  NOT_COVERED: 'Fora da cobertura dos dados',
  UNCONFIRMED: 'Sem segunda evidência que confirme',
};

export const TERM_CATEGORY_LABEL: Record<TermCategory, string> = {
  QUALIFIED: 'Qualificado',
  UNQUALIFIED: 'Não Qualificada',
  BRAND: 'Marca',
  COMPETITOR: 'Concorrente',
  GENERAL: 'Geral',
};

export const TERM_CATEGORY_CLASS: Record<TermCategory, string> = {
  QUALIFIED: 'badge badge-soft badge-success badge-xs',
  UNQUALIFIED: 'badge badge-soft badge-error badge-xs',
  BRAND: 'badge badge-soft badge-secondary badge-xs',
  COMPETITOR: 'badge badge-soft badge-info badge-xs',
  GENERAL: 'badge badge-soft badge-xs',
};

export const KEYWORD_CATEGORY_LABEL: Record<KeywordCategory, string> = {
  BRAND: 'Marca',
  QUALIFIED: 'Qualificada',
  RISK: 'Risco de desperdício',
  GENERAL: 'Geral',
};

export const KEYWORD_CATEGORY_CLASS: Record<KeywordCategory, string> = {
  BRAND: 'badge badge-soft badge-secondary badge-xs',
  QUALIFIED: 'badge badge-soft badge-success badge-xs',
  RISK: 'badge badge-soft badge-error badge-xs',
  GENERAL: 'badge badge-soft badge-xs',
};

export const MATCH_LABEL: Record<MatchType, string> = {
  EXACT: 'Exata [ ]',
  PHRASE: 'Frase " "',
  BROAD: 'Ampla',
};

export const MATCH_CLASS: Record<MatchType, string> = {
  EXACT: 'badge badge-soft badge-success',
  PHRASE: 'badge badge-soft badge-info',
  BROAD: 'badge badge-soft badge-warning',
};

export function formatMatch(text: string, type: MatchType): string {
  if (type === 'EXACT') return `[${text}]`;
  if (type === 'PHRASE') return `"${text}"`;
  return text;
}
