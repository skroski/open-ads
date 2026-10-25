import { OffTargetInput, computeOffTarget, termsForReview } from './off-target';
import { HourRow, RegionRow, SearchTermRow } from './models';

const term = (t: string, cost: number, extra: Partial<SearchTermRow> = {}): SearchTermRow => ({
  term: t,
  campaignId: '1',
  campaignName: 'C',
  adGroupId: '1',
  adGroupName: 'G',
  excluded: false,
  alreadyNegative: false,
  category: 'GENERAL',
  categoryReason: '',
  impressions: 100,
  clicks: 10,
  cost,
  conversions: 0,
  ...extra,
});

const region = (regionId: string, regionName: string, cost: number): RegionRow => ({
  regionId,
  regionName,
  locationType: 'LOCATION_OF_PRESENCE',
  impressions: 100,
  clicks: 10,
  cost,
  conversions: 0,
});

const hour = (weekday: number, h: number, cost: number): HourRow => ({
  weekday,
  hour: h,
  campaignId: '1',
  impressions: 100,
  clicks: 10,
  cost,
  conversions: 0,
});

function input(over: Partial<OffTargetInput> = {}): OffTargetInput {
  return {
    terms: [
      term('vaga de emprego vendedor', 120, { category: 'UNQUALIFIED', categoryReason: 'Contém "emprego", da lista de termos sem intenção de compra.' }),
      term('vaga de emprego vendedor', 30, { category: 'UNQUALIFIED', categoryReason: 'Contém "emprego", da lista de termos sem intenção de compra.', campaignId: '2' }),
      term('curso de corrida', 80, { category: 'UNQUALIFIED', alreadyNegative: true }),
      term('tênis de corrida', 500, { category: 'QUALIFIED', conversions: 5 }),
    ],
    regions: [region('1001', 'Curitiba', 600), region('2001', 'Manaus', 90), region('2002', 'Belém', 10)],
    hours: [hour(1, 10, 300), hour(1, 22, 40), hour(6, 10, 60)],
    serviceArea: { regionIds: ['1001'], regionNames: { '1001': 'Curitiba' } },
    serviceHours: { startHour: 8, endHour: 18, weekdays: [1, 2, 3, 4, 5] },
    periodCost: 1000,
    ...over,
  };
}

describe('computeOffTarget', () => {
  const r = computeOffTarget(input());
  const group = (kind: string) => r.groups.find((g) => g.kind === kind)!;

  it('termos: soma por texto entre campanhas e ignora negativas já existentes', () => {
    expect(group('TERM').items).toHaveLength(1);
    expect(group('TERM').cost).toBe(150);
  });

  it('regiões fora da área e horários fora do atendimento, em reais', () => {
    expect(group('REGION').cost).toBe(100);
    expect(group('REGION').items.map((i) => i.label)).toEqual(['Manaus', 'Belém']);
    // 22h de segunda e sábado às 10h estão fora do horário
    expect(group('HOURS').cost).toBe(100);
  });

  it('a faixa vai do maior recorte à soma, porque os recortes se sobrepõem', () => {
    expect(r.floor).toBe(150);
    expect(r.ceiling).toBe(350);
    expect(r.floorShare).toBeCloseTo(0.15);
    expect(r.ceilingShare).toBeCloseTo(0.35);
  });

  it('sem área nem horário configurados, avisa o que não avaliou', () => {
    const none = computeOffTarget(input({ serviceArea: { regionIds: [], regionNames: {} }, serviceHours: null }));
    expect(none.groups.map((g) => g.kind)).toEqual(['TERM']);
    expect(none.notes).toHaveLength(2);
    expect(none.floor).toBe(150);
  });

  it('percentual indisponível sem gasto no período', () => {
    expect(computeOffTarget(input({ periodCost: 0 })).floorShare).toBeNull();
  });
});

describe('computeOffTarget — sugestões da IA', () => {
  const terms = [
    ...input().terms,
    term('tênis infantil escolar', 70),
    term('sapato criança', 25),
  ];

  it('ficam à parte, não entram na faixa e só valem para termos reais e ainda não apanhados', () => {
    const r = computeOffTarget(
      input({
        terms,
        ai: [
          { term: 'tênis infantil escolar', reason: 'Contraria "calçado infantil".', evidence: ['x2', 's1'] },
          { term: 'termo inexistente', reason: 'x', evidence: ['x1'] },
          { term: 'vaga de emprego vendedor', reason: 'já vem da regra', evidence: ['x1'] },
          { term: 'curso de corrida', reason: 'já é negativa', evidence: ['x1'] },
        ],
      }),
    );
    expect(r.toConfirm.items.map((i) => i.label)).toEqual(['tênis infantil escolar']);
    expect(r.toConfirm.cost).toBe(70);
    expect(r.floor).toBe(150);
    expect(r.ceiling).toBe(350);
  });
});

describe('termsForReview', () => {
  it('só termos que gastaram sem converter, sem regra nem negativa, do maior gasto ao menor', () => {
    const list = termsForReview([
      term('a', 10),
      term('b', 50),
      term('c', 99, { conversions: 2 }),
      term('d', 40, { category: 'UNQUALIFIED' }),
      term('e', 30, { alreadyNegative: true }),
      term('f', 20, { category: 'BRAND' }),
      term('g', 0),
      term('h', 5, { category: 'COMPETITOR' }),
    ]);
    expect(list.map((t) => t.term)).toEqual(['b', 'a', 'h']);
  });

  it('respeita o limite', () => {
    const many = Array.from({ length: 60 }, (_, i) => term(`t${i}`, i + 1));
    expect(termsForReview(many)).toHaveLength(40);
  });
});
