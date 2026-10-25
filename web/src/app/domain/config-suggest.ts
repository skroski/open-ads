import {
  DEFAULT_THRESHOLDS,
  MIN_CLICKS_RANGE,
  MIN_CLICKS_TARGET_CONVERSIONS,
  SUFFICIENCY_RULES,
  SUGGEST_RULES,
  SufficiencyRule,
  defaultGoal,
  stageFromCategory,
  stageFromName,
} from './config';
import {
  AdRow,
  BusinessConfig,
  CampaignLocation,
  ConversionActionInfo,
  ConversionBreakdownRow,
  Confidence,
  FUNNEL_STAGES,
  FunnelStage,
  HourRow,
  ParamKey,
  ParamStatus,
  Perf,
  RegionRow,
  STAGE_LABEL,
} from './models';
import { Provenance, deriveConfidence } from './provenance';
import { Sufficiency, describeShortfall, evaluateSufficiency } from './sufficiency';

/**
 * Auto-preenchimento dos parâmetros do sistema. Tudo aqui é cálculo sobre os dados já carregados:
 * nada é inventado e nada é gravado. Cada parâmetro vira uma sugestão com origem, confiança e
 * motivo; quem decide é a pessoa. A IA só entra para interpretar nomes ambíguos de conversão.
 */

export type SuggestionKey = ParamKey | 'economics';

export type SuggestionStatus =
  /** Há uma proposta pronta para aceitar. */
  | 'ready'
  /** Faltam dados; o texto diz quanto e quando deve chegar. */
  | 'insufficient'
  /** Não há como saber só pelos dados: a pessoa precisa informar. */
  | 'needs_user'
  /** A pessoa já decidiu (ou o valor atual já serve): não será alterado. */
  | 'locked'
  /** Medição de conversão com falha: sugerir seria enganoso. */
  | 'blocked';

export interface Suggestion {
  key: SuggestionKey;
  title: string;
  status: SuggestionStatus;
  /** O valor proposto, em texto curto. */
  summary?: string;
  reason: string;
  /** Aplica a sugestão e marca o parâmetro como confirmado. Função pura, não grava nada. */
  apply?: (config: BusinessConfig) => BusinessConfig;
  provenance?: Provenance;
  confidence?: Confidence;
  /** Pontos que a pessoa deve olhar antes de aceitar. */
  doubts?: string[];
  /** Nomes de conversão que o código não soube classificar (candidatos à ajuda da IA). */
  ambiguous?: string[];
  question?: string;
  etaDays?: number | null;
  lockedState?: ParamStatus;
}

export interface SuggestInput {
  config: BusinessConfig;
  /** Dias do período dos dados abaixo. */
  windowDays: number;
  /** Totais do período (soma das campanhas). */
  totals: Perf;
  conversionActions: readonly ConversionActionInfo[];
  conversionBreakdown: readonly ConversionBreakdownRow[];
  regions: readonly RegionRow[];
  campaignLocations: readonly CampaignLocation[];
  hours: readonly HourRow[];
  ads: readonly AdRow[];
  /** Há indício de medição de conversão quebrada (ver `detectConversionOutages`). */
  trackingBroken: boolean;
}

// ───────────────────────── Estado dos parâmetros ─────────────────────────

/** Estado já decidido de um parâmetro: o gravado, ou "manual" quando um valor antigo foge do padrão. */
export function decidedState(config: BusinessConfig, key: ParamKey): ParamStatus | null {
  const saved = config.paramStatus[key];
  if (saved) return saved;
  switch (key) {
    case 'mapping':
      return Object.keys(config.mapping).length ? 'MANUAL' : null;
    case 'goalStage':
      return config.goal.goalStage !== defaultGoal().goalStage ? 'MANUAL' : null;
    case 'targetCostPerGoal':
      return config.goal.targetCostPerGoal !== null ? 'MANUAL' : null;
    case 'serviceArea':
      return config.serviceArea.regionIds.length ? 'MANUAL' : null;
    case 'serviceHours':
      return config.serviceHours !== null ? 'MANUAL' : null;
    case 'minClicks':
      return config.thresholds.minClicks !== DEFAULT_THRESHOLDS.minClicks ? 'MANUAL' : null;
    case 'domains':
      return config.domains.length ? 'MANUAL' : null;
  }
}

const confirm = (c: BusinessConfig, key: ParamKey): BusinessConfig => ({
  ...c,
  paramStatus: { ...c.paramStatus, [key]: 'CONFIRMED' },
});

