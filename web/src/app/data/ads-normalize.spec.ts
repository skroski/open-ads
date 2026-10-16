import {
  deviceLabel,
  expandSharedNegatives,
  lastSegment,
  matchTypeOf,
  networkLabel,
  normalizeAccount,
  normalizeAdGroupNegatives,
  normalizeAds,
  normalizeCampaignLocations,
  normalizeCampaigns,
  normalizeChanges,
  normalizeConversionActions,
  normalizeConversionBreakdown,
  normalizeDaily,
  normalizeDevices,
  normalizeGeoConstants,
  normalizeHours,
  normalizeKeywordMetrics,
  normalizeKeywords,
  normalizeLandingPages,
  normalizeNegatives,
  normalizeNetworks,
  normalizeRegions,
  normalizeSearchTerms,
  num,
  regionIdsOf,
} from './ads-normalize';
import { normalizeUrl } from '../domain/text';

// A API REST devolve inteiros de 64 bits como string e omite campos zerados.
const metrics = { impressions: '1200', clicks: '40', costMicros: '85500000', conversions: 2.5 };

describe('num', () => {
  it('converte strings numéricas e zera o que não é número', () => {
    expect(num('42')).toBe(42);
    expect(num(3.5)).toBe(3.5);
    expect(num(undefined)).toBe(0);
    expect(num(null)).toBe(0);
    expect(num('abc')).toBe(0);
    expect(num(Infinity)).toBe(0);
  });
});

describe('lastSegment', () => {
  it('pega o id depois da última barra', () => {
    expect(lastSegment('geoTargetConstants/20106')).toBe('20106');
    expect(lastSegment('20106')).toBe('20106');
    expect(lastSegment(undefined)).toBe('');
  });
});

describe('normalizeAccount', () => {
  it('lê a conta e usa padrões quando faltam campos', () => {
    expect(normalizeAccount([{ customer: { id: '123', descriptiveName: 'Loja', currencyCode: 'USD', timeZone: 'UTC' } }])).toEqual({
      id: '123',
      name: 'Loja',
      currency: 'USD',
      timeZone: 'UTC',
    });
    expect(normalizeAccount([], '999')).toEqual({ id: '999', name: 'Conta 999', currency: 'BRL', timeZone: 'America/Sao_Paulo' });
  });
});

describe('normalizeCampaigns e normalizeDaily', () => {
  it('converte micros em reais e metrics ausentes em zero', () => {
    const [c] = normalizeCampaigns([
      { campaign: { id: '1', name: 'Pesquisa', status: 'ENABLED', advertisingChannelType: 'SEARCH' }, metrics },
    ]);
    expect(c).toMatchObject({ id: '1', name: 'Pesquisa', channel: 'SEARCH', impressions: 1200, clicks: 40, cost: 85.5, conversions: 2.5 });

    const [empty] = normalizeCampaigns([{ campaign: { id: '2' } }]);
    expect(empty).toMatchObject({ impressions: 0, clicks: 0, cost: 0, conversions: 0 });
  });

  it('agrupa canais antigos e desconhecidos', () => {
    const channel = (t: string) => normalizeCampaigns([{ campaign: { advertisingChannelType: t } }])[0].channel;
    expect(channel('DISCOVERY')).toBe('DEMAND_GEN');
    expect(channel('DEMAND_GEN')).toBe('DEMAND_GEN');
    expect(channel('PERFORMANCE_MAX')).toBe('PERFORMANCE_MAX');
    expect(channel('SMART')).toBe('OTHER');
  });

  it('diário mantém data e campanha', () => {
    const [d] = normalizeDaily([{ segments: { date: '2026-10-01' }, campaign: { id: '1', name: 'A' }, metrics }]);
    expect(d).toMatchObject({ date: '2026-10-01', campaignId: '1', campaignName: 'A', cost: 85.5 });
  });
});

describe('normalizeSearchTerms', () => {
  it('minúscula e apara o termo, e marca os já negativados', () => {
    const rows = normalizeSearchTerms([
      { searchTermView: { searchTerm: '  Dentista Grátis ', status: 'ADDED_EXCLUDED' }, campaign: { id: '1' }, adGroup: { id: '9' }, metrics },
      { searchTermView: { searchTerm: 'implante', status: 'NONE' }, campaign: { id: '1' }, adGroup: { id: '9' }, metrics },
      { searchTermView: { searchTerm: 'clareamento', status: 'ADDED' }, campaign: { id: '1' }, adGroup: { id: '9' }, metrics },
    ]);
    expect(rows.map((r) => r.term)).toEqual(['dentista grátis', 'implante', 'clareamento']);
    expect(rows.map((r) => r.excluded)).toEqual([true, false, false]);
  });
});

