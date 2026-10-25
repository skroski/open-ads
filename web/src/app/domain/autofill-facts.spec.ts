import { buildFactSheet, buildTermReviewFacts, buildThemeFacts } from './autofill-facts';
import { AdRow, CampaignRow, ConversionActionInfo } from './models';

const camp = (name: string, cost: number, extra: Partial<CampaignRow> = {}): CampaignRow => ({
  id: name,
  name,
  status: 'ENABLED',
  channel: 'SEARCH',
  impressions: 1000,
  clicks: 50,
  cost,
  conversions: 4.5,
  ...extra,
});

const ad = (campaignName: string, headlines: string[], clicks: number): AdRow => ({
  adId: campaignName + headlines.join(),
  type: 'RSA',
  status: 'ENABLED',
  finalUrls: [],
  headlines,
  descriptions: [],
  campaignId: '1',
  campaignName,
  adGroupId: '1',
  adGroupName: 'G',
  impressions: 100,
  clicks,
  cost: 1,
  conversions: 0,
});

const action = (name: string): ConversionActionInfo => ({
  id: name,
  name,
  category: 'DEFAULT',
  type: 'WEBPAGE',
  status: 'ENABLED',
  primary: true,
  includeInConversions: true,
  countingType: 'ONE_PER_CLICK',
});

describe('buildFactSheet', () => {
  const facts = buildFactSheet({
    campaigns: [camp('Barata', 10), camp('Cara', 1234.5), camp('Removida', 9999, { status: 'REMOVED' })],
    ads: [ad('Cara', ['Tênis 24h', 'Agende hoje'], 30), ad('Cara', ['Tênis 24h', 'Agende hoje'], 5), ad('Barata', ['Sandália'], 1)],
    terms: [
      { term: 'tenis de corrida', conversions: 3 },
      { term: 'tenis de corrida', conversions: 2 },
      { term: 'sem conversao', conversions: 0 },
    ],
    ambiguousActions: [action('Evento 7')],
    conversionBreakdown: [
      { campaignId: '1', actionName: 'Evento 7', category: 'DEFAULT', conversions: 6, allConversions: 6, value: 0 },
    ],
  });

  it('ordena campanhas por gasto, ignora removidas e escreve os números exatos', () => {
    expect(facts.find((f) => f.id === 'c1')?.text).toBe('Campanha "Cara": 50 cliques, R$ 1234,50 gastos, 4,5 conversões');
    expect(facts.find((f) => f.id === 'c2')?.text).toContain('Barata');
    expect(facts.find((f) => f.id === 'c3')).toBeUndefined();
  });

  it('não repete anúncios com os mesmos títulos', () => {
    expect(facts.filter((f) => f.id.startsWith('a'))).toHaveLength(2);
  });

  it('soma conversões por termo e ignora termos sem conversão', () => {
    expect(facts.find((f) => f.id === 't1')?.text).toBe('Termo de busca que converteu: "tenis de corrida" (5 conversões)');
    expect(facts.filter((f) => f.id.startsWith('t'))).toHaveLength(1);
  });

  it('inclui o volume das conversões ambíguas', () => {
    expect(facts.find((f) => f.id === 'k1')?.text).toContain('6 conversões');
  });

  it('ids únicos', () => {
    expect(new Set(facts.map((f) => f.id)).size).toBe(facts.length);
  });
});

describe('buildTermReviewFacts', () => {
  it('só inclui campos de contexto preenchidos, com ids x1… e termos s1…', () => {
    const facts = buildTermReviewFacts(
      { offer: 'Tênis', notOffer: '', idealCustomer: 'Adultos', notCustomer: '' },
      [{ term: 'aparelho infantil', clicks: 12, cost: 30.5 }],
    );
    expect(facts.map((f) => f.id)).toEqual(['x1', 'x2', 's1']);
    expect(facts[0].text).toBe('O que a empresa vende: Tênis');
    expect(facts[1].text).toBe('Cliente ideal: Adultos');
    expect(facts[2].text).toBe('Termo de busca "aparelho infantil": 12 cliques, R$ 30,50 gastos, 0 conversões');
  });
});

describe('buildThemeFacts', () => {
  it('junta o contexto (x) aos fatos da conta, sem passar de 60 fatos', () => {
    const campaigns = Array.from({ length: 30 }, (_, i) => camp(`C${i}`, i + 1));
    const ads = Array.from({ length: 30 }, (_, i) => ad(`C${i}`, [`Título ${i}`], i));
    const terms = Array.from({ length: 30 }, (_, i) => ({ term: `termo ${i}`, conversions: i + 1 }));
    const facts = buildThemeFacts(
      { offer: 'Tênis', notOffer: 'a', idealCustomer: 'b', notCustomer: 'c' },
      { campaigns, ads, terms },
    );
    expect(facts.slice(0, 4).map((f) => f.id)).toEqual(['x1', 'x2', 'x3', 'x4']);
    expect(facts.length).toBeLessThanOrEqual(60);
    expect(new Set(facts.map((f) => f.id)).size).toBe(facts.length);
  });
});
