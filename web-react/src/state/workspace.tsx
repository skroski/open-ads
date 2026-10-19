import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  normalizeAccount,
  normalizeAds,
  normalizeCampaigns,
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
  normalizeAdGroupNegatives,
  expandSharedNegatives,
  normalizePlacements,
  normalizeRegions,
  normalizeSearchTerms,
  regionIdsOf,
  type KeywordBase,
  type SearchTermRaw,
} from '@shared/data/ads-normalize';
import { AdsQueries } from '@shared/data/ads-queries';
import { brandHintsFrom, classifyKeyword, classifyTerm, prepareAuditRules } from '@shared/domain/classify';
import { addDays, isoDate, windowOf, type DateWindow } from '@shared/domain/dates';
import { isNegated, prepareNegatives } from '@shared/domain/negatives';
import type {
  Ga4PageRow,
  KeywordRow,
  Perf,
  SearchConsolePageRow,
  SearchConsoleQueryRow,
  SearchTermRow,
  SourceStatus,
} from '@shared/domain/models';
import { ga4Pages, search, searchConsolePages, searchConsoleQueries, type SourceData } from '../lib/api';
import { useAccount } from './account';
import { useBusinessConfig } from './config';
import { useDataset, type DatasetState } from './dataset';

const EMPTY_PERF: Perf = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };

type Id = { id: string };
type ById = Id & { w: DateWindow };

export interface WorkspaceValue {
  /** Pede os dados que as análises usam (idempotente). Só então as consultas começam. */
  needCore(): void;
  info: DatasetState<ReturnType<typeof normalizeAccount>>;
  campaigns: DatasetState<ReturnType<typeof normalizeCampaigns>>;
  previousCampaigns: DatasetState<ReturnType<typeof normalizeCampaigns>>;
  daily: DatasetState<ReturnType<typeof normalizeDaily>>;
  searchTermsRaw: DatasetState<SearchTermRaw[]>;
  devices: DatasetState<ReturnType<typeof normalizeDevices>>;
  hours: DatasetState<ReturnType<typeof normalizeHours>>;
  regions: DatasetState<ReturnType<typeof normalizeRegions>>;
  landingPages: DatasetState<ReturnType<typeof normalizeLandingPages>>;
  ads: DatasetState<ReturnType<typeof normalizeAds>>;
  placements: DatasetState<ReturnType<typeof normalizePlacements>>;
  conversionActions: DatasetState<ReturnType<typeof normalizeConversionActions>>;
  conversionBreakdown: DatasetState<ReturnType<typeof normalizeConversionBreakdown>>;
  negatives: DatasetState<ReturnType<typeof normalizeNegatives>>;
  keywordsBase: DatasetState<KeywordBase[]>;
  keywordMetrics: DatasetState<ReturnType<typeof normalizeKeywordMetrics>>;
  ga4Pages: DatasetState<SourceData<Ga4PageRow>>;
  gscPages: DatasetState<SourceData<SearchConsolePageRow>>;
  gscQueries: DatasetState<SourceData<SearchConsoleQueryRow>>;
  ga4Status: SourceStatus;
  searchConsoleStatus: SourceStatus;
  accountName: string;
  preparedRules: ReturnType<typeof prepareAuditRules>;
  /** Termos de busca já classificados pelas regras da conta e cruzados com as negativas. */
  terms: SearchTermRow[];
  /** Palavras anunciadas com classificação e desempenho do período. */
  keywords: KeywordRow[];
  reloadAll(): void;
  anyLoading: boolean;
  lastLoadedAt: number | null;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

/**
 * Todos os dados do Google Ads da conta ativa, carregados sob demanda. As telas chamam
 * `needCore()` e leem os conjuntos; mudar a conta ou o período recarrega o que foi pedido.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { config, rules } = useBusinessConfig();
  const [wanted, setWanted] = useState(false);
  const needCore = useCallback(() => setWanted(true), []);

  const id = account.selectedId;
  const byAccount: Id | undefined = id ? { id } : undefined;
  const byWindow: ById | undefined = id ? { id, w: account.window } : undefined;
  const byPrevious: ById | undefined = id ? { id, w: account.previous } : undefined;
  /** 180 dias terminando ontem: base para rastreamento, maturação e efeitos. */
  const dailyWindow = useMemo<DateWindow>(() => {
    const yesterday = addDays(isoDate(new Date()), -1);
    return windowOf(addDays(yesterday, -179), yesterday);
  }, []);
  const byDaily: ById | undefined = id ? { id, w: dailyWindow } : undefined;

