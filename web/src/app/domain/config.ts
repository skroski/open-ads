import { BusinessConfig, BusinessContext, BusinessGoal, FunnelStage, Thresholds } from './models';
import { normalize } from './text';

export const DEFAULT_THRESHOLDS: Thresholds = {
  zeroResultAlpha: 0.1,
  minClicks: 8,
  aboveTargetFactor: 1.5,
};

/**
 * Parâmetros da previsão. O histórico mínimo (6 semanas) é o que permite testar o método em pelo menos
 * 8 pontos de partida passados, base da faixa de incerteza e do erro exibido.
 */
export const FORECAST = {
  minHistoryDays: 42,
  maxHorizonDays: 14,
  /** Treino mínimo antes do primeiro teste com dias passados. */
  minTrainDays: 28,
  /** Testes com dias passados para o erro exibido, espaçados em 7 dias. */
  backtestOrigins: 4,
  /** Acima disto (erro médio relativo do total previsto) a previsão não é exibida. */
  maxError: 0.3,
  /** Faixa provável: 80% dos casos. */
  intervalLow: 0.1,
  intervalHigh: 0.9,
  /** Holt amortecido; valores fixos e simples de explicar. */
  alpha: 0.3,
  beta: 0.1,
  phi: 0.98,
  seasonWeeks: 8,
} as const;

/** Exigência mínima de dados por recurso. Janela comum: `SUFFICIENCY_WINDOW_DAYS` dias. */
export const SUFFICIENCY_WINDOW_DAYS = 90;

export type SufficiencyFeature = 'FORECAST_VOLUME' | 'FORECAST_CONVERSIONS' | 'RATE_ESTIMATE' | 'GOAL_COST';

export interface SufficiencyRule {
  /** Dias com impressões dentro da janela. */
  minActiveDays: number;
  minClicks: number;
  minConversions: number;
}

/** Pontos de partida a calibrar com contas reais; ficam aqui para ajuste em um só lugar. */
export const SUFFICIENCY_RULES: Record<SufficiencyFeature, SufficiencyRule> = {
  FORECAST_VOLUME: { minActiveDays: FORECAST.minHistoryDays, minClicks: 100, minConversions: 0 },
  FORECAST_CONVERSIONS: { minActiveDays: FORECAST.minHistoryDays, minClicks: 0, minConversions: 30 },
  RATE_ESTIMATE: { minActiveDays: 0, minClicks: 100, minConversions: 0 },
  GOAL_COST: { minActiveDays: 0, minClicks: 0, minConversions: 30 },
};

/** Mínimos para o auto-preenchimento de cada parâmetro (janela = período selecionado no painel). */
export const SUGGEST_RULES = {
  serviceArea: { minActiveDays: 0, minClicks: 0, minConversions: 10 },
  serviceHours: { minActiveDays: 0, minClicks: 0, minConversions: 30 },
  minClicks: { minActiveDays: 0, minClicks: 100, minConversions: 5 },
} as const satisfies Record<string, SufficiencyRule>;

/** Conversões esperadas por conta de "mínimo de cliques": cliques suficientes para ~3 conversões. */
export const MIN_CLICKS_TARGET_CONVERSIONS = 3;
export const MIN_CLICKS_RANGE = { min: 8, max: 100 } as const;

export function defaultContext(): BusinessContext {
  return { offer: '', notOffer: '', idealCustomer: '', notCustomer: '' };
}

export function defaultGoal(): BusinessGoal {
  return {
    goalStage: 'CONTACT',
    targetCostPerGoal: null,
    targetCac: null,
    targetRoiPct: null,
    defaultMarginPct: null,
    salesCycleDays: 30,
    stageLagDays: {},
  };
}

export function defaultBusinessConfig(): BusinessConfig {
  return {
    goal: defaultGoal(),
    mapping: {},
    serviceArea: { regionIds: [], regionNames: {} },
    serviceHours: null,
    thresholds: { ...DEFAULT_THRESHOLDS },
    domains: [],
    ga4PropertyId: '',
    searchConsoleSite: '',
    gtmContainerPath: '',
    gtmWorkspacePath: '',
    context: defaultContext(),
    paramStatus: {},
  };
}

