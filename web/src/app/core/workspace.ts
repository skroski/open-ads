import { Injectable, computed, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  KeywordBase,
  SearchTermRaw,
  normalizeAccount,
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
  normalizeAdGroupNegatives,
  expandSharedNegatives,
  normalizeNetworks,
  normalizePlacements,
  normalizeRegions,
  normalizeSearchTerms,
  regionIdsOf,
} from '../data/ads-normalize';
import { AdsQueries } from '../data/ads-queries';
import { GoogleAdsApi } from '../data/google-ads.api';
import { IntegrationsApi, SourceData } from '../data/integrations.api';
import { brandHintsFrom, classifyKeyword, classifyTerm, prepareAuditRules } from '../domain/classify';
import { DateWindow, addDays, isoDate, windowOf } from '../domain/dates';
import { isNegated, prepareNegatives } from '../domain/negatives';
import {
  Ga4ChannelRow,
  Ga4PageRow,
  KeywordRow,
  Perf,
  SearchConsolePageRow,
  SearchConsoleQueryRow,
  SearchTermRow,
  SourceStatus,
} from '../domain/models';
import { AccountStore } from './account.store';
import { BusinessConfigStore } from './business-config.store';
import { Dataset } from './dataset';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

interface ByAccount {
  id: string;
}
interface ByWindow extends ByAccount {
  w: DateWindow;
}
interface ByGa4 extends ByWindow {
  propertyId: string;
}
interface ByGsc extends ByWindow {
  site: string;
}

const EMPTY_PERF: Perf = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };

/**
 * Todos os dados do Google Ads da conta ativa, carregados sob demanda.
 *
 * As telas pedem o que precisam (`ws.campaigns.need()`) e leem sinais; mudar a
 * conta ou o período recarrega só o que já foi pedido.
 */
@Injectable({ providedIn: 'root' })
export class Workspace {
  private readonly api = inject(GoogleAdsApi);
  private readonly integrations = inject(IntegrationsApi);
  private readonly account = inject(AccountStore);
  private readonly config = inject(BusinessConfigStore);

  private readonly byAccount = computed<ByAccount | undefined>(() => {
    const id = this.account.selectedId();
    return id ? { id } : undefined;
  });

  private readonly byWindow = computed<ByWindow | undefined>(() => {
    const id = this.account.selectedId();
    return id ? { id, w: this.account.window() } : undefined;
  });

  private readonly byPrevious = computed<ByWindow | undefined>(() => {
    const id = this.account.selectedId();
    return id ? { id, w: this.account.previous() } : undefined;
  });

  /** 180 dias terminando ontem: base para rastreamento, maturação e efeitos. */
  readonly dailyWindow = computed<DateWindow>(() => {
    const yesterday = addDays(isoDate(new Date()), -1);
    return windowOf(addDays(yesterday, -179), yesterday);
  });

  private readonly byDaily = computed<ByWindow | undefined>(() => {
    const id = this.account.selectedId();
    return id ? { id, w: this.dailyWindow() } : undefined;
  });

  private run(query: string, customerId: string): Promise<Raw[]> {
    return firstValueFrom(this.api.search(query, customerId));
  }

  // ───── Conjuntos de dados ─────

  readonly info = new Dataset(this.byAccount, async (p) =>
    normalizeAccount(await this.run(AdsQueries.account(), p.id), p.id),
  );

  readonly campaigns = new Dataset(this.byWindow, async (p) =>
    normalizeCampaigns(await this.run(AdsQueries.campaigns(p.w), p.id)),
  );

  readonly previousCampaigns = new Dataset(this.byPrevious, async (p) =>
    normalizeCampaigns(await this.run(AdsQueries.campaigns(p.w), p.id)),
  );

  readonly daily = new Dataset(this.byDaily, async (p) =>
    normalizeDaily(await this.run(AdsQueries.daily(p.w), p.id)),
  );

  readonly searchTermsRaw = new Dataset<SearchTermRaw[], ByWindow>(this.byWindow, async (p) =>
    normalizeSearchTerms(await this.run(AdsQueries.searchTerms(p.w), p.id)),
  );

  readonly devices = new Dataset(this.byWindow, async (p) =>
    normalizeDevices(await this.run(AdsQueries.devices(p.w), p.id)),
  );