describe('dispositivos e redes', () => {
  it('soma linhas do mesmo dispositivo', () => {
    const rows = normalizeDevices([
      { segments: { device: 'MOBILE' }, metrics },
      { segments: { device: 'MOBILE' }, metrics },
      { segments: {}, metrics },
    ]);
    expect(rows).toHaveLength(2);
    const mobile = rows.find((r) => r.device === 'MOBILE');
    expect(mobile).toMatchObject({ impressions: 2400, clicks: 80, cost: 171, conversions: 5 });
    expect(rows.find((r) => r.device === 'UNKNOWN')).toBeTruthy();
  });

  it('soma redes e traduz o rótulo', () => {
    const [n] = normalizeNetworks([
      { segments: { adNetworkType: 'SEARCH' }, metrics },
      { segments: { adNetworkType: 'SEARCH' }, metrics },
    ]);
    expect(n).toMatchObject({ network: 'SEARCH', label: 'Rede de Pesquisa', clicks: 80 });
  });

  it('rótulos desconhecidos voltam como vieram', () => {
    expect(deviceLabel('MOBILE')).toBe('Celular');
    expect(deviceLabel('NOVO')).toBe('NOVO');
    expect(networkLabel('YOUTUBE')).toBe('YouTube');
    expect(networkLabel('NOVA')).toBe('NOVA');
  });
});

describe('normalizeHours', () => {
  it('converte o dia da semana em 1..7 e descarta dia desconhecido', () => {
    const rows = normalizeHours([
      { segments: { dayOfWeek: 'MONDAY', hour: 9 }, campaign: { id: '1' }, metrics },
      { segments: { dayOfWeek: 'SUNDAY', hour: '23' }, campaign: { id: '1' }, metrics },
      { segments: { dayOfWeek: 'UNSPECIFIED', hour: 1 }, campaign: { id: '1' }, metrics },
    ]);
    expect(rows.map((r) => [r.weekday, r.hour])).toEqual([[1, 9], [7, 23]]);
  });
});

describe('regiões', () => {
  const names = new Map([['20106', 'São Paulo']]);

  it('nomeia pela tabela e cai num rótulo genérico quando falta', () => {
    const rows = normalizeRegions(
      [
        { segments: { geoTargetRegion: 'geoTargetConstants/20106' }, geographicView: { locationType: 'LOCATION_OF_PRESENCE' }, metrics },
        { segments: { geoTargetRegion: 'geoTargetConstants/555' }, geographicView: { locationType: 'OUTRO' }, metrics },
        { segments: {}, metrics },
      ],
      names,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ regionId: '20106', regionName: 'São Paulo', locationType: 'LOCATION_OF_PRESENCE' });
    expect(rows[1]).toMatchObject({ regionId: '555', regionName: 'Região 555', locationType: 'UNKNOWN' });
  });

  it('lista ids únicos e lê as constantes geográficas', () => {
    const rows = [
      { segments: { geoTargetRegion: 'geoTargetConstants/1' } },
      { segments: { geoTargetRegion: 'geoTargetConstants/1' } },
      { segments: { geoTargetRegion: 'geoTargetConstants/2' } },
      { segments: {} },
    ];
    expect(regionIdsOf(rows)).toEqual(['1', '2']);

    const geo = normalizeGeoConstants([
      { geoTargetConstant: { id: '1', name: 'Rio' } },
      { geoTargetConstant: { id: '2', canonicalName: 'Minas Gerais,Brazil' } },
      { geoTargetConstant: { id: '3' } },
      { geoTargetConstant: {} },
    ]);
    expect([...geo]).toEqual([['1', 'Rio'], ['2', 'Minas Gerais,Brazil'], ['3', 'Região 3']]);
  });
});

describe('páginas de destino', () => {
  it('guarda a URL original e a normalizada', () => {
    const url = 'https://Exemplo.com.br/oferta/?utm_source=x';
    const [p] = normalizeLandingPages([{ landingPageView: { unexpandedFinalUrl: url }, campaign: { id: '1', name: 'A' }, metrics }]);
    expect(p.url).toBe(url);
    expect(p.normalizedUrl).toBe(normalizeUrl(url));
    expect(p.clicks).toBe(40);
  });
});

