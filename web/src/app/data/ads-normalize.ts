import {
  AccountInfo,
  AdRow,
  CampaignLocation,
  CampaignRow,
  CampaignShareRow,
  DemographicDimension,
  DemographicRow,
  DisplayAdGroupRow,
  ChannelType,
  ConversionActionInfo,
  ConversionBreakdownRow,
  DailyRow,
  DeviceRow,
  GoogleAdsChange,
  HourRow,
  KeywordQuality,
  LandingPageRow,
  LocationType,
  MatchType,
  NegativeKeyword,
  NetworkRow,
  Perf,
  PlacementRow,
  PmaxAssetGroupRow,
  PmaxAssetRow,
  QualityRating,
  RegionRow,
  SearchTermRow,
} from '../domain/models';
import { normalizeUrl } from '../domain/text';

/**
 * Converte as linhas cruas da API REST do Google Ads (camelCase, inteiros de 64 bits
 * como string) em tipos do domínio. Nada aqui calcula análise: só traduz formato.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function perf(r: Raw): Perf {
  return {
    impressions: num(r.metrics?.impressions),
    clicks: num(r.metrics?.clicks),
    cost: num(r.metrics?.costMicros) / 1_000_000,
    conversions: num(r.metrics?.conversions),
  };
}

/** "geoTargetConstants/20106" → "20106" */
export function lastSegment(resourceName: unknown): string {
  const s = str(resourceName);
  return s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s;
}

function channelOf(value: string): ChannelType {
  switch (value) {
    case 'SEARCH':
    case 'DISPLAY':
    case 'PERFORMANCE_MAX':
    case 'VIDEO':
    case 'SHOPPING':
      return value;
    case 'DEMAND_GEN':
    case 'DISCOVERY':
      return 'DEMAND_GEN';
    default:
      return 'OTHER';
  }
}

export function normalizeAccount(rows: Raw[], fallbackId = ''): AccountInfo {
  const c = rows[0]?.customer ?? {};
  const id = str(c.id) || fallbackId;
  return {
    id,
    name: str(c.descriptiveName) || `Conta ${id}`,
    currency: str(c.currencyCode) || 'BRL',
    timeZone: str(c.timeZone) || 'America/Sao_Paulo',
  };
}

export function normalizeCampaigns(rows: Raw[]): CampaignRow[] {
  return rows.map((r) => ({
    id: str(r.campaign?.id),
    name: str(r.campaign?.name),
    status: str(r.campaign?.status),
    channel: channelOf(str(r.campaign?.advertisingChannelType)),
    ...perf(r),
  }));
}

