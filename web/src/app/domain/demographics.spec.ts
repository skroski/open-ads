import { DemographicDimension, DemographicRow } from './models';
import { reportDemographics, segmentLabel } from './demographics';

const th = { zeroResultAlpha: 0.1, minClicks: 8 };

const row = (
  dimension: DemographicDimension,
  segment: string,
  clicks: number,
  conversions: number,
  extra: Partial<DemographicRow> = {},
): DemographicRow => ({
  dimension,
  segment,
  campaignId: '1',
  adGroupId: '10',
  excluded: false,
  bidModifier: null,
  impressions: clicks * 100,
  clicks,
  cost: clicks * 2,
  conversions,
  ...extra,
});

const age = (rows: DemographicRow[]) => reportDemographics(rows, '1', th).dimensions.find((d) => d.dimension === 'AGE')!;
const seg = (rows: DemographicRow[], s: string) => age(rows).segments.find((x) => x.segment === s)!;

describe('reportDemographics — sem conversões', () => {
  const rows = [row('AGE', 'AGE_RANGE_25_34', 40, 0), row('AGE', 'AGE_RANGE_35_44', 60, 0), row('AGE', 'AGE_RANGE_18_24', 0, 0, { excluded: true })];

  it('não sugere nenhum corte e diz o motivo', () => {
    expect(reportDemographics(rows, '1', th).noConversions).toBe(true);
    for (const s of age(rows).segments.filter((x) => !x.excluded)) {
      expect(s.advice).toBe('NO_EVIDENCE');
      expect(s.reason).toContain('não há como saber');
    }
  });

  it('mostra onde o gasto foi: participação, CTR e CPC', () => {
    const s = seg(rows, 'AGE_RANGE_35_44');
    expect(s.costShare).toBeCloseTo(0.6);
    expect(s.ctr).toBeCloseTo(0.01);
    expect(s.cpc).toBeCloseTo(2);
  });

  it('perfil já excluído aparece como excluído', () => {
    expect(seg(rows, 'AGE_RANGE_18_24').advice).toBe('EXCLUDED');
  });
});

describe('reportDemographics — com conversões', () => {
  const rows = [
    row('AGE', 'AGE_RANGE_25_34', 100, 10),
    row('AGE', 'AGE_RANGE_35_44', 80, 8),
    row('AGE', 'AGE_RANGE_55_64', 60, 0),
    row('AGE', 'AGE_RANGE_65_UP', 5, 0),
    row('AGE', 'AGE_RANGE_45_54', 12, 0),
  ];

  it('candidato a excluir: muitos cliques sem conversão, onde os demais convertem, fora do acaso', () => {
    const s = seg(rows, 'AGE_RANGE_55_64');
    expect(s.advice).toBe('EXCLUDE_CANDIDATE');
    expect(s.reason).toContain('60 cliques sem conversão');
    expect(s.canExclude).toBe(true);
  });

  it('quem converte é mantido', () => {
    expect(seg(rows, 'AGE_RANGE_25_34').advice).toBe('CONVERTS');
  });

  it('poucos cliques ou possível acaso não viram recomendação', () => {
    expect(seg(rows, 'AGE_RANGE_65_UP').reason).toContain('Poucos cliques');
    const lucky = seg(rows, 'AGE_RANGE_45_54');
    // taxa dos demais ≈ 8,8%; 12 cliques sem conversão ocorre por acaso em ~32% das vezes
    expect(lucky.advice).toBe('NO_EVIDENCE');
    expect(lucky.reason).toContain('pode ser acaso');
  });
});

describe('reportDemographics — detalhes', () => {
  it('soma os grupos de anúncios e só considera excluído o que está excluído em todos', () => {
    const rows = [
      row('GENDER', 'MALE', 10, 1, { adGroupId: '10' }),
      row('GENDER', 'MALE', 10, 0, { adGroupId: '11', excluded: true }),
      row('GENDER', 'FEMALE', 20, 2),
    ];
    const male = reportDemographics(rows, '1', th).dimensions.find((d) => d.dimension === 'GENDER')!.segments.find((s) => s.segment === 'MALE')!;
    expect(male.perf.clicks).toBe(20);
    expect(male.excluded).toBe(false);
    expect(male.partlyExcluded).toBe(true);
  });

  it('não deixa excluir o último perfil ativo', () => {
    const rows = [row('PARENTAL', 'PARENT', 30, 3), row('PARENTAL', 'NOT_A_PARENT', 0, 0, { excluded: true })];
    const p = reportDemographics(rows, '1', th).dimensions.find((d) => d.dimension === 'PARENTAL')!;
    expect(p.segments.find((s) => s.segment === 'PARENT')!.canExclude).toBe(false);
  });

  it('mede a fatia do gasto em perfis desconhecidos e filtra pela campanha', () => {
    const rows = [row('AGE', 'AGE_RANGE_25_34', 75, 0), row('AGE', 'AGE_RANGE_UNDETERMINED', 25, 0), row('AGE', 'AGE_RANGE_35_44', 99, 0, { campaignId: '2' })];
    expect(age(rows).unknownCostShare).toBeCloseTo(0.25);
    expect(age(rows).totals.clicks).toBe(100);
  });

  it('rótulos em português e fallback para o código', () => {
    expect(segmentLabel('AGE_RANGE_65_UP')).toBe('65 anos ou mais');
    expect(segmentLabel('INCOME_RANGE_90_UP')).toContain('percentil 90');
    expect(segmentLabel('OUTRO')).toBe('OUTRO');
  });
});
