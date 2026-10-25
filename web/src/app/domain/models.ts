/**
 * Modelos do domínio. Nenhum import de Angular aqui: o domínio é TypeScript puro,
 * para ser testado sem TestBed e reaproveitado no servidor se for preciso.
 */

// ───────────────────────── Contas ─────────────────────────

export interface AccountRef {
  id: string;
  name: string;
  manager?: boolean;
  loginCustomerId?: string;
}

// ───────────────────────── Métricas base ─────────────────────────

export interface Perf {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
}

// ───────────────────────── Google Ads (dados brutos normalizados) ─────────────────────────

export type ChannelType =
  | 'SEARCH'
  | 'DISPLAY'
  | 'PERFORMANCE_MAX'
  | 'VIDEO'
  | 'SHOPPING'
  | 'DEMAND_GEN'
  | 'OTHER';

export interface CampaignRow extends Perf {
  id: string;
  name: string;
  status: string;
  channel: ChannelType;
}

export interface DailyRow extends Perf {
  date: string; // YYYY-MM-DD
  campaignId: string;
  campaignName: string;
}

export type TermCategory = 'QUALIFIED' | 'UNQUALIFIED' | 'BRAND' | 'COMPETITOR' | 'GENERAL';

export interface SearchTermRow extends Perf {
  term: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  /** O Google Ads marcou o termo como já excluído por palavra negativa. */
  excluded: boolean;
  /** Existe uma palavra negativa de campanha idêntica a este termo. */
  alreadyNegative: boolean;
  category: TermCategory;
  categoryReason: string;
}

export interface DeviceRow extends Perf {
  device: string;
}

export interface NetworkRow extends Perf {
  network: string;
  label: string;
}

export interface HourRow extends Perf {
  /** 1 = segunda … 7 = domingo. */
  weekday: number;
  hour: number;
  campaignId: string;
}

export type LocationType = 'LOCATION_OF_PRESENCE' | 'AREA_OF_INTEREST' | 'UNKNOWN';

export interface RegionRow extends Perf {
  regionId: string;
  regionName: string;
  locationType: LocationType;
}

export interface LandingPageRow extends Perf {
  url: string;
  normalizedUrl: string;
  campaignId: string;
  campaignName: string;
}

export interface AdRow extends Perf {
  adId: string;
  type: string;
  status: string;
  finalUrls: string[];
  headlines: string[];
  descriptions: string[];
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
}

export interface PlacementRow extends Perf {
  name: string;
  type: string;
  targetUrl: string;
  campaignId: string;
}

/**
 * Grupo de recursos de Performance Max. O Google não expõe grupos de anúncios
 * tradicionais para PMax; este é o nível em que a composição dos recursos é
 * administrada e avaliada.
 */
export interface PmaxAssetGroupRow extends Perf {
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  adStrength: string;
  assetCoverage: string;
  primaryStatus: string;
}

/** Recurso associado a um grupo PMax, com métricas do período selecionado. */
export interface PmaxAssetRow extends Perf {
  assetGroupId: string;
  campaignId: string;
  asset: string;
  fieldType: string;
  primaryStatus: string;
  status: string;
}

export interface ConversionActionInfo {
  id: string;
  name: string;
  category: string;
  type: string;
  status: string;
  primary: boolean;
  includeInConversions: boolean;
  countingType: string;
  defaultValue?: number;
  alwaysUseDefaultValue?: boolean;
}

export interface ConversionBreakdownRow {
  campaignId: string;
  actionName: string;
  category: string;
  conversions: number;
  allConversions: number;
  /** Valor registrado pelo Google Ads. NÃO é receita: veja `detectStaticValue`. */
  value: number;
}

/** Onde a negativa mora no Google Ads. */
export type NegativeLevel = 'CAMPAIGN' | 'AD_GROUP' | 'SHARED_LIST';

export interface NegativeKeyword {
  id: string;
  campaignId: string;
  campaignName: string;
  text: string;
  matchType: MatchType;
  /** Ausente em dados antigos: trate como campanha. */
  level?: NegativeLevel;
  /** Só para negativas de grupo de anúncios: valem apenas dentro do grupo. */
  adGroupId?: string;
  adGroupName?: string;
  /** Só para listas compartilhadas: uma linha por campanha que usa a lista. */
  listId?: string;
  listName?: string;
}

