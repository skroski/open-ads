import { chanceOfZero } from './stats';
import { DemographicDimension, DemographicRow, Perf, Thresholds } from './models';

/**
 * Perfil demográfico de uma campanha de Display. O painel mostra onde o gasto foi, por faixa etária, gênero,
 * renda e situação parental, e só aponta um perfil como candidato a exclusão quando os dados sustentam:
 * cliques suficientes, nenhuma conversão nele e conversões nos demais perfis. Sem conversões em lugar nenhum,
 * não há como saber qual perfil rende mais, e o painel não sugere cortes.
 */

export const DIMENSION_TITLE: Record<DemographicDimension, string> = {
  AGE: 'Faixa etária',
  GENDER: 'Gênero',
  INCOME: 'Renda domiciliar',
  PARENTAL: 'Situação parental',
};

export const DIMENSIONS: readonly DemographicDimension[] = ['AGE', 'GENDER', 'INCOME', 'PARENTAL'];

const SEGMENT_LABEL: Record<string, string> = {
  AGE_RANGE_18_24: '18 a 24 anos',
  AGE_RANGE_25_34: '25 a 34 anos',
  AGE_RANGE_35_44: '35 a 44 anos',
  AGE_RANGE_45_54: '45 a 54 anos',
  AGE_RANGE_55_64: '55 a 64 anos',
  AGE_RANGE_65_UP: '65 anos ou mais',
  AGE_RANGE_UNDETERMINED: 'Idade desconhecida',
  MALE: 'Homens',
  FEMALE: 'Mulheres',
  UNDETERMINED: 'Gênero desconhecido',
  // Renda domiciliar por percentil, como o Google define: 90 ou mais é a faixa mais alta.
  INCOME_RANGE_0_50: 'Renda: percentil 0 a 50',
  INCOME_RANGE_50_60: 'Renda: percentil 50 a 60',
  INCOME_RANGE_60_70: 'Renda: percentil 60 a 70',
  INCOME_RANGE_70_80: 'Renda: percentil 70 a 80',
  INCOME_RANGE_80_90: 'Renda: percentil 80 a 90',
  INCOME_RANGE_90_UP: 'Renda: percentil 90 ou mais',
  INCOME_RANGE_UNDETERMINED: 'Renda desconhecida',
  PARENT: 'Com filhos',
  NOT_A_PARENT: 'Sem filhos',
  UNKNOWN: 'Situação parental desconhecida',
};

const UNKNOWN_SEGMENTS = new Set(['AGE_RANGE_UNDETERMINED', 'UNDETERMINED', 'INCOME_RANGE_UNDETERMINED', 'UNKNOWN']);

export const segmentLabel = (segment: string): string => SEGMENT_LABEL[segment] ?? segment;

export type Advice =
  /** Gastou sem converter, num grupo que converte, com evidência de que não é acaso. */
  | 'EXCLUDE_CANDIDATE'
  | 'CONVERTS'
  | 'NO_EVIDENCE'
  | 'EXCLUDED';

export interface SegmentReport {
  segment: string;
  label: string;
  /** Excluído em todos os grupos de anúncios da campanha. */
  excluded: boolean;
  /** Excluído em alguns grupos, não em todos. */
  partlyExcluded: boolean;
  unknown: boolean;
  perf: Perf;
  costShare: number | null;
  ctr: number | null;
  cpc: number | null;
  conversionRate: number | null;
  advice: Advice;
  reason: string;
  /** Excluir deixaria a dimensão sem nenhum perfil ativo: o grupo pararia de entregar. */
  canExclude: boolean;
}

export interface DimensionReport {
  dimension: DemographicDimension;
  title: string;
  totals: Perf;
  /** Parcela do gasto nos perfis "desconhecido": o Google não sabe quem viu. */
  unknownCostShare: number | null;
  segments: SegmentReport[];
}

export interface DemographicsReport {
  campaignId: string;
  totals: Perf;
  /** Nenhum perfil converteu: sem base para comparar perfis. */
  noConversions: boolean;
  dimensions: DimensionReport[];
}

const zero = (): Perf => ({ impressions: 0, clicks: 0, cost: 0, conversions: 0 });
const add = (a: Perf, b: Perf): Perf => ({
  impressions: a.impressions + b.impressions,
  clicks: a.clicks + b.clicks,
  cost: a.cost + b.cost,
  conversions: a.conversions + b.conversions,
});
const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);
const pct = (v: number, digits = 0): string => `${(v * 100).toFixed(digits).replace('.', ',')}%`;

