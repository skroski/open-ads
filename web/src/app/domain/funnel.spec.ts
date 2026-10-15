import { defaultGoal, defaultStageFor, stageLagDays } from './config';
import { attributeLeads, buildFunnel, evaluateGoal, leadReached, maturesOn, windowMaturity } from './funnel';
import { CampaignRow, ConversionActionInfo, ConversionBreakdownRow, Lead } from './models';

const window = { from: '2026-09-13', to: '2026-10-12', days: 30 };

const campaigns: CampaignRow[] = [
  { id: '1000000001', name: 'Acme Display', status: 'ENABLED', channel: 'DISPLAY', impressions: 68150, clicks: 553, cost: 189.33, conversions: 4 },
  { id: '1000000002', name: 'Campanha Acme - Pesquisa', status: 'ENABLED', channel: 'SEARCH', impressions: 1500, clicks: 34, cost: 102.56, conversions: 11 },
  { id: '1000000003', name: 'Acme Pesquisa - Donos e Dentistas [SP-SC-PR-RS-DF]', status: 'PAUSED', channel: 'SEARCH', impressions: 900, clicks: 54, cost: 107.02, conversions: 18 },
];

const contactAction: ConversionActionInfo = {
  id: '1',
  name: 'Contato Site Acme',
  category: 'CONTACT',
  type: 'WEBPAGE',
  status: 'ENABLED',
  primary: true,
  includeInConversions: true,
  countingType: 'ONE_PER_CLICK',
  defaultValue: 30,
  alwaysUseDefaultValue: true,
};

// Valor fixo de R$ 60 por conversão, como na conta real.
const breakdown: ConversionBreakdownRow[] = [
  { campaignId: '1000000001', actionName: 'Contato Site Acme', category: 'CONTACT', conversions: 4, allConversions: 4, value: 240 },
  { campaignId: '1000000002', actionName: 'Contato Site Acme', category: 'CONTACT', conversions: 11, allConversions: 11, value: 660 },
  { campaignId: '1000000003', actionName: 'Contato Site Acme', category: 'CONTACT', conversions: 18, allConversions: 18, value: 1080 },
];

const lead = (over: Partial<Lead>): Lead => ({
  id: crypto.randomUUID(),
  accountId: '1234567890',
  createdAt: '2026-09-20',
  status: 'OPEN',
  ...over,
});

describe('mapeamento de ações', () => {
  it('uma ação da categoria CONTACT é contato iniciado', () => {
    expect(defaultStageFor({ name: 'Contato Site Acme', category: 'CONTACT' })).toBe('CONTACT');
  });

  it('clique no WhatsApp é interação, mesmo cadastrado como contato', () => {
    expect(defaultStageFor({ name: 'Clique no WhatsApp', category: 'CONTACT' })).toBe('INTERACTION');
    expect(defaultStageFor({ name: 'Botão ligar', category: 'SUBMIT_LEAD_FORM' })).toBe('INTERACTION');
  });

  it('reconhece venda e qualificação pelo nome ou pela categoria', () => {
    expect(defaultStageFor({ name: 'Venda fechada', category: 'DEFAULT' })).toBe('SALE');
    expect(defaultStageFor({ name: 'Lead qualificado', category: 'DEFAULT' })).toBe('QUALIFIED');
    expect(defaultStageFor({ name: 'x', category: 'QUALIFIED_LEAD' })).toBe('QUALIFIED');
    expect(defaultStageFor({ name: 'x', category: 'PURCHASE' })).toBe('SALE');
  });
});

