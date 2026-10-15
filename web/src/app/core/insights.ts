import { Injectable, computed, inject } from '@angular/core';
import { deviceLabel } from '../data/ads-normalize';
import { ContentOpportunity, findContentOpportunities } from '../domain/content';
import { stageLagDays } from '../domain/config';
import { diffDays, isoDate } from '../domain/dates';
import { CHANNEL_LABEL, num, pct } from '../domain/format';
import { FunnelMetrics, FunnelResult, buildFunnel, leadReached, leadsInWindow, maturesOn, windowMaturity } from '../domain/funnel';
import {
  CandidatePage,
  INTENT_LABEL,
  LOW_COHERENCE,
  TermCluster,
  clusterTerms,
  coherenceOf,
  indexAdsByGroup,
  inferIntent,
  intentFit,
  pageTextOf,
  recommendPage,
} from '../domain/intent';
import { AdGroupFit, adGroupFits } from '../domain/keyword-fit';
import { KeywordSuggestion, suggestFromSearchConsole, suggestFromTerms } from '../domain/keyword-suggest';
import { classifyTerm } from '../domain/classify';
import { NegativeGap, findNegativeGaps } from '../domain/negatives';
import { median } from '../domain/stats';
import {
  FunnelStage,
  Perf,
  Recommendation,
  RecommendationStatus,
  SearchConsoleQueryRow,
  SearchTermRow,
  WasteRow,
} from '../domain/models';
import { PageFinding, RecommendationInput, CrmQuality, buildRecommendations } from '../domain/recommendations';
import { detectConversionOutages } from '../domain/tracking';
import { contentTokens, normalizeUrl, normalize, urlHost } from '../domain/text';
import {
  AssessContext,
  GroupItem,
  GroupOptions,
  RowSignal,
  assessGroup,
  costReference,
  summarize,
} from '../domain/waste';
import { AccountStore } from './account.store';
import { BusinessConfigStore } from './business-config.store';
import { ChangesStore, ContentStore, LeadsStore, QuestionsStore, RecStatesStore } from './collections';
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