/** Prazos típicos até cada estágio acontecer; a venda segue o ciclo configurado. */
const BASE_LAG: Record<FunnelStage, number> = {
  CLICK: 0,
  INTERACTION: 0,
  CONTACT: 1,
  QUALIFIED: 7,
  PROPOSAL: 14,
  SALE: 30,
};

export function stageLagDays(goal: BusinessGoal, stage: FunnelStage): number {
  const custom = goal.stageLagDays[stage];
  if (custom !== undefined && custom >= 0) return custom;
  if (stage === 'SALE') return goal.salesCycleDays;
  return BASE_LAG[stage];
}

/** Estágio deduzido só pelo nome da ação (palavras-chave), ou null quando o nome não diz nada. */
export function stageFromName(name: string): FunnelStage | null {
  const n = normalize(name);
  if (/\b(venda|vendas|compra|purchase|fechad[oa]|contrato assinado)\b/.test(n)) return 'SALE';
  if (/\bproposta\b/.test(n)) return 'PROPOSAL';
  if (/\b(qualificad[oa]s?|sql|mql)\b/.test(n)) return 'QUALIFIED';
  if (/\b(clique|cliques|click|botao|button|cta)\b/.test(n)) return 'INTERACTION';
  return null;
}

/** Estágio deduzido só pela categoria do Google Ads, ou null para categorias genéricas. */
export function stageFromCategory(category: string): FunnelStage | null {
  switch (category) {
    case 'QUALIFIED_LEAD':
      return 'QUALIFIED';
    case 'SUBMIT_LEAD_FORM':
    case 'CONTACT':
    case 'PHONE_CALL_LEAD':
    case 'IMPORTED_LEAD':
    case 'BOOK_APPOINTMENT':
    case 'REQUEST_QUOTE':
    case 'GET_QUOTE':
    case 'SIGNUP':
      return 'CONTACT';
    case 'CONVERTED_LEAD':
    case 'PURCHASE':
    case 'STORE_SALE':
    case 'SUBSCRIBE_PAID':
      return 'SALE';
    case 'PAGE_VIEW':
    case 'ENGAGEMENT':
    case 'GET_DIRECTIONS':
    case 'OUTBOUND_CLICK':
    case 'ADD_TO_CART':
    case 'BEGIN_CHECKOUT':
    case 'STORE_VISIT':
    case 'DOWNLOAD':
      return 'INTERACTION';
    default:
      return null;
  }
}

/**
 * Sugere o estágio de uma ação de conversão do Google Ads. É só uma sugestão:
 * o usuário confirma na tela de funil. O nome pode rebaixar a categoria, porque
 * "Clique no WhatsApp" costuma vir cadastrado como contato, mas ainda não é um.
 */
export function defaultStageFor(action: { name: string; category: string }): FunnelStage {
  return stageFromName(action.name) ?? stageFromCategory(action.category) ?? 'CONTACT';
}

/** Mescla o que veio salvo com os padrões, para aceitar configs de versões antigas. */
export function mergeConfig(saved: Partial<BusinessConfig> | null | undefined): BusinessConfig {
  const base = defaultBusinessConfig();
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    goal: { ...base.goal, ...(saved.goal ?? {}), stageLagDays: { ...(saved.goal?.stageLagDays ?? {}) } },
    mapping: { ...(saved.mapping ?? {}) },
    serviceArea: {
      regionIds: [...(saved.serviceArea?.regionIds ?? [])],
      regionNames: { ...(saved.serviceArea?.regionNames ?? {}) },
    },
    thresholds: { ...base.thresholds, ...(saved.thresholds ?? {}) },
    domains: [...(saved.domains ?? [])],
    context: { ...base.context, ...(saved.context ?? {}) },
    paramStatus: { ...(saved.paramStatus ?? {}) },
  };
}
