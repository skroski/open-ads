import {
  aggregateMatchesGoal,
  analyzeEfficiency,
  efficiencyAdvice,
  scopeWasteInputs,
} from './efficiency';
import { defaultGoal } from './config';
import { BusinessGoal, CampaignRow, ConversionActionInfo, WasteRow } from './models';
import { WasteEnv, WasteInputs } from './waste-dimensions';

const goal: BusinessGoal = { ...defaultGoal(), targetCostPerGoal: 20 };
const window = { from: '2026-09-01', to: '2026-09-30', days: 30 };
const perf = { clicks: 200, cost: 600, impressions: 2000, conversions: 10 };
const action: ConversionActionInfo = {
  id: '1',
  name: 'Contato',
  category: 'SUBMIT_LEAD_FORM',
  type: 'WEBPAGE',
  status: 'ENABLED',
  primary: true,
  includeInConversions: true,
  countingType: 'ONE_PER_CLICK',
};
const campaign = (id: string, channel: CampaignRow['channel']): CampaignRow => ({
  ...perf,
  id,
  channel,
  name: id,
  status: 'ENABLED',
});
const input = (): WasteInputs => ({
  funnel: null,
  campaigns: [campaign('display', 'DISPLAY'), campaign('busca', 'SEARCH')],
  campaignMaturity: new Map(),
  campaignNames: new Map(),
  channelNames: new Map(),
  terms: [],
  keywords: [],
  ads: [],
  regions: [],
  devices: [],
  placements: [],
  hours: [],
  landingPages: [],
  ga4Rows: null,
  brand: [],
  adsByGroup: new Map(),
  crmByTerm: { available: false, map: new Map() },
  auditOf: () => undefined,
  serviceArea: { regionIds: [], regionNames: {} },
  serviceHours: null,
});
const row = (over: Partial<WasteRow> = {}): WasteRow => ({
  key: '1',
  dimension: 'campaign',
  label: 'Campanha',
  perf,
  outcomes: 10,
  outcomesKnown: true,
  monthlyCost: 600,
  assessment: {
    verdict: 'ABOVE_TARGET',
    confidence: { level: 'HIGH', reasons: ['Volume suficiente.'] },
    signals: [],
    evidence: [
      { kind: 'FACT', source: 'GOOGLE_ADS', text: 'Gasto observado.' },
      { kind: 'HYPOTHESIS', source: 'CALCULATION', text: 'Criativo pode precisar de revisão.' },
      { kind: 'UNAVAILABLE', source: 'CRM', text: 'Qualificação ausente.' },
    ],
  },
  ...over,
});

