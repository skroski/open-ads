import { defaultStageFor, stageLagDays } from './config';
import { DateWindow, diffDays, eachDay, today as todayIso } from './dates';
import {
  BusinessGoal,
  CampaignRow,
  ConversionActionInfo,
  ConversionBreakdownRow,
  ConversionMapping,
  FUNNEL_STAGES,
  FunnelStage,
  Lead,
} from './models';
import { normalize, tokens } from './text';

/**
 * Funil de qualidade: clique → interação → contato → qualificado → proposta → venda.
 *
 * Duas fontes alimentam o funil e nunca são somadas (para não contar a mesma
 * pessoa duas vezes):
 *  - Google Ads: conversões classificadas por ação (mapeamento configurável);
 *  - CRM: leads importados, que são a única fonte de qualificação, proposta, venda e receita.
 *
 * O "valor de conversão" do Google Ads NÃO entra em receita nem em ROI: na prática
 * é um número fixo cadastrado na ação (ex.: R$ 60 por contato).
 */

export type StageSource = 'ADS' | 'CRM' | 'NONE';

export interface StageValue {
  count: number;
  ads: number;
  crm: number;
  source: StageSource;
}

export interface FunnelMetrics {
  cost: number;
  impressions: number;
  clicks: number;
  stages: Record<FunnelStage, StageValue>;
  /** Custo por unidade de cada estágio; null quando não há unidades (nunca zero). */
  costPer: Record<FunnelStage, number | null>;
  /** Receita das vendas registradas no CRM; null quando não há CRM no período. */
  revenue: number | null;
  salesWithoutValue: number;
  grossProfit: number | null;
  /** Fração da receita que tem margem conhecida (0–1). */
  marginCoverage: number;
  roi: number | null;
  roiOnMargin: number | null;
}

export interface ActionResolution {
  name: string;
  category: string;
  stage: FunnelStage | 'IGNORE';
  /** O usuário confirmou este mapeamento (senão é só a sugestão automática). */
  confirmed: boolean;
  conversions: number;
  allConversions: number;
  value: number;
}

export interface LeadAttribution {
  byCampaign: Map<string, Lead[]>;
  unattributed: Lead[];
}

// ───────────────────────── Mapeamento de ações ─────────────────────────

export function resolveStage(
  action: { name: string; category: string },
  mapping: ConversionMapping,
): { stage: FunnelStage | 'IGNORE'; confirmed: boolean } {
  const chosen = mapping[action.name];
  if (chosen) return { stage: chosen, confirmed: true };
  return { stage: defaultStageFor(action), confirmed: false };
}

/** Agrupa a quebra de conversões por ação, já com o estágio resolvido. */
export function resolveActions(
  breakdown: readonly ConversionBreakdownRow[],
  actions: readonly ConversionActionInfo[],
  mapping: ConversionMapping,
): ActionResolution[] {
  const byName = new Map<string, ActionResolution>();
  for (const a of actions) {
    const r = resolveStage(a, mapping);
    byName.set(a.name, {
      name: a.name,
      category: a.category,
      stage: r.stage,
      confirmed: r.confirmed,
      conversions: 0,
      allConversions: 0,
      value: 0,
    });
  }
  for (const row of breakdown) {
    let entry = byName.get(row.actionName);
    if (!entry) {
      const r = resolveStage({ name: row.actionName, category: row.category }, mapping);
      entry = {
        name: row.actionName,
        category: row.category,
        stage: r.stage,
        confirmed: r.confirmed,
        conversions: 0,
        allConversions: 0,
        value: 0,
      };
      byName.set(row.actionName, entry);
    }
    entry.conversions += row.conversions;
    entry.allConversions += row.allConversions;
    entry.value += row.value;
  }
  return Array.from(byName.values()).sort((a, b) => b.allConversions - a.allConversions);
}

// ───────────────────────── Valor de conversão do Ads ─────────────────────────

export interface AdsValueAnalysis {
  total: number;
  /** O valor por conversão é o mesmo em todas as linhas: é um valor padrão, não receita. */
  isStatic: boolean;
  perConversion: number | null;
}

