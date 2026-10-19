import { useMemo } from 'react';
import { findContentOpportunities, type ContentOpportunity } from '@shared/domain/content';
import { classifyTerm } from '@shared/domain/classify';
import { stageLagDays } from '@shared/domain/config';
import { diffDays, isoDate } from '@shared/domain/dates';
import { CHANNEL_LABEL } from '@shared/domain/format';
import {
  buildFunnel,
  leadReached,
  leadsInWindow,
  maturesOn,
  windowMaturity,
  type FunnelMetrics,
  type FunnelResult,
} from '@shared/domain/funnel';
import {
  clusterTerms,
  coherenceOf,
  indexAdsByGroup,
  pageTextOf,
  recommendPage,
  type CandidatePage,
  type TermCluster,
} from '@shared/domain/intent';
import type {
  FunnelStage,
  Recommendation,
  RecommendationStatus,
  SearchConsoleQueryRow,
  SearchTermRow,
  WasteRow,
} from '@shared/domain/models';
import { buildRecommendations, type CrmQuality, type PageFinding, type RecommendationInput } from '@shared/domain/recommendations';
import { median } from '@shared/domain/stats';
import { contentTokens, normalize, normalizeUrl } from '@shared/domain/text';
import { detectConversionOutages } from '@shared/domain/tracking';
import {
  wasteCampaigns,
  wasteHours,
  wastePages,
  wastePlacements,
  wasteRegions,
  wasteTerms,
  type WasteEnv,
  type WasteInputs,
} from '@shared/domain/waste-dimensions';
import { costReference, type AssessContext, type GroupOptions } from '@shared/domain/waste';
import { useAccount } from './account';
import { usePageAudits } from './audits';
import { useContentItems, useLeads, useQuestions, useRecommendationStates } from './collections';
import { useBusinessConfig } from './config';
import { useWorkspace } from './workspace';

export interface RecommendationView extends Recommendation {
  status: RecommendationStatus;
  note?: string;
}

export const STAGE_ORDER: readonly FunnelStage[] = ['CLICK', 'INTERACTION', 'CONTACT', 'QUALIFIED', 'PROPOSAL', 'SALE'];

/**
 * Cruza todas as fontes e roda os motores de análise (equivalente ao serviço `Insights` do
 * Angular, só com o que a Visão geral usa). Toda a regra vem de `@shared/domain`; aqui fica
 * apenas a ligação entre os dados carregados e essas funções. Nada grava: é análise pura.
 */
