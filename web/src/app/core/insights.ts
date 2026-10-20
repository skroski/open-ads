import { Injectable, computed, inject } from '@angular/core';

import { ContentOpportunity, findContentOpportunities } from '../domain/content';
import { stageLagDays } from '../domain/config';
import { aggregateMatchesGoal, analyzeEfficiency, MediaScope } from '../domain/efficiency';
import { diffDays, isoDate } from '../domain/dates';
import { CHANNEL_LABEL } from '../domain/format';
import {
  FunnelMetrics,
  FunnelResult,
  buildFunnel,
  leadReached,
  leadsInWindow,
  maturesOn,
  windowMaturity,
} from '../domain/funnel';
import {
  CandidatePage,
  TermCluster,
  clusterTerms,
  coherenceOf,
  indexAdsByGroup,
  pageTextOf,
  recommendPage,
} from '../domain/intent';
import { AdGroupFit, adGroupFits } from '../domain/keyword-fit';
import {
  KeywordSuggestion,
  suggestFromSearchConsole,
  suggestFromTerms,
} from '../domain/keyword-suggest';
import { classifyTerm } from '../domain/classify';
import { NegativeGap, findNegativeGaps } from '../domain/negatives';
import { median } from '../domain/stats';
import {
  FunnelStage,
  Recommendation,
  RecommendationStatus,
  SearchConsoleQueryRow,
  SearchTermRow,
  WasteRow,
} from '../domain/models';
import {
  PageFinding,
  RecommendationInput,
  CrmQuality,
  buildRecommendations,
} from '../domain/recommendations';
import { detectConversionOutages } from '../domain/tracking';
import {
  WasteEnv,
  WasteInputs,
  wasteAds,
  wasteCampaigns,
  wasteDevices,
  wasteHours,
  wasteKeywords,
  wastePages,
  wastePlacements,
  wasteRegions,
  wasteTerms,
} from '../domain/waste-dimensions';
import { contentTokens, normalizeUrl, normalize, urlHost } from '../domain/text';
import { AssessContext, GroupOptions, costReference, summarize } from '../domain/waste';
import { AccountStore } from './account.store';
import { BusinessConfigStore } from './business-config.store';
import {
  ChangesStore,
  ContentStore,
  LeadsStore,
  QuestionsStore,
  RecStatesStore,
} from './collections';
import { PageAudits } from './page-audits';
import { Workspace } from './workspace';

export interface RecommendationView extends Recommendation {
  status: RecommendationStatus;
  note?: string;
}

export interface RegionCoverage {
  geoClicks: number;
  campaignClicks: number;
  ratio: number;
  consistent: boolean;
}

const EMPTY: readonly never[] = [];
const WEEKDAY_NAME = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

const hourLabel = (h: number): string =>
  `${String(h).padStart(2, '0')}h–${String((h + 1) % 24).padStart(2, '0')}h`;

/**
 * Cruza todas as fontes e roda os motores de análise. Telas só leem sinais daqui.
 * Nada neste serviço dispara escrita: é análise pura sobre os dados carregados.
 */
@Injectable({ providedIn: 'root' })
export class Insights {
  private readonly ws = inject(Workspace);
  private readonly account = inject(AccountStore);
  private readonly cfg = inject(BusinessConfigStore);
  private readonly leads = inject(LeadsStore);
  private readonly contentStore = inject(ContentStore);
  private readonly states = inject(RecStatesStore);
  private readonly audits = inject(PageAudits);
  private readonly changes = inject(ChangesStore);
  private readonly questions = inject(QuestionsStore);

  // ───── Contexto ─────

  readonly goal = computed(() => this.cfg.config().goal);
  readonly thresholds = computed(() => this.cfg.config().thresholds);
  readonly window = this.account.window;

  readonly context = computed<AssessContext>(() => ({
    thresholds: this.thresholds(),
    goal: this.goal(),
    windowDays: this.window().days,
  }));

  readonly goalLagDays = computed(() => stageLagDays(this.goal(), this.goal().goalStage));
  readonly maturity = computed(() => windowMaturity(this.window(), this.goalLagDays()));
  readonly maturesOnDate = computed(() => maturesOn(this.window(), this.goalLagDays()));

