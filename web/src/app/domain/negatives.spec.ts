import { CampaignRow, NegativeKeyword, SearchTermRow } from './models';
import { findNegativeGaps, isNegated, prepareNegatives } from './negatives';
import { prepareRules } from './text';

const neg = (text: string, campaignId: string, extra: Partial<NegativeKeyword> = {}): NegativeKeyword => ({
  id: text,
  campaignId,
  campaignName: campaignId,
  text,
  matchType: 'PHRASE',
  level: 'CAMPAIGN',
  ...extra,
});

const camp = (id: string, channel: CampaignRow['channel'] = 'SEARCH'): CampaignRow => ({
  id,
  name: `Campanha ${id}`,
  status: 'ENABLED',
  channel,
  impressions: 0,
  clicks: 0,
  cost: 0,
  conversions: 0,
});

const term = (text: string, campaignId: string, cost: number, alreadyNegative = false): SearchTermRow => ({
  term: text,
  campaignId,
  campaignName: campaignId,
  adGroupId: 'g',
  adGroupName: 'g',
  excluded: false,
  alreadyNegative,
  category: 'GENERAL',
  categoryReason: '',
  impressions: 0,
  clicks: 1,
  cost,
  conversions: 0,
});

describe('isNegated — níveis de negativa', () => {
  it('negativa de grupo de anúncios só bloqueia dentro do próprio grupo', () => {
    const p = prepareNegatives([neg('gratis', 'c1', { level: 'AD_GROUP', adGroupId: 'g1' })]);
    expect(isNegated('software gratis', 'c1', p, 'g1')).toBe(true);
    expect(isNegated('software gratis', 'c1', p, 'g2')).toBe(false);
  });

  it('lista compartilhada expandida vale na campanha que a usa', () => {
    const p = prepareNegatives([neg('vagas', 'c2', { level: 'SHARED_LIST', listName: 'Geral' })]);
    expect(isNegated('vagas odontologico', 'c2', p)).toBe(true);
    expect(isNegated('vagas odontologico', 'c1', p)).toBe(false);
  });
});

describe('findNegativeGaps — cobertura entre campanhas', () => {
  const base = {
    campaigns: [camp('a'), camp('b'), camp('d', 'DISPLAY')],
    keywords: [] as Array<{ campaignId: string; text: string }>,
    terms: [] as SearchTermRow[],
    brand: prepareRules([]),
  };

  it('aponta a campanha de Pesquisa sem a negativa e o gasto que vazou nela', () => {
    const gaps = findNegativeGaps({
      ...base,
      negatives: [neg('gratis', 'a')],
      terms: [term('sistema gratis', 'b', 12.5), term('sistema pago', 'b', 30)],
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].coveredIn).toEqual(['Campanha a']);
    expect(gaps[0].missingIn.map((m) => m.campaignId)).toEqual(['b']); // Display fica de fora
    expect(gaps[0].totalLeak).toBeCloseTo(12.5, 5);
    expect(gaps[0].missingIn[0].leakTerms).toEqual(['sistema gratis']);
  });

  it('não sugere onde a negativa bloquearia uma palavra-chave da própria campanha', () => {
    const gaps = findNegativeGaps({
      ...base,
      negatives: [neg('curso', 'a')],
      keywords: [{ campaignId: 'b', text: 'curso de gestao odontologica' }],
    });
    expect(gaps).toEqual([]);
  });

  it('ignora negativas de marca e de grupo de anúncios', () => {
    const gaps = findNegativeGaps({
      ...base,
      brand: prepareRules(['acme']),
      negatives: [neg('acme', 'a'), neg('emprego', 'a', { level: 'AD_GROUP', adGroupId: 'g' })],
    });
    expect(gaps).toEqual([]);
  });

  it('negativa presente em todas as campanhas não é lacuna', () => {
    const gaps = findNegativeGaps({ ...base, negatives: [neg('vagas', 'a'), neg('vagas', 'b')] });
    expect(gaps).toEqual([]);
  });
});