  readonly networks = new Dataset(this.byWindow, async (p) =>
    normalizeNetworks(await this.run(AdsQueries.networks(p.w), p.id)),
  );

  readonly hours = new Dataset(this.byWindow, async (p) =>
    normalizeHours(await this.run(AdsQueries.hours(p.w), p.id)),
  );

  readonly regions = new Dataset(this.byWindow, async (p) => {
    const raw = await this.run(AdsQueries.regions(p.w), p.id);
    const ids = regionIdsOf(raw);
    const names = ids.length
      ? normalizeGeoConstants(await this.run(AdsQueries.geoConstants(ids), p.id))
      : new Map<string, string>();
    return normalizeRegions(raw, names);
  });

  readonly landingPages = new Dataset(this.byWindow, async (p) =>
    normalizeLandingPages(await this.run(AdsQueries.landingPages(p.w), p.id)),
  );

  readonly ads = new Dataset(this.byWindow, async (p) =>
    normalizeAds(await this.run(AdsQueries.ads(p.w), p.id)),
  );

  readonly placements = new Dataset(this.byWindow, async (p) =>
    normalizePlacements(await this.run(AdsQueries.placements(p.w), p.id)),
  );

  readonly conversionActions = new Dataset(this.byAccount, async (p) =>
    normalizeConversionActions(await this.run(AdsQueries.conversionActions(), p.id)),
  );

  readonly conversionBreakdown = new Dataset(this.byWindow, async (p) =>
    normalizeConversionBreakdown(await this.run(AdsQueries.conversionBreakdown(p.w), p.id)),
  );

  /** Negativas de campanha, de grupo de anúncios e de listas compartilhadas, juntas. */
  readonly negatives = new Dataset(this.byAccount, async (p) => {
    const [campaign, adGroup, links, criteria] = await Promise.all([
      this.run(AdsQueries.negatives(), p.id),
      this.run(AdsQueries.adGroupNegatives(), p.id),
      this.run(AdsQueries.sharedNegativeLinks(), p.id),
      this.run(AdsQueries.sharedNegativeCriteria(), p.id),
    ]);
    return [
      ...normalizeNegatives(campaign),
      ...normalizeAdGroupNegatives(adGroup),
      ...expandSharedNegatives(links, criteria),
    ];
  });

  readonly keywordsBase = new Dataset<KeywordBase[], ByAccount>(this.byAccount, async (p) =>
    normalizeKeywords(await this.run(AdsQueries.keywords(), p.id)),
  );

  readonly keywordMetrics = new Dataset(this.byWindow, async (p) =>
    normalizeKeywordMetrics(await this.run(AdsQueries.keywordMetrics(p.w), p.id)),
  );

  readonly campaignLocations = new Dataset(this.byAccount, async (p) =>
    normalizeCampaignLocations(await this.run(AdsQueries.campaignLocations(), p.id)),
  );

  /** Eventos de mudança dos últimos 30 dias (limite do Google Ads). */
  readonly changeEvents = new Dataset(this.byAccount, async (p) => {
    const now = new Date();
    const from = `${addDays(isoDate(now), -29)} 00:00:00`;
    const to = `${isoDate(now)} 23:59:59`;
    return normalizeChanges(await this.run(AdsQueries.changeEvents(from, to), p.id));
  });

  // ───── Google Analytics e Search Console (opcionais) ─────

  private readonly byGa4 = computed<ByGa4 | undefined>(() => {
    const id = this.account.selectedId();
    const propertyId = this.config.config().ga4PropertyId;
    return id && propertyId ? { id, propertyId, w: this.account.window() } : undefined;
  });

  private readonly byGsc = computed<ByGsc | undefined>(() => {
    const id = this.account.selectedId();
    const site = this.config.config().searchConsoleSite;
    return id && site ? { id, site, w: this.account.window() } : undefined;
  });

  readonly ga4Pages = new Dataset<SourceData<Ga4PageRow>, ByGa4>(
    this.byGa4,
    (p) => firstValueFrom(this.integrations.ga4Pages(p.propertyId, p.w)),
  );