  // ───── Carregamento ─────

  /** Pede todos os conjuntos de dados que as análises usam. */
  needCore(): void {
    [
      this.ws.info,
      this.ws.campaigns,
      this.ws.previousCampaigns,
      this.ws.daily,
      this.ws.searchTermsRaw,
      this.ws.negatives,
      this.ws.conversionActions,
      this.ws.conversionBreakdown,
      this.ws.regions,
      this.ws.hours,
      this.ws.devices,
      this.ws.landingPages,
      this.ws.ads,
      this.ws.placements,
      this.ws.keywordsBase,
      this.ws.keywordMetrics,
    ].forEach((d) => d.need());
    this.ws.ga4Pages.need();
    this.ws.gscPages.need();
    this.ws.gscQueries.need();
  }

  readonly loadingCore = computed(
    () =>
      this.ws.campaigns.loading() ||
      this.ws.conversionBreakdown.loading() ||
      this.ws.searchTermsRaw.loading() ||
      this.ws.daily.loading(),
  );

  readonly coreError = computed(
    () =>
      this.ws.campaigns.error() ??
      this.ws.conversionBreakdown.error() ??
      this.ws.conversionActions.error() ??
      this.ws.searchTermsRaw.error() ??
      null,
  );

  // ───── Funil e meta ─────

  readonly funnel = computed<FunnelResult | null>(() => {
    const campaigns = this.ws.campaigns.value();
    const breakdown = this.ws.conversionBreakdown.value();
    const actions = this.ws.conversionActions.value();
    if (!campaigns || !breakdown || !actions) return null;
    return buildFunnel({
      campaigns,
      breakdown,
      actions,
      mapping: this.cfg.config().mapping,
      leads: this.leads.items(),
      window: this.window(),
      goal: this.goal(),
    });
  });

  /** Resultados no estágio-meta; null quando a fonte do estágio não existe. */
  private outcomesOf(m: FunnelMetrics): number | null {
    const v = m.stages[this.goal().goalStage];
    if (v.source === 'NONE') return null;
    if (v.source === 'ADS' && this.funnel()?.resolutions.some((r) =>
      r.stage === this.goal().goalStage && r.allConversions > 0 && !r.confirmed)) return null;
    return v.count;
  }

  readonly costRef = computed(() => {
    const f = this.funnel();
    if (!f) return { target: null as number | null, isAverage: false };
    const v = f.total.stages[this.goal().goalStage];
    return costReference(this.goal(), f.total.cost, v.source === 'NONE' ? 0 : v.count);
  });

  readonly goalIsAdsMeasured = computed(() => {
    const s = this.goal().goalStage;
    return (s === 'CONTACT' || s === 'INTERACTION') &&
      aggregateMatchesGoal(this.ws.conversionActions.value() ?? [], this.cfg.config().mapping, this.goal());
  });

  // ───── Mapas auxiliares ─────

  private readonly campaignNames = computed(
    () => new Map((this.ws.campaigns.value() ?? []).map((c) => [c.id, c.name])),
  );

  private readonly channelNames = computed(() => {
    const map = new Map<string, string>();
    for (const c of this.ws.campaigns.value() ?? [])
      map.set(c.channel, CHANNEL_LABEL[c.channel] ?? c.channel);
    return map;
  });

  private readonly adsByGroup = computed(() => indexAdsByGroup(this.ws.ads.value() ?? []));

  /** Maturação de cada campanha, ponderada pelo custo dia a dia. */
  private readonly campaignMaturity = computed(() => {
    const w = this.window();
    const lag = this.goalLagDays();
    const today = isoDate(new Date());
    const acc = new Map<string, { cost: number; mature: number }>();
    for (const r of this.ws.daily.value() ?? []) {
      if (r.date < w.from || r.date > w.to) continue;
      const e = acc.get(r.campaignId) ?? { cost: 0, mature: 0 };
      e.cost += r.cost;
      if (diffDays(r.date, today) >= lag) e.mature += r.cost;
      acc.set(r.campaignId, e);
    }
    const out = new Map<string, number>();
    for (const [id, e] of acc) out.set(id, e.cost > 0 ? e.mature / e.cost : this.maturity());
    return out;
  });

