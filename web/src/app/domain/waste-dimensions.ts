import {
  AdRow,
  KeywordRow,
  Perf,
  PageAudit,
  PlacementRow,
  SearchTermRow,
  WasteRow,
  CampaignRow,
  DeviceRow,
  HourRow,
  LandingPageRow,
  RegionRow,
  BusinessConfig,
  Ga4PageRow,
  Evidence,
} from './models';
import { deviceLabel } from '../data/ads-normalize';
import { FunnelMetrics, FunnelResult } from './funnel';
import {
  INTENT_LABEL,
  LOW_COHERENCE,
  coherenceOf,
  indexAdsByGroup,
  inferIntent,
  intentFit,
  pageTextOf,
} from './intent';
import { CHANNEL_LABEL, num, pct } from './format';
import { normalize, normalizeUrl } from './text';
import { AssessContext, GroupItem, GroupOptions, RowSignal, assessGroup } from './waste';

/**
 * Monta as linhas de desperdício de cada dimensão (campanha, termo, palavra, região,
 * dispositivo, horário, página, posicionamento, anúncio). Funções puras: o serviço
 * `Insights` só reúne os dados carregados e chama estas funções.
 */

const WEEKDAY_NAME = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

const hourLabel = (h: number): string =>
  `${String(h).padStart(2, '0')}h–${String((h + 1) % 24).padStart(2, '0')}h`;

/** Dados já carregados que as análises cruzam. */
export interface WasteInputs {
  funnel: FunnelResult | null;
  campaigns: readonly CampaignRow[] | undefined;
  campaignMaturity: ReadonlyMap<string, number>;
  campaignNames: Map<string, string>;
  channelNames: Map<string, string>;
  terms: readonly SearchTermRow[];
  keywords: readonly KeywordRow[];
  regions: readonly RegionRow[] | undefined;
  devices: readonly DeviceRow[] | undefined;
  hours: readonly HourRow[] | undefined;
  landingPages: readonly LandingPageRow[] | undefined;
  ads: readonly AdRow[] | undefined;
  placements: readonly PlacementRow[] | undefined;
  /** Linhas do GA4 por página; null quando o GA4 não está configurado. */
  ga4Rows: readonly Ga4PageRow[] | null;
  brand: Parameters<typeof inferIntent>[1];
  adsByGroup: ReturnType<typeof indexAdsByGroup>;
  crmByTerm: { available: boolean; map: ReadonlyMap<string, number> };
  auditOf: (url: string) => PageAudit | undefined;
  serviceArea: BusinessConfig['serviceArea'];
  serviceHours: BusinessConfig['serviceHours'];
}

/** Regras da meta e da maturação, iguais para todas as dimensões. */
export interface WasteEnv {
  context: AssessContext;
  /** A meta é medida pelo próprio Google Ads (contato ou interação), não pelo CRM. */
  adsMeasured: boolean;
  outcomesOf: (m: FunnelMetrics) => number | null;
  options: (
    dimension: GroupOptions['dimension'],
    groupLabel: string,
    extra?: Partial<GroupOptions>,
  ) => GroupOptions;
}

export function wasteCampaigns(inputs: WasteInputs, env: WasteEnv): WasteRow[] {
  const f = inputs.funnel;
  const campaigns = inputs.campaigns;
  if (!f || !campaigns) return [];
  const maturity = inputs.campaignMaturity;
  const unq = new Map<string, { cost: number; unq: number }>();
  for (const t of inputs.terms) {
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
          source: 'CONFIG',
          mechanism: 'INTENT',
        });
      }
      return {
        key: c.id,
        label: c.name,
        sublabel: `${CHANNEL_LABEL[c.channel] ?? c.channel}${c.status === 'PAUSED' ? ' · pausada' : ''}`,
        perf: {
          impressions: c.impressions,
          clicks: c.clicks,
          cost: c.cost,
          conversions: c.conversions,
        },
        outcomes: metrics ? env.outcomesOf(metrics) : null,
        outcomeSource: metrics?.stages[env.context.goal.goalStage].source === 'CRM' ? 'CRM' : 'GOOGLE_ADS',
        parentKey: c.channel,
        signals,
        maturity: maturity.get(c.id),
      };
    });
  return assessGroup(
    items,
    env.context,
    env.options('campaign', 'todas as campanhas', {
      parentLabel: 'outras campanhas do mesmo tipo',
      parentNames: inputs.channelNames,
      allowGroupFallback: false,
    }),
  );
}