describe('normalizeAds', () => {
  it('lê títulos e descrições vindos como lista ou como JSON em string', () => {
    const [a, b] = normalizeAds([
      {
        adGroupAd: {
          status: 'ENABLED',
          ad: {
            id: '7',
            type: 'RESPONSIVE_SEARCH_AD',
            finalUrls: ['https://a.com'],
            responsiveSearchAd: { headlines: [{ text: 'Título 1' }, { text: '' }, {}], descriptions: [{ text: 'Desc' }] },
          },
        },
        campaign: { id: '1' },
        adGroup: { id: '2' },
        metrics,
      },
      {
        adGroupAd: {
          ad: {
            finalUrls: 'https://b.com',
            responsiveSearchAd: { headlines: '[{"text":"Via JSON"}]', descriptions: 'quebrado{' },
          },
        },
        metrics,
      },
    ]);
    expect(a).toMatchObject({ adId: '7', status: 'ENABLED', finalUrls: ['https://a.com'], headlines: ['Título 1'], descriptions: ['Desc'] });
    expect(b.finalUrls).toEqual(['https://b.com']);
    expect(b.headlines).toEqual(['Via JSON']);
    expect(b.descriptions).toEqual([]);
  });

  it('finalUrls em JSON de lista vira lista', () => {
    const [a] = normalizeAds([{ adGroupAd: { ad: { finalUrls: '["https://c.com","https://d.com"]' } }, metrics }]);
    expect(a.finalUrls).toEqual(['https://c.com', 'https://d.com']);
  });
});

describe('conversões', () => {
  it('lê ações de conversão com os padrões da API', () => {
    const [a, b] = normalizeConversionActions([
      { conversionAction: { id: '1', name: 'Lead', primaryForGoal: true, valueSettings: { defaultValue: '50', alwaysUseDefaultValue: true } } },
      { conversionAction: { id: '2', name: 'Clique', includeInConversionsMetric: false } },
    ]);
    expect(a).toMatchObject({ primary: true, includeInConversions: true, defaultValue: 50, alwaysUseDefaultValue: true });
    expect(b).toMatchObject({ primary: false, includeInConversions: false, defaultValue: undefined, alwaysUseDefaultValue: false });
  });

  it('o detalhamento descarta linhas sem nome de ação', () => {
    const rows = normalizeConversionBreakdown([
      { campaign: { id: '1' }, segments: { conversionActionName: 'Lead', conversionActionCategory: 'LEAD' }, metrics: { conversions: '3', allConversions: '4', conversionsValue: '150' } },
      { campaign: { id: '1' }, segments: {}, metrics: { conversions: 1 } },
    ]);
    expect(rows).toEqual([{ campaignId: '1', actionName: 'Lead', category: 'LEAD', conversions: 3, allConversions: 4, value: 150 }]);
  });
});

describe('palavras negativas', () => {
  it('matchTypeOf aceita só os três tipos', () => {
    expect(matchTypeOf('PHRASE', 'EXACT')).toBe('PHRASE');
    expect(matchTypeOf('BROAD_MODIFIER', 'EXACT')).toBe('EXACT');
    expect(matchTypeOf(undefined, 'BROAD')).toBe('BROAD');
  });

  it('negativas de campanha e de grupo', () => {
    const [c] = normalizeNegatives([
      { campaignCriterion: { criterionId: '5', keyword: { text: 'grátis', matchType: 'PHRASE' } }, campaign: { id: '1', name: 'A' } },
    ]);
    expect(c).toEqual({ id: '5', campaignId: '1', campaignName: 'A', text: 'grátis', matchType: 'PHRASE', level: 'CAMPAIGN' });

    const [g] = normalizeAdGroupNegatives([
      { adGroupCriterion: { criterionId: '6', keyword: { text: 'curso' } }, campaign: { id: '1' }, adGroup: { id: '2', name: 'G' } },
    ]);
    expect(g).toMatchObject({ level: 'AD_GROUP', adGroupId: '2', adGroupName: 'G', matchType: 'EXACT' });
  });

  it('lista compartilhada vira uma linha por campanha ativa', () => {
    const links = [
      { campaignSharedSet: { status: 'ENABLED' }, campaign: { id: '1', name: 'A' }, sharedSet: { id: '10', name: 'Lista base' } },
      { campaignSharedSet: { status: 'ENABLED' }, campaign: { id: '2', name: 'B' }, sharedSet: { id: '10', name: 'Lista base' } },
      { campaignSharedSet: { status: 'REMOVED' }, campaign: { id: '3', name: 'C' }, sharedSet: { id: '10', name: 'Lista base' } },
      { campaignSharedSet: { status: 'ENABLED' }, campaign: { id: '4', name: 'D' }, sharedSet: { id: '99' } },
    ];
    const criteria = [
      { sharedSet: { id: '10' }, sharedCriterion: { criterionId: '1', keyword: { text: 'grátis', matchType: 'BROAD' } } },
      { sharedSet: { id: '10' }, sharedCriterion: { criterionId: '2', keyword: { text: 'vaga' } } },
    ];
    const out = expandSharedNegatives(links, criteria);
    expect(out).toHaveLength(4);
    expect(out.every((n) => n.level === 'SHARED_LIST' && n.listId === '10' && n.listName === 'Lista base')).toBe(true);
    expect(out.map((n) => n.campaignId)).toEqual(['1', '1', '2', '2']);
    expect(out[0].matchType).toBe('BROAD');
    expect(out[1].matchType).toBe('EXACT');
  });
});

