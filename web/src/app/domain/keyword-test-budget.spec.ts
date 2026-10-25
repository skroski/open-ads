import { CampaignShareRow } from './models';
import { testBudget } from './keyword-test-budget';

const row = (over: Partial<CampaignShareRow> = {}): CampaignShareRow => ({
  id: '1',
  name: 'P',
  status: 'ENABLED',
  channel: 'SEARCH',
  impressions: 3000,
  clicks: 200,
  cost: 500,
  conversions: 40,
  dailyBudget: 20,
  searchShare: 0.3,
  lostBudget: 0.1,
  lostRank: 0.3,
  ...over,
});

describe('testBudget', () => {
  it('dimensiona cliques e reais para observar 10 conversões, com faixa', () => {
    const r = testBudget({ rows: [row(), row({ id: '2', clicks: 100, cost: 350, conversions: 20 })], windowDays: 30, trackingBroken: false });
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.targetConversions).toBe(10);
    expect(r.conversionRate.point).toBeCloseTo(60 / 300);
    expect(r.clicks.low).toBeLessThan(r.clicks.high);
    // CPC: R$ 2,50 e R$ 3,50
    expect(r.cpc.low).toBeCloseTo(2.5);
    expect(r.cpc.high).toBeCloseTo(3.5);
    expect(r.cost.low).toBeCloseTo(r.clicks.low * 2.5);
    expect(r.cost.high).toBeCloseTo(r.clicks.high * 3.5);
  });

  it('ignora Display: uma campanha sem conversão não dilui a taxa', () => {
    const r = testBudget({
      rows: [row(), row({ id: 'd', channel: 'DISPLAY', clicks: 5000, cost: 900, conversions: 0 })],
      windowDays: 30,
      trackingBroken: false,
    });
    expect(r.status === 'ready' && r.conversionRate.point).toBeCloseTo(0.2);
  });

  it('com uma campanha só, avisa que a faixa de CPC não tem variação', () => {
    const r = testBudget({ rows: [row()], windowDays: 30, trackingBroken: false });
    expect(r.status === 'ready' && r.caveats.join(' ')).toContain('uma só campanha');
  });

  it('não dimensiona com poucos cliques, sem conversões ou com rastreamento quebrado', () => {
    expect(testBudget({ rows: [row({ clicks: 60, conversions: 5 })], windowDays: 30, trackingBroken: false }).status).toBe('insufficient');
    expect(testBudget({ rows: [row({ conversions: 0 })], windowDays: 30, trackingBroken: false }).status).toBe('insufficient');
    expect(testBudget({ rows: [row()], windowDays: 30, trackingBroken: true }).status).toBe('blocked');
  });
});