export function wasteTerms(inputs: WasteInputs, env: WasteEnv): WasteRow[] {
  const brand = inputs.brand;
  const adsByGroup = inputs.adsByGroup;
  const adsMeasured = env.adsMeasured;
  const items: GroupItem[] = inputs.terms
    .filter((t) => t.clicks > 0 || t.cost > 0)
    .map((t) => {
      const outcomes = adsMeasured
        ? t.conversions
        : null;
      const base = {
        key: `${t.term}|${t.campaignId}|${t.adGroupId}`,
        label: t.term,
        sublabel: t.campaignName,
        perf: {
          impressions: t.impressions,
          clicks: t.clicks,
          cost: t.cost,
          conversions: t.conversions,
        },
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
          forcedWaste:
            'Termo hoje negativado: o gasto do período foi numa busca que você mesmo bloqueou.',
        };
      }

      const signals: RowSignal[] = [];
      if (t.category === 'UNQUALIFIED') signals.push({ kind: 'FACT', source: 'CONFIG', mechanism: 'INTENT', text: t.categoryReason });
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
        const c = coherenceOf(t.term, group.texts, pageTextOf(url, inputs.auditOf(url)));
        if (c.score !== null && c.score < LOW_COHERENCE) {
          signals.push({
            kind: 'HYPOTHESIS',
            mechanism: 'INTENT',
            text: `A busca tem pouco a ver com ${c.weakest === 'AD' ? 'o texto do anúncio' : 'a página de destino'} (aderência de ${pct(c.score, 0)}).`,
          });
        }
      }
      return { ...base, signals };
    });
  return assessGroup(
    items,
    env.context,
    env.options('term', 'todos os termos', {
      parentLabel: 'demais termos da mesma campanha',
      parentNames: inputs.campaignNames,
      allowGroupFallback: false,
    }),
  );
}

export function wasteKeywords(inputs: WasteInputs, env: WasteEnv): WasteRow[] {
  const items: GroupItem[] = inputs.keywords
    .filter((k) => k.clicks > 0 || k.cost > 0)
    .map((k) => ({
      key: k.resourceName,
      label: k.text,
      sublabel: `${k.campaignName} · ${k.adGroupName}${k.status === 'PAUSED' ? ' · pausada' : ''}`,
      perf: {
        impressions: k.impressions,
        clicks: k.clicks,
        cost: k.cost,
        conversions: k.conversions,
      },
      outcomes: env.adsMeasured ? k.conversions : null,
      parentKey: k.campaignId,
      signals: k.category === 'RISK' ? [{ kind: 'FACT' as const, text: k.categoryReason }] : [],
    }));
  return assessGroup(
    items,
    env.context,
    env.options('keyword', 'todas as palavras', {
      parentLabel: 'demais palavras da mesma campanha',
      parentNames: inputs.campaignNames,
      allowGroupFallback: false,
    }),
  );
}

export function wasteRegions(inputs: WasteInputs, env: WasteEnv): WasteRow[] {
  const regions = inputs.regions ?? [];
  const area = inputs.serviceArea;
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
    outcomes: env.adsMeasured ? e.perf.conversions : null,
    forcedWaste:
      configured && !inArea.has(id) && e.perf.cost > 0
        ? `${e.name} está fora da área de atendimento que você configurou.`
        : undefined,
  }));
  return assessGroup(
    items,
    env.context,
    env.options('region', 'demais regiões', { minBaselineClicks: 20 }),
  );
}

export function wasteDevices(inputs: WasteInputs, env: WasteEnv): WasteRow[] {
  const items: GroupItem[] = (inputs.devices ?? []).map((d) => ({
    key: d.device,
    label: deviceLabel(d.device),
    perf: d,
    outcomes: env.adsMeasured ? d.conversions : null,
  }));
  return assessGroup(
    items,
    env.context,
    env.options('device', 'demais dispositivos', { minBaselineClicks: 20 }),
  );
}