export function reportDemographics(
  rows: readonly DemographicRow[],
  campaignId: string,
  thresholds: Pick<Thresholds, 'zeroResultAlpha' | 'minClicks'>,
): DemographicsReport {
  const mine = rows.filter((r) => r.campaignId === campaignId);

  const dimensions: DimensionReport[] = DIMENSIONS.map((dimension) => {
    const own = mine.filter((r) => r.dimension === dimension);
    const bySegment = new Map<string, { perf: Perf; groups: number; excluded: number }>();
    for (const r of own) {
      const e = bySegment.get(r.segment) ?? { perf: zero(), groups: 0, excluded: 0 };
      e.perf = add(e.perf, r);
      e.groups += 1;
      if (r.excluded) e.excluded += 1;
      bySegment.set(r.segment, e);
    }
    const totals = [...bySegment.values()].reduce((t, e) => add(t, e.perf), zero());
    const activeCount = [...bySegment.values()].filter((e) => e.excluded < e.groups).length;
    const unknownCost = [...bySegment].filter(([s]) => UNKNOWN_SEGMENTS.has(s)).reduce((c, [, e]) => c + e.perf.cost, 0);

    const segments: SegmentReport[] = [...bySegment].map(([segment, e]) => {
      const excluded = e.excluded === e.groups;
      const base = {
        segment,
        label: segmentLabel(segment),
        excluded,
        partlyExcluded: !excluded && e.excluded > 0,
        unknown: UNKNOWN_SEGMENTS.has(segment),
        perf: e.perf,
        costShare: ratio(e.perf.cost, totals.cost),
        ctr: ratio(e.perf.clicks, e.perf.impressions),
        cpc: ratio(e.perf.cost, e.perf.clicks),
        conversionRate: ratio(e.perf.conversions, e.perf.clicks),
        canExclude: !excluded && activeCount > 1,
      };
      if (excluded) return { ...base, advice: 'EXCLUDED' as const, reason: 'Já está excluído da segmentação.' };
      if (totals.conversions <= 0) {
        return { ...base, advice: 'NO_EVIDENCE' as const, reason: 'Nenhum perfil desta dimensão teve conversões: não há como saber qual rende mais.' };
      }
      if (e.perf.conversions > 0) {
        return { ...base, advice: 'CONVERTS' as const, reason: `Teve ${e.perf.conversions.toFixed(1).replace('.', ',')} conversões.` };
      }
      if (e.perf.clicks < thresholds.minClicks) {
        return { ...base, advice: 'NO_EVIDENCE' as const, reason: `Poucos cliques para concluir (${e.perf.clicks} de ${thresholds.minClicks} mínimos).` };
      }
      const rest = { clicks: totals.clicks - e.perf.clicks, conversions: totals.conversions - e.perf.conversions };
      const rate = ratio(rest.conversions, rest.clicks);
      if (rate === null || rate <= 0) {
        return { ...base, advice: 'NO_EVIDENCE' as const, reason: 'Os demais perfis também não converteram.' };
      }
      const luck = chanceOfZero(rate, e.perf.clicks);
      if (luck > thresholds.zeroResultAlpha) {
        return { ...base, advice: 'NO_EVIDENCE' as const, reason: `Sem conversões, mas pode ser acaso (${pct(luck)} de chance).` };
      }
      return {
        ...base,
        advice: 'EXCLUDE_CANDIDATE' as const,
        reason: `${e.perf.clicks} cliques sem conversão; nos demais perfis a taxa é ${pct(rate, 1)}. Chance de ser acaso: ${pct(luck)}.`,
      };
    });
    segments.sort((a, b) => b.perf.cost - a.perf.cost);

    return { dimension, title: DIMENSION_TITLE[dimension], totals, unknownCostShare: ratio(unknownCost, totals.cost), segments };
  });

  // Totais da campanha: qualquer dimensão cobre todo o tráfego (usa a que tiver mais cliques).
  const totals = dimensions.reduce((best, d) => (d.totals.clicks > best.clicks ? d.totals : best), zero());
  return { campaignId, totals, noConversions: totals.conversions <= 0, dimensions };
}