describe('funil sem CRM (dados reais da conta)', () => {
  const result = buildFunnel({
    campaigns,
    breakdown,
    actions: [contactAction],
    mapping: {},
    leads: [],
    window,
    goal: defaultGoal(),
  });

  it('conta contatos pelo Google Ads e não inventa qualificados nem vendas', () => {
    expect(result.total.stages.CONTACT.count).toBe(33);
    expect(result.total.stages.CONTACT.source).toBe('ADS');
    expect(result.total.stages.QUALIFIED.source).toBe('NONE');
    expect(result.total.stages.SALE.source).toBe('NONE');
    expect(result.total.costPer.SALE).toBeNull();
    expect(result.total.costPer.QUALIFIED).toBeNull();
  });

  it('custo por contato = custo / contatos', () => {
    expect(result.total.costPer.CONTACT).toBeCloseTo(398.91 / 33, 4);
  });

  it('não existe receita nem ROI sem CRM', () => {
    expect(result.total.revenue).toBeNull();
    expect(result.total.roi).toBeNull();
    expect(result.crmPresent).toBe(false);
  });

  it('detecta que o valor de conversão do Google Ads é fixo', () => {
    expect(result.adsValue.isStatic).toBe(true);
    expect(result.adsValue.perConversion).toBe(60);
  });

  it('marca como não confirmada a ação mapeada só por sugestão', () => {
    expect(result.unconfirmedConversions).toBe(33);
    const confirmed = buildFunnel({
      campaigns,
      breakdown,
      actions: [contactAction],
      mapping: { 'Contato Site Acme': 'CONTACT' },
      leads: [],
      window,
      goal: defaultGoal(),
    });
    expect(confirmed.unconfirmedConversions).toBe(0);
  });

  it('respeita IGNORE: a ação deixa de contar em qualquer estágio', () => {
    const ignored = buildFunnel({
      campaigns,
      breakdown,
      actions: [contactAction],
      mapping: { 'Contato Site Acme': 'IGNORE' },
      leads: [],
      window,
      goal: defaultGoal(),
    });
    expect(ignored.total.stages.CONTACT.count).toBe(0);
    expect(ignored.total.stages.CONTACT.source).toBe('NONE');
  });
});

describe('funil com CRM', () => {
  const leads: Lead[] = [
    lead({ campaign: 'Campanha Acme - Pesquisa', status: 'WON', wonAt: '2026-10-01', value: 3000, marginPct: 50 }),
    lead({ campaign: 'campanha acme pesquisa', status: 'QUALIFIED' }),
    lead({ campaign: '1000000003', status: 'PROPOSAL' }),
    lead({ campaign: 'Campanha Acme - Pesquisa', status: 'DISQUALIFIED', lostReason: 'sem perfil' }),
    lead({ campaign: 'indireto', status: 'OPEN' }),
    lead({ campaign: 'Campanha Acme - Pesquisa', status: 'OPEN', createdAt: '2026-08-01' }), // fora da janela
  ];

  const result = buildFunnel({
    campaigns,
    breakdown,
    actions: [contactAction],
    mapping: { 'Contato Site Acme': 'CONTACT' },
    leads,
    window,
    goal: { ...defaultGoal(), defaultMarginPct: null },
  });

  it('atribui leads por nome normalizado e por id, e separa os sem origem', () => {
    const pesquisa = result.byCampaign.get('1000000002');
    expect(pesquisa?.stages.CONTACT.crm).toBe(3);
    expect(result.byCampaign.get('1000000003')?.stages.PROPOSAL.crm).toBe(1);
    expect(result.unattributedLeads).toBe(1);
  });

  it('ignora leads fora da janela', () => {
    expect(result.total.stages.CONTACT.crm).toBe(5);
  });

  it('qualificado/proposta/venda vêm do CRM e são cumulativos', () => {
    expect(result.total.stages.QUALIFIED.count).toBe(3); // WON + QUALIFIED + PROPOSAL
    expect(result.total.stages.PROPOSAL.count).toBe(2); // WON + PROPOSAL
    expect(result.total.stages.SALE.count).toBe(1);
    expect(result.total.stages.SALE.source).toBe('CRM');
  });

  it('receita, ROI e ROI sobre margem vêm só do CRM', () => {
    expect(result.total.revenue).toBe(3000);
    expect(result.total.roi).toBeCloseTo((3000 - 398.91) / 398.91, 4);
    expect(result.total.grossProfit).toBe(1500);
    expect(result.total.roiOnMargin).toBeCloseTo((1500 - 398.91) / 398.91, 4);
    expect(result.total.costPer.SALE).toBeCloseTo(398.91, 2);
  });

  it('sem margem informada, não calcula ROI sobre margem', () => {
    const noMargin = buildFunnel({
      campaigns,
      breakdown,
      actions: [contactAction],
      mapping: {},
      leads: [lead({ campaign: 'Campanha Acme - Pesquisa', status: 'WON', wonAt: '2026-10-01', value: 1000 })],
      window,
      goal: defaultGoal(),
    });
    expect(noMargin.total.roi).not.toBeNull();
    expect(noMargin.total.roiOnMargin).toBeNull();
    expect(noMargin.total.grossProfit).toBeNull();
  });

  it('com margem padrão, calcula ROI sobre margem', () => {
    const withDefault = buildFunnel({
      campaigns,
      breakdown,
      actions: [contactAction],
      mapping: {},
      leads: [lead({ campaign: 'Campanha Acme - Pesquisa', status: 'WON', wonAt: '2026-10-01', value: 1000 })],
      window,
      goal: { ...defaultGoal(), defaultMarginPct: 40 },
    });
    expect(withDefault.total.grossProfit).toBe(400);
    expect(withDefault.total.roiOnMargin).toBeCloseTo((400 - 398.91) / 398.91, 4);
  });

  it('venda sem valor informado impede o ROI de ser calculado', () => {
    const r = buildFunnel({
      campaigns,
      breakdown,
      actions: [contactAction],
      mapping: {},
      leads: [lead({ campaign: 'Campanha Acme - Pesquisa', status: 'WON' })],
      window,
      goal: defaultGoal(),
    });
    expect(r.total.salesWithoutValue).toBe(1);
    expect(r.total.roi).toBeNull();
  });
});