export function analyzeAdsValue(
  breakdown: readonly ConversionBreakdownRow[],
  actions: readonly ConversionActionInfo[],
): AdsValueAnalysis {
  const rows = breakdown.filter((r) => r.conversions > 0);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const perConv = rows.map((r) => r.value / r.conversions);
  const first = perConv[0];
  const allEqual = perConv.length > 0 && perConv.every((v) => Math.abs(v - first) < 0.005);
  const alwaysDefault = actions.some((a) => a.alwaysUseDefaultValue === true);
  // Estático = o Ads sempre usa o valor padrão da ação, ou todas as linhas têm o mesmo valor por conversão.
  const isStatic = rows.length > 0 && (alwaysDefault || (perConv.length >= 2 && allEqual));
  return { total, isStatic, perConversion: allEqual ? first : null };
}

// ───────────────────────── Atribuição de leads a campanhas ─────────────────────────

export function attributeLeads(leads: readonly Lead[], campaigns: readonly CampaignRow[]): LeadAttribution {
  const byCampaign = new Map<string, Lead[]>();
  const unattributed: Lead[] = [];

  const prepared = campaigns.map((c) => ({ id: c.id, norm: normalize(c.name), tokens: new Set(tokens(c.name)) }));

  for (const lead of leads) {
    const ref = (lead.campaign ?? '').trim();
    let matchId: string | undefined;
    if (ref) {
      const digits = ref.replace(/\D/g, '');
      matchId = prepared.find((c) => digits.length >= 6 && c.id === digits)?.id;
      if (!matchId) {
        const norm = normalize(ref);
        matchId = prepared.find((c) => c.norm === norm)?.id;
        if (!matchId) {
          // Parcial: todas as palavras da UTM estão no nome da campanha, e só em uma campanha.
          const leadTokens = tokens(ref);
          if (leadTokens.length >= 2) {
            const hits = prepared.filter((c) => leadTokens.every((t) => c.tokens.has(t)));
            if (hits.length === 1) matchId = hits[0].id;
          }
        }
      }
    }
    if (matchId) {
      const list = byCampaign.get(matchId) ?? [];
      list.push(lead);
      byCampaign.set(matchId, list);
    } else {
      unattributed.push(lead);
    }
  }
  return { byCampaign, unattributed };
}

// ───────────────────────── Estágios alcançados por um lead ─────────────────────────

export function leadReached(lead: Lead): Record<'qualified' | 'proposal' | 'sale', boolean> {
  const sale = lead.status === 'WON' || !!lead.wonAt;
  const proposal = sale || lead.status === 'PROPOSAL' || !!lead.proposalAt;
  const qualified = proposal || lead.status === 'QUALIFIED' || !!lead.qualifiedAt;
  return { qualified, proposal, sale };
}

export function leadsInWindow(leads: readonly Lead[], w: DateWindow): Lead[] {
  return leads.filter((l) => l.createdAt >= w.from && l.createdAt <= w.to);
}

// ───────────────────────── Montagem do funil ─────────────────────────

interface BuildScope {
  cost: number;
  impressions: number;
  clicks: number;
  adsByStage: Partial<Record<FunnelStage, number>>;
  leads: readonly Lead[];
  crmPresent: boolean;
}

const EMPTY_STAGE: StageValue = { count: 0, ads: 0, crm: 0, source: 'NONE' };