/** Aplica, em ordem, as sugestões prontas escolhidas pela pessoa. */
export function applySuggestions(config: BusinessConfig, chosen: readonly Suggestion[]): BusinessConfig {
  return chosen.reduce((acc, s) => (s.status === 'ready' && s.apply ? s.apply(acc) : acc), config);
}

// ───────────────────────── Ajudas ─────────────────────────

const round2 = (n: number): number => Math.round(n * 100) / 100;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function windowHistory(totals: Perf, windowDays: number) {
  const days = Math.max(1, windowDays);
  return {
    // A suficiência dos parâmetros não exige dias ativos: o período já foi escolhido pela pessoa.
    activeDays: days,
    clicks: totals.clicks,
    conversions: totals.conversions,
    windowDays: days,
    recentClicksPerDay: totals.clicks / days,
    recentConversionsPerDay: totals.conversions / days,
  };
}

function gate(
  input: SuggestInput,
  rule: SufficiencyRule,
  feature: 'GOAL_COST' | 'RATE_ESTIMATE',
  totals: Perf = input.totals,
): Sufficiency {
  return evaluateSufficiency(feature, windowHistory(totals, input.windowDays), {
    trackingBroken: input.trackingBroken,
    rule,
  });
}

/** Converte um resultado não pronto da porta de suficiência em sugestão sem proposta. */
function notReady(key: SuggestionKey, title: string, s: Sufficiency): Suggestion {
  if (s.status === 'blocked') return { key, title, status: 'blocked', reason: s.reason };
  if (s.status === 'insufficient') {
    return { key, title, status: 'insufficient', reason: describeShortfall(s), etaDays: s.etaDays };
  }
  return { key, title, status: 'insufficient', reason: 'Sem dados.' };
}

function locked(key: ParamKey, title: string, state: ParamStatus): Suggestion {
  return {
    key,
    title,
    status: 'locked',
    lockedState: state,
    reason:
      state === 'CONFIRMED'
        ? 'Você já confirmou este valor. Ele não será alterado.'
        : 'Você já informou este valor. Ele não será alterado.',
  };
}

const prov = (source: Provenance['source'], detail: string): Provenance => ({ source, detail });
const periodo = (days: number): string => `últimos ${plural(days, 'dia', 'dias')} (período selecionado)`;

// ───────────────────────── Parâmetros ─────────────────────────

const TITLES: Record<SuggestionKey, string> = {
  mapping: 'Etapa de cada conversão',
  goalStage: 'Etapa que representa um bom resultado',
  targetCostPerGoal: 'Custo por resultado (ponto de partida)',
  serviceArea: 'Regiões onde a empresa atende',
  serviceHours: 'Horário de atendimento',
  minClicks: 'Mínimo de cliques para concluir',
  domains: 'Domínios do site',
  economics: 'Margem, custo por cliente, ROI e ciclo de venda',
};

function suggestMapping(input: SuggestInput): { suggestion: Suggestion; map: Record<string, FunnelStage> } {
  const key = 'mapping';
  const title = TITLES[key];
  const proposed: Record<string, FunnelStage> = {};
  const ambiguous: string[] = [];
  for (const a of input.conversionActions) {
    if (a.status !== 'ENABLED' || !a.includeInConversions) continue;
    if (a.name in input.config.mapping) continue;
    const stage = stageFromName(a.name) ?? stageFromCategory(a.category);
    if (stage) proposed[a.name] = stage;
    else ambiguous.push(a.name);
  }
  const count = Object.keys(proposed).length;

  if (!count && !ambiguous.length) {
    const state = decidedState(input.config, key);
    return {
      suggestion: state
        ? locked(key, title, state)
        : { key, title, status: 'insufficient', reason: 'Nenhuma ação de conversão ativa foi encontrada na conta.' },
      map: {},
    };
  }
  if (!count) {
    return {
      suggestion: {
        key,
        title,
        status: 'needs_user',
        reason: 'Os nomes e as categorias destas conversões não indicam a etapa do funil.',
        question: `Em que etapa do funil cada uma se encaixa? ${ambiguous.join(', ')}.`,
        ambiguous,
      },
      map: {},
    };
  }
  return {
    suggestion: {
      key,
      title,
      status: 'ready',
      summary: Object.entries(proposed)
        .map(([name, stage]) => `${name} → ${STAGE_LABEL[stage]}`)
        .join('; '),
      reason: `Deduzido pelo nome e pela categoria de ${plural(count, 'ação de conversão', 'ações de conversão')} sem etapa definida.`,
      provenance: prov('CALCULATION', 'regra pelo nome e pela categoria da conversão no Google Ads'),
      confidence: { level: 'MEDIUM', reasons: ['Deduzido pelo nome e pela categoria; confira antes de aceitar.'] },
      doubts: ambiguous.length ? [`Sem etapa sugerida (nome ambíguo): ${ambiguous.join(', ')}.`] : undefined,
      ambiguous: ambiguous.length ? ambiguous : undefined,
      apply: (c) => confirm({ ...c, mapping: { ...c.mapping, ...proposed } }, key),
    },
    map: proposed,
  };
}

