import { CandidatePage, pageTextOf } from './intent';
import { adGroupFits } from './keyword-fit';
import { KeywordRow } from './models';
import { normalizeUrl } from './text';

const kw = (text: string, adGroupId: string, extra: Partial<KeywordRow> = {}): KeywordRow => ({
  resourceName: `${adGroupId}~${text}`,
  criterionId: text,
  campaignId: 'c1',
  campaignName: 'Campanha 1',
  adGroupId,
  adGroupName: `Grupo ${adGroupId}`,
  text,
  matchType: 'PHRASE',
  status: 'ENABLED',
  category: 'GENERAL',
  categoryReason: '',
  impressions: 100,
  clicks: 10,
  cost: 20,
  conversions: 0,
  ...extra,
});

const page = (url: string): CandidatePage => {
  const t = pageTextOf(url, undefined);
  return { url, normalizedUrl: normalizeUrl(url), words: t.words, basis: t.basis, origin: 'usada nos anúncios' };
};

describe('adGroupFits — palavra-chave × página de destino', () => {
  const sobre = 'https://site.com.br/planos-precos';
  const agenda = 'https://site.com.br/agendamento-online-clinica-odontologica';

  it('aponta palavras que não aparecem na página e sugere a página que cobre o assunto', () => {
    const fits = adGroupFits({
      keywords: [kw('agendamento online clinica odontologica', 'g1'), kw('agenda clinica odontologica', 'g1')],
      adUrlsByGroup: new Map([['g1', [sobre]]]),
      pageOf: (u) => pageTextOf(u, undefined),
      candidates: [page(sobre), page(agenda)],
    });
    expect(fits).toHaveLength(1);
    expect(fits[0].url).toBe(sobre);
    expect(fits[0].misaligned.length).toBe(2);
    expect(fits[0].suggestion?.kind).toBe('REDIRECT');
    expect(fits[0].suggestion?.best?.url).toBe(agenda);
  });

  it('conta as notas de página de destino do Google e ignora palavras pausadas', () => {
    const below = { score: 3, adRelevance: null, landingPage: 'BELOW_AVERAGE' as const, expectedCtr: null };
    const fits = adGroupFits({
      keywords: [
        kw('agendamento online clinica odontologica', 'g1', { quality: below }),
        kw('outra coisa', 'g1', { status: 'PAUSED', quality: below }),
      ],
      adUrlsByGroup: new Map([['g1', [agenda]]]),
      pageOf: (u) => pageTextOf(u, undefined),
      candidates: [],
    });
    expect(fits[0].keywords).toBe(1);
    expect(fits[0].landingBelow).toBe(1);
    expect(fits[0].qualityAvg).toBe(3);
    expect(fits[0].misaligned).toEqual([]);
  });

  it('a URL própria da palavra vence a do anúncio', () => {
    const fits = adGroupFits({
      keywords: [kw('agenda', 'g1', { finalUrls: [agenda] })],
      adUrlsByGroup: new Map([['g1', [sobre]]]),
      pageOf: (u) => pageTextOf(u, undefined),
      candidates: [],
    });
    expect(fits[0].url).toBe(agenda);
  });
});