export function useInsights() {
  const ws = useWorkspace();
  const account = useAccount();
  const { config } = useBusinessConfig();
  const leads = useLeads();
  const contentItems = useContentItems();
  const questions = useQuestions();
  const states = useRecommendationStates();
  const audits = usePageAudits();

  const goal = config.goal;
  const thresholds = config.thresholds;
  const window = account.window;

  // ───── Contexto e maturação ─────
  const goalLagDays = stageLagDays(goal, goal.goalStage);
  const maturity = windowMaturity(window, goalLagDays);
  const maturesOnDate = maturesOn(window, goalLagDays);

  const campaigns = ws.campaigns.value;
  const daily = ws.daily.value;

  const loadingCore = ws.campaigns.loading || ws.conversionBreakdown.loading || ws.searchTermsRaw.loading || ws.daily.loading;
  const coreError = ws.campaigns.error ?? ws.conversionBreakdown.error ?? ws.conversionActions.error ?? ws.searchTermsRaw.error ?? null;

  // ───── Funil e meta ─────
  const funnel = useMemo<FunnelResult | null>(() => {
    const breakdown = ws.conversionBreakdown.value;
    const actions = ws.conversionActions.value;
    if (!campaigns || !breakdown || !actions) return null;
    return buildFunnel({ campaigns, breakdown, actions, mapping: config.mapping, leads, window, goal });
  }, [campaigns, ws.conversionBreakdown.value, ws.conversionActions.value, config.mapping, leads, window, goal]);

  const costRef = useMemo(() => {
    if (!funnel) return { target: null as number | null, isAverage: false };
    const v = funnel.total.stages[goal.goalStage];
    return costReference(goal, funnel.total.cost, v.source === 'NONE' ? 0 : v.count);
  }, [funnel, goal]);

  const goalIsAdsMeasured = goal.goalStage === 'CONTACT' || goal.goalStage === 'INTERACTION';

  // ───── Mapas auxiliares ─────
  const campaignNames = useMemo(() => new Map((campaigns ?? []).map((c) => [c.id, c.name])), [campaigns]);
  const channelNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of campaigns ?? []) map.set(c.channel, CHANNEL_LABEL[c.channel] ?? c.channel);
    return map;
  }, [campaigns]);
  const adsByGroup = useMemo(() => indexAdsByGroup(ws.ads.value ?? []), [ws.ads.value]);

  /** Maturação de cada campanha, ponderada pelo custo dia a dia. */
  const campaignMaturity = useMemo(() => {
    const today = isoDate(new Date());
    const acc = new Map<string, { cost: number; mature: number }>();
    for (const r of daily ?? []) {
      if (r.date < window.from || r.date > window.to) continue;
      const e = acc.get(r.campaignId) ?? { cost: 0, mature: 0 };
      e.cost += r.cost;
      if (diffDays(r.date, today) >= goalLagDays) e.mature += r.cost;
      acc.set(r.campaignId, e);
    }
    const out = new Map<string, number>();
    for (const [id, e] of acc) out.set(id, e.cost > 0 ? e.mature / e.cost : maturity);
    return out;
  }, [daily, window, goalLagDays, maturity]);

  /** Índice dos leads do CRM com termo informado, por estágio-meta. */
  const crmByTerm = useMemo(() => {
    const stage = goal.goalStage;
    const withTerm = leadsInWindow(leads, window).filter((l) => l.term);
    const map = new Map<string, number>();
    for (const l of withTerm) {
      const r = leadReached(l);
      const reached =
        stage === 'CONTACT' || stage === 'INTERACTION' ? true : stage === 'QUALIFIED' ? r.qualified : stage === 'PROPOSAL' ? r.proposal : r.sale;
      if (reached) map.set(normalize(l.term as string), (map.get(normalize(l.term as string)) ?? 0) + 1);
    }
    return { available: withTerm.length > 0, map };
  }, [leads, window, goal.goalStage]);

  // ───── Desperdício por dimensão ─────
  const ga4 = ws.ga4Pages.value;
  const wasteInputs = useMemo<WasteInputs>(
    () => ({
      funnel,
      campaigns,
      campaignMaturity,
      campaignNames,
      channelNames,
      terms: ws.terms,
      keywords: ws.keywords,
      regions: ws.regions.value,
      devices: ws.devices.value,
      hours: ws.hours.value,
      landingPages: ws.landingPages.value,
      ads: ws.ads.value,
      placements: ws.placements.value,
      ga4Rows: ga4?.status.configured ? ga4.rows : null,
      brand: ws.preparedRules.brand,
      adsByGroup,
      crmByTerm,
      auditOf: (url) => audits.get(url),
      serviceArea: config.serviceArea,
      serviceHours: config.serviceHours,
    }),
    [funnel, campaigns, campaignMaturity, campaignNames, channelNames, ws.terms, ws.keywords, ws.regions.value, ws.devices.value, ws.hours.value, ws.landingPages.value, ws.ads.value, ws.placements.value, ga4, ws.preparedRules, adsByGroup, crmByTerm, audits, config.serviceArea, config.serviceHours],
  );

  const wasteEnv = useMemo<WasteEnv>(() => {
    const context: AssessContext = { thresholds, goal, windowDays: window.days };
    const outcomesOf = (m: FunnelMetrics): number | null => {
      const v = m.stages[goal.goalStage];
      return v.source === 'NONE' ? null : v.count;
    };
    return {
      context,
      adsMeasured: goalIsAdsMeasured,
      outcomesOf,
      options: (dimension, groupLabel, extra): GroupOptions => ({
        dimension,
        groupLabel,
        maturity,
        costTarget: costRef.target,
        costTargetIsAverage: costRef.isAverage,
        ...extra,
      }),
    };
  }, [thresholds, goal, window.days, goalIsAdsMeasured, maturity, costRef]);

  const waste = useMemo(
    () => ({
      campaign: wasteCampaigns(wasteInputs, wasteEnv) as WasteRow[],
      term: wasteTerms(wasteInputs, wasteEnv) as WasteRow[],
      region: wasteRegions(wasteInputs, wasteEnv) as WasteRow[],
      hour: wasteHours(wasteInputs, wasteEnv) as WasteRow[],
      page: wastePages(wasteInputs, wasteEnv) as WasteRow[],
      placement: wastePlacements(wasteInputs, wasteEnv) as WasteRow[],
    }),
    [wasteInputs, wasteEnv],
  );

  const serviceAreaConfigured = config.serviceArea.regionIds.length > 0;

  // ───── Rastreamento ─────
  const outages = useMemo(() => {
    const today = isoDate(new Date());
    return detectConversionOutages(daily ?? []).filter((o) => o.ongoing || diffDays(o.to, today) <= 45);
  }, [daily]);

  /** Quanto do custo de Pesquisa os termos visíveis explicam (0–1). */
  const searchCoverage = useMemo<number | null>(() => {
    const search = (campaigns ?? []).filter((c) => c.channel === 'SEARCH');
    const cost = search.reduce((s, c) => s + c.cost, 0);
    if (cost <= 0 || !ws.searchTermsRaw.value) return null;
    const ids = new Set(search.map((c) => c.id));
    const covered = ws.terms.filter((t) => ids.has(t.campaignId)).reduce((s, t) => s + t.cost, 0);
    return Math.min(1, covered / cost);
  }, [campaigns, ws.searchTermsRaw.value, ws.terms]);

  // ───── Intenção, páginas e conteúdo ─────
  const clusters = useMemo<TermCluster[]>(
    () => clusterTerms(ws.terms.filter((t) => !t.alreadyNegative), ws.preparedRules.brand),
    [ws.terms, ws.preparedRules],
  );

  /** Páginas conhecidas, com o texto que as descreve (leitura real, quando houver). */
  const candidatePages = useMemo<CandidatePage[]>(() => {
    const map = new Map<string, CandidatePage>();
    const add = (url: string, origin: string, titles: string[] = []): void => {
      if (!url) return;
      const norm = normalizeUrl(url);
      if (map.has(norm)) return;
      const text = pageTextOf(url, audits.get(url), titles);
      map.set(norm, { url, normalizedUrl: norm, words: text.words, basis: text.basis, origin });
    };
    for (const a of ws.ads.value ?? []) a.finalUrls.forEach((u) => add(u, 'usada nos anúncios'));
    for (const p of ws.landingPages.value ?? []) add(p.url, 'usada nos anúncios');
    for (const c of contentItems) {
      if (c.url && c.status !== 'IDEA') add(c.url, 'conteúdo registrado', [c.title, c.theme]);
    }
    for (const g of ws.gscPages.value?.rows ?? []) add(g.page, 'aparece no Google');
    return Array.from(map.values());
  }, [ws.ads.value, ws.landingPages.value, contentItems, ws.gscPages.value, audits]);

  const pageFindings = useMemo<PageFinding[]>(
    () =>
      clusters
        .filter((c) => c.cost >= 5)
        .slice(0, 40)
        .map((cluster) => {
          const urls = new Set<string>();
          for (const t of cluster.terms) adsByGroup.get(t.adGroupId)?.urls.forEach((u) => urls.add(u));
          const currentUrls = Array.from(urls);
          let weighted = 0;
          let weight = 0;
          for (const t of cluster.terms) {
            const group = adsByGroup.get(t.adGroupId);
            const url = group?.urls[0];
            if (!group || !url || t.cost <= 0) continue;
            const c = coherenceOf(t.term, group.texts, pageTextOf(url, audits.get(url)));
            if (c.score !== null) {
              weighted += c.score * t.cost;
              weight += t.cost;
            }
          }
          return {
            cluster,
            currentUrls,
            recommendation: recommendPage(cluster, currentUrls, candidatePages),
            coherence: weight > 0 ? weighted / weight : null,
          };
        }),
    [clusters, adsByGroup, candidatePages, audits],
  );

  const organicClusters = useMemo<TermCluster[]>(() => {
    const rows = ws.gscQueries.value;
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
    return clusterTerms(asTerms, ws.preparedRules.brand);
  }, [ws.gscQueries.value, ws.preparedRules]);

  /** Cada dúvida do atendimento vira um grupo de assunto; `clicks` carrega quantas vezes apareceu. */
  const supportClusters = useMemo<TermCluster[]>(
    () =>
      questions.map((q, i) => ({
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
    [questions],
  );

  const contentOpportunities = useMemo<ContentOpportunity[]>(
    () =>
      findContentOpportunities({
        clusters,
        organicClusters,
        supportClusters,
        candidates: candidatePages,
        registry: contentItems,
        gscPages: ws.gscPages.value?.status.configured ? ws.gscPages.value.rows : null,
        gscQueries: ws.gscQueries.value?.status.configured ? ws.gscQueries.value.rows : null,
        ga4Pages: ga4?.status.configured ? ga4.rows : null,
        paidUrls: (ws.landingPages.value ?? []).map((p) => p.url),
        today: isoDate(new Date()),
      }),
    [clusters, organicClusters, supportClusters, candidatePages, contentItems, ws.gscPages.value, ws.gscQueries.value, ga4, ws.landingPages.value],
  );

  // ───── Atendimento (CRM) ─────
  const crmQuality = useMemo<CrmQuality | null>(() => {
    const cohort = leadsInWindow(leads, window);
    if (!cohort.length) return null;
    const disq = cohort.filter((l) => l.status === 'DISQUALIFIED').length;
    const times = cohort.map((l) => l.firstResponseMinutes).filter((v): v is number => v !== undefined && v >= 0);
    return {
      leads: cohort.length,
      disqualified: disq,
      disqualifiedShare: disq / cohort.length,
      medianResponseMinutes: median(times),
      slowResponseShare: times.length ? times.filter((m) => m > 60).length / times.length : null,
    };
  }, [leads, window]);

  // ───── Recomendações ─────
  const recommendations = useMemo<RecommendationView[]>(() => {
    if (!funnel || !campaigns) return [];
    const input: RecommendationInput = {
      windowDays: window.days,
      windowLabel: account.rangeLabel,
      goal,
      thresholds,
      maturity,
      maturesOn: maturesOnDate,
      funnel,
      campaigns,
      waste: {
        campaigns: waste.campaign,
        terms: waste.term,
        regions: waste.region,
        hours: waste.hour,
        pages: waste.page,
        placements: waste.placement,
      },
      terms: ws.terms,
      outages,
      pageFindings,
      contentOpportunities,
      crmQuality,
      sources: { crm: funnel.crmPresent, ga4: ws.ga4Status, searchConsole: ws.searchConsoleStatus },
      serviceAreaConfigured,
      searchCoverage,
    };
    return buildRecommendations(input).map((r) => ({ ...r, status: states.statusOf(r.id), note: states.noteOf(r.id) }));
  }, [funnel, campaigns, window, account.rangeLabel, goal, thresholds, maturity, maturesOnDate, waste, ws.terms, outages, pageFindings, contentOpportunities, crmQuality, ws.ga4Status, ws.searchConsoleStatus, serviceAreaConfigured, searchCoverage, states]);

  const openRecommendations = useMemo(() => recommendations.filter((r) => r.status === 'OPEN'), [recommendations]);

  return {
    goal,
    window,
    goalLagDays,
    maturity,
    maturesOnDate,
    loadingCore,
    coreError,
    funnel,
    waste,
    outages,
    serviceAreaConfigured,
    openRecommendations,
    stageOrder: STAGE_ORDER,
  };
}