/** Conversões do período por etapa, contando só as ações mapeadas. */
function conversionsByStage(
  breakdown: readonly ConversionBreakdownRow[],
  mapping: Record<string, FunnelStage | 'IGNORE'>,
): Map<FunnelStage, number> {
  const out = new Map<FunnelStage, number>();
  for (const r of breakdown) {
    const stage = mapping[r.actionName];
    if (!stage || stage === 'IGNORE') continue;
    out.set(stage, (out.get(stage) ?? 0) + r.conversions);
  }
  return out;
}

function suggestGoal(input: SuggestInput, proposedMap: Record<string, FunnelStage>): Suggestion[] {
  const { config, totals } = input;
  const rule = SUFFICIENCY_RULES.GOAL_COST;
  const byStage = conversionsByStage(input.conversionBreakdown, { ...proposedMap, ...config.mapping });
  const eligible = FUNNEL_STAGES.filter((s) => s !== 'CLICK' && s !== 'INTERACTION');

  const stageDecided = decidedState(config, 'goalStage');
  const costDecided = decidedState(config, 'targetCostPerGoal');

  // Medição de conversão com falha: nada que dependa de conversões deve ser sugerido.
  if (input.trackingBroken) {
    const blocked = gate(input, rule, 'GOAL_COST');
    return [
      stageDecided ? locked('goalStage', TITLES.goalStage, stageDecided) : notReady('goalStage', TITLES.goalStage, blocked),
      costDecided
        ? locked('targetCostPerGoal', TITLES.targetCostPerGoal, costDecided)
        : notReady('targetCostPerGoal', TITLES.targetCostPerGoal, blocked),
    ];
  }

  // Etapa-meta: a mais avançada que já tem volume para sustentar conclusões.
  const best = [...eligible].reverse().find((s) => (byStage.get(s) ?? 0) >= rule.minConversions);
  const out: Suggestion[] = [];

  let goalStage: FunnelStage | null = stageDecided ? config.goal.goalStage : (best ?? null);

  if (stageDecided) {
    out.push(locked('goalStage', TITLES.goalStage, stageDecided));
  } else if (best) {
    const n = byStage.get(best) ?? 0;
    out.push({
      key: 'goalStage',
      title: TITLES.goalStage,
      status: 'ready',
      summary: STAGE_LABEL[best],
      reason: `É a etapa mais avançada com volume: ${plural(Math.round(n), 'conversão', 'conversões')} no período (mínimo ${rule.minConversions}).`,
      provenance: prov('GOOGLE_ADS', periodo(input.windowDays)),
      confidence: deriveConfidence({ ratio: n / rule.minConversions }),
      apply: (c) => confirm({ ...c, goal: { ...c.goal, goalStage: best } }, 'goalStage'),
    });
  } else {
    // Mostra o que falta na etapa que mais se aproxima do mínimo.
    const top = eligible.reduce<{ stage: FunnelStage; n: number } | null>((acc, s) => {
      const n = byStage.get(s) ?? 0;
      return !acc || n > acc.n ? { stage: s, n } : acc;
    }, null);
    const n = top?.n ?? 0;
    out.push(
      notReady(
        'goalStage',
        TITLES.goalStage,
        gate(input, rule, 'GOAL_COST', { ...totals, conversions: n }),
      ),
    );
    goalStage = null;
  }

  // Custo por resultado: ponto de partida a partir do que a conta já paga hoje.
  if (costDecided) {
    out.push(locked('targetCostPerGoal', TITLES.targetCostPerGoal, costDecided));
  } else if (goalStage) {
    const n = byStage.get(goalStage) ?? 0;
    const s = gate(input, rule, 'GOAL_COST', { ...totals, conversions: n });
    if (s.status === 'ready' && totals.cost > 0) {
      const value = round2(totals.cost / n);
      out.push({
        key: 'targetCostPerGoal',
        title: TITLES.targetCostPerGoal,
        status: 'ready',
        summary: `R$ ${value.toFixed(2).replace('.', ',')}`,
        reason:
          'Custo médio atual por resultado na etapa-meta (gasto do período ÷ conversões da etapa). É um ponto de partida, não a meta ideal: ela depende da sua margem.',
        provenance: prov('CALCULATION', `gasto ÷ conversões da etapa, ${periodo(input.windowDays)}`),
        confidence: deriveConfidence({ ratio: s.ratio }),
        doubts: ['O gasto inclui o que foi pago por conversões de outras etapas, então o custo real por resultado pode ser menor.'],
        apply: (c) => confirm({ ...c, goal: { ...c.goal, targetCostPerGoal: value } }, 'targetCostPerGoal'),
      });
    } else {
      out.push(notReady('targetCostPerGoal', TITLES.targetCostPerGoal, s));
    }
  } else {
    out.push({
      key: 'targetCostPerGoal',
      title: TITLES.targetCostPerGoal,
      status: 'insufficient',
      reason: 'Depende da etapa-meta, que ainda não tem conversões suficientes.',
    });
  }
  return out;
}