  const info = useDataset(byAccount, async (p, s) => normalizeAccount(await search(AdsQueries.account(), p.id, s), p.id), wanted);
  const campaigns = useDataset(byWindow, async (p, s) => normalizeCampaigns(await search(AdsQueries.campaigns(p.w), p.id, s)), wanted);
  const previousCampaigns = useDataset(byPrevious, async (p, s) => normalizeCampaigns(await search(AdsQueries.campaigns(p.w), p.id, s)), wanted);
  const daily = useDataset(byDaily, async (p, s) => normalizeDaily(await search(AdsQueries.daily(p.w), p.id, s)), wanted);
  const searchTermsRaw = useDataset<SearchTermRaw[], ById>(byWindow, async (p, s) => normalizeSearchTerms(await search(AdsQueries.searchTerms(p.w), p.id, s)), wanted);
  const devices = useDataset(byWindow, async (p, s) => normalizeDevices(await search(AdsQueries.devices(p.w), p.id, s)), wanted);
  const hours = useDataset(byWindow, async (p, s) => normalizeHours(await search(AdsQueries.hours(p.w), p.id, s)), wanted);
  const regions = useDataset(
    byWindow,
    async (p, s) => {
      const raw = await search(AdsQueries.regions(p.w), p.id, s);
      const ids = regionIdsOf(raw);
      const names = ids.length ? normalizeGeoConstants(await search(AdsQueries.geoConstants(ids), p.id, s)) : new Map<string, string>();
      return normalizeRegions(raw, names);
    },
    wanted,
  );
  const landingPages = useDataset(byWindow, async (p, s) => normalizeLandingPages(await search(AdsQueries.landingPages(p.w), p.id, s)), wanted);
  const ads = useDataset(byWindow, async (p, s) => normalizeAds(await search(AdsQueries.ads(p.w), p.id, s)), wanted);
  const placements = useDataset(byWindow, async (p, s) => normalizePlacements(await search(AdsQueries.placements(p.w), p.id, s)), wanted);
  const conversionActions = useDataset(byAccount, async (p, s) => normalizeConversionActions(await search(AdsQueries.conversionActions(), p.id, s)), wanted);
  const conversionBreakdown = useDataset(byWindow, async (p, s) => normalizeConversionBreakdown(await search(AdsQueries.conversionBreakdown(p.w), p.id, s)), wanted);
  /** Negativas de campanha, de grupo de anúncios e de listas compartilhadas, juntas. */
  const negatives = useDataset(
    byAccount,
    async (p, s) => {
      const [campaign, adGroup, links, criteria] = await Promise.all([
        search(AdsQueries.negatives(), p.id, s),
        search(AdsQueries.adGroupNegatives(), p.id, s),
        search(AdsQueries.sharedNegativeLinks(), p.id, s),
        search(AdsQueries.sharedNegativeCriteria(), p.id, s),
      ]);
      return [...normalizeNegatives(campaign), ...normalizeAdGroupNegatives(adGroup), ...expandSharedNegatives(links, criteria)];
    },
    wanted,
  );
  const keywordsBase = useDataset<KeywordBase[], Id>(byAccount, async (p, s) => normalizeKeywords(await search(AdsQueries.keywords(), p.id, s)), wanted);
  const keywordMetrics = useDataset(byWindow, async (p, s) => normalizeKeywordMetrics(await search(AdsQueries.keywordMetrics(p.w), p.id, s)), wanted);

