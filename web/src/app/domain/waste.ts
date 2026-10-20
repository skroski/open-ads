import { stageLagDays } from './config';
import { brl, num, pct } from './format';
import { chanceOfZero } from './stats';
import {
  Assessment,
  BusinessGoal,
  Confidence,
  DataSource,
  Evidence,
  InsufficientReason,
  Perf,
  STAGE_LABEL,
  Thresholds,
  Verdict,
  WasteDimension,
  WasteRow,
} from './models';
import { monthly } from './metrics';

/**
 * Veredito sobre cada linha de gasto. Substitui regras fixas (ex.: "70% do Display
 * é vazamento") por um teste que qualquer pessoa consegue auditar:
 *
 *  1. Há cliques suficientes? Senão: falta de dados.
 *  2. O período já amadureceu (prazo típico até o estágio-meta)? Senão: falta de dados.
 *  3. Sem resultado: qual a chance de isso acontecer só por acaso, dada a taxa de
 *     referência? Se for alta: falta de dados.
 *  4. Chance baixa E ao menos um sinal independente concorda: desperdício provável.
 *     Sem segundo sinal: falta de dados (não confirmado).
 *  5. Com resultado: custo por resultado comparado à meta (ou à média da conta).
 */

export interface RowSignal {
  text: string;
  /** FACT = medido/configurado; HYPOTHESIS = leitura plausível que falta verificar. */
  kind: 'FACT' | 'HYPOTHESIS';
  source?: DataSource;
  /** Sinais do mesmo mecanismo não contam como confirmações independentes. */
  mechanism?: string;
}

export interface AssessInput {
  clicks: number;
  cost: number;
  /** Resultados no estágio-meta. `null` = não dá para saber para esta linha. */
  outcomes: number | null;
  /** Resultados por clique de linhas comparáveis (sem a própria linha). */
  baselineRate: number | null;
  baselineLabel: string;
  baselineClicks: number;
  /** Custo por resultado de referência (meta, ou média da conta). */
  costTarget: number | null;
  costTargetIsAverage: boolean;
  costReferenceLabel?: string;
  /** 0–1: fração do período que já teve tempo de gerar o estágio-meta. */
  maturity: number;
  signals: readonly RowSignal[];
  trackingIssues: readonly string[];
  /** Regra do negócio que torna o gasto desperdício por definição (ex.: fora da área atendida). */
  forcedWaste?: string;
  outcomeSource?: DataSource;
  contextEvidence?: readonly Evidence[];
}

export interface AssessContext {
  thresholds: Thresholds;
  goal: BusinessGoal;
  windowDays: number;
}

// Sem coortes de cliques por data, a fração de dias/custo maduro não permite
// saber quantos cliques já tiveram toda a janela de conversão.
const MATURITY_MIN = 1;

function confidence(level: Confidence['level'], reasons: string[]): Confidence {
  return { level, reasons };
}

function insufficient(
  reason: InsufficientReason,
  evidence: Evidence[],
  extra: Partial<Assessment> = {},
): Assessment {
  return {
    verdict: 'INSUFFICIENT_DATA',
    confidence: confidence('LOW', ['Os dados atuais não sustentam uma conclusão.']),
    evidence,
    signals: [],
    reason,
    ...extra,
  };
}