function buildMetrics(scope: BuildScope, defaultMarginPct: number | null): FunnelMetrics {
  const crm = { contact: 0, qualified: 0, proposal: 0, sale: 0 };
  let revenue = 0;
  let salesWithoutValue = 0;
  let profit = 0;
  let revenueWithMargin = 0;

  for (const lead of scope.leads) {
    crm.contact++;
    const r = leadReached(lead);
    if (r.qualified) crm.qualified++;
    if (r.proposal) crm.proposal++;
    if (r.sale) {
      crm.sale++;
      if (lead.value !== undefined && lead.value >= 0) {
        revenue += lead.value;
        const margin = lead.marginPct ?? defaultMarginPct;
        if (margin !== null && margin !== undefined) {
          profit += (lead.value * margin) / 100;
          revenueWithMargin += lead.value;
        }
      } else {
        salesWithoutValue++;
      }
    }
  }

  const stages = {} as Record<FunnelStage, StageValue>;
  for (const s of FUNNEL_STAGES) stages[s] = { ...EMPTY_STAGE };

  stages.CLICK = { count: scope.clicks, ads: scope.clicks, crm: 0, source: 'ADS' };
  const adsInteraction = scope.adsByStage.INTERACTION ?? 0;
  stages.INTERACTION = {
    count: adsInteraction,
    ads: adsInteraction,
    crm: 0,
    source: adsInteraction > 0 ? 'ADS' : 'NONE',
  };

  // Contato: o Ads é a fonte preferida (rastreamento direto); o CRM cobre quando o Ads não tem.
  const adsContact = scope.adsByStage.CONTACT ?? 0;
  stages.CONTACT = {
    ads: adsContact,
    crm: crm.contact,
    count: adsContact > 0 ? adsContact : crm.contact,
    source: adsContact > 0 ? 'ADS' : crm.contact > 0 ? 'CRM' : 'NONE',
  };

  // Qualificado, proposta e venda: o CRM é a fonte preferida.
  const late: Array<['QUALIFIED' | 'PROPOSAL' | 'SALE', number]> = [
    ['QUALIFIED', crm.qualified],
    ['PROPOSAL', crm.proposal],
    ['SALE', crm.sale],
  ];
  for (const [stage, crmCount] of late) {
    const ads = scope.adsByStage[stage] ?? 0;
    stages[stage] = {
      ads,
      crm: crmCount,
      count: crmCount > 0 ? crmCount : ads,
      source: crmCount > 0 ? 'CRM' : ads > 0 ? 'ADS' : scope.crmPresent ? 'CRM' : 'NONE',
    };
  }

  const costPer = {} as Record<FunnelStage, number | null>;
  for (const s of FUNNEL_STAGES) {
    const v = stages[s];
    costPer[s] = v.source !== 'NONE' && v.count > 0 ? scope.cost / v.count : null;
  }

  // Sem nenhum lead do CRM no período não existe receita conhecida (e não "R$ 0").
  const revenueKnown = scope.crmPresent ? revenue : null;
  const marginCoverage = revenue > 0 ? revenueWithMargin / revenue : defaultMarginPct !== null ? 1 : 0;
  const complete = salesWithoutValue === 0;

  return {
    cost: scope.cost,
    impressions: scope.impressions,
    clicks: scope.clicks,
    stages,
    costPer,
    revenue: revenueKnown,
    salesWithoutValue,
    grossProfit: revenueKnown !== null && revenueWithMargin > 0 ? profit : null,
    marginCoverage,
    roi:
      revenueKnown !== null && scope.cost > 0 && complete ? (revenueKnown - scope.cost) / scope.cost : null,
    roiOnMargin:
      revenueKnown !== null && scope.cost > 0 && complete && marginCoverage >= 0.999
        ? (profit - scope.cost) / scope.cost
        : null,
  };
}

export interface FunnelInput {
  campaigns: readonly CampaignRow[];
  breakdown: readonly ConversionBreakdownRow[];
  actions: readonly ConversionActionInfo[];
  mapping: ConversionMapping;
  leads: readonly Lead[];
  window: DateWindow;
  goal: BusinessGoal;
}

export interface FunnelResult {
  total: FunnelMetrics;
  byCampaign: Map<string, FunnelMetrics>;
  resolutions: ActionResolution[];
  unattributedLeads: number;
  crmPresent: boolean;
  /** Conversões do Ads em ações ainda não confirmadas pelo usuário. */
  unconfirmedConversions: number;
  adsValue: AdsValueAnalysis;
}