/** Parcela entre 0 e 1, ou null quando o Google não informa (campo ausente ou fora do intervalo). */
function share(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

export function normalizeCampaignShares(rows: Raw[]): CampaignShareRow[] {
  return rows.map((r) => {
    const micros = num(r.campaignBudget?.amountMicros);
    return {
      id: str(r.campaign?.id),
      name: str(r.campaign?.name),
      status: str(r.campaign?.status),
      channel: channelOf(str(r.campaign?.advertisingChannelType)),
      ...perf(r),
      dailyBudget: micros > 0 ? micros / 1_000_000 : null,
      searchShare: share(r.metrics?.searchImpressionShare),
      lostBudget: share(r.metrics?.searchBudgetLostImpressionShare),
      lostRank: share(r.metrics?.searchRankLostImpressionShare),
    };
  });
}

const DEMOGRAPHIC_FIELD = { AGE: 'ageRange', GENDER: 'gender', INCOME: 'incomeRange', PARENTAL: 'parentalStatus' } as const;

export function normalizeDemographics(dimension: DemographicDimension, rows: Raw[]): DemographicRow[] {
  const field = DEMOGRAPHIC_FIELD[dimension];
  return rows
    .map((r) => {
      const bid = r.adGroupCriterion?.bidModifier;
      return {
        dimension,
        segment: str(r.adGroupCriterion?.[field]?.type),
        campaignId: str(r.campaign?.id),
        adGroupId: str(r.adGroup?.id),
        excluded: r.adGroupCriterion?.negative === true,
        bidModifier: bid === undefined || bid === null ? null : num(bid),
        ...perf(r),
      };
    })
    .filter((r) => r.segment);
}

export function normalizeDisplayAdGroups(rows: Raw[]): DisplayAdGroupRow[] {
  return rows.map((r) => ({
    id: str(r.adGroup?.id),
    name: str(r.adGroup?.name),
    campaignId: str(r.campaign?.id),
    optimizedTargeting: r.adGroup?.optimizedTargetingEnabled !== false,
  }));
}

export function normalizeDaily(rows: Raw[]): DailyRow[] {
  return rows.map((r) => ({
    date: str(r.segments?.date),
    campaignId: str(r.campaign?.id),
    campaignName: str(r.campaign?.name),
    ...perf(r),
  }));
}

export type SearchTermRaw = Omit<SearchTermRow, 'alreadyNegative' | 'category' | 'categoryReason'>;

export function normalizeSearchTerms(rows: Raw[]): SearchTermRaw[] {
  return rows.map((r) => ({
    term: str(r.searchTermView?.searchTerm).toLowerCase().trim(),
    campaignId: str(r.campaign?.id),
    campaignName: str(r.campaign?.name),
    adGroupId: str(r.adGroup?.id),
    adGroupName: str(r.adGroup?.name),
    excluded: ['EXCLUDED', 'ADDED_EXCLUDED'].includes(str(r.searchTermView?.status)),
    ...perf(r),
  }));
}

const DEVICE_LABEL: Record<string, string> = {
  MOBILE: 'Celular',
  DESKTOP: 'Computador',
  TABLET: 'Tablet',
  CONNECTED_TV: 'TV conectada',
  OTHER: 'Outros',
  UNKNOWN: 'Desconhecido',
  UNSPECIFIED: 'Não especificado',
};

export function deviceLabel(device: string): string {
  return DEVICE_LABEL[device] ?? device;
}

/** Soma linhas por chave preservando as métricas base. */
function foldBy<T extends Perf, K extends string>(
  rows: T[],
  keyOf: (row: T) => K,
  make: (key: K, row: T) => Omit<T, keyof Perf>,
): Array<Omit<T, keyof Perf> & Perf> {
  const map = new Map<K, Omit<T, keyof Perf> & Perf>();
  for (const row of rows) {
    const key = keyOf(row);
    const prev = map.get(key);
    if (prev) {
      prev.impressions += row.impressions;
      prev.clicks += row.clicks;
      prev.cost += row.cost;
      prev.conversions += row.conversions;
    } else {
      map.set(key, {
        ...make(key, row),
        impressions: row.impressions,
        clicks: row.clicks,
        cost: row.cost,
        conversions: row.conversions,
      });
    }
  }
  return Array.from(map.values());
}

export function normalizeDevices(rows: Raw[]): DeviceRow[] {
  const flat = rows.map((r) => ({ device: str(r.segments?.device) || 'UNKNOWN', ...perf(r) }));
  return foldBy(flat, (r) => r.device, (device) => ({ device })) as DeviceRow[];
}

const NETWORK_LABEL: Record<string, string> = {
  SEARCH: 'Rede de Pesquisa',
  SEARCH_PARTNERS: 'Parceiros de Pesquisa',
  CONTENT: 'Rede de Display',
  YOUTUBE: 'YouTube',
  YOUTUBE_SEARCH: 'YouTube (busca)',
  YOUTUBE_WATCH: 'YouTube (vídeos)',
  MIXED: 'Misto (Performance Max)',
  CROSS_NETWORK: 'Várias redes',
  GOOGLE_TV: 'Google TV',
  UNKNOWN: 'Desconhecida',
};

export function networkLabel(network: string): string {
  return NETWORK_LABEL[network] ?? network;
}

export function normalizeNetworks(rows: Raw[]): NetworkRow[] {
  const flat = rows.map((r) => ({ network: str(r.segments?.adNetworkType) || 'UNKNOWN', ...perf(r) }));
  return foldBy(flat, (r) => r.network, (network) => ({
    network,
    label: networkLabel(network),
  })) as NetworkRow[];
}

const WEEKDAY: Record<string, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

export function normalizeHours(rows: Raw[]): HourRow[] {
  return rows
    .map((r) => ({
      weekday: WEEKDAY[str(r.segments?.dayOfWeek)] ?? 0,
      hour: num(r.segments?.hour),
      campaignId: str(r.campaign?.id),
      ...perf(r),
    }))
    .filter((r) => r.weekday > 0);
}

export function normalizeRegions(rows: Raw[], names: Map<string, string>): RegionRow[] {
  return rows
    .map((r) => {
      const regionId = lastSegment(r.segments?.geoTargetRegion);
      const type = str(r.geographicView?.locationType);
      const locationType: LocationType =
        type === 'LOCATION_OF_PRESENCE' || type === 'AREA_OF_INTEREST' ? type : 'UNKNOWN';
      return {
        regionId,
        regionName: names.get(regionId) ?? (regionId ? `Região ${regionId}` : 'Sem região'),
        locationType,
        ...perf(r),
      };
    })
    .filter((r) => r.regionId !== '');
}

export function regionIdsOf(rows: Raw[]): string[] {
  return Array.from(new Set(rows.map((r) => lastSegment(r.segments?.geoTargetRegion)).filter(Boolean)));
}

export function normalizeGeoConstants(rows: Raw[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const g = r.geoTargetConstant ?? {};
    const id = str(g.id);
    if (id) out.set(id, str(g.name) || str(g.canonicalName) || `Região ${id}`);
  }
  return out;
}

export function normalizeLandingPages(rows: Raw[]): LandingPageRow[] {
  return rows.map((r) => {
    const url = str(r.landingPageView?.unexpandedFinalUrl);
    return {
      url,
      normalizedUrl: normalizeUrl(url),
      campaignId: str(r.campaign?.id),
      campaignName: str(r.campaign?.name),
      ...perf(r),
    };
  });
}

function textAssets(value: unknown): string[] {
  let list: unknown = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.map((a: Raw) => str(a?.text)).filter((t) => t.length > 0);
}

export function normalizeAds(rows: Raw[]): AdRow[] {
  return rows.map((r) => {
    const ad = r.adGroupAd?.ad ?? {};
    let finalUrls: unknown = ad.finalUrls;
    if (typeof finalUrls === 'string') {
      try {
        finalUrls = JSON.parse(finalUrls);
      } catch {
        finalUrls = [finalUrls];
      }
    }
    return {
      adId: str(ad.id),
      type: str(ad.type),
      status: str(r.adGroupAd?.status),
      finalUrls: Array.isArray(finalUrls) ? finalUrls.map(str) : [],
      headlines: textAssets(ad.responsiveSearchAd?.headlines),
      descriptions: textAssets(ad.responsiveSearchAd?.descriptions),
      campaignId: str(r.campaign?.id),
      campaignName: str(r.campaign?.name),
      adGroupId: str(r.adGroup?.id),
      adGroupName: str(r.adGroup?.name),
      ...perf(r),
    };
  });
}

export function normalizePlacements(rows: Raw[]): PlacementRow[] {
  return rows.map((r) => ({
    name: str(r.detailPlacementView?.displayName),
    type: str(r.detailPlacementView?.placementType),
    targetUrl: str(r.detailPlacementView?.targetUrl),
    campaignId: str(r.campaign?.id),
    ...perf(r),
  }));
}

/** Recursos e grupos PMax são normalizados sem inferir atribuição causal. */
export function normalizePmaxAssetGroups(rows: Raw[]): PmaxAssetGroupRow[] {
  return rows.map((r) => ({
    id: str(r.assetGroup?.id),
    name: str(r.assetGroup?.name),
    campaignId: str(r.campaign?.id),
    campaignName: str(r.campaign?.name),
    adStrength: str(r.assetGroup?.adStrength),
    assetCoverage: str(r.assetGroup?.assetCoverage),
    primaryStatus: str(r.assetGroup?.primaryStatus),
    ...perf(r),
  }));
}

export function normalizePmaxAssets(rows: Raw[]): PmaxAssetRow[] {
  return rows.map((r) => ({
    assetGroupId: str(r.assetGroup?.id),
    campaignId: str(r.campaign?.id),
    asset: str(r.assetGroupAsset?.asset),
    fieldType: str(r.assetGroupAsset?.fieldType),
    primaryStatus: str(r.assetGroupAsset?.primaryStatus),
    status: str(r.assetGroupAsset?.status),
    ...perf(r),
  }));
}

export function normalizeConversionActions(rows: Raw[]): ConversionActionInfo[] {
  return rows.map((r) => {
    const c = r.conversionAction ?? {};
    return {
      id: str(c.id),
      name: str(c.name),
      category: str(c.category),
      type: str(c.type),
      status: str(c.status),
      primary: c.primaryForGoal === true,
      includeInConversions: c.includeInConversionsMetric !== false,
      countingType: str(c.countingType),
      defaultValue: c.valueSettings?.defaultValue !== undefined ? num(c.valueSettings.defaultValue) : undefined,
      alwaysUseDefaultValue: c.valueSettings?.alwaysUseDefaultValue === true,
    };
  });
}

export function normalizeConversionBreakdown(rows: Raw[]): ConversionBreakdownRow[] {
  return rows
    .map((r) => ({
      campaignId: str(r.campaign?.id),
      actionName: str(r.segments?.conversionActionName),
      category: str(r.segments?.conversionActionCategory),
      conversions: num(r.metrics?.conversions),
      allConversions: num(r.metrics?.allConversions),
      value: num(r.metrics?.conversionsValue),
    }))
    .filter((r) => r.actionName !== '');
}

export function matchTypeOf(value: unknown, fallback: MatchType): MatchType {
  const v = str(value);
  return v === 'EXACT' || v === 'PHRASE' || v === 'BROAD' ? v : fallback;
}

export function normalizeNegatives(rows: Raw[]): NegativeKeyword[] {
  return rows.map((r) => ({
    id: str(r.campaignCriterion?.criterionId),
    campaignId: str(r.campaign?.id),
    campaignName: str(r.campaign?.name),
    text: str(r.campaignCriterion?.keyword?.text),
    matchType: matchTypeOf(r.campaignCriterion?.keyword?.matchType, 'EXACT'),
    level: 'CAMPAIGN' as const,
  }));
}

export function normalizeAdGroupNegatives(rows: Raw[]): NegativeKeyword[] {
  return rows.map((r) => ({
    id: str(r.adGroupCriterion?.criterionId),
    campaignId: str(r.campaign?.id),
    campaignName: str(r.campaign?.name),
    adGroupId: str(r.adGroup?.id),
    adGroupName: str(r.adGroup?.name),
    text: str(r.adGroupCriterion?.keyword?.text),
    matchType: matchTypeOf(r.adGroupCriterion?.keyword?.matchType, 'EXACT'),
    level: 'AD_GROUP' as const,
  }));
}

/**
 * Lista compartilhada vira uma linha por campanha que a usa, para o resto do sistema
 * tratar "esta campanha bloqueia este termo" do mesmo jeito, venha de onde vier.
 */
export function expandSharedNegatives(links: Raw[], criteria: Raw[]): NegativeKeyword[] {
  const bySet = new Map<string, Raw[]>();
  for (const c of criteria) {
    const id = str(c.sharedSet?.id);
    bySet.set(id, [...(bySet.get(id) ?? []), c]);
  }
  const out: NegativeKeyword[] = [];
  for (const l of links) {
    if (str(l.campaignSharedSet?.status) !== 'ENABLED') continue;
    const setId = str(l.sharedSet?.id);
    for (const c of bySet.get(setId) ?? []) {
      out.push({
        id: str(c.sharedCriterion?.criterionId),
        campaignId: str(l.campaign?.id),
        campaignName: str(l.campaign?.name),
        text: str(c.sharedCriterion?.keyword?.text),
        matchType: matchTypeOf(c.sharedCriterion?.keyword?.matchType, 'EXACT'),
        level: 'SHARED_LIST',
        listId: setId,
        listName: str(l.sharedSet?.name),
      });
    }
  }
  return out;
}

export interface KeywordBase {
  resourceName: string;
  criterionId: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  text: string;
  matchType: MatchType;
  status: 'ENABLED' | 'PAUSED';
  bid?: number;
  finalUrls: string[];
  quality: KeywordQuality;
}

function ratingOf(value: unknown): QualityRating | null {
  const v = str(value);
  return v === 'ABOVE_AVERAGE' || v === 'AVERAGE' || v === 'BELOW_AVERAGE' ? v : null;
}

export function normalizeKeywords(rows: Raw[]): KeywordBase[] {
  return rows.map((r) => {
    const c = r.adGroupCriterion ?? {};
    const micros = num(c.cpcBidMicros);
    return {
      resourceName: str(c.resourceName),
      criterionId: str(c.criterionId),
      campaignId: str(r.campaign?.id),
      campaignName: str(r.campaign?.name),
      adGroupId: str(r.adGroup?.id),
      adGroupName: str(r.adGroup?.name),
      text: str(c.keyword?.text),
      matchType: matchTypeOf(c.keyword?.matchType, 'BROAD'),
      status: str(c.status) === 'PAUSED' ? 'PAUSED' : 'ENABLED',
      bid: micros > 0 ? micros / 1_000_000 : undefined,
      finalUrls: Array.isArray(c.finalUrls) ? c.finalUrls.map(str).filter(Boolean) : [],
      quality: {
        score: num(c.qualityInfo?.qualityScore) || null,
        adRelevance: ratingOf(c.qualityInfo?.creativeQualityScore),
        landingPage: ratingOf(c.qualityInfo?.postClickQualityScore),
        expectedCtr: ratingOf(c.qualityInfo?.searchPredictedCtr),
      },
    };
  });
}

export function normalizeKeywordMetrics(rows: Raw[]): Map<string, Perf> {
  const out = new Map<string, Perf>();
  for (const r of rows) {
    const key = str(r.adGroupCriterion?.resourceName);
    if (!key) continue;
    const p = perf(r);
    const prev = out.get(key);
    out.set(
      key,
      prev
        ? {
            impressions: prev.impressions + p.impressions,
            clicks: prev.clicks + p.clicks,
            cost: prev.cost + p.cost,
            conversions: prev.conversions + p.conversions,
          }
        : p,
    );
  }
  return out;
}

export function normalizeCampaignLocations(rows: Raw[]): CampaignLocation[] {
  return rows
    .map((r) => ({
      campaignId: str(r.campaign?.id),
      regionId: lastSegment(r.campaignCriterion?.location?.geoTargetConstant),
      negative: r.campaignCriterion?.negative === true,
    }))
    .filter((r) => r.regionId !== '');
}

export function normalizeChanges(rows: Raw[]): GoogleAdsChange[] {
  return rows.map((r) => {
    const e = r.changeEvent ?? {};
    const fields = e.changedFields;
    const changedFields: string[] = Array.isArray(fields)
      ? fields.map(str)
      : str(fields)
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean);
    return {
      at: str(e.changeDateTime).slice(0, 19),
      resourceType: str(e.changeResourceType),
      operation: str(e.resourceChangeOperation),
      changedFields,
      userEmail: str(e.userEmail),
      clientType: str(e.clientType),
      campaignId: lastSegment(e.campaign) || undefined,
      adGroupId: lastSegment(e.adGroup) || undefined,
    };
  });
}