const hourLabel = (h: number): string => `${String(h).padStart(2, '0')}h–${String((h + 1) % 24).padStart(2, '0')}h`;

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
    return v.source === 'NONE' ? null : v.count;
  }

  readonly costRef = computed(() => {
    const f = this.funnel();
    if (!f) return { target: null as number | null, isAverage: false };
    const v = f.total.stages[this.goal().goalStage];
    return costReference(this.goal(), f.total.cost, v.source === 'NONE' ? 0 : v.count);
  });

  readonly goalIsAdsMeasured = computed(() => {
    const s = this.goal().goalStage;
    return s === 'CONTACT' || s === 'INTERACTION';
  });

  // ───── Mapas auxiliares ─────

  private readonly campaignNames = computed(
    () => new Map((this.ws.campaigns.value() ?? []).map((c) => [c.id, c.name])),
  );

  private readonly channelNames = computed(() => {
    const map = new Map<string, string>();
    for (const c of this.ws.campaigns.value() ?? []) map.set(c.channel, CHANNEL_LABEL[c.channel] ?? c.channel);
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

  private options(dimension: GroupOptions['dimension'], groupLabel: string, extra: Partial<GroupOptions> = {}): GroupOptions {
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
      if (reached) map.set(normalize(l.term as string), (map.get(normalize(l.term as string)) ?? 0) + 1);
    }
    return { available: withTerm.length > 0, map };
  });

  // ───── Desperdício por dimensão ─────

  readonly wasteCampaigns = computed<WasteRow[]>(() => {
    const f = this.funnel();
    const campaigns = this.ws.campaigns.value();
    if (!f || !campaigns) return [];
    const maturity = this.campaignMaturity();
    const unq = new Map<string, { cost: number; unq: number }>();
    for (const t of this.ws.terms()) {
      const e = unq.get(t.campaignId) ?? { cost: 0, unq: 0 };
      e.cost += t.cost;
      if (t.category === 'UNQUALIFIED') e.unq += t.cost;
      unq.set(t.campaignId, e);
    }
    const items: GroupItem[] = campaigns
      .filter((c) => c.clicks > 0 || c.cost > 0)
      .map((c) => {
        const metrics = f.byCampaign.get(c.id);
        const share = unq.get(c.id);
        const signals: RowSignal[] = [];
        if (share && share.cost > 0 && share.unq / share.cost >= 0.4) {
          signals.push({
            kind: 'FACT',
            text: `${pct(share.unq / share.cost, 0)} do custo desta campanha está em termos da sua lista de "sem intenção de compra".`,
          });
        }
        return {
          key: c.id,
          label: c.name,
          sublabel: `${CHANNEL_LABEL[c.channel] ?? c.channel}${c.status === 'PAUSED' ? ' · pausada' : ''}`,
          perf: { impressions: c.impressions, clicks: c.clicks, cost: c.cost, conversions: c.conversions },
          outcomes: metrics ? this.outcomesOf(metrics) : null,
          parentKey: c.channel,
          signals,
          maturity: maturity.get(c.id),
        };
      });
    return assessGroup(
      items,
      this.context(),
      this.options('campaign', 'todas as campanhas', {
        parentLabel: 'outras campanhas do mesmo tipo',
        parentNames: this.channelNames(),
      }),
    );
  });

  readonly wasteTerms = computed<WasteRow[]>(() => {
    const brand = this.ws.preparedRules().brand;
    const adsByGroup = this.adsByGroup();
    const crm = this.crmByTerm();
    const adsMeasured = this.goalIsAdsMeasured();
    const items: GroupItem[] = this.ws
      .terms()
      .filter((t) => t.clicks > 0 || t.cost > 0)
      .map((t) => {
        const outcomes = adsMeasured ? t.conversions : crm.available ? (crm.map.get(normalize(t.term)) ?? 0) : null;
        const base = {
          key: `${t.term}|${t.campaignId}|${t.adGroupId}`,
          label: t.term,
          sublabel: t.campaignName,
          perf: { impressions: t.impressions, clicks: t.clicks, cost: t.cost, conversions: t.conversions },
          outcomes,
          parentKey: t.campaignId,
        };

        // Termo hoje bloqueado: você já decidiu que ele não serve. O gasto que ele teve
        // no período conta como desperdício. Não dá para saber se foi antes ou depois da
        // negativa (o Google Ads não guarda a data dela), só que foi gasto num termo bloqueado.
        if (t.alreadyNegative) {
          // Conversão do Google também conta: com meta no CRM sem dados, outcomes é null.
          const converted = (outcomes ?? 0) > 0 || t.conversions > 0;
          if (converted) {
            return {
              ...base,
              excludeFromBaseline: true,
              blocked: true,
              signals: [
                {
                  kind: 'FACT' as const,
                  text: `Este termo está negativado, mas gerou ${num(Math.max(outcomes ?? 0, t.conversions), 1)} resultado(s) no período. A negativa pode estar bloqueando uma busca que converte: revise antes de manter.`,
                },
              ],
            };
          }
          return {
            ...base,
            excludeFromBaseline: true,
            blocked: true,
            forcedWaste: 'Termo hoje negativado: o gasto do período foi numa busca que você mesmo bloqueou.',
          };
        }

        const signals: RowSignal[] = [];
        if (t.category === 'UNQUALIFIED') signals.push({ kind: 'FACT', text: t.categoryReason });
        const intent = inferIntent(t.term, brand);
        if (intentFit(intent) === 'BAD' && t.category !== 'UNQUALIFIED') {
          signals.push({
            kind: 'HYPOTHESIS',
            text: `A intenção da busca parece ser outra: ${INTENT_LABEL[intent].toLowerCase()}.`,
          });
        }
        const group = adsByGroup.get(t.adGroupId);
        const url = group?.urls[0];
        if (group && url) {
          const c = coherenceOf(t.term, group.texts, pageTextOf(url, this.audits.get(url)));
          if (c.score !== null && c.score < LOW_COHERENCE) {
            signals.push({
              kind: c.basis === 'AUDIT' ? 'FACT' : 'HYPOTHESIS',
              text: `A busca tem pouco a ver com ${c.weakest === 'AD' ? 'o texto do anúncio' : 'a página de destino'} (aderência de ${pct(c.score, 0)}).`,
            });
          }
        }
        return { ...base, signals };
      });
    return assessGroup(
      items,
      this.context(),
      this.options('term', 'todos os termos', {
        parentLabel: 'demais termos da mesma campanha',
        parentNames: this.campaignNames(),
      }),
    );
  });

  readonly wasteKeywords = computed<WasteRow[]>(() => {
    const items: GroupItem[] = this.ws
      .keywords()
      .filter((k) => k.clicks > 0 || k.cost > 0)
      .map((k) => ({
        key: k.resourceName,
        label: k.text,
        sublabel: `${k.campaignName} · ${k.adGroupName}${k.status === 'PAUSED' ? ' · pausada' : ''}`,
        perf: { impressions: k.impressions, clicks: k.clicks, cost: k.cost, conversions: k.conversions },
        outcomes: this.goalIsAdsMeasured() ? k.conversions : null,
        parentKey: k.campaignId,
        signals:
          k.category === 'RISK'
            ? [{ kind: 'FACT' as const, text: k.categoryReason }]
            : [],
      }));
    return assessGroup(
      items,
      this.context(),
      this.options('keyword', 'todas as palavras', {
        parentLabel: 'demais palavras da mesma campanha',
        parentNames: this.campaignNames(),
      }),
    );
  });

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

  readonly wasteRegions = computed<WasteRow[]>(() => {
    const regions = this.ws.regions.value() ?? [];
    const area = this.cfg.config().serviceArea;
    const configured = area.regionIds.length > 0;
    const inArea = new Set(area.regionIds);
    const byRegion = new Map<string, { name: string; perf: Perf }>();
    for (const r of regions) {
      const e = byRegion.get(r.regionId) ?? {
        name: r.regionName,
        perf: { impressions: 0, clicks: 0, cost: 0, conversions: 0 },
      };
      e.perf = {
        impressions: e.perf.impressions + r.impressions,
        clicks: e.perf.clicks + r.clicks,
        cost: e.perf.cost + r.cost,
        conversions: e.perf.conversions + r.conversions,
      };
      byRegion.set(r.regionId, e);
    }
    const items: GroupItem[] = Array.from(byRegion, ([id, e]) => ({
      key: id,
      label: e.name,
      perf: e.perf,
      outcomes: this.goalIsAdsMeasured() ? e.perf.conversions : null,
      forcedWaste:
        configured && !inArea.has(id) && e.perf.cost > 0
          ? `${e.name} está fora da área de atendimento que você configurou.`
          : undefined,
    }));
    return assessGroup(items, this.context(), this.options('region', 'demais regiões', { minBaselineClicks: 20 }));
  });

  readonly serviceAreaConfigured = computed(() => this.cfg.config().serviceArea.regionIds.length > 0);

  readonly wasteDevices = computed<WasteRow[]>(() => {
    const items: GroupItem[] = (this.ws.devices.value() ?? []).map((d) => ({
      key: d.device,
      label: deviceLabel(d.device),
      perf: d,
      outcomes: this.goalIsAdsMeasured() ? d.conversions : null,
    }));
    return assessGroup(items, this.context(), this.options('device', 'demais dispositivos', { minBaselineClicks: 20 }));
  });

  readonly wasteHours = computed<WasteRow[]>(() => {
    const hours = this.ws.hours.value() ?? [];
    const sh = this.cfg.config().serviceHours;
    const byHour = new Map<number, Perf>();
    const byDay = new Map<number, Perf>();
    const add = (m: Map<number, Perf>, k: number, r: Perf): void => {
      const p = m.get(k) ?? { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
      m.set(k, {
        impressions: p.impressions + r.impressions,
        clicks: p.clicks + r.clicks,
        cost: p.cost + r.cost,
        conversions: p.conversions + r.conversions,
      });
    };
    for (const r of hours) {
      add(byHour, r.hour, r);
      add(byDay, r.weekday, r);
    }
    const measured = this.goalIsAdsMeasured();
    const note = sh
      ? `Fora do horário de atendimento (${sh.weekdays.map((d) => WEEKDAY_NAME[d].slice(0, 3)).join(', ')}, ${sh.startHour}h–${sh.endHour}h).`
      : '';
    const hourItems: GroupItem[] = Array.from(byHour, ([h, perf]) => ({
      key: `h:${h}`,
      label: hourLabel(h),
      perf,
      outcomes: measured ? perf.conversions : null,
      signals: sh && (h < sh.startHour || h >= sh.endHour) ? [{ kind: 'FACT' as const, text: note }] : [],
    })).sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
    const dayItems: GroupItem[] = Array.from(byDay, ([d, perf]) => ({
      key: `d:${d}`,
      label: WEEKDAY_NAME[d],
      perf,
      outcomes: measured ? perf.conversions : null,
      signals: sh && !sh.weekdays.includes(d) ? [{ kind: 'FACT' as const, text: note }] : [],
    }));
    const opts = this.options('hour', 'demais horários', { minBaselineClicks: 20 });
    return [
      ...assessGroup(hourItems, this.context(), opts),
      ...assessGroup(dayItems, this.context(), { ...opts, groupLabel: 'demais dias' }),
    ];
  });

  /** Páginas de destino a partir das campanhas, com termos ligados por grupo de anúncios. */
  readonly wastePages = computed<WasteRow[]>(() => {
    const pages = this.ws.landingPages.value() ?? [];
    const adsByGroup = this.adsByGroup();
    const ga4 = this.ws.ga4Pages.value();
    const ga4Rows = ga4?.status.configured ? ga4.rows : null;
    const sessionsByPath = new Map<string, number>();
    ga4Rows?.forEach((r) => {
      const key = r.path.replace(/\/+$/, '') || '/';
      sessionsByPath.set(key, (sessionsByPath.get(key) ?? 0) + r.sessions);
    });

    // Termos por página: cada grupo de anúncios aponta para as URLs finais de seus anúncios.
    const termsByPage = new Map<string, SearchTermRow[]>();
    for (const t of this.ws.terms()) {
      const urls = adsByGroup.get(t.adGroupId)?.urls ?? [];
      for (const u of new Set(urls.map(normalizeUrl))) {
        const list = termsByPage.get(u) ?? [];
        list.push(t);
        termsByPage.set(u, list);
      }
    }

    const byPage = new Map<string, { url: string; perf: Perf }>();
    for (const p of pages) {
      const e = byPage.get(p.normalizedUrl) ?? {
        url: p.url,
        perf: { impressions: 0, clicks: 0, cost: 0, conversions: 0 },
      };
      e.perf = {
        impressions: e.perf.impressions + p.impressions,
        clicks: e.perf.clicks + p.clicks,
        cost: e.perf.cost + p.cost,
        conversions: e.perf.conversions + p.conversions,
      };
      byPage.set(p.normalizedUrl, e);
    }

    const items: GroupItem[] = Array.from(byPage, ([norm, e]) => {
      const audit = this.audits.get(e.url);
      const signals: RowSignal[] = [];
      const trackingIssues: string[] = [];

      if (audit) {
        if (!audit.ok) {
          trackingIssues.push(
            `A página respondeu ${audit.status ?? 'sem resposta'}${audit.error ? ` (${audit.error})` : ''}.`,
          );
        } else {
          if (audit.forms + audit.telLinks + audit.whatsappLinks === 0) {
            signals.push({ kind: 'FACT', text: 'A página não tem formulário, telefone nem botão de WhatsApp.' });
          }
          if (audit.trackingTags.length === 0 && e.perf.conversions === 0) {
            trackingIssues.push('Não encontramos etiqueta de medição no HTML da página (pode existir outra forma de medir).');
          }
          if ((audit.responseMs ?? 0) > 3000) {
            signals.push({ kind: 'FACT', text: `A página levou ${num((audit.responseMs ?? 0) / 1000, 1)} s para responder.` });
          }
          if (!audit.hasViewport) {
            signals.push({ kind: 'HYPOTHESIS', text: 'A página não declara viewport: pode não estar adaptada ao celular.' });
          }
        }
      }

      if (sessionsByPath.size && e.perf.clicks >= this.thresholds().minClicks) {
        let path = '/';
        try {
          path = new URL(/^https?:\/\//i.test(e.url) ? e.url : `https://${e.url}`).pathname.replace(/\/+$/, '') || '/';
        } catch {
          /* mantém "/" */
        }
        if ((sessionsByPath.get(path) ?? 0) === 0) {
          trackingIssues.push(
            `O Google Analytics não registrou nenhuma sessão em ${path}, apesar de ${num(e.perf.clicks)} cliques pagos.`,
          );
        }
      }

      // Coerência média (ponderada pelo custo) das buscas que chegam a esta página.
      const terms = termsByPage.get(norm) ?? [];
      let weighted = 0;
      let weight = 0;
      for (const t of terms) {
        const group = adsByGroup.get(t.adGroupId);
        if (!group) continue;
        const c = coherenceOf(t.term, group.texts, pageTextOf(e.url, audit));
        if (c.score !== null && t.cost > 0) {
          weighted += c.score * t.cost;
          weight += t.cost;
        }
      }
      if (weight > 0 && weighted / weight < LOW_COHERENCE) {
        signals.push({
          kind: audit?.ok ? 'FACT' : 'HYPOTHESIS',
          text: `As buscas que chegam aqui têm aderência de ${pct(weighted / weight, 0)} com o conteúdo da página${
            audit?.ok ? '' : ' (estimada pelo endereço; leia a página para confirmar)'
          }.`,
        });
      }

      return {
        key: norm,
        label: e.url.replace(/^https?:\/\//, ''),
        perf: e.perf,
        outcomes: this.goalIsAdsMeasured() ? e.perf.conversions : null,
        signals,
        trackingIssues,
      };
    });
    return assessGroup(items, this.context(), this.options('page', 'demais páginas', { minBaselineClicks: 20 }));
  });

  readonly wastePlacements = computed<WasteRow[]>(() => {
    const items: GroupItem[] = (this.ws.placements.value() ?? [])
      .filter((p) => p.clicks > 0 || p.cost > 0)
      .map((p) => ({
        key: `${p.campaignId}|${p.targetUrl || p.name}`,
        label: p.name.replace(/^Mobile App: /, ''),
        sublabel: p.type === 'MOBILE_APPLICATION' ? 'Aplicativo móvel' : p.type === 'WEBSITE' ? 'Site' : p.type,
        perf: p,
        outcomes: this.goalIsAdsMeasured() ? p.conversions : null,
        parentKey: p.campaignId,
        signals:
          p.type === 'MOBILE_APPLICATION'
            ? [
                {
                  kind: 'HYPOTHESIS' as const,
                  text: 'Aplicativo móvel: cliques acidentais são comuns e a intenção de compra tende a ser baixa.',
                },
              ]
            : [],
      }));
    return assessGroup(
      items,
      this.context(),
      this.options('placement', 'demais posicionamentos', {
        parentLabel: 'mesma campanha de Display',
        parentNames: this.campaignNames(),
      }),
    );
  });

  readonly wasteAds = computed<WasteRow[]>(() => {
    const items: GroupItem[] = (this.ws.ads.value() ?? [])
      .filter((a) => a.clicks > 0 || a.cost > 0)
      .map((a) => ({
        key: a.adId,
        label: a.headlines[0] ?? `${a.type} ${a.adId}`,
        sublabel: `${a.campaignName} · ${a.adGroupName}`,
        perf: a,
        outcomes: this.goalIsAdsMeasured() ? a.conversions : null,
        parentKey: a.campaignId,
      }));
    return assessGroup(
      items,
      this.context(),
      this.options('ad', 'todos os anúncios', {
        parentLabel: 'demais anúncios da mesma campanha',
        parentNames: this.campaignNames(),
      }),
    );
  });

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
    for (const a of this.ws.ads.value() ?? []) a.finalUrls.forEach((u) => add(u, 'usada nos anúncios'));
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
        for (const t of cluster.terms) adsByGroup.get(t.adGroupId)?.urls.forEach((u) => urls.add(u));
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
      gscQueries: this.ws.gscQueries.value()?.status.configured ? this.ws.gscQueries.value()!.rows : null,
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
    const times = cohort.map((l) => l.firstResponseMinutes).filter((v): v is number => v !== undefined && v >= 0);
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

  readonly openRecommendations = computed(() => this.recommendations().filter((r) => r.status === 'OPEN'));

  readonly stageOrder: readonly FunnelStage[] = ['CLICK', 'INTERACTION', 'CONTACT', 'QUALIFIED', 'PROPOSAL', 'SALE'];

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