  private options(
    dimension: GroupOptions['dimension'],
    groupLabel: string,
    extra: Partial<GroupOptions> = {},
  ): GroupOptions {
    const ref = this.costRef();
    return {
      dimension,
      groupLabel,
      maturity: this.maturity(),
      costTarget: ref.target,
      costTargetIsAverage: ref.isAverage,
      ...extra,
    };
  }

  /** Índice dos leads do CRM com termo informado, por estágio-meta. */
  private readonly crmByTerm = computed(() => {
    const stage = this.goal().goalStage;
    const cohort = leadsInWindow(this.leads.items(), this.window());
    const withTerm = cohort.filter((l) => l.term);
    const map = new Map<string, number>();
    for (const l of withTerm) {
      const r = leadReached(l);
      const reached =
        stage === 'CONTACT' || stage === 'INTERACTION'
          ? true
          : stage === 'QUALIFIED'
            ? r.qualified
            : stage === 'PROPOSAL'
              ? r.proposal
              : r.sale;
      if (reached)
        map.set(normalize(l.term as string), (map.get(normalize(l.term as string)) ?? 0) + 1);
    }
    return { available: withTerm.length > 0, map };
  });

  // ───── Desperdício por dimensão ─────

  private readonly wasteInputs = computed<WasteInputs>(() => {
    const ga4 = this.ws.ga4Pages.value();
    return {
      funnel: this.funnel(),
      campaigns: this.ws.campaigns.value(),
      campaignMaturity: this.campaignMaturity(),
      campaignNames: this.campaignNames(),
      channelNames: this.channelNames(),
      terms: this.ws.terms(),
      keywords: this.ws.keywords(),
      regions: this.ws.regions.value(),
      devices: this.ws.devices.value(),
      hours: this.ws.hours.value(),
      landingPages: this.ws.landingPages.value(),
      ads: this.ws.ads.value(),
      placements: this.ws.placements.value(),
      ga4Rows: ga4?.status.configured ? ga4.rows : null,
      brand: this.ws.preparedRules().brand,
      adsByGroup: this.adsByGroup(),
      crmByTerm: this.crmByTerm(),
      auditOf: (url) => this.audits.get(url),
      serviceArea: this.cfg.config().serviceArea,
      serviceHours: this.cfg.config().serviceHours,
    };
  });

  private readonly wasteEnv = computed<WasteEnv>(() => ({
    context: this.context(),
    adsMeasured: this.goalIsAdsMeasured(),
    outcomesOf: (m) => this.outcomesOf(m),
    options: (dimension, groupLabel, extra) => this.options(dimension, groupLabel, extra),
  }));

  /** Recortes com o mesmo escopo; a tela não rateia dados da conta entre campanhas. */
  efficiency(channel: MediaScope, campaignId = '') {
    return analyzeEfficiency(this.wasteInputs(), this.wasteEnv(), channel, campaignId);
  }

  readonly wasteCampaigns = computed<WasteRow[]>(() =>
    wasteCampaigns(this.wasteInputs(), this.wasteEnv()),
  );

  readonly wasteTerms = computed<WasteRow[]>(() => wasteTerms(this.wasteInputs(), this.wasteEnv()));

  readonly wasteKeywords = computed<WasteRow[]>(() =>
    wasteKeywords(this.wasteInputs(), this.wasteEnv()),
  );

  /** Regiões: presença e interesse são partições do mesmo total, então somam. */
  readonly regionCoverage = computed<RegionCoverage | null>(() => {
    const regions = this.ws.regions.value();
    const campaigns = this.ws.campaigns.value();
    if (!regions || !campaigns) return null;
    const geoClicks = regions.reduce((s, r) => s + r.clicks, 0);
    const campaignClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
    const ratio = campaignClicks > 0 ? geoClicks / campaignClicks : 0;
    return { geoClicks, campaignClicks, ratio, consistent: ratio >= 0.97 && ratio <= 1.03 };
  });