/** Avalia uma linha. Função pura: mesmos números, mesmo veredito. */
export function assess(input: AssessInput, ctx: AssessContext): Assessment {
  const { thresholds, goal } = ctx;
  const stage = STAGE_LABEL[goal.goalStage].toLowerCase();
  const evidence: Evidence[] = [
    {
      kind: 'FACT',
      source: 'GOOGLE_ADS',
      text: `${num(input.clicks)} cliques e ${brl(input.cost)} investidos no período.`,
    },
  ];
  const signalTexts = input.signals.map((s) => s.text);
  evidence.push(...(input.contextEvidence ?? []));
  if (input.outcomes === 0) evidence.push({ kind: 'FACT', source: input.outcomeSource ?? 'GOOGLE_ADS', text: `Não há registros de ${stage} para esta linha no período.` });
  for (const s of input.signals) evidence.push({ kind: s.kind, source: s.source ?? 'CALCULATION', text: s.text });
  const independentFacts = new Set(input.signals
    .filter((s) => s.kind === 'FACT')
    .map((s) => s.mechanism ?? s.text));

  // 1) Regra do negócio: gasto onde a empresa não atende.
  if (input.forcedWaste) {
    return {
      verdict: 'PROBABLE_WASTE',
      confidence: confidence('HIGH', ['Vem de uma regra que você configurou, não de estatística.']),
      evidence: [{ kind: 'FACT', source: 'CONFIG', text: input.forcedWaste }, ...evidence],
      signals: [input.forcedWaste, ...signalTexts],
    };
  }

  // 2) Falha de medição vence qualquer conclusão sobre desempenho.
  if (input.trackingIssues.length > 0) {
    return {
      verdict: 'TRACKING_FAILURE',
      confidence: confidence(input.trackingIssues.length >= 2 ? 'HIGH' : 'MEDIUM', [
        input.trackingIssues.length >= 2
          ? 'Mais de um indício independente aponta para a medição.'
          : 'Há um indício de que a medição está falhando.',
      ]),
      evidence: [
        ...input.trackingIssues.map<Evidence>((t) => ({ kind: 'FACT', source: 'CALCULATION', text: t })),
        ...evidence,
        {
          kind: 'UNAVAILABLE',
          source: 'CALCULATION',
          text: 'Enquanto a medição não for corrigida, não dá para dizer se o gasto traz resultado.',
        },
      ],
      signals: [],
    };
  }

  // 3) Volume mínimo.
  if (input.clicks < thresholds.minClicks) {
    evidence.push({
      kind: 'FACT',
      source: 'CONFIG',
      text: `São necessários ao menos ${num(thresholds.minClicks)} cliques para concluir algo.`,
    });
    return insufficient('LOW_VOLUME', evidence);
  }

  // 4) Resultado desconhecido para esta linha.
  if (input.outcomes === null) {
    evidence.push({
      kind: 'UNAVAILABLE',
      source: 'CALCULATION',
      text: `Os dados disponíveis não permitem contar os resultados de ${stage} desta linha. Confirme as ações de conversão e a cobertura da fonte.`,
    });
    return insufficient('NO_GOAL_DATA', evidence);
  }

  const lag = stageLagDays(goal, goal.goalStage);
  const immatureNote: Evidence | null =
    input.maturity < 1
      ? {
          kind: 'FACT',
          source: 'CONFIG',
          text: `Só ${pct(input.maturity, 0)} do período já teve tempo de gerar ${stage}${
            lag > 0 ? ` (prazo típico: ${num(lag)} dias)` : ''
          }.`,
        }
      : null;

  // 5) Sem resultado algum.
  if (input.outcomes === 0) {
    if (input.maturity < MATURITY_MIN) {
      if (immatureNote) evidence.push(immatureNote);
      evidence.push({
        kind: 'HYPOTHESIS',
        source: 'CALCULATION',
        text: 'Ainda é cedo: parte desses cliques pode virar resultado dentro do prazo normal.',
      });
      return insufficient('IMMATURE', evidence);
    }

    if (input.baselineRate === null || input.baselineRate <= 0 || input.baselineRate >= 1) {
      evidence.push({
        kind: 'UNAVAILABLE',
        source: 'CALCULATION',
        text: 'Não há uma taxa válida de linhas comparáveis. Conversões por clique iguais ou superiores a 100% também não permitem este teste.',
      });
      return insufficient('NO_GOAL_DATA', evidence);
    }

    const chance = chanceOfZero(input.baselineRate, input.clicks);
    evidence.push({
      kind: 'FACT',
      source: 'CALCULATION',
      text: `Taxa de referência: ${pct(input.baselineRate, 1)} de resultados por clique (${input.baselineLabel}, ${num(input.baselineClicks)} cliques).`,
    });
    evidence.push({
      kind: 'FACT',
      source: 'CALCULATION',
      text: `Com ${num(input.clicks)} cliques, ficar sem nenhum resultado só por acaso aconteceria em ${pct(chance, 1)} das vezes.`,
    });
    evidence.push({ kind: 'HYPOTHESIS', source: 'CALCULATION', text: 'Este cálculo supõe cliques independentes e uma taxa comparável e estável. Não é a probabilidade de o público ser inadequado; repetição de usuários, atribuição e muitos recortes podem reduzir sua confiabilidade.' });
    if (immatureNote) evidence.push(immatureNote);

    if (chance > thresholds.zeroResultAlpha) {
      return insufficient('LOW_VOLUME', evidence, { chanceByLuck: chance });
    }

    if (independentFacts.size === 0) {
      evidence.push({
        kind: 'UNAVAILABLE',
        source: 'CALCULATION',
        text: 'Nenhum segundo sinal confirma (termo desqualificado, região fora da área, página com problema…). Revise antes de cortar.',
      });
      return insufficient('UNCONFIRMED', evidence, { chanceByLuck: chance });
    }

    const strong = chance < thresholds.zeroResultAlpha / 5 && independentFacts.size >= 2;
    return {
      verdict: 'PROBABLE_WASTE',
      confidence: strong
        ? confidence('HIGH', [
            'Chance de acaso muito baixa.',
            'Mais de um sinal independente concorda.',
            'Período já maduro.',
          ])
        : confidence('MEDIUM', [
            'Chance de acaso baixa.',
            `${independentFacts.size} sinal(is) observado(s) reforçam a revisão. Hipóteses não contam como confirmação.`,
          ]),
      evidence,
      signals: signalTexts,
      chanceByLuck: chance,
    };
  }

  // 6) Com resultado: custo por resultado vs. meta.
  const cpo = input.cost / input.outcomes;
  evidence.push({
    kind: 'FACT',
    source: input.outcomeSource ?? 'GOOGLE_ADS',
    text: `${num(input.outcomes, 1)} resultados (${stage}), a ${brl(cpo)} cada.`,
  });

  if (input.costTarget === null || input.costTarget <= 0) {
    evidence.push({
      kind: 'UNAVAILABLE',
      source: 'CONFIG',
      text: 'Sem meta de custo e sem média da conta para comparar.',
    });
    return insufficient('NO_CONFIG', evidence);
  }

  evidence.push({
    kind: 'FACT',
    source: input.costTargetIsAverage ? 'CALCULATION' : 'CONFIG',
    text: input.costTargetIsAverage
      ? `Meta não definida: comparado com ${input.costReferenceLabel ?? 'a média da conta'}, ${brl(input.costTarget)} por ${stage}.`
      : `Meta configurada: ${brl(input.costTarget)} por ${stage}.`,
  });
  if (immatureNote) evidence.push(immatureNote);

  if (input.maturity < MATURITY_MIN) {
    return insufficient('IMMATURE', evidence);
  }

  const outcomesLevel: Confidence['level'] = input.outcomes >= 10 ? 'HIGH' : input.outcomes >= 3 ? 'MEDIUM' : 'LOW';

  if (cpo > input.costTarget * thresholds.aboveTargetFactor) {
    if (input.maturity < MATURITY_MIN) {
      evidence.push({
        kind: 'HYPOTHESIS',
        source: 'CALCULATION',
        text: 'O custo por resultado ainda pode cair conforme os cliques recentes amadurecem.',
      });
      return insufficient('IMMATURE', evidence);
    }
    return {
      verdict: 'ABOVE_TARGET',
      confidence: confidence(outcomesLevel, [
        `${num(input.outcomes, 1)} resultados sustentam o custo por resultado.`,
      ]),
      evidence,
      signals: signalTexts,
    };
  }

  return {
    verdict: 'PERFORMING',
    confidence: confidence(outcomesLevel, [`${num(input.outcomes, 1)} resultados no período.`]),
    evidence,
    signals: signalTexts,
  };
}

