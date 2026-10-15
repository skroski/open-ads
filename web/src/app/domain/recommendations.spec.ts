import { defaultGoal } from './config';
import { ContentOpportunity } from './content';
import { buildFunnel } from './funnel';
import { narrate, toPlainText } from './narrative';
import { PageFinding, RecommendationInput, buildRecommendations } from './recommendations';
import {
  CampaignRow,
  ConversionActionInfo,
  ConversionBreakdownRow,
  Recommendation,
  SearchTermRow,
  WasteRow,
} from './models';
import { OutageFinding } from './tracking';

const campaigns: CampaignRow[] = [
  { id: 'd', name: 'Acme Display', status: 'ENABLED', channel: 'DISPLAY', impressions: 68150, clicks: 553, cost: 189.33, conversions: 4 },
  { id: 's', name: 'Campanha Acme - Pesquisa', status: 'ENABLED', channel: 'SEARCH', impressions: 1500, clicks: 34, cost: 102.56, conversions: 11 },
  { id: 'p', name: 'Acme Pesquisa - Donos', status: 'PAUSED', channel: 'SEARCH', impressions: 900, clicks: 54, cost: 107.02, conversions: 18 },
];

const action: ConversionActionInfo = {
  id: '1',
  name: 'Contato Site Acme',
  category: 'CONTACT',
  type: 'WEBPAGE',
  status: 'ENABLED',
  primary: true,
  includeInConversions: true,
  countingType: 'ONE_PER_CLICK',
  alwaysUseDefaultValue: true,
};

const breakdown: ConversionBreakdownRow[] = campaigns.map((c) => ({
  campaignId: c.id,
  actionName: 'Contato Site Acme',
  category: 'CONTACT',
  conversions: c.conversions,
  allConversions: c.conversions,
  value: c.conversions * 60,
}));

const funnel = buildFunnel({
  campaigns,
  breakdown,
  actions: [action],
  mapping: {},
  leads: [],
  window: { from: '2026-09-13', to: '2026-10-12', days: 30 },
  goal: defaultGoal(),
});

const wasteRow = (over: Partial<WasteRow> & Pick<WasteRow, 'dimension' | 'key' | 'label'>): WasteRow => ({
  perf: { impressions: 100, clicks: 50, cost: 40, conversions: 0 },
  outcomes: 0,
  monthlyCost: 40,
  assessment: {
    verdict: 'PROBABLE_WASTE',
    confidence: { level: 'MEDIUM', reasons: [] },
    evidence: [{ kind: 'FACT', source: 'GOOGLE_ADS', text: '50 cliques e R$ 40,00.' }],
    signals: ['x'],
  },
  ...over,
});

const baseInput = (): RecommendationInput => ({
  windowDays: 30,
  windowLabel: 'Últimos 30 dias',
  goal: defaultGoal(),
  thresholds: { zeroResultAlpha: 0.1, minClicks: 8, aboveTargetFactor: 1.5 },
  maturity: 1,
  maturesOn: '2026-10-12',
  funnel,
  campaigns,
  waste: { campaigns: [], terms: [], regions: [], hours: [], pages: [], placements: [] },
  terms: [],
  outages: [],
  pageFindings: [],
  contentOpportunities: [],
  crmQuality: null,
  sources: { crm: false, ga4: { configured: false }, searchConsole: { configured: false } },
  serviceAreaConfigured: true,
  searchCoverage: 0.9,
});

const term = (t: string, cost: number, cat: SearchTermRow['category'] = 'UNQUALIFIED'): SearchTermRow => ({
  term: t,
  campaignId: 's',
  campaignName: 'Campanha Acme - Pesquisa',
  adGroupId: 'g',
  adGroupName: 'G',
  excluded: false,
  alreadyNegative: false,
  category: cat,
  categoryReason: 'Contém "gratis", da lista de termos sem intenção de compra.',
  impressions: 50,
  clicks: 10,
  cost,
  conversions: 0,
});

const check = (r: Recommendation): void => {
  expect(r.id).toBeTruthy();
  expect(r.problem.length).toBeGreaterThan(10);
  expect(r.action.length).toBeGreaterThan(5);
  expect(r.validation.length).toBeGreaterThan(3);
  expect(r.evidence.length).toBeGreaterThan(0);
  expect(r.confidence.reasons.length).toBeGreaterThan(0);
  expect(r.priority).toBeGreaterThanOrEqual(0);
  expect(r.priority).toBeLessThanOrEqual(100);
};