  readonly wasteRegions = computed<WasteRow[]>(() =>
    wasteRegions(this.wasteInputs(), this.wasteEnv()),
  );

  readonly serviceAreaConfigured = computed(
    () => this.cfg.config().serviceArea.regionIds.length > 0,
  );

  readonly wasteDevices = computed<WasteRow[]>(() =>
    wasteDevices(this.wasteInputs(), this.wasteEnv()),
  );

  readonly wasteHours = computed<WasteRow[]>(() => wasteHours(this.wasteInputs(), this.wasteEnv()));

  readonly wastePages = computed<WasteRow[]>(() => wastePages(this.wasteInputs(), this.wasteEnv()));

  readonly wastePlacements = computed<WasteRow[]>(() =>
    wastePlacements(this.wasteInputs(), this.wasteEnv()),
  );

  readonly wasteAds = computed<WasteRow[]>(() => wasteAds(this.wasteInputs(), this.wasteEnv()));

  // ───── Cobertura de negativas entre campanhas ─────

  /** Negativas presentes em parte das campanhas de Pesquisa e ausentes nas demais. */
  readonly negativeGaps = computed<NegativeGap[]>(() => {
    const negatives = this.ws.negatives.value();
    const campaigns = this.ws.campaigns.value();
    if (!negatives || !campaigns) return [];
    return findNegativeGaps({
      negatives,
      campaigns,
      keywords: (this.ws.keywordsBase.value() ?? []).filter((k) => k.status === 'ENABLED'),
      terms: this.ws.terms(),
      brand: this.ws.preparedRules().brand,
    });
  });

  // ───── Palavra-chave × página de destino ─────

  /** Para cada grupo de anúncios: página usada, aderência das palavras e notas do Google. */
  readonly keywordFits = computed<AdGroupFit[]>(() => {
    const adUrlsByGroup = new Map<string, string[]>();
    for (const [id, g] of this.adsByGroup()) adUrlsByGroup.set(id, g.urls);
    return adGroupFits({
      keywords: this.ws.keywords(),
      adUrlsByGroup,
      pageOf: (url) => pageTextOf(url, this.audits.get(url)),
      candidates: this.candidatePages(),
    });
  });

  /** Sugestões de palavras-chave por campanha, tiradas dos termos de busca e do Search Console. */
  readonly keywordSuggestions = computed<KeywordSuggestion[]>(() => {
    const keywords = this.ws.keywords();
    const rules = this.ws.preparedRules();
    return [
      ...suggestFromTerms(this.ws.terms(), keywords),
      ...suggestFromSearchConsole(
        this.ws.gscQueries.value()?.rows ?? [],
        keywords,
        (text) => classifyTerm(text, rules).category === 'UNQUALIFIED',
      ),
    ];
  });

  readonly wasteByDimension = computed(() => ({
    campaign: this.wasteCampaigns(),
    term: this.wasteTerms(),
    keyword: this.wasteKeywords(),
    ad: this.wasteAds(),
    region: this.wasteRegions(),
    device: this.wasteDevices(),
    hour: this.wasteHours(),
    page: this.wastePages(),
    placement: this.wastePlacements(),
  }));

  readonly wasteSummaryByDimension = computed(() => {
    const w = this.wasteByDimension();
    return {
      campaign: summarize(w.campaign),
      term: summarize(w.term),
      keyword: summarize(w.keyword),
      ad: summarize(w.ad),
      region: summarize(w.region),
      device: summarize(w.device),
      hour: summarize(w.hour),
      page: summarize(w.page),
      placement: summarize(w.placement),
    };
  });

  // ───── Rastreamento ─────

  readonly outages = computed(() => {
    const today = isoDate(new Date());
    return detectConversionOutages(this.ws.daily.value() ?? []).filter(
      (o) => o.ongoing || diffDays(o.to, today) <= 45,
    );
  });