// ───────────────────────── Linhas e grupos ─────────────────────────

export interface GroupItem {
  key: string;
  label: string;
  sublabel?: string;
  perf: Perf;
  /** Resultados no estágio-meta; null quando desconhecidos para esta linha. */
  outcomes: number | null;
  outcomeSource?: DataSource;
  contextEvidence?: Evidence[];
  /** Linha "pai" cuja taxa serve de referência (ex.: campanha de um termo). */
  parentKey?: string;
  signals?: RowSignal[];
  trackingIssues?: string[];
  forcedWaste?: string;
  /** Maturação própria da linha; se ausente, usa a da janela. */
  maturity?: number;
  /**
   * Fica fora da taxa de referência dos demais (ex.: termo já negativado). Serve para
   * uma linha que você já decidiu bloquear não puxar o veredito das outras.
   */
  excludeFromBaseline?: boolean;
  /** Já bloqueado no Google Ads: segue para a linha como `blocked`. */
  blocked?: boolean;
}

export interface GroupOptions {
  dimension: WasteDimension;
  /** Nome da referência quando comparada com todo o grupo. */
  groupLabel: string;
  /** Rótulo da referência quando comparada com o pai (ex.: "mesma campanha"). */
  parentLabel?: string;
  /** Mínimo de cliques na referência para ela valer. */
  minBaselineClicks?: number;
  /** Maturação da janela inteira (0–1). */
  maturity: number;
  costTarget: number | null;
  costTargetIsAverage: boolean;
  costReferenceLabel?: string;
  /** Rótulo para o pai (ex.: id da campanha → nome). */
  parentNames?: Map<string, string>;
  /** Desative quando misturar pais significaria comparar públicos/formatos diferentes. */
  allowGroupFallback?: boolean;
}