describe('atribuição de leads', () => {
  it('não atribui quando a UTM bate com duas campanhas', () => {
    const two: CampaignRow[] = [
      { ...campaigns[1], id: '1', name: 'Pesquisa Clinicas SP' },
      { ...campaigns[1], id: '2', name: 'Pesquisa Clinicas RJ' },
    ];
    const r = attributeLeads([lead({ campaign: 'pesquisa clinicas' })], two);
    expect(r.unattributed).toHaveLength(1);
  });

  it('um lead que chegou à venda também passou por qualificação e proposta', () => {
    expect(leadReached(lead({ status: 'WON' }))).toEqual({ qualified: true, proposal: true, sale: true });
    expect(leadReached(lead({ status: 'LOST', qualifiedAt: '2026-09-25' })).qualified).toBe(true);
    expect(leadReached(lead({ status: 'DISQUALIFIED' })).qualified).toBe(false);
  });
});

describe('meta e maturação', () => {
  const base = buildFunnel({
    campaigns,
    breakdown,
    actions: [contactAction],
    mapping: {},
    leads: [],
    window,
    goal: defaultGoal(),
  });

  it('sem meta de custo, o status é NO_TARGET (não "dentro da meta")', () => {
    expect(evaluateGoal(base.total, defaultGoal()).status).toBe('NO_TARGET');
  });

  it('compara o custo por resultado com a meta e o fator de tolerância', () => {
    const goal = { ...defaultGoal(), targetCostPerGoal: 5 };
    expect(evaluateGoal(base.total, goal).status).toBe('ABOVE'); // 12,09 > 5 * 1,5
    expect(evaluateGoal(base.total, { ...goal, targetCostPerGoal: 20 }).status).toBe('MET');
  });

  it('estágio sem fonte de dados vira NO_DATA', () => {
    const goal = { ...defaultGoal(), goalStage: 'SALE' as const };
    expect(evaluateGoal(base.total, goal).status).toBe('NO_DATA');
  });

  it('a janela só amadurece depois do ciclo de venda', () => {
    // Janela de 30 dias terminando em 12/10, ciclo de 30 dias, hoje 13/10: quase nada amadureceu.
    expect(windowMaturity(window, 30, '2026-10-13')).toBeLessThan(0.05);
    expect(windowMaturity(window, 30, '2026-11-20')).toBe(1);
    expect(windowMaturity(window, 0, '2026-10-13')).toBe(1);
    // Em 13/10 com prazo de 7 dias, amadurecem os dias até 06/10: 18 de setembro + 6 de outubro = 24 de 30.
    expect(windowMaturity(window, 7, '2026-10-13')).toBeCloseTo(24 / 30, 5);
  });

  it('informa a data em que a janela fica madura', () => {
    expect(maturesOn(window, 30)).toBe('2026-11-11');
  });

  it('o prazo da venda segue o ciclo configurado', () => {
    expect(stageLagDays({ ...defaultGoal(), salesCycleDays: 45 }, 'SALE')).toBe(45);
    expect(stageLagDays(defaultGoal(), 'CONTACT')).toBe(1);
  });
});
