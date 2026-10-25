import { campaignTips, PotentialInput } from './campaign-potential';
import { CampaignShareRow } from './models';

const row = (over: Partial<CampaignShareRow> = {}): CampaignShareRow => ({
  id: '1',
  name: 'Pesquisa',
  status: 'ENABLED',
  channel: 'SEARCH',
  impressions: 5000,
  clicks: 400,
  cost: 800,
  conversions: 40,
  dailyBudget: 30,
  searchShare: 0.4,
  lostBudget: 0.3,
  lostRank: 0.1,
  ...over,
});

const input = (rows: CampaignShareRow[], over: Partial<PotentialInput> = {}): PotentialInput => ({
  rows,
  windowDays: 30,
  costTarget: null,
  aboveTargetFactor: 1.5,
  accountCostPerConversion: 20,
  trackingBroken: false,
  ...over,
});

describe('campaignTips — perda por orçamento', () => {
  const [tip] = campaignTips(input([row()]));

  it('projeta as conversões extras com faixa, a partir das taxas da própria campanha', () => {
    expect(tip.status).toBe('ready');
    // 400 cliques × (0,3 ÷ 0,4) = 300 cliques extras; custo = 300 × R$ 2,00
    expect(tip.extraClicks).toBeCloseTo(300);
    expect(tip.extraCost).toBeCloseTo(600);
    expect(tip.extraCostPerDay).toBeCloseTo(20);
    // taxa de conversão observada 10% dentro da faixa de Wilson
    expect(tip.extraConversions!.low).toBeLessThan(30);
    expect(tip.extraConversions!.high).toBeGreaterThan(30);
    expect(tip.provenance?.source).toBe('CALCULATION');
    expect(tip.caveats.join(' ')).toContain('tende a ser menor');
  });

  it('não projeta com parcela abaixo de 10%, sem conversões ou com poucos cliques', () => {
    expect(campaignTips(input([row({ searchShare: 0.08 })]))[0].status).toBe('insufficient');
    expect(campaignTips(input([row({ conversions: 0 })]))[0].status).toBe('insufficient');
    const few = campaignTips(input([row({ clicks: 81, cost: 200 })]))[0];
    expect(few.status).toBe('insufficient');
    expect(few.caveats[0]).toContain('Faltam 19 cliques');
  });

  it('bloqueia quando o custo por conversão já está acima da meta ou da média da conta', () => {
    // R$ 20 por conversão; meta de R$ 10 × 1,5 = 15
    const t = campaignTips(input([row()], { costTarget: 10 }))[0];
    expect(t.status).toBe('blocked');
    expect(t.caveats[0]).toContain('sua meta');
    expect(campaignTips(input([row()], { accountCostPerConversion: 10 }))[0].caveats[0]).toContain('média da conta');
  });

  it('rastreamento quebrado bloqueia', () => {
    expect(campaignTips(input([row()], { trackingBroken: true }))[0].status).toBe('blocked');
  });
});

describe('campaignTips — perda por ranking', () => {
  it('diz que verba não resolve e não projeta número', () => {
    const tips = campaignTips(input([row({ lostBudget: 0.02, lostRank: 0.78, searchShare: 0.12 })]));
    expect(tips).toHaveLength(1);
    expect(tips[0].kind).toBe('RANK');
    expect(tips[0].status).toBe('info');
    expect(tips[0].caveats[0]).toContain('mais verba não resolve');
    expect(tips[0].extraConversions).toBeUndefined();
  });
});

describe('campaignTips — seleção e ordem', () => {
  it('só Pesquisa ativa e com parcela informada; prontas primeiro', () => {
    const tips = campaignTips(
      input([
        row({ id: 'display', channel: 'DISPLAY' }),
        row({ id: 'pausada', status: 'PAUSED' }),
        row({ id: 'sem-parcela', searchShare: null }),
        row({ id: 'rank', name: 'Rank', lostBudget: 0, lostRank: 0.5 }),
        row({ id: 'ok', name: 'Ok' }),
      ]),
    );
    expect(tips.map((t) => `${t.campaignId}:${t.kind}`)).toEqual(['ok:BUDGET', 'rank:RANK']);
  });
});
