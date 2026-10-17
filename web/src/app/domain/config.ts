import { BusinessConfig, BusinessGoal, FunnelStage, Thresholds } from './models';
import { normalize } from './text';

export const DEFAULT_THRESHOLDS: Thresholds = {
  zeroResultAlpha: 0.1,
  minClicks: 8,
  aboveTargetFactor: 1.5,
};

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

/**
 * Sugere o estágio de uma ação de conversão do Google Ads. É só uma sugestão:
 * o usuário confirma na tela de funil. O nome pode rebaixar a categoria, porque
 * "Clique no WhatsApp" costuma vir cadastrado como contato, mas ainda não é um.
 */
export function defaultStageFor(action: { name: string; category: string }): FunnelStage {
  const name = normalize(action.name);

  if (/\b(venda|vendas|compra|purchase|fechad[oa]|contrato assinado)\b/.test(name)) return 'SALE';
  if (/\bproposta\b/.test(name)) return 'PROPOSAL';
  if (/\b(qualificad[oa]s?|sql|mql)\b/.test(name)) return 'QUALIFIED';
  if (/\b(clique|cliques|click|botao|button|cta)\b/.test(name)) return 'INTERACTION';

  switch (action.category) {
    case 'QUALIFIED_LEAD':
      return 'QUALIFIED';
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
      return 'CONTACT';
  }
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
  };
}
