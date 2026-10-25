import { TIPS } from './config';
import { pct } from './format';
import { CampaignShareRow, Confidence } from './models';
import { Provenance, deriveConfidence } from './provenance';
import { Sufficiency, describeShortfall, evaluateSufficiency } from './sufficiency';
import { wilson } from './stats';

/**
 * Onde mais orçamento (ou outro ajuste) tende a render, a partir da parcela de impressões do Google Ads.
 * Perder impressões por orçamento se resolve com verba; perder por ranking não: exige lance, anúncio e
 * página melhores. O painel separa as duas coisas e só projeta o que os dados da campanha sustentam.
 */

export interface Range {
  low: number;
  high: number;
}

export type TipKind = 'BUDGET' | 'RANK';
export type TipStatus = 'ready' | 'info' | 'insufficient' | 'blocked';

export interface CampaignTip {
  campaignId: string;
  campaignName: string;
  kind: TipKind;
  status: TipStatus;
  headline: string;
  evidence: string[];
  caveats: string[];
  /** Só em `ready`. */
  extraClicks?: number;
  extraConversions?: Range;
  extraCost?: number;
  extraCostPerDay?: number;
  confidence?: Confidence;
  provenance?: Provenance;
  etaDays?: number | null;
  /** Ordenação: maior primeiro. */
  priority: number;
}

export interface PotentialInput {
  rows: readonly CampaignShareRow[];
  windowDays: number;
  /** Custo máximo por resultado informado pela pessoa, se houver. */
  costTarget: number | null;
  /** Múltiplo da meta a partir do qual o custo é considerado alto. */
  aboveTargetFactor: number;
  /** Custo por conversão da conta toda, usado quando não há meta. */
  accountCostPerConversion: number | null;
  trackingBroken: boolean;
}

const money = (v: number): string => `R$ ${v.toFixed(2).replace('.', ',')}`;
const pc = (v: number): string => pct(v, 0);

function history(row: CampaignShareRow, windowDays: number) {
  const days = Math.max(1, windowDays);
  return {
    activeDays: days,
    clicks: row.clicks,
    conversions: row.conversions,
    windowDays: days,
    recentClicksPerDay: row.clicks / days,
    recentConversionsPerDay: row.conversions / days,
  };
}

function evidenceOf(r: CampaignShareRow): string[] {
  const out: string[] = [];
  if (r.searchShare !== null) out.push(`Recebeu ${pc(r.searchShare)} das impressões possíveis.`);
  if (r.lostBudget !== null) out.push(`Perdeu ${pc(r.lostBudget)} por orçamento.`);
  if (r.lostRank !== null) out.push(`Perdeu ${pc(r.lostRank)} por ranking.`);
  if (r.dailyBudget !== null) out.push(`Orçamento diário: ${money(r.dailyBudget)}.`);
  return out;
}

function budgetTip(r: CampaignShareRow, input: PotentialInput): CampaignTip {
  const base = { campaignId: r.id, campaignName: r.name, kind: 'BUDGET' as const, evidence: evidenceOf(r), caveats: [] as string[] };
  const lost = r.lostBudget ?? 0;
  const headline = `Perde ${pc(lost)} das impressões por orçamento`;
  const stop = (status: TipStatus, reason: string, extra: Partial<CampaignTip> = {}): CampaignTip => ({
    ...base,
    status,
    headline,
    caveats: [reason],
    priority: 0,
    ...extra,
  });

  if (r.searchShare === null || r.searchShare < TIPS.minShare) {
    return stop('insufficient', 'A parcela de impressões está abaixo de 10%: o Google não informa o valor exato, então não dá para projetar o ganho.');
  }
  if (r.conversions <= 0) return stop('insufficient', 'A campanha não teve conversões no período: sem taxa de conversão, não há como projetar.');

  const gate: Sufficiency = evaluateSufficiency('RATE_ESTIMATE', history(r, input.windowDays), {
    trackingBroken: input.trackingBroken,
  });
  if (gate.status === 'blocked') return stop('blocked', gate.reason);
  if (gate.status === 'insufficient') {
    return stop('insufficient', describeShortfall(gate), { etaDays: gate.etaDays });
  }

  const cpa = r.cost / r.conversions;
  const reference = input.costTarget ?? input.accountCostPerConversion;
  if (reference !== null && reference > 0 && cpa > reference * input.aboveTargetFactor) {
    return stop(
      'blocked',
      `O custo por conversão desta campanha (${money(cpa)}) já está acima de ${input.costTarget !== null ? 'sua meta' : 'a média da conta'} (${money(reference)}). Mais verba compraria resultado caro: corrija isso antes.`,
    );
  }

  // Impressões que o orçamento deixou escapar, em proporção às que a campanha recebeu.
  const extraClicks = r.clicks * (lost / r.searchShare);
  const cvr = wilson(Math.min(r.conversions, r.clicks), r.clicks);
  const extraConversions = { low: extraClicks * cvr.low, high: extraClicks * cvr.high };
  const extraCost = extraClicks * (r.cost / r.clicks);
  return {
    ...base,
    status: 'ready',
    headline,
    extraClicks,
    extraConversions,
    extraCost,
    extraCostPerDay: extraCost / Math.max(1, input.windowDays),
    confidence: deriveConfidence({ ratio: gate.ratio }),
    provenance: { source: 'CALCULATION', detail: `parcela de impressões e taxas da campanha, últimos ${input.windowDays} dias` },
    caveats: [
      'Supõe o mesmo CTR, CPC e taxa de conversão nas impressões extras. O Google costuma entregar primeiro as melhores, então o ganho real tende a ser menor.',
      'A faixa de conversões vem da incerteza da taxa de conversão observada (intervalo de 95%).',
    ],
    priority: extraConversions.high,
  };
}

function rankTip(r: CampaignShareRow): CampaignTip {
  const lost = r.lostRank ?? 0;
  return {
    campaignId: r.id,
    campaignName: r.name,
    kind: 'RANK',
    status: 'info',
    headline: `Perde ${pc(lost)} das impressões por ranking`,
    evidence: evidenceOf(r),
    caveats: [
      (r.lostBudget ?? 0) < TIPS.minLostBudget
        ? 'Orçamento não é o limite aqui: mais verba não resolve. O caminho é lance, qualidade do anúncio e da página e relevância das palavras.'
        : 'Parte da perda é por ranking: além de verba, o caminho é lance, qualidade do anúncio e da página e relevância das palavras.',
    ],
    provenance: { source: 'GOOGLE_ADS', detail: 'parcela de impressões perdida por ranking' },
    priority: lost * r.cost,
  };
}

/** Dicas por campanha de Pesquisa ativa, das que mais prometem às que só informam. */
export function campaignTips(input: PotentialInput): CampaignTip[] {
  const tips: CampaignTip[] = [];
  for (const r of input.rows) {
    if (r.channel !== 'SEARCH' || r.status !== 'ENABLED' || r.clicks <= 0 || r.searchShare === null) continue;
    if ((r.lostBudget ?? 0) >= TIPS.minLostBudget) tips.push(budgetTip(r, input));
    if ((r.lostRank ?? 0) >= TIPS.minLostRank) tips.push(rankTip(r));
  }
  const order: Record<TipStatus, number> = { ready: 0, info: 1, insufficient: 2, blocked: 2 };
  return tips.sort((a, b) => order[a.status] - order[b.status] || b.priority - a.priority);
}