describe('normalizeKeywords', () => {
  it('lê lance, Índice de Qualidade e notas', () => {
    const [k] = normalizeKeywords([
      {
        adGroupCriterion: {
          resourceName: 'customers/1/adGroupCriteria/2~3',
          criterionId: '3',
          status: 'PAUSED',
          cpcBidMicros: '1500000',
          finalUrls: ['https://a.com', ''],
          keyword: { text: 'implante', matchType: 'PHRASE' },
          qualityInfo: { qualityScore: 7, creativeQualityScore: 'ABOVE_AVERAGE', postClickQualityScore: 'BELOW_AVERAGE', searchPredictedCtr: 'AVERAGE' },
        },
        campaign: { id: '1', name: 'A' },
        adGroup: { id: '2', name: 'G' },
      },
    ]);
    expect(k).toMatchObject({
      resourceName: 'customers/1/adGroupCriteria/2~3',
      status: 'PAUSED',
      bid: 1.5,
      matchType: 'PHRASE',
      finalUrls: ['https://a.com'],
      quality: { score: 7, adRelevance: 'ABOVE_AVERAGE', landingPage: 'BELOW_AVERAGE', expectedCtr: 'AVERAGE' },
    });
  });

  it('sem dados de qualidade ou lance, usa nulos e padrões', () => {
    const [k] = normalizeKeywords([{ adGroupCriterion: { keyword: { text: 'x' }, qualityInfo: { creativeQualityScore: 'UNKNOWN' } } }]);
    expect(k.status).toBe('ENABLED');
    expect(k.matchType).toBe('BROAD');
    expect(k.bid).toBeUndefined();
    expect(k.quality).toEqual({ score: null, adRelevance: null, landingPage: null, expectedCtr: null });
  });

  it('métricas por palavra-chave somam linhas repetidas e ignoram sem chave', () => {
    const rn = 'customers/1/adGroupCriteria/2~3';
    const map = normalizeKeywordMetrics([
      { adGroupCriterion: { resourceName: rn }, metrics },
      { adGroupCriterion: { resourceName: rn }, metrics },
      { metrics },
    ]);
    expect(map.size).toBe(1);
    expect(map.get(rn)).toEqual({ impressions: 2400, clicks: 80, cost: 171, conversions: 5 });
  });
});

describe('localização e alterações', () => {
  it('locais de campanha marcam exclusões e descartam sem região', () => {
    const rows = normalizeCampaignLocations([
      { campaign: { id: '1' }, campaignCriterion: { location: { geoTargetConstant: 'geoTargetConstants/20106' }, negative: true } },
      { campaign: { id: '1' }, campaignCriterion: { location: { geoTargetConstant: 'geoTargetConstants/20107' } } },
      { campaign: { id: '1' }, campaignCriterion: {} },
    ]);
    expect(rows).toEqual([
      { campaignId: '1', regionId: '20106', negative: true },
      { campaignId: '1', regionId: '20107', negative: false },
    ]);
  });

  it('histórico aceita campos como lista ou texto separado por vírgula', () => {
    const [a, b] = normalizeChanges([
      {
        changeEvent: {
          changeDateTime: '2026-10-01 14:30:05.123456',
          changeResourceType: 'CAMPAIGN_BUDGET',
          resourceChangeOperation: 'UPDATE',
          changedFields: 'amount_micros, name,',
          userEmail: 'a@b.com',
          clientType: 'GOOGLE_ADS_WEB_CLIENT',
          campaign: 'customers/1/campaigns/55',
        },
      },
      { changeEvent: { changedFields: ['status'] } },
    ]);
    expect(a).toMatchObject({ at: '2026-10-01 14:30:05', changedFields: ['amount_micros', 'name'], campaignId: '55', adGroupId: undefined });
    expect(b.changedFields).toEqual(['status']);
    expect(b.campaignId).toBeUndefined();
  });
});