  readonly ga4Channels = new Dataset<SourceData<Ga4ChannelRow>, ByGa4>(
    this.byGa4,
    (p) => firstValueFrom(this.integrations.ga4Channels(p.propertyId, p.w)),
  );

  readonly gscPages = new Dataset<SourceData<SearchConsolePageRow>, ByGsc>(
    this.byGsc,
    (p) => firstValueFrom(this.integrations.searchConsolePages(p.site, p.w)),
  );

  readonly gscQueries = new Dataset<SourceData<SearchConsoleQueryRow>, ByGsc>(
    this.byGsc,
    (p) => firstValueFrom(this.integrations.searchConsoleQueries(p.site, p.w)),
  );

  /** Estado do GA4 em linguagem simples: não configurado, sem permissão, ok. */
  readonly ga4Status = computed<SourceStatus>(() => {
    if (!this.config.config().ga4PropertyId) {
      return { configured: false, reason: 'Informe o ID da propriedade do GA4 em Configurações.' };
    }
    const err = this.ga4Pages.error();
    if (err) return { configured: false, reason: err };
    return this.ga4Pages.value()?.status ?? { configured: true };
  });

  readonly searchConsoleStatus = computed<SourceStatus>(() => {
    if (!this.config.config().searchConsoleSite) {
      return { configured: false, reason: 'Informe o site do Search Console em Configurações.' };
    }
    const err = this.gscPages.error();
    if (err) return { configured: false, reason: err };
    return this.gscPages.value()?.status ?? { configured: true };
  });

  private readonly everything: Array<{ reload(): void; loading(): boolean; loadedAt(): number | null }> = [
    this.ga4Pages,
    this.ga4Channels,
    this.gscPages,
    this.gscQueries,
    this.info,
    this.campaigns,
    this.previousCampaigns,
    this.daily,
    this.searchTermsRaw,
    this.devices,
    this.networks,
    this.hours,
    this.regions,
    this.landingPages,
    this.ads,
    this.placements,
    this.conversionActions,
    this.conversionBreakdown,
    this.negatives,
    this.keywordsBase,
    this.keywordMetrics,
    this.campaignLocations,
    this.changeEvents,
  ];

  // ───── Derivados ─────

  readonly accountName = computed(() => this.info.value()?.name ?? this.account.selected()?.name ?? '');
  readonly currency = computed(() => this.info.value()?.currency ?? 'BRL');

  readonly preparedRules = computed(() => {
    const campaigns = this.campaigns.value() ?? [];
    const hints = brandHintsFrom(
      this.accountName(),
      campaigns.map((c) => c.name),
    );
    return prepareAuditRules(this.config.rules(), hints);
  });

  /** Termos de busca já classificados pelas regras da conta e cruzados com as negativas. */
  readonly terms = computed<SearchTermRow[]>(() => {
    const raw = this.searchTermsRaw.value() ?? [];
    const rules = this.preparedRules();
    const negatives = prepareNegatives(this.negatives.value() ?? []);
    return raw.map((r) => {
      const c = classifyTerm(r.term, rules);
      return {
        ...r,
        alreadyNegative: r.excluded || isNegated(r.term, r.campaignId, negatives, r.adGroupId),
        category: c.category,
        categoryReason: c.reason,
      };
    });
  });

  /** Palavras anunciadas com classificação e desempenho do período. */
  readonly keywords = computed<KeywordRow[]>(() => {
    const base = this.keywordsBase.value() ?? [];
    const metrics = this.keywordMetrics.value();
    const rules = this.preparedRules();
    return base.map((k) => {
      const c = classifyKeyword(k.text, rules);
      const m = metrics?.get(k.resourceName) ?? EMPTY_PERF;
      return { ...k, ...m, category: c.category, categoryReason: c.reason };
    });
  });

  /** Recarrega tudo o que já foi pedido por alguma tela. */
  reloadAll(): void {
    this.everything.forEach((d) => d.reload());
    this.account.discover();
  }

  anyLoading = computed(() => this.everything.some((d) => d.loading()));

  /** Última carga concluída entre os dados já pedidos (ms), ou null. */
  readonly lastLoadedAt = computed(() => {
    const times = this.everything.map((d) => d.loadedAt()).filter((t): t is number => t !== null);
    return times.length ? Math.max(...times) : null;
  });
}