/** Taxa (resultados/clique) de um conjunto, desconsiderando uma linha. */
function leaveOneOut(
  totalClicks: number,
  totalOutcomes: number,
  item: { clicks: number; outcomes: number | null },
): { rate: number | null; clicks: number } {
  const clicks = totalClicks - item.clicks;
  const outcomes = totalOutcomes - (item.outcomes ?? 0);
  return { rate: clicks > 0 ? outcomes / clicks : null, clicks };
}

export function assessGroup(items: readonly GroupItem[], ctx: AssessContext, opts: GroupOptions): WasteRow[] {
  const minBase = opts.minBaselineClicks ?? 30;

  // Totais do grupo e de cada pai, contando só linhas com resultado conhecido.
  const known = items.filter((i) => i.outcomes !== null && !i.excludeFromBaseline &&
    (i.maturity ?? opts.maturity) >= MATURITY_MIN && !i.trackingIssues?.length);
  const groups = new Map<DataSource, { clicks: number; outcomes: number }>();
  const parentKey = (item: GroupItem) => JSON.stringify([item.parentKey, item.outcomeSource ?? 'GOOGLE_ADS']);
  const parent = new Map<string, { clicks: number; outcomes: number }>();
  for (const i of known) {
    const source = i.outcomeSource ?? 'GOOGLE_ADS';
    const group = groups.get(source) ?? { clicks: 0, outcomes: 0 };
    group.clicks += i.perf.clicks;
    group.outcomes += i.outcomes ?? 0;
    groups.set(source, group);
    if (!i.parentKey) continue;
    const key = parentKey(i);
    const p = parent.get(key) ?? { clicks: 0, outcomes: 0 };
    p.clicks += i.perf.clicks;
    p.outcomes += i.outcomes ?? 0;
    parent.set(key, p);
  }

  return items.map((item) => {
    let baseline = { rate: null as number | null, clicks: 0 };
    let label = opts.groupLabel;
    // Linha fora dos totais: nada a descontar dela na referência.
    const self = !known.includes(item)
      ? { clicks: 0, outcomes: 0 }
      : { clicks: item.perf.clicks, outcomes: item.outcomes };
    const p = item.parentKey ? parent.get(parentKey(item)) : undefined;
    if (p) {
      const r = leaveOneOut(p.clicks, p.outcomes, self);
      if (r.clicks >= minBase) {
        baseline = r;
        const name = opts.parentNames?.get(item.parentKey as string);
        label = name ? `${opts.parentLabel ?? 'mesma campanha'}: ${name}` : (opts.parentLabel ?? opts.groupLabel);
      }
    }
    if (baseline.rate === null && opts.allowGroupFallback !== false) {
      const group = groups.get(item.outcomeSource ?? 'GOOGLE_ADS') ?? { clicks: 0, outcomes: 0 };
      const r = leaveOneOut(group.clicks, group.outcomes, self);
      if (r.clicks >= minBase) baseline = r;
    }

    const assessment = assess(
      {
        clicks: item.perf.clicks,
        cost: item.perf.cost,
        outcomes: item.outcomes,
        baselineRate: baseline.rate,
        baselineLabel: label,
        baselineClicks: baseline.clicks,
        costTarget: opts.costTarget,
        costTargetIsAverage: opts.costTargetIsAverage,
        costReferenceLabel: opts.costReferenceLabel,
        maturity: item.maturity ?? opts.maturity,
        signals: item.signals ?? [],
        trackingIssues: item.trackingIssues ?? [],
        forcedWaste: item.forcedWaste,
        outcomeSource: item.outcomeSource,
        contextEvidence: item.contextEvidence,
      },
      ctx,
    );

    return {
      dimension: opts.dimension,
      key: item.key,
      label: item.label,
      sublabel: item.sublabel,
      perf: item.perf,
      outcomes: item.outcomes ?? 0,
      outcomesKnown: item.outcomes !== null,
      outcomeSource: item.outcomeSource ?? 'GOOGLE_ADS',
      assessment,
      // Já bloqueado não gasta mais: entra no custo do período, não na projeção mensal.
      monthlyCost: item.blocked ? 0 : monthly(item.perf.cost, ctx.windowDays),
      ...(item.blocked ? { blocked: true } : {}),
    };
  });
}