export type MatchType = 'EXACT' | 'PHRASE' | 'BROAD';

/** Nota do Google Ads para cada componente do Índice de Qualidade. */
export type QualityRating = 'ABOVE_AVERAGE' | 'AVERAGE' | 'BELOW_AVERAGE';

export interface KeywordQuality {
  /** 1–10; null quando o Google ainda não tem dados (pouco volume). */
  score: number | null;
  adRelevance: QualityRating | null;
  landingPage: QualityRating | null;
  expectedCtr: QualityRating | null;
}

export type KeywordCategory = 'BRAND' | 'QUALIFIED' | 'RISK' | 'GENERAL';

export interface KeywordRow extends Perf {
  resourceName: string;
  criterionId: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  text: string;
  matchType: MatchType;
  status: 'ENABLED' | 'PAUSED';
  /** Teto de CPC da palavra (R$). Indefinido = usa o lance do grupo. */
  bid?: number;
  /** URL final própria da palavra (raro); vazia = usa a do anúncio. */
  finalUrls?: string[];
  quality?: KeywordQuality;
  category: KeywordCategory;
  categoryReason: string;
}

export interface CampaignLocation {
  campaignId: string;
  regionId: string;
  negative: boolean;
}

export interface GoogleAdsChange {
  /** ISO local "YYYY-MM-DD HH:mm:ss". */
  at: string;
  resourceType: string;
  operation: string;
  changedFields: string[];
  userEmail: string;
  clientType: string;
  campaignId?: string;
  adGroupId?: string;
}

export interface AccountInfo {
  id: string;
  name: string;
  currency: string;
  timeZone: string;
}

// ───────────────────────── Funil ─────────────────────────

/**
 * Estágios do funil, em ordem. "Receita" não é um estágio: é um valor monetário
 * que só existe a partir de vendas registradas.
 */
export type FunnelStage = 'CLICK' | 'INTERACTION' | 'CONTACT' | 'QUALIFIED' | 'PROPOSAL' | 'SALE';

export const FUNNEL_STAGES: readonly FunnelStage[] = [
  'CLICK',
  'INTERACTION',
  'CONTACT',
  'QUALIFIED',
  'PROPOSAL',
  'SALE',
];

export const STAGE_LABEL: Record<FunnelStage, string> = {
  CLICK: 'Clique',
  INTERACTION: 'Interação',
  CONTACT: 'Contato iniciado',
  QUALIFIED: 'Lead qualificado',
  PROPOSAL: 'Proposta',
  SALE: 'Venda',
};

export const STAGE_HELP: Record<FunnelStage, string> = {
  CLICK: 'A pessoa clicou no anúncio e chegou ao site.',
  INTERACTION: 'Ação de interesse, como clicar no botão do WhatsApp ou no telefone. Ainda não é um contato.',
  CONTACT: 'A pessoa enviou um formulário, ligou ou iniciou uma conversa de fato.',
  QUALIFIED: 'O atendimento confirmou que tem perfil para comprar.',
  PROPOSAL: 'Uma proposta ou orçamento foi enviado.',
  SALE: 'Cliente fechado. Só aqui existe receita.',
};

/** Etapa em que uma ação de conversão do Google Ads é contabilizada (ou ignorada). */
export type ConversionMapping = Record<string, FunnelStage | 'IGNORE'>;

// ───────────────────────── CRM (importado/manual) ─────────────────────────

export type LeadStatus = 'OPEN' | 'QUALIFIED' | 'PROPOSAL' | 'WON' | 'LOST' | 'DISQUALIFIED';

export interface Lead {
  id: string;
  accountId: string;
  /** Identificador no CRM de origem, usado para não duplicar importações. */
  externalId?: string;
  createdAt: string; // YYYY-MM-DD do primeiro contato
  campaign?: string; // nome ou id da campanha
  term?: string;
  gclid?: string;
  source?: string;
  landingPage?: string;
  region?: string;
  status: LeadStatus;
  qualifiedAt?: string;
  proposalAt?: string;
  wonAt?: string;
  lostAt?: string;
  /** Receita da venda (R$). Só faz sentido com status WON. */
  value?: number;
  /** Margem desta venda em % (0–100). Quando ausente, vale a margem padrão da meta. */
  marginPct?: number;
  lostReason?: string;
  firstResponseMinutes?: number;
}