  /** Quanto do custo de Pesquisa os termos visíveis explicam (0–1). */
  readonly searchCoverage = computed<number | null>(() => {
    const campaigns = (this.ws.campaigns.value() ?? []).filter((c) => c.channel === 'SEARCH');
    const cost = campaigns.reduce((s, c) => s + c.cost, 0);
    if (cost <= 0 || !this.ws.searchTermsRaw.value()) return null;
    const ids = new Set(campaigns.map((c) => c.id));
    const covered = this.ws
      .terms()
      .filter((t) => ids.has(t.campaignId))
      .reduce((s, t) => s + t.cost, 0);
    return Math.min(1, covered / cost);
  });

  // ───── Intenção e páginas ─────

  readonly clusters = computed<TermCluster[]>(() =>
    clusterTerms(
      this.ws.terms().filter((t) => !t.alreadyNegative),
      this.ws.preparedRules().brand,
    ),
  );

  /** Páginas conhecidas, com o texto que as descreve (leitura real, quando houver). */
  readonly candidatePages = computed<CandidatePage[]>(() => {
    const map = new Map<string, CandidatePage>();
    const add = (url: string, origin: string, titles: string[] = []): void => {
      if (!url) return;
      const norm = normalizeUrl(url);
      if (map.has(norm)) return;
      const text = pageTextOf(url, this.audits.get(url), titles);
      map.set(norm, { url, normalizedUrl: norm, words: text.words, basis: text.basis, origin });
    };
    for (const a of this.ws.ads.value() ?? [])
      a.finalUrls.forEach((u) => add(u, 'usada nos anúncios'));
    for (const p of this.ws.landingPages.value() ?? []) add(p.url, 'usada nos anúncios');
    for (const c of this.contentStore.items()) {
      if (c.url && c.status !== 'IDEA') add(c.url, 'conteúdo registrado', [c.title, c.theme]);
    }
    for (const g of this.ws.gscPages.value()?.rows ?? []) add(g.page, 'aparece no Google');
    return Array.from(map.values());
  });

  readonly pageFindings = computed<PageFinding[]>(() => {
    const adsByGroup = this.adsByGroup();
    const candidates = this.candidatePages();
    return this.clusters()
      .filter((c) => c.cost >= 5)
      .slice(0, 40)
      .map((cluster) => {
        const urls = new Set<string>();
        for (const t of cluster.terms)
          adsByGroup.get(t.adGroupId)?.urls.forEach((u) => urls.add(u));
        const currentUrls = Array.from(urls);
        let weighted = 0;
        let weight = 0;
        for (const t of cluster.terms) {
          const group = adsByGroup.get(t.adGroupId);
          const url = group?.urls[0];
          if (!group || !url || t.cost <= 0) continue;
          const c = coherenceOf(t.term, group.texts, pageTextOf(url, this.audits.get(url)));
          if (c.score !== null) {
            weighted += c.score * t.cost;
            weight += t.cost;
          }
        }
        return {
          cluster,
          currentUrls,
          recommendation: recommendPage(cluster, currentUrls, candidates),
          coherence: weight > 0 ? weighted / weight : null,
        };
      });
  });

  // ───── Conteúdo ─────

  readonly organicClusters = computed<TermCluster[]>(() => {
    const rows = this.ws.gscQueries.value();
    if (!rows?.status.configured) return [];
    const asTerms: SearchTermRow[] = rows.rows.map((q: SearchConsoleQueryRow) => ({
      term: q.query.toLowerCase(),
      campaignId: 'gsc',
      campaignName: 'Busca orgânica',
      adGroupId: 'gsc',
      adGroupName: 'gsc',
      excluded: false,
      alreadyNegative: false,
      category: 'GENERAL' as const,
      categoryReason: '',
      impressions: q.impressions,
      clicks: Math.max(q.clicks, q.impressions > 0 ? 1 : 0),
      cost: 0,
      conversions: 0,
    }));
    return clusterTerms(asTerms, this.ws.preparedRules().brand);
  });

