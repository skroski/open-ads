import { TIPS } from './config';
import { CampaignShareRow, Confidence } from './models';
import { deriveConfidence } from './provenance';
import { Range } from './campaign-potential';
import { describeShortfall, evaluateSufficiency } from './sufficiency';
import { wilson } from './stats';

/**
 * Quanto investir para aprender se uma palavra nova funciona. Não prevê o resultado da palavra: diz
 * quantos cliques e quantos reais são precisos, nas taxas e no CPC que a conta já tem, para observar um
 * número de conversões que dê alguma força à leitura. Só usa campanhas de Pesquisa.
 */

export type TestBudget =
  | {
      status: 'ready';
      targetConversions: number;
      conversionRate: Range & { point: number };
      clicks: Range;
      cost: Range;
      cpc: Range;
      confidence: Confidence;
      caveats: string[];
    }
  | { status: 'insufficient' | 'blocked'; reason: string; etaDays?: number | null };

export interface TestBudgetInput {
  rows: readonly CampaignShareRow[];
  windowDays: number;
  trackingBroken: boolean;
  targetConversions?: number;
}

export function testBudget(input: TestBudgetInput): TestBudget {
  const target = input.targetConversions ?? TIPS.testConversions;
  const search = input.rows.filter((r) => r.channel === 'SEARCH' && r.clicks > 0);
  const clicks = search.reduce((s, r) => s + r.clicks, 0);
  const conversions = search.reduce((s, r) => s + r.conversions, 0);
  const days = Math.max(1, input.windowDays);

  const gate = evaluateSufficiency(
    'RATE_ESTIMATE',
    { activeDays: days, clicks, conversions, windowDays: days, recentClicksPerDay: clicks / days, recentConversionsPerDay: conversions / days },
    { trackingBroken: input.trackingBroken },
  );
  if (gate.status === 'blocked') return { status: 'blocked', reason: gate.reason };
  if (gate.status === 'insufficient') return { status: 'insufficient', reason: describeShortfall(gate), etaDays: gate.etaDays };
  if (conversions <= 0) {
    return { status: 'insufficient', reason: 'As campanhas de Pesquisa ainda não tiveram conversões: sem taxa de conversão, não há como dimensionar o teste.' };
  }

  const rate = wilson(Math.min(conversions, clicks), clicks);
  if (rate.low <= 0) return { status: 'insufficient', reason: 'A taxa de conversão ainda é incerta demais para dimensionar um teste.' };

  const cpcs = search.filter((r) => r.clicks >= TIPS.minClicksForCpc).map((r) => r.cost / r.clicks);
  const avg = search.reduce((s, r) => s + r.cost, 0) / clicks;
  const cpc: Range = cpcs.length ? { low: Math.min(...cpcs), high: Math.max(...cpcs) } : { low: avg, high: avg };

  const needed: Range = { low: Math.ceil(target / rate.high), high: Math.ceil(target / rate.low) };
  return {
    status: 'ready',
    targetConversions: target,
    conversionRate: { low: rate.low, high: rate.high, point: conversions / clicks },
    clicks: needed,
    cost: { low: needed.low * cpc.low, high: needed.high * cpc.high },
    cpc,
    confidence: deriveConfidence({ ratio: gate.ratio }),
    caveats: [
      'Supõe que a palavra nova converte como as que a conta já tem; ela pode render mais ou menos. O teste serve justamente para descobrir.',
      cpcs.length < 2
        ? 'O CPC vem de uma só campanha, então a faixa de custo não inclui variação de CPC.'
        : 'A faixa de CPC vai da campanha mais barata à mais cara.',
    ],
  };
}