export function wasteHours(inputs: WasteInputs, env: WasteEnv): WasteRow[] {
  const hours = inputs.hours ?? [];
  const sh = inputs.serviceHours;
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
  const measured = env.adsMeasured;
  const note = sh
    ? `Fora do horário de atendimento (${sh.weekdays.map((d) => WEEKDAY_NAME[d].slice(0, 3)).join(', ')}, ${sh.startHour}h–${sh.endHour}h).`
    : '';
  const hourItems: GroupItem[] = Array.from(byHour, ([h, perf]) => ({
    key: `h:${h}`,
    label: hourLabel(h),
    perf,
    outcomes: measured ? perf.conversions : null,
    signals:
      sh && (h < sh.startHour || h >= sh.endHour) ? [{ kind: 'FACT' as const, text: note }] : [],
  })).sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  const dayItems: GroupItem[] = Array.from(byDay, ([d, perf]) => ({
    key: `d:${d}`,
    label: WEEKDAY_NAME[d],
    perf,
    outcomes: measured ? perf.conversions : null,
    signals: sh && !sh.weekdays.includes(d) ? [{ kind: 'FACT' as const, text: note }] : [],
  }));
  const opts = env.options('hour', 'demais horários', { minBaselineClicks: 20 });
  return [
    ...assessGroup(hourItems, env.context, opts),
    ...assessGroup(dayItems, env.context, { ...opts, groupLabel: 'demais dias' }),
  ];
}

export function wastePages(inputs: WasteInputs, env: WasteEnv): WasteRow[] {
  const pages = inputs.landingPages ?? [];
  const adsByGroup = inputs.adsByGroup;
  const ga4Rows = inputs.ga4Rows;
  const sessionsByPath = new Map<string, number>();
  ga4Rows?.forEach((r) => {
    const key = r.path.replace(/\/+$/, '') || '/';
    sessionsByPath.set(key, (sessionsByPath.get(key) ?? 0) + r.sessions);
  });

  // Termos por página: cada grupo de anúncios aponta para as URLs finais de seus anúncios.
  const termsByPage = new Map<string, SearchTermRow[]>();
  for (const t of inputs.terms) {
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
    const audit = inputs.auditOf(e.url);
    const signals: RowSignal[] = [];
    const trackingIssues: string[] = [];
    const contextEvidence: Evidence[] = [];

    if (audit) {
      contextEvidence.push({ kind: 'FACT', source: 'SITE', text: `Página consultada em ${audit.fetchedAt}. Esta leitura atual do HTML não descreve necessariamente a página durante o período dos anúncios.` });
      if (!audit.ok) {
        trackingIssues.push(
          `A página respondeu ${audit.status ?? 'sem resposta'}${audit.error ? ` (${audit.error})` : ''}.`,
        );
      } else {
        if (audit.forms + audit.telLinks + audit.whatsappLinks === 0) {
          signals.push({
            kind: 'FACT',
            text: 'O HTML lido não contém formulário, telefone nem botão de WhatsApp; elementos carregados por JavaScript precisam de verificação no navegador.',
            source: 'SITE',
            mechanism: 'PAGE_CONTACT',
          });
        }
        if (audit.trackingTags.length === 0 && e.perf.conversions === 0) {
          trackingIssues.push(
            'Não encontramos etiqueta de medição no HTML da página (pode existir outra forma de medir).',
          );
        }
        if ((audit.responseMs ?? 0) > 3000) {
          signals.push({
            kind: 'FACT',
            text: `A página levou ${num((audit.responseMs ?? 0) / 1000, 1)} s para responder.`,
            source: 'SITE',
            mechanism: 'PAGE_SPEED',
          });
        }
        if (!audit.hasViewport) {
          signals.push({
            kind: 'HYPOTHESIS',
            text: 'A página não declara viewport: pode não estar adaptada ao celular.',
          });
        }
      }
    }

    if (ga4Rows !== null) {
      let path = '/';
      try {
        path =
          new URL(/^https?:\/\//i.test(e.url) ? e.url : `https://${e.url}`).pathname.replace(
            /\/+$/,
            '',
          ) || '/';
      } catch {
        /* mantém "/" */
      }
      const analytics = ga4Rows.filter((r) => (r.path.split('?')[0].replace(/\/+$/, '') || '/') === path);
      if (analytics.length) {
        const sessions = analytics.reduce((s, r) => s + r.sessions, 0);
        const engaged = analytics.reduce((s, r) => s + r.engagedSessions, 0);
        const keyEvents = analytics.reduce((s, r) => s + r.keyEvents, 0);
        contextEvidence.push({ kind: 'FACT', source: 'GA4', text: `O caminho ${path} tem ${num(sessions)} sessões, ${num(engaged)} sessões com engajamento e ${num(keyEvents, 1)} eventos principais no período. São todas as origens da propriedade, sem identificar domínio ou campanha; não são somados às conversões do Ads.` });
        if (sessions >= 30 && engaged / sessions < 0.25) signals.push({ kind: 'HYPOTHESIS', source: 'GA4', mechanism: 'PAGE_ENGAGEMENT', text: 'Uma parte pequena das sessões deste caminho tem engajamento. Confira relevância da oferta, carregamento e consentimento; esse recorte não comprova baixa qualidade do tráfego pago.' });
      } else {
        contextEvidence.push({ kind: 'UNAVAILABLE', source: 'GA4', text: `O relatório não retornou o caminho ${path}. Isso não significa zero sessões: confira filtros, domínio, limites e configuração da propriedade.` });
      }
      if (sessionsByPath.has(path) && sessionsByPath.get(path) === 0) {
        signals.push({ kind: 'HYPOTHESIS', source: 'GA4', mechanism: 'PAGE_MEASUREMENT',
          text: `O Google Analytics retornou zero sessões em ${path}; confira domínio, consentimento e filtros antes de atribuir isso aos cliques pagos.` });
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
        kind: 'HYPOTHESIS',
        mechanism: 'INTENT',
        text: `As buscas que chegam aqui têm aderência de ${pct(weighted / weight, 0)} com o conteúdo da página${
          audit?.ok ? '' : ' (estimada pelo endereço; leia a página para confirmar)'
        }.`,
      });
    }

    return {
      key: norm,
      label: e.url.replace(/^https?:\/\//, ''),
      perf: e.perf,
      outcomes: env.adsMeasured ? e.perf.conversions : null,
      signals,
      trackingIssues,
      contextEvidence,
    };
  });
  return assessGroup(
    items,
    env.context,
    env.options('page', 'demais páginas', { minBaselineClicks: 20 }),
  );
}