function conversionsBy<T extends Perf>(rows: readonly T[], keyOf: (r: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(keyOf(r), (m.get(keyOf(r)) ?? 0) + r.conversions);
  return m;
}

function suggestArea(input: SuggestInput): Suggestion {
  const key = 'serviceArea';
  const title = TITLES[key];
  const decided = decidedState(input.config, key);
  if (decided) return locked(key, title, decided);

  const s = gate(input, SUGGEST_RULES.serviceArea, 'GOAL_COST');
  if (s.status !== 'ready') return notReady(key, title, s);

  const converted = conversionsBy(input.regions, (r) => r.regionId);
  const names = new Map(input.regions.map((r) => [r.regionId, r.regionName]));
  const convertedIds = [...converted].filter(([, n]) => n > 0).map(([id]) => id);
  const targeted = new Set(input.campaignLocations.filter((l) => !l.negative).map((l) => l.regionId));
  const both = convertedIds.filter((id) => targeted.has(id));
  const included = targeted.size && both.length ? both : convertedIds;
  const doubtful = [...targeted].filter((id) => !included.includes(id));
  const nameOf = (id: string): string => names.get(id) ?? `região ${id}`;

  return {
    key,
    title,
    status: 'ready',
    summary: `${plural(included.length, 'região', 'regiões')}: ${included.slice(0, 6).map(nameOf).join(', ')}${included.length > 6 ? '…' : ''}`,
    reason: 'Regiões que as campanhas segmentam e de onde já vieram conversões.',
    provenance: prov('GOOGLE_ADS', periodo(input.windowDays)),
    confidence: deriveConfidence({ ratio: s.ratio }),
    doubts: [
      'Regiões onde você atende mas ainda não converteu ficam de fora e passam a contar como fora da área. Marque-as em Configurações se for o caso.',
      ...(doubtful.length ? [`Segmentadas sem conversão (fora da sugestão): ${doubtful.slice(0, 8).map(nameOf).join(', ')}.`] : []),
    ],
    apply: (c) =>
      confirm(
        {
          ...c,
          serviceArea: {
            regionIds: included,
            regionNames: Object.fromEntries(included.map((id) => [id, nameOf(id)])),
          },
        },
        key,
      ),
  };
}

function suggestHours(input: SuggestInput): Suggestion {
  const key = 'serviceHours';
  const title = TITLES[key];
  const decided = decidedState(input.config, key);
  if (decided) return locked(key, title, decided);

  const s = gate(input, SUGGEST_RULES.serviceHours, 'GOAL_COST');
  if (s.status !== 'ready') return notReady(key, title, s);

  const byHour = new Array<number>(24).fill(0);
  const byDay = new Array<number>(8).fill(0);
  for (const r of input.hours) {
    if (r.hour >= 0 && r.hour < 24) byHour[r.hour] += r.conversions;
    if (r.weekday >= 1 && r.weekday <= 7) byDay[r.weekday] += r.conversions;
  }
  const total = byHour.reduce((a, b) => a + b, 0);
  if (total <= 0) return { key, title, status: 'insufficient', reason: 'Nenhuma conversão com horário no período.' };

  // Descarta as pontas com menos de 2,5% das conversões cada.
  let start = 0;
  let acc = 0;
  while (start < 23 && acc + byHour[start] <= total * 0.025) acc += byHour[start++];
  let end = 24;
  acc = 0;
  while (end > start + 1 && acc + byHour[end - 1] <= total * 0.025) acc += byHour[--end];

  if (end - start >= 20) {
    return {
      key,
      title,
      status: 'needs_user',
      reason: 'As conversões acontecem em quase todas as horas do dia, então os dados não revelam um horário de atendimento.',
      question: 'Qual o horário em que sua equipe atende? Deixe desligado se atende o dia todo.',
    };
  }
  const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => byDay[d] >= total * 0.05);
  const names = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  return {
    key,
    title,
    status: 'ready',
    summary: `${start}h às ${end}h, ${days.map((d) => names[d]).join(', ')}`,
    reason: 'Faixa que concentra 95% das conversões e dias com ao menos 5% delas.',
    provenance: prov('CALCULATION', `conversões por hora e dia, ${periodo(input.windowDays)}`),
    confidence: deriveConfidence({ ratio: s.ratio }),
    doubts: ['É o horário em que as conversões acontecem, não necessariamente o de atendimento. Confirme com sua equipe.'],
    apply: (c) => confirm({ ...c, serviceHours: { startHour: start, endHour: end, weekdays: days } }, key),
  };
}