export interface WasteSummary {
  verdict: Verdict;
  rows: number;
  cost: number;
  monthlyCost: number;
}

/** Resume UMA dimensão. Dimensões se sobrepõem: nunca some resumos de dimensões diferentes. */
export function summarize(rows: readonly WasteRow[]): Record<Verdict, WasteSummary> {
  const out = {} as Record<Verdict, WasteSummary>;
  const verdicts: Verdict[] = [
    'PROBABLE_WASTE',
    'TRACKING_FAILURE',
    'ABOVE_TARGET',
    'INSUFFICIENT_DATA',
    'PERFORMING',
  ];
  for (const v of verdicts) out[v] = { verdict: v, rows: 0, cost: 0, monthlyCost: 0 };
  for (const r of rows) {
    const s = out[r.assessment.verdict];
    s.rows++;
    s.cost += r.perf.cost;
    s.monthlyCost += r.monthlyCost;
  }
  return out;
}

/** Meta de custo por resultado: a configurada, ou a média da conta como referência. */
export function costReference(
  goal: BusinessGoal,
  accountCost: number,
  accountOutcomes: number,
): { target: number | null; isAverage: boolean } {
  if (goal.targetCostPerGoal !== null && goal.targetCostPerGoal > 0) {
    return { target: goal.targetCostPerGoal, isAverage: false };
  }
  if (accountOutcomes > 0 && accountCost > 0) {
    return { target: accountCost / accountOutcomes, isAverage: true };
  }
  return { target: null, isAverage: false };
}

// ───────────────────────── Categorias para separar o gasto ─────────────────────────

/**
 * Leitura simples do veredito para separar a verba:
 *  - WASTE: desperdício real (inclui termo já bloqueado, cujo gasto já aconteceu);
 *  - EXPENSIVE: traz resultado, mas caro frente à meta;
 *  - GOOD: dentro da meta. Não é "lucrativo": lucro exige receita por item, que só o CRM dá;
 *  - UNKNOWN: ainda não dá para concluir;
 *  - TRACKING: a medição parece falhar, então nada pode ser julgado.
 */
export type WasteCategory = 'WASTE' | 'EXPENSIVE' | 'GOOD' | 'UNKNOWN' | 'TRACKING';

export const WASTE_CATEGORIES: readonly WasteCategory[] = ['WASTE', 'EXPENSIVE', 'GOOD', 'UNKNOWN', 'TRACKING'];

const CATEGORY_OF: Record<Verdict, WasteCategory> = {
  PROBABLE_WASTE: 'WASTE',
  ABOVE_TARGET: 'EXPENSIVE',
  PERFORMING: 'GOOD',
  INSUFFICIENT_DATA: 'UNKNOWN',
  TRACKING_FAILURE: 'TRACKING',
};

export function wasteCategory(row: WasteRow): WasteCategory {
  return CATEGORY_OF[row.assessment.verdict];
}

export interface CategoryTotal {
  category: WasteCategory;
  rows: number;
  cost: number;
  /** Fração do custo total da dimensão (0–1). */
  share: number;
}

/** Custo por categoria dentro de UMA dimensão (somar dimensões diferentes conta o mesmo clique várias vezes). */
export function categoryTotals(rows: readonly WasteRow[]): Record<WasteCategory, CategoryTotal> {
  const total = rows.reduce((s, r) => s + r.perf.cost, 0);
  const out = {} as Record<WasteCategory, CategoryTotal>;
  for (const c of WASTE_CATEGORIES) out[c] = { category: c, rows: 0, cost: 0, share: 0 };
  for (const r of rows) {
    const t = out[wasteCategory(r)];
    t.rows++;
    t.cost += r.perf.cost;
  }
  for (const c of WASTE_CATEGORIES) out[c].share = total > 0 ? out[c].cost / total : 0;
  return out;
}