export function wastePlacements(inputs: WasteInputs, env: WasteEnv): WasteRow[] {
  const items: GroupItem[] = (inputs.placements ?? [])
    .filter((p) => p.clicks > 0 || p.cost > 0)
    .map((p) => ({
      key: `${p.campaignId}|${p.targetUrl || p.name}`,
      label: p.name.replace(/^Mobile App: /, ''),
      sublabel:
        p.type === 'MOBILE_APPLICATION'
          ? 'Aplicativo móvel'
          : p.type === 'WEBSITE'
            ? 'Site'
            : p.type,
      perf: p,
      outcomes: env.adsMeasured ? p.conversions : null,
      parentKey: p.campaignId,
      signals:
        p.type === 'MOBILE_APPLICATION'
          ? [
              {
                kind: 'HYPOTHESIS' as const,
                text: 'Se houver cliques sem resultado, confira a experiência no aplicativo e a qualidade dos contatos. O tipo de posicionamento, sozinho, não demonstra cliques acidentais nem público inadequado.',
              },
            ]
          : [],
    }));
  return assessGroup(
    items,
    env.context,
    env.options('placement', 'demais posicionamentos', {
      parentLabel: 'mesma campanha de Display',
      parentNames: inputs.campaignNames,
      allowGroupFallback: false,
    }),
  );
}

export function wasteAds(inputs: WasteInputs, env: WasteEnv): WasteRow[] {
  const items: GroupItem[] = (inputs.ads ?? [])
    .filter((a) => a.clicks > 0 || a.cost > 0)
    .map((a) => ({
      key: a.adId,
      label: a.headlines[0] ?? `${a.type} ${a.adId}`,
      sublabel: `${a.campaignName} · ${a.adGroupName}`,
      perf: a,
      outcomes: env.adsMeasured ? a.conversions : null,
      parentKey: a.campaignId,
    }));
  return assessGroup(
    items,
    env.context,
    env.options('ad', 'todos os anúncios', {
      parentLabel: 'demais anúncios da mesma campanha',
      parentNames: inputs.campaignNames,
      allowGroupFallback: false,
    }),
  );
}