function suggestMinClicks(input: SuggestInput): Suggestion {
  const key = 'minClicks';
  const title = TITLES[key];
  const decided = decidedState(input.config, key);
  if (decided) return locked(key, title, decided);

  const s = gate(input, SUGGEST_RULES.minClicks, 'RATE_ESTIMATE');
  if (s.status !== 'ready') return notReady(key, title, s);

  const rate = input.totals.conversions / input.totals.clicks;
  const value = Math.min(
    MIN_CLICKS_RANGE.max,
    Math.max(MIN_CLICKS_RANGE.min, Math.ceil((MIN_CLICKS_TARGET_CONVERSIONS * input.totals.clicks) / input.totals.conversions)),
  );
  if (value === input.config.thresholds.minClicks) {
    return { key, title, status: 'locked', reason: 'O valor atual já está de acordo com o volume da conta.' };
  }
  return {
    key,
    title,
    status: 'ready',
    summary: `${value} cliques`,
    reason: `Com ${(rate * 100).toFixed(1).replace('.', ',')}% de conversão, são precisos cerca de ${value} cliques para esperar ${MIN_CLICKS_TARGET_CONVERSIONS} conversões.`,
    provenance: prov('CALCULATION', `conversões ÷ cliques, ${periodo(input.windowDays)}`),
    confidence: deriveConfidence({ ratio: s.ratio }),
    apply: (c) => confirm({ ...c, thresholds: { ...c.thresholds, minClicks: value } }, key),
  };
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
};

function suggestDomains(input: SuggestInput): Suggestion {
  const key = 'domains';
  const title = TITLES[key];
  const decided = decidedState(input.config, key);
  if (decided) return locked(key, title, decided);

  const clicks = new Map<string, number>();
  for (const ad of input.ads) {
    for (const url of ad.finalUrls) {
      const host = hostOf(url);
      if (host) clicks.set(host, (clicks.get(host) ?? 0) + ad.clicks);
    }
  }
  const hosts = [...clicks].sort((a, b) => b[1] - a[1]).map(([h]) => h).slice(0, 5);
  if (!hosts.length) {
    return { key, title, status: 'insufficient', reason: 'Nenhum anúncio com página de destino foi encontrado.' };
  }
  return {
    key,
    title,
    status: 'ready',
    summary: hosts.join(', '),
    reason: 'Endereços das páginas de destino dos seus próprios anúncios, dos mais clicados aos menos.',
    provenance: prov('GOOGLE_ADS', 'páginas de destino dos anúncios'),
    confidence: { level: 'HIGH', reasons: ['Endereços lidos diretamente dos seus anúncios.'] },
    apply: (c) => confirm({ ...c, domains: hosts }, key),
  };
}

function suggestEconomics(input: SuggestInput): Suggestion {
  const g = input.config.goal;
  if (g.defaultMarginPct !== null && g.targetCac !== null && g.targetRoiPct !== null) {
    return { key: 'economics', title: TITLES.economics, status: 'locked', lockedState: 'MANUAL', reason: 'Você já informou estes valores.' };
  }
  return {
    key: 'economics',
    title: TITLES.economics,
    status: 'needs_user',
    reason: 'O Google Ads não guarda margem, custo por cliente nem ciclo de venda. O painel não estima estes valores.',
    question: 'Informe a margem média, o custo máximo por cliente e o ROI mínimo na tela de Funil, ou importe suas vendas com datas.',
  };
}

/** Uma sugestão por parâmetro, na ordem em que aparecem na tela. */
export function suggestParameters(input: SuggestInput): Suggestion[] {
  const mapping = suggestMapping(input);
  return [
    mapping.suggestion,
    ...suggestGoal(input, mapping.map),
    suggestArea(input),
    suggestHours(input),
    suggestMinClicks(input),
    suggestDomains(input),
    suggestEconomics(input),
  ];
}