  /** Cada dúvida do atendimento vira um grupo de assunto; `clicks` carrega quantas vezes apareceu. */
  readonly supportClusters = computed<TermCluster[]>(() =>
    this.questions.items().map((q, i) => ({
      id: `q${i}-${q.id.slice(0, 6)}`,
      topics: contentTokens(q.question).slice(0, 4),
      label: q.question,
      terms: [],
      clicks: q.count,
      cost: 0,
      conversions: 0,
      impressions: 0,
      intent: 'INFORMATIONAL' as const,
    })),
  );

  readonly contentOpportunities = computed<ContentOpportunity[]>(() =>
    findContentOpportunities({
      clusters: this.clusters(),
      organicClusters: this.organicClusters(),
      supportClusters: this.supportClusters(),
      candidates: this.candidatePages(),
      registry: this.contentStore.items(),
      gscPages: this.ws.gscPages.value()?.status.configured ? this.ws.gscPages.value()!.rows : null,
      gscQueries: this.ws.gscQueries.value()?.status.configured
        ? this.ws.gscQueries.value()!.rows
        : null,
      ga4Pages: this.ws.ga4Pages.value()?.status.configured ? this.ws.ga4Pages.value()!.rows : null,
      paidUrls: (this.ws.landingPages.value() ?? []).map((p) => p.url),
      today: isoDate(new Date()),
    }),
  );

  // ───── Atendimento (CRM) ─────

  readonly crmQuality = computed<CrmQuality | null>(() => {
    const cohort = leadsInWindow(this.leads.items(), this.window());
    if (!cohort.length) return null;
    const disq = cohort.filter((l) => l.status === 'DISQUALIFIED').length;
    const times = cohort
      .map((l) => l.firstResponseMinutes)
      .filter((v): v is number => v !== undefined && v >= 0);
    return {
      leads: cohort.length,
      disqualified: disq,
      disqualifiedShare: disq / cohort.length,
      medianResponseMinutes: median(times),
      slowResponseShare: times.length ? times.filter((m) => m > 60).length / times.length : null,
    };
  });

  // ───── Recomendações ─────

  readonly recommendations = computed<RecommendationView[]>(() => {
    const f = this.funnel();
    const campaigns = this.ws.campaigns.value();
    if (!f || !campaigns) return [];
    const w = this.wasteByDimension();
    const input: RecommendationInput = {
      windowDays: this.window().days,
      windowLabel: this.account.rangeLabel(),
      goal: this.goal(),
      thresholds: this.thresholds(),
      maturity: this.maturity(),
      maturesOn: this.maturesOnDate(),
      funnel: f,
      campaigns,
      waste: {
        campaigns: w.campaign,
        terms: w.term,
        regions: w.region,
        hours: w.hour,
        pages: w.page,
        placements: w.placement,
      },
      terms: this.ws.terms(),
      outages: this.outages(),
      pageFindings: this.pageFindings(),
      contentOpportunities: this.contentOpportunities(),
      crmQuality: this.crmQuality(),
      sources: {
        crm: f.crmPresent,
        ga4: this.ws.ga4Status(),
        searchConsole: this.ws.searchConsoleStatus(),
      },
      serviceAreaConfigured: this.serviceAreaConfigured(),
      searchCoverage: this.searchCoverage(),
    };
    return buildRecommendations(input).map((r) => ({
      ...r,
      status: this.states.statusOf(r.id),
      note: this.states.noteOf(r.id),
    }));
  });

  readonly openRecommendations = computed(() =>
    this.recommendations().filter((r) => r.status === 'OPEN'),
  );

  readonly stageOrder: readonly FunnelStage[] = [
    'CLICK',
    'INTERACTION',
    'CONTACT',
    'QUALIFIED',
    'PROPOSAL',
    'SALE',
  ];

  /** Para depuração e telas que mostram o domínio do site. */
  readonly siteHosts = computed(() => {
    const hosts = new Set<string>(this.cfg.config().domains.map((d) => d.replace(/^www\./, '')));
    for (const p of this.ws.landingPages.value() ?? []) {
      const h = urlHost(p.url);
      if (h) hosts.add(h);
    }
    return Array.from(hosts);
  });

  readonly changeCount = computed(() => this.changes.items().length);

  readonly empty = EMPTY;
}