describe('efficiency — integridade do recorte', () => {
  it('permite o total de conversões apenas quando todas as ações contadas têm a meta confirmada', () => {
    expect(aggregateMatchesGoal([action], { Contato: 'CONTACT' }, goal)).toBe(true);
    expect(aggregateMatchesGoal([action], {}, goal)).toBe(false);
    expect(
      aggregateMatchesGoal(
        [action, { ...action, name: 'Botão' }],
        { Contato: 'CONTACT', Botão: 'INTERACTION' },
        goal,
      ),
    ).toBe(false);
    expect(aggregateMatchesGoal([], {}, goal)).toBe(false);
  });
  it('não confunde ações secundárias com as conversões primárias do relatório', () => {
    expect(
      aggregateMatchesGoal(
        [action, { ...action, name: 'Botão', primary: false }],
        { Contato: 'CONTACT' },
        goal,
      ),
    ).toBe(true);
  });
  it('não distribui regiões e dispositivos da conta como se fossem dados do Display', () => {
    const scoped = scopeWasteInputs(input(), 'DISPLAY');
    expect(scoped.campaigns?.map((c) => c.id)).toEqual(['display']);
    expect(scoped.regions).toBeUndefined();
    expect(scoped.devices).toBeUndefined();
    const all = input();
    expect(scopeWasteInputs(all, 'ALL')).toBe(all);
  });
  it('mantém páginas, anúncios, horários e posicionamentos somente da campanha selecionada', () => {
    const data = input();
    data.placements = ['display', 'busca'].map((campaignId) => ({
      ...perf,
      campaignId,
      name: campaignId,
      type: 'WEBSITE',
      targetUrl: campaignId,
    }));
    data.hours = ['display', 'busca'].map((campaignId) => ({
      ...perf,
      campaignId,
      weekday: 1,
      hour: 12,
    }));
    const scoped = scopeWasteInputs(data, 'ALL', 'display');
    expect(scoped.placements?.map((p) => p.campaignId)).toEqual(['display']);
    expect(scoped.hours?.map((p) => p.campaignId)).toEqual(['display']);
    expect(scoped.devices).toBeUndefined();
    expect(scopeWasteInputs(data, 'SEARCH', 'display').campaigns).toEqual([]);
  });
  it('filtrar uma campanha não altera os dados de entrada', () => {
    const data = input();
    scopeWasteInputs(data, 'DISPLAY');
    expect(data.campaigns).toHaveLength(2);
  });
  it('um aplicativo sem resultado não é condenado por uma hipótese sobre cliques acidentais', () => {
    const data = input();
    data.placements = [
      {
        ...perf,
        campaignId: 'display',
        conversions: 0,
        name: 'App',
        type: 'MOBILE_APPLICATION',
        targetUrl: 'app',
      },
      {
        ...perf,
        campaignId: 'display',
        conversions: 60,
        name: 'Site',
        type: 'WEBSITE',
        targetUrl: 'site',
      },
    ];
    const env: WasteEnv = {
      context: {
        goal,
        windowDays: 30,
        thresholds: { minClicks: 8, zeroResultAlpha: 0.1, aboveTargetFactor: 1.5 },
      },
      adsMeasured: true,
      outcomesOf: () => null,
      options: (dimension, groupLabel, extra) => ({
        dimension,
        groupLabel,
        maturity: 1,
        costTarget: 20,
        costTargetIsAverage: false,
        ...extra,
      }),
    };
    const report = analyzeEfficiency(data, env, 'DISPLAY');
    expect(report.placement[0].assessment.reason).toBe('UNCONFIRMED');
    expect(report.placement[0].assessment.evidence.some((e) => e.kind === 'HYPOTHESIS')).toBe(true);
  });
});

describe('efficiency — explicações para o cliente', () => {
  it('separa fatos, hipóteses e lacunas e usa o período no cenário histórico', () => {
    const advice = efficiencyAdvice(row(), goal, window);
    expect(advice.facts.every((e) => e.kind === 'FACT')).toBe(true);
    expect(advice.hypotheses.every((e) => e.kind === 'HYPOTHESIS')).toBe(true);
    expect(advice.missing.every((e) => e.kind === 'UNAVAILABLE')).toBe(true);
    expect(advice.impact.amount).toBe(400);
    expect(advice.impact.basis).toContain(window.from);
    expect(advice.impact.basis).toContain('não é economia garantida');
  });
  it('não estima impacto com pouco volume, meta ausente ou resultado desconhecido', () => {
    expect(efficiencyAdvice(row({ outcomes: 2 }), goal, window).impact.amount).toBeNull();
    expect(
      efficiencyAdvice(row(), { ...goal, targetCostPerGoal: null }, window).impact.amount,
    ).toBeNull();
    expect(efficiencyAdvice(row({ outcomesKnown: false }), goal, window).impact.amount).toBeNull();
    const low = row();
    low.assessment.confidence.level = 'LOW';
    expect(efficiencyAdvice(low, goal, window).impact.amount).toBeNull();
  });
  it('não promete economia nem sugere nova exclusão para itens bloqueados', () => {
    const advice = efficiencyAdvice(row({ blocked: true }), goal, window);
    expect(advice.action).toContain('não há nova exclusão');
    expect(advice.impact.amount).toBeNull();
  });
  it('prioriza corrigir medição e explica por que zero desconhecido não deve ser usado', () => {
    const missing = row({ outcomesKnown: false });
    missing.assessment = {
      ...missing.assessment,
      verdict: 'INSUFFICIENT_DATA',
      reason: 'NO_GOAL_DATA',
    };
    expect(efficiencyAdvice(missing, goal, window).action).toContain('não significa zero');
    const broken = row();
    broken.assessment = { ...broken.assessment, verdict: 'TRACKING_FAILURE' };
    expect(efficiencyAdvice(broken, goal, window).priority).toBe(0);
  });
});