  // Google Analytics e Search Console (opcionais): só consultam se a conta os configurou.
  const ga4Property = config.ga4PropertyId;
  const gscSite = config.searchConsoleSite;
  const byGa4 = id && ga4Property ? { id, propertyId: ga4Property, w: account.window } : undefined;
  const byGsc = id && gscSite ? { id, site: gscSite, w: account.window } : undefined;
  const ga4PagesData = useDataset(byGa4, (p, s) => ga4Pages(p.propertyId, p.w, s), wanted);
  const gscPagesData = useDataset(byGsc, (p, s) => searchConsolePages(p.site, p.w, s), wanted);
  const gscQueriesData = useDataset(byGsc, (p, s) => searchConsoleQueries(p.site, p.w, s), wanted);

  const ga4Status = useMemo<SourceStatus>(() => {
    if (!ga4Property) return { configured: false, reason: 'Informe o ID da propriedade do GA4 em Configurações.' };
    if (ga4PagesData.error) return { configured: false, reason: ga4PagesData.error };
    return ga4PagesData.value?.status ?? { configured: true };
  }, [ga4Property, ga4PagesData.error, ga4PagesData.value]);

  const searchConsoleStatus = useMemo<SourceStatus>(() => {
    if (!gscSite) return { configured: false, reason: 'Informe o site do Search Console em Configurações.' };
    if (gscPagesData.error) return { configured: false, reason: gscPagesData.error };
    return gscPagesData.value?.status ?? { configured: true };
  }, [gscSite, gscPagesData.error, gscPagesData.value]);

  const everything: Array<DatasetState<unknown>> = [
    ga4PagesData, gscPagesData, gscQueriesData, info, campaigns, previousCampaigns, daily, searchTermsRaw,
    devices, hours, regions, landingPages, ads, placements, conversionActions, conversionBreakdown,
    negatives, keywordsBase, keywordMetrics,
  ];

  const accountName = info.value?.name ?? account.selected?.name ?? '';

  const preparedRules = useMemo(() => {
    const hints = brandHintsFrom(accountName, (campaigns.value ?? []).map((c) => c.name));
    return prepareAuditRules(rules, hints);
  }, [rules, accountName, campaigns.value]);

  const terms = useMemo<SearchTermRow[]>(() => {
    const raw = searchTermsRaw.value ?? [];
    const prepared = prepareNegatives(negatives.value ?? []);
    return raw.map((r) => {
      const c = classifyTerm(r.term, preparedRules);
      return {
        ...r,
        alreadyNegative: r.excluded || isNegated(r.term, r.campaignId, prepared, r.adGroupId),
        category: c.category,
        categoryReason: c.reason,
      };
    });
  }, [searchTermsRaw.value, negatives.value, preparedRules]);

  const keywords = useMemo<KeywordRow[]>(() => {
    const base = keywordsBase.value ?? [];
    const metrics = keywordMetrics.value;
    return base.map((k) => {
      const c = classifyKeyword(k.text, preparedRules);
      const m = metrics?.get(k.resourceName) ?? EMPTY_PERF;
      return { ...k, ...m, category: c.category, categoryReason: c.reason };
    });
  }, [keywordsBase.value, keywordMetrics.value, preparedRules]);

  const reloadAll = (): void => {
    everything.forEach((d) => d.reload());
    account.discover();
  };

  const loadedTimes = everything.map((d) => d.loadedAt).filter((t): t is number => t !== null);

  const value: WorkspaceValue = {
    needCore,
    info, campaigns, previousCampaigns, daily, searchTermsRaw, devices, hours, regions, landingPages, ads,
    placements, conversionActions, conversionBreakdown, negatives, keywordsBase, keywordMetrics,
    ga4Pages: ga4PagesData, gscPages: gscPagesData, gscQueries: gscQueriesData,
    ga4Status, searchConsoleStatus, accountName, preparedRules, terms, keywords,
    reloadAll,
    anyLoading: everything.some((d) => d.loading),
    lastLoadedAt: loadedTimes.length ? Math.max(...loadedTimes) : null,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace precisa estar dentro de <WorkspaceProvider>.');
  return ctx;
}
