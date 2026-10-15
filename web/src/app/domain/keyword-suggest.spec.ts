import { suggestFromSearchConsole, suggestFromTerms } from './keyword-suggest';
import { KeywordRow, SearchTermRow } from './models';

const term = (text: string, extra: Partial<SearchTermRow> = {}): SearchTermRow => ({
  term: text,
  campaignId: 'c1',
  campaignName: 'Campanha 1',
  adGroupId: 'g1',
  adGroupName: 'Grupo 1',
  excluded: false,
  alreadyNegative: false,
  category: 'GENERAL',
  categoryReason: '',
  impressions: 50,
  clicks: 1,
  cost: 3,
  conversions: 0,
  ...extra,
});

const kw = (text: string, campaignId = 'c1'): KeywordRow => ({
  resourceName: text,
  criterionId: text,
  campaignId,
  campaignName: `Campanha ${campaignId.slice(1)}`,
  adGroupId: 'g1',
  adGroupName: 'Grupo 1',
  text,
  matchType: 'PHRASE',
  status: 'ENABLED',
  category: 'GENERAL',
  categoryReason: '',
  impressions: 0,
  clicks: 0,
  cost: 0,
  conversions: 0,
});

describe('suggestFromTerms', () => {
  it('sugere termo que converteu e ainda não é palavra-chave, em correspondência exata', () => {
    const s = suggestFromTerms([term('sistema para clinica odontologica', { conversions: 2 })], [kw('software odontologico')]);
    expect(s).toHaveLength(1);
    expect(s[0].matchType).toBe('EXACT');
  });

  it('ignora o que já é palavra-chave, negativado, desqualificado ou com poucos cliques', () => {
    const s = suggestFromTerms(
      [
        term('software odontologico', { clicks: 9 }),
        term('vagas odontologico', { clicks: 9, alreadyNegative: true }),
        term('curso odontologico', { clicks: 9, category: 'UNQUALIFIED' }),
        term('agenda pet', { clicks: 2 }),
      ],
      [kw('[software odontologico]')],
    );
    expect(s).toEqual([]);
  });

  it('soma o mesmo termo vindo de grupos diferentes da campanha', () => {
    const s = suggestFromTerms([term('agenda pet', { clicks: 2 }), term('agenda pet', { clicks: 2, adGroupId: 'g2' })], []);
    expect(s[0].clicks).toBe(4);
  });
});

describe('suggestFromSearchConsole', () => {
  const rows = [
    { query: 'software clinica odontologica gratis', clicks: 3, impressions: 400, ctr: 0.01, position: 8 },
    { query: 'prontuario odontologico online', clicks: 1, impressions: 200, ctr: 0.005, position: 12 },
    { query: 'receita de bolo', clicks: 0, impressions: 90, ctr: 0, position: 30 },
  ];

  it('liga a busca orgânica à campanha de assunto parecido e descarta o que não combina', () => {
    const s = suggestFromSearchConsole(rows, [kw('prontuario odontologico'), kw('software clinica')], () => false);
    expect(s.map((x) => x.text)).toEqual(['software clinica odontologica gratis', 'prontuario odontologico online']);
    expect(s[0].campaignId).toBe('c1');
  });

  it('respeita a lista de desqualificados', () => {
    const s = suggestFromSearchConsole(rows, [kw('software clinica odontologica')], (t) => t.includes('gratis'));
    expect(s.map((x) => x.text)).not.toContain('software clinica odontologica gratis');
  });
});