export function buildFunnel(input: FunnelInput): FunnelResult {
  const cohort = leadsInWindow(input.leads, input.window);
  const crmPresent = cohort.length > 0;
  const resolutions = resolveActions(input.breakdown, input.actions, input.mapping);
  const stageByAction = new Map(resolutions.map((r) => [r.name, r.stage]));
  const attribution = attributeLeads(cohort, input.campaigns);

  const adsByCampaign = new Map<string, Partial<Record<FunnelStage, number>>>();
  const adsTotal: Partial<Record<FunnelStage, number>> = {};
  for (const row of input.breakdown) {
    const stage = stageByAction.get(row.actionName);
    if (!stage || stage === 'IGNORE') continue;
    adsTotal[stage] = (adsTotal[stage] ?? 0) + row.allConversions;
    const per = adsByCampaign.get(row.campaignId) ?? {};
    per[stage] = (per[stage] ?? 0) + row.allConversions;
    adsByCampaign.set(row.campaignId, per);
  }

  const byCampaign = new Map<string, FunnelMetrics>();
  for (const c of input.campaigns) {
    byCampaign.set(
      c.id,
      buildMetrics(
        {
          cost: c.cost,
          impressions: c.impressions,
          clicks: c.clicks,
          adsByStage: adsByCampaign.get(c.id) ?? {},
          leads: attribution.byCampaign.get(c.id) ?? [],
          crmPresent,
        },
        input.goal.defaultMarginPct,
      ),
    );
  }

  const total = buildMetrics(
    {
      cost: input.campaigns.reduce((s, c) => s + c.cost, 0),
      impressions: input.campaigns.reduce((s, c) => s + c.impressions, 0),
      clicks: input.campaigns.reduce((s, c) => s + c.clicks, 0),
      adsByStage: adsTotal,
      leads: cohort,
      crmPresent,
    },
    input.goal.defaultMarginPct,
  );

  return {
    total,
    byCampaign,
    resolutions,
    unattributedLeads: attribution.unattributed.length,
    crmPresent,
    unconfirmedConversions: resolutions
      .filter((r) => !r.confirmed && r.stage !== 'IGNORE')
      .reduce((s, r) => s + r.allConversions, 0),
    adsValue: analyzeAdsValue(input.breakdown, input.actions),
  };
}

// ───────────────────────── Meta do negócio ─────────────────────────

export type GoalStatus = 'NO_TARGET' | 'MET' | 'ABOVE' | 'NO_RESULTS' | 'NO_DATA';

export interface GoalEvaluation {
  stage: FunnelStage;
  count: number;
  source: StageSource;
  costPerGoal: number | null;
  target: number | null;
  status: GoalStatus;
}

export function evaluateGoal(m: FunnelMetrics, goal: BusinessGoal, aboveFactor = 1.5): GoalEvaluation {
  const v = m.stages[goal.goalStage];
  const costPerGoal = m.costPer[goal.goalStage];
  const target = goal.targetCostPerGoal;
  let status: GoalStatus;
  if (v.source === 'NONE') status = 'NO_DATA';
  else if (v.count === 0) status = 'NO_RESULTS';
  else if (target === null || target <= 0) status = 'NO_TARGET';
  else if ((costPerGoal ?? 0) > target * aboveFactor) status = 'ABOVE';
  else status = 'MET';
  return { stage: goal.goalStage, count: v.count, source: v.source, costPerGoal, target, status };
}

// ───────────────────────── Maturação ─────────────────────────

/**
 * Fração da janela que já teve tempo de produzir o estágio. Um clique de ontem
 * ainda não teve prazo de virar venda: cortar por ele seria precipitado.
 * `onDate` existe para testes; em produção é hoje.
 */
export function windowMaturity(w: DateWindow, lagDays: number, onDate: string = todayIso()): number {
  if (lagDays <= 0) return 1;
  const days = eachDay(w.from, w.to);
  if (!days.length) return 1;
  const matured = days.filter((d) => diffDays(d, onDate) >= lagDays).length;
  return matured / days.length;
}

/** Data a partir da qual a janela inteira estará madura. */
export function maturesOn(w: DateWindow, lagDays: number): string {
  const d = new Date(`${w.to}T00:00:00`);
  d.setDate(d.getDate() + lagDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function goalLagDays(goal: BusinessGoal): number {
  return stageLagDays(goal, goal.goalStage);
}