describe('buildRecommendations', () => {
  it('toda recomendação traz problema, evidência, ação, confiança e validação', () => {
    const input = baseInput();
    input.terms = [term('curso gratis', 20)];
    input.waste.terms = [wasteRow({ dimension: 'term', key: 'tutorial|s|g', label: 'tutorial ia' })];
    const recs = buildRecommendations(input);
    expect(recs.length).toBeGreaterThan(3);
    recs.forEach(check);
  });

  it('falha de rastreamento aparece primeiro', () => {
    const input = baseInput();
    const outage: OutageFinding = {
      scope: 'ACCOUNT',
      from: '2026-10-01',
      to: '2026-10-12',
      days: 12,
      clicks: 300,
      cost: 450,
      baselineRate: 0.05,
      chanceByLuck: 0.0001,
      ongoing: true,
    };
    input.outages = [outage];
    input.waste.terms = [wasteRow({ dimension: 'term', key: 'a', label: 'a' })];
    const recs = buildRecommendations(input);
    expect(recs[0].category).toBe('TRACKING');
    expect(recs[0].confidence.level).toBe('HIGH');
    expect(recs[0].evidence.some((e) => e.kind === 'UNAVAILABLE')).toBe(true);
  });

  it('desperdício provável em termos vira uma ação de negativar com os termos certos', () => {
    const input = baseInput();
    input.waste.terms = [
      wasteRow({ dimension: 'term', key: 'curso ia|s|g', label: 'curso ia', perf: { impressions: 1, clicks: 60, cost: 90, conversions: 0 } }),
      wasteRow({ dimension: 'term', key: 'vagas|s|g', label: 'vagas ia', perf: { impressions: 1, clicks: 40, cost: 50, conversions: 0 } }),
    ];
    const rec = buildRecommendations(input).find((r) => r.id === 'waste:terms:probable');
    expect(rec).toBeDefined();
    expect(rec?.actionButton?.kind).toBe('NEGATE_TERMS');
    expect(rec?.actionButton?.terms).toEqual(['curso ia', 'vagas ia']);
    expect(rec?.impact.monthlyCostBrl).toBeCloseTo(80, 5); // dois fixtures com monthlyCost 40
  });

  it('não repete como "lista de desqualificados" os termos já listados como desperdício provável', () => {
    const input = baseInput();
    input.terms = [term('curso ia', 30), term('tutorial ia', 15)];
    input.waste.terms = [wasteRow({ dimension: 'term', key: 'curso ia|s|g', label: 'curso ia' })];
    const rec = buildRecommendations(input).find((r) => r.id === 'waste:terms:unqualified');
    expect(rec?.actionButton?.terms).toEqual(['tutorial ia']);
  });

  it('termo desqualificado que converteu avisa para conferir antes de negativar', () => {
    const input = baseInput();
    const t = term('suporte acme', 12);
    t.conversions = 2;
    input.terms = [t];
    const rec = buildRecommendations(input).find((r) => r.id === 'waste:terms:unqualified');
    expect(rec?.confidence.level).toBe('LOW');
    expect(rec?.actionButton?.terms).toEqual([]);
  });

  it('alerta que o valor de conversão do Google Ads é fixo', () => {
    const rec = buildRecommendations(baseInput()).find((r) => r.id === 'data:static-value');
    expect(rec).toBeDefined();
    expect(rec?.problem).toContain('R$');
  });

  it('pede dados do CRM quando não há leads, e meta quando não foi definida', () => {
    const ids = buildRecommendations(baseInput()).map((r) => r.id);
    expect(ids).toContain('data:no-crm');
    expect(ids).toContain('data:no-target');
    expect(ids).toContain('data:unconfirmed-mapping');
  });

  it('avisa sobre período imaturo e informa a data de maturação', () => {
    const input = baseInput();
    input.maturity = 0.2;
    input.maturesOn = '2026-11-11';
    const rec = buildRecommendations(input).find((r) => r.id === 'data:immature');
    expect(rec?.action).toContain('2026-11-11');
  });

  it('campanha pausada que performava vira pergunta, não ordem', () => {
    const input = baseInput();
    input.waste.campaigns = [
      wasteRow({
        dimension: 'campaign',
        key: 'p',
        label: 'Acme Pesquisa - Donos',
        perf: { impressions: 900, clicks: 54, cost: 107.02, conversions: 18 },
        outcomes: 18,
        assessment: {
          verdict: 'PERFORMING',
          confidence: { level: 'HIGH', reasons: ['18 resultados.'] },
          evidence: [],
          signals: [],
        },
      }),
    ];
    const rec = buildRecommendations(input).find((r) => r.id === 'campaign:paused-performing:p');
    expect(rec).toBeDefined();
    expect(rec?.evidence.some((e) => e.kind === 'HYPOTHESIS')).toBe(true);
    expect(rec?.evidence.some((e) => e.kind === 'UNAVAILABLE')).toBe(true);
  });

  it('sugere a página melhor como hipótese verificável, sem prometer resultado', () => {
    const input = baseInput();
    const finding: PageFinding = {
      cluster: {
        id: 'c1',
        topics: ['chatbot', 'clinica'],
        label: 'chatbot para clinica',
        terms: [term('chatbot para clinica', 30, 'QUALIFIED')],
        clicks: 40,
        cost: 60,
        conversions: 2,
        impressions: 500,
        intent: 'COMMERCIAL',
      },
      currentUrls: ['https://exemplo.com.br'],
      recommendation: {
        kind: 'REDIRECT',
        best: { url: 'https://exemplo.com.br/chatbot-clinica/', normalizedUrl: 'exemplo.com.br/chatbot-clinica', words: [], basis: 'URL', origin: 'x' },
        bestScore: 1,
        currentScore: null,
        note: '',
      },
      coherence: null,
    };
    input.pageFindings = [finding];
    const rec = buildRecommendations(input).find((r) => r.id === 'landing:redirect:c1');
    expect(rec).toBeDefined();
    expect(rec?.impact.basis.toLowerCase()).toContain('hipótese');
    expect(rec?.validation).toContain('antes e depois');
  });

  it('inclui conteúdo com prioridade menor que desperdício e rastreamento', () => {
    const input = baseInput();
    const opp: ContentOpportunity = {
      id: 'publish:x',
      type: 'PUBLISH',
      topic: 'crm odontologico',
      intent: 'COMMERCIAL',
      role: 'DECIDE',
      demand: { clicks: 40, impressions: 0, cost: 80, conversions: 0, paid: true, organic: false },
      evidence: [{ kind: 'FACT', source: 'GOOGLE_ADS', text: '40 cliques.' }],
      confidence: { level: 'MEDIUM', reasons: ['x'] },
      action: 'Publicar.',
      priority: 70,
    };
    input.contentOpportunities = [opp];
    input.waste.terms = [wasteRow({ dimension: 'term', key: 'a|s|g', label: 'a' })];
    const recs = buildRecommendations(input);
    const content = recs.find((r) => r.category === 'CONTENT');
    const waste = recs.find((r) => r.category === 'WASTE');
    expect(content).toBeDefined();
    expect(waste!.priority).toBeGreaterThan(content!.priority);
  });

  it('não gera recomendações duplicadas', () => {
    const input = baseInput();
    input.terms = [term('curso gratis', 20), term('vagas ia', 10)];
    const ids = buildRecommendations(input).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('narrate', () => {
  it('separa fato, hipótese e indisponível em blocos distintos', () => {
    const rec = buildRecommendations(baseInput()).find((r) => r.id === 'campaign:above:x') ?? buildRecommendations(baseInput())[0];
    const n = narrate({
      ...rec,
      evidence: [
        { kind: 'FACT', source: 'GOOGLE_ADS', text: 'Gastou R$ 10,00.' },
        { kind: 'HYPOTHESIS', source: 'CALCULATION', text: 'Pode ser sazonal.' },
        { kind: 'UNAVAILABLE', source: 'CRM', text: 'Sem vendas.' },
      ],
    });
    const titles = n.sections.map((s) => s.title);
    expect(titles).toContain('O que foi medido');
    expect(titles).toContain('O que é suposição (ainda não comprovado)');
    expect(titles).toContain('O que ainda não sabemos');
    expect(n.sections.find((s) => s.title === 'O que foi medido')?.items?.[0]).toContain('Google Ads');
    expect(toPlainText(n)).toContain('O QUE FAZER');
  });

  it('omite blocos sem conteúdo (não inventa hipótese)', () => {
    const rec = buildRecommendations(baseInput())[0];
    const n = narrate({ ...rec, evidence: [{ kind: 'FACT', source: 'GOOGLE_ADS', text: 'Fato.' }] });
    expect(n.sections.map((s) => s.title)).not.toContain('O que ainda não sabemos');
  });
});