// ───────────────────────── Configuração do negócio ─────────────────────────

export interface AuditRules {
  brandTerms: string[];
  unqualifiedTerms: string[];
  qualifiedTerms: string[];
  competitorTerms: string[];
}

export interface BusinessGoal {
  /** Estágio que representa "um bom resultado" para este negócio. */
  goalStage: FunnelStage;
  /** Custo máximo aceitável por resultado do estágio-meta (R$). */
  targetCostPerGoal: number | null;
  /** Custo máximo aceitável por cliente (R$). */
  targetCac: number | null;
  /** ROI mínimo desejado, em % (ex.: 100 = ganhar o dobro do investido). */
  targetRoiPct: number | null;
  /** Margem padrão (%) usada quando a venda não informa a própria. */
  defaultMarginPct: number | null;
  /** Dias típicos entre o primeiro contato e a venda. */
  salesCycleDays: number;
  /** Dias típicos até o estágio acontecer (usado para não cortar cedo demais). */
  stageLagDays: Partial<Record<FunnelStage, number>>;
}

export interface ServiceHours {
  startHour: number; // 0–23
  endHour: number; // 1–24
  /** 1 = segunda … 7 = domingo. */
  weekdays: number[];
}

export interface ServiceArea {
  /** IDs de região (geoTargetConstants) em que a empresa realmente atende. */
  regionIds: string[];
  /** Nomes legíveis, para exibir sem nova consulta. */
  regionNames: Record<string, string>;
}

export interface Thresholds {
  /** Probabilidade máxima de "zero resultados por acaso" para falar em desperdício. */
  zeroResultAlpha: number;
  /** Mínimo de cliques para qualquer veredito. */
  minClicks: number;
  /** Múltiplo da meta de custo a partir do qual há "acima da meta". */
  aboveTargetFactor: number;
}

/** Contexto em linguagem livre: ajuda a separar o que combina com o negócio do que o Google entrega por engano. */
export interface BusinessContext {
  /** O que a empresa vende. */
  offer: string;
  /** O que a empresa NÃO vende ou não atende. */
  notOffer: string;
  /** Quem é o cliente ideal. */
  idealCustomer: string;
  /** Quem não é cliente. */
  notCustomer: string;
}

/** Parâmetros que o painel sabe sugerir a partir dos dados da conta. */
export type ParamKey =
  | 'mapping'
  | 'goalStage'
  | 'targetCostPerGoal'
  | 'serviceArea'
  | 'serviceHours'
  | 'minClicks'
  | 'domains';

/**
 * Estado gravado de um parâmetro. Sem entrada, vale o padrão (ou o valor antigo,
 * tratado como manual). "Sugerido" nunca é gravado: só existe na tela, até a pessoa decidir.
 */
export type ParamStatus = 'CONFIRMED' | 'MANUAL';

export interface BusinessConfig {
  goal: BusinessGoal;
  mapping: ConversionMapping;
  serviceArea: ServiceArea;
  serviceHours: ServiceHours | null;
  thresholds: Thresholds;
  /** Domínios do site (para auditar páginas e relacionar GA4/Search Console). */
  domains: string[];
  ga4PropertyId: string;
  searchConsoleSite: string;
  /** Caminhos relativos escolhidos na API do Google Tag Manager, por conta Ads. */
  gtmContainerPath: string;
  gtmWorkspacePath: string;
  context: BusinessContext;
  /** Parâmetros já decididos pela pessoa; o auto-preenchimento nunca os sobrescreve. */
  paramStatus: Partial<Record<ParamKey, ParamStatus>>;
}

// ───────────────────────── Evidência, veredito e recomendação ─────────────────────────

/** Natureza de uma afirmação: o que foi medido, o que se supõe e o que falta. */
export type Epistemic = 'FACT' | 'HYPOTHESIS' | 'UNAVAILABLE';

export type DataSource = 'GOOGLE_ADS' | 'GA4' | 'SEARCH_CONSOLE' | 'SITE' | 'CRM' | 'CONFIG' | 'CALCULATION';

export interface Evidence {
  kind: Epistemic;
  text: string;
  source: DataSource;
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Confidence {
  level: ConfidenceLevel;
  /** Motivos curtos que sustentam o nível. */
  reasons: string[];
}

export type Verdict =
  | 'PROBABLE_WASTE'
  | 'TRACKING_FAILURE'
  | 'INSUFFICIENT_DATA'
  | 'ABOVE_TARGET'
  | 'PERFORMING';

export type InsufficientReason =
  | 'LOW_VOLUME'
  | 'IMMATURE'
  | 'NO_GOAL_DATA'
  | 'NO_CONFIG'
  | 'NOT_COVERED'
  | 'UNCONFIRMED';

export type WasteDimension = 'campaign' | 'ad' | 'term' | 'keyword' | 'region' | 'device' | 'hour' | 'page' | 'placement';

export interface Assessment {
  verdict: Verdict;
  confidence: Confidence;
  evidence: Evidence[];
  /** Sinais independentes que reforçam o veredito (ex.: termo da lista de desqualificados). */
  signals: string[];
  reason?: InsufficientReason;
  /** Chance de ver zero resultados só por acaso, dada a taxa de referência. */
  chanceByLuck?: number;
}

export interface WasteRow {
  dimension: WasteDimension;
  key: string;
  label: string;
  sublabel?: string;
  perf: Perf;
  /** Resultados no estágio-meta (contatos, qualificados…). */
  outcomes: number;
  /** false distingue resultado desconhecido de zero medido. */
  outcomesKnown?: boolean;
  outcomeSource?: DataSource;
  assessment: Assessment;
  /** Ritmo de gasto mensalizado; não é previsão de economia nem impacto causal. */
  monthlyCost: number;
  /** Já bloqueado no Google Ads (termo negativado): conta o gasto, mas não há o que negativar. */
  blocked?: boolean;
}

export type RecommendationCategory =
  | 'WASTE'
  | 'TRACKING'
  | 'FUNNEL'
  | 'LANDING_PAGE'
  | 'CONTENT'
  | 'CAMPAIGN'
  | 'DATA_QUALITY';

export type RecommendationStatus = 'OPEN' | 'ACCEPTED' | 'DONE' | 'DISMISSED';

export interface RecommendationAction {
  /** Texto do botão. */
  label: string;
  kind: 'NEGATE_TERMS' | 'ROUTE' | 'NONE';
  /** Termos a negativar (NEGATE_TERMS) ou rota (ROUTE). */
  terms?: string[];
  route?: string;
  queryParams?: Record<string, string>;
}

export interface Recommendation {
  id: string;
  category: RecommendationCategory;
  title: string;
  /** Problema encontrado, em linguagem simples. */
  problem: string;
  evidence: Evidence[];
  impact: {
    /** Valor mensal estimado em R$, quando faz sentido. */
    monthlyCostBrl?: number;
    description: string;
    /** Em que suposição a estimativa se apoia. */
    basis: string;
  };
  /** Ação sugerida. */
  action: string;
  actionButton?: RecommendationAction;
  confidence: Confidence;
  /** Como saber se a ação funcionou. */
  validation: string;
  /** 0–100, só para ordenar. */
  priority: number;
  entity?: { type: string; id: string; label: string };
}

export interface RecommendationState {
  id: string;
  accountId: string;
  status: RecommendationStatus;
  note?: string;
  updatedAt: string;
}

// ───────────────────────── Conteúdo ─────────────────────────

export type SearchIntent =
  | 'INFORMATIONAL'
  | 'COMMERCIAL'
  | 'TRANSACTIONAL'
  | 'NAVIGATIONAL'
  | 'SUPPORT'
  | 'JOB'
  | 'FREE'
  | 'UNKNOWN';

export type ContentRole = 'ATTRACT' | 'DECIDE' | 'CONVERT';

export type ContentStatus = 'IDEA' | 'DRAFT' | 'PUBLISHED' | 'UPDATING' | 'ARCHIVED';

export interface ContentItem {
  id: string;
  accountId: string;
  title: string;
  url: string;
  theme: string;
  audience: string;
  intent: SearchIntent;
  role: ContentRole;
  objective: string;
  status: ContentStatus;
  publishedAt?: string;
  updates: Array<{ at: string; note: string }>;
  productionCost?: number;
  notes?: string;
}

/** Pergunta que os clientes fazem no atendimento: demanda real por conteúdo. */
export interface SupportQuestion {
  id: string;
  accountId: string;
  question: string;
  /** Quantas vezes apareceu no período observado. */
  count: number;
  createdAt: string;
}

// ───────────────────────── Histórico, hipóteses e aprendizados ─────────────────────────

export type ChangeKind =
  | 'CAMPAIGN'
  | 'KEYWORD'
  | 'NEGATIVE'
  | 'BID'
  | 'AD'
  | 'URL'
  | 'PAGE'
  | 'CONTENT'
  | 'SERVICE'
  | 'TRACKING'
  | 'OTHER';

export type ChangeSource = 'APP' | 'GOOGLE_ADS' | 'MANUAL';

export interface Snapshot {
  /** Janela usada como base de comparação. */
  from: string;
  to: string;
  perf: Perf;
}

export interface ChangeEntry {
  id: string;
  accountId: string;
  /** Data/hora da mudança, ISO ("YYYY-MM-DDTHH:mm:ss" ou só a data). */
  at: string;
  kind: ChangeKind;
  title: string;
  description?: string;
  source: ChangeSource;
  author?: string;
  entity?: { type: string; id: string; label: string };
  /** Escopo da medição: uma campanha específica, ou a conta toda quando ausente. */
  campaignId?: string;
  /** Efeito esperado, para poder confirmar ou refutar depois. */
  expected?: string;
  /** Chave estável usada para não duplicar eventos importados do Google Ads. */
  externalKey?: string;
}

export type HypothesisStatus = 'DRAFT' | 'RUNNING' | 'CONCLUDED' | 'ABORTED';
export type HypothesisKind = 'LANDING_URL' | 'CONTENT' | 'COPY' | 'BID' | 'OTHER';
export type HypothesisMethod = 'BEFORE_AFTER' | 'EXPERIMENT';

export interface Hypothesis {
  id: string;
  accountId: string;
  createdAt: string;
  kind: HypothesisKind;
  title: string;
  /** "Se fizermos X, então Y, porque Z." */
  statement: string;
  fromUrl?: string;
  toUrl?: string;
  campaignId?: string;
  method: HypothesisMethod;
  status: HypothesisStatus;
  /** Data em que a mudança entrou no ar. */
  startedAt?: string;
  /** Melhora relativa mínima que valeria a pena detectar, em %. */
  minLiftPct: number;
  baseline?: Snapshot;
  conclusion?: string;
}

export type LearningVerdict = 'CONFIRMED' | 'REFUTED' | 'INCONCLUSIVE';

export interface Learning {
  id: string;
  accountId: string;
  at: string;
  title: string;
  insight: string;
  verdict: LearningVerdict;
  tags: string[];
  sourceId?: string;
}

// ───────────────────────── Site e analytics ─────────────────────────

/** Resultado da leitura de uma página do site (HTML analisado no servidor). */
export interface PageAudit {
  url: string;
  normalizedUrl: string;
  fetchedAt: string;
  /** Código HTTP final. Nulo quando a página não pôde ser lida. */
  status: number | null;
  ok: boolean;
  finalUrl?: string;
  responseMs?: number;
  title?: string;
  metaDescription?: string;
  h1: string[];
  h2: string[];
  forms: number;
  telLinks: number;
  whatsappLinks: number;
  hasViewport: boolean;
  hasCanonical: boolean;
  noindex: boolean;
  lang?: string;
  /** Etiquetas de medição encontradas no HTML (ex.: gtag, gtm, meta-pixel). */
  trackingTags: string[];
  wordCount: number;
  error?: string;
}

export interface Ga4PageRow {
  /** Caminho da página (ex.: "/ia-para-clinicas/"). */
  path: string;
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  /** Duração média de engajamento em segundos. */
  avgEngagementSec: number;
}

export interface Ga4ChannelRow {
  channel: string;
  sessions: number;
  keyEvents: number;
}

export interface SearchConsolePageRow {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchConsoleQueryRow {
  query: string;
  page?: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Série diária de uma métrica, usada para avaliar efeitos ao longo do tempo. */
export interface SeriesPoint {
  date: string;
  value: number;
}

/** Estado de uma fonte de dados externa (GA4, Search Console, IA). */
export interface SourceStatus {
  configured: boolean;
  /** Por que está indisponível, em linguagem simples. */
  reason?: string;
}
