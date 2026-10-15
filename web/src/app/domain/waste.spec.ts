import { defaultGoal } from './config';
import { AssessContext, AssessInput, assess, assessGroup, categoryTotals, costReference, summarize } from './waste';
import { detectConversionOutages } from './tracking';
import { addDays } from './dates';
import { DailyRow } from './models';

const ctx: AssessContext = {
  thresholds: { zeroResultAlpha: 0.1, minClicks: 8, aboveTargetFactor: 1.5 },
  goal: defaultGoal(),
  windowDays: 30,
};

const base: AssessInput = {
  clicks: 60,
  cost: 120,
  outcomes: 0,
  baselineRate: 0.1,
  baselineLabel: 'mesma campanha',
  baselineClicks: 200,
  costTarget: 15,
  costTargetIsAverage: false,
  maturity: 1,
  signals: [],
  trackingIssues: [],
};

describe('assess — veredito de uma linha', () => {
  it('regra do negócio (fora da área) é desperdício provável mesmo com contatos', () => {
    const a = assess({ ...base, outcomes: 3, forcedWaste: 'Região fora da área atendida.' }, ctx);
    expect(a.verdict).toBe('PROBABLE_WASTE');
    expect(a.confidence.level).toBe('HIGH');
  });

  it('indício de falha de medição vence qualquer conclusão de desempenho', () => {
    const a = assess({ ...base, trackingIssues: ['A página não carrega.'] }, ctx);
    expect(a.verdict).toBe('TRACKING_FAILURE');
  });

  it('poucos cliques = falta de dados, mesmo sem resultado', () => {
    const a = assess({ ...base, clicks: 5 }, ctx);
    expect(a.verdict).toBe('INSUFFICIENT_DATA');
    expect(a.reason).toBe('LOW_VOLUME');
  });

  it('resultado desconhecido para a linha = falta de dados', () => {
    const a = assess({ ...base, outcomes: null }, ctx);
    expect(a.reason).toBe('NO_GOAL_DATA');
  });

  it('período ainda imaturo não vira desperdício', () => {
    const a = assess({ ...base, maturity: 0.2, signals: [{ text: 'x', kind: 'FACT' }] }, ctx);
    expect(a.verdict).toBe('INSUFFICIENT_DATA');
    expect(a.reason).toBe('IMMATURE');
  });

  it('sem taxa de referência não dá para julgar', () => {
    const a = assess({ ...base, baselineRate: null }, ctx);
    expect(a.reason).toBe('NO_GOAL_DATA');
  });

  it('zero resultado com chance alta de ser acaso = falta de dados, com a chance explicada', () => {
    const a = assess({ ...base, clicks: 10, baselineRate: 0.1 }, ctx);
    expect(a.verdict).toBe('INSUFFICIENT_DATA');
    expect(a.chanceByLuck).toBeCloseTo(0.9 ** 10, 5);
    expect(a.evidence.some((e) => e.text.includes('por acaso'))).toBe(true);
  });

  it('chance baixa sem segundo sinal = não confirmado (falta de dados)', () => {
    const a = assess({ ...base, clicks: 60, baselineRate: 0.1 }, ctx);
    expect(a.verdict).toBe('INSUFFICIENT_DATA');
    expect(a.reason).toBe('UNCONFIRMED');
  });

  it('chance baixa + um sinal independente = desperdício provável (confiança média)', () => {
    const a = assess(
      { ...base, clicks: 40, baselineRate: 0.1, signals: [{ text: 'Termo da lista de desqualificados.', kind: 'FACT' }] },
      ctx,
    );
    expect(a.verdict).toBe('PROBABLE_WASTE');
    expect(a.confidence.level).toBe('MEDIUM');
  });

  it('chance muito baixa + dois sinais + período maduro = confiança alta', () => {
    const a = assess(
      {
        ...base,
        clicks: 120,
        baselineRate: 0.1,
        signals: [
          { text: 'Termo desqualificado.', kind: 'FACT' },
          { text: 'Intenção de emprego.', kind: 'HYPOTHESIS' },
        ],
      },
      ctx,
    );
    expect(a.verdict).toBe('PROBABLE_WASTE');
    expect(a.confidence.level).toBe('HIGH');
  });

  it('com resultado e sem meta nem média, pede configuração', () => {
    const a = assess({ ...base, outcomes: 4, costTarget: null }, ctx);
    expect(a.reason).toBe('NO_CONFIG');
  });

  it('custo por resultado dentro da meta = dentro da meta', () => {
    const a = assess({ ...base, outcomes: 8, cost: 100 }, ctx); // R$ 12,50 vs meta 15
    expect(a.verdict).toBe('PERFORMING');
  });

  it('custo por resultado muito acima da meta = acima da meta, com confiança pelo nº de resultados', () => {
    const a = assess({ ...base, outcomes: 12, cost: 600 }, ctx); // R$ 50 vs 15*1,5
    expect(a.verdict).toBe('ABOVE_TARGET');
    expect(a.confidence.level).toBe('HIGH');
    const few = assess({ ...base, outcomes: 2, cost: 100 }, ctx);
    expect(few.verdict).toBe('ABOVE_TARGET');
    expect(few.confidence.level).toBe('LOW');
  });

  it('acima da meta mas imaturo = não recomenda cortar ainda', () => {
    const a = assess({ ...base, outcomes: 12, cost: 600, maturity: 0.3 }, ctx);
    expect(a.verdict).toBe('INSUFFICIENT_DATA');
    expect(a.reason).toBe('IMMATURE');
  });

  it('quando a meta é a média da conta, a evidência diz isso', () => {
    const a = assess({ ...base, outcomes: 12, cost: 600, costTarget: 12, costTargetIsAverage: true }, ctx);
    expect(a.evidence.some((e) => e.text.includes('média da conta'))).toBe(true);
  });
});

describe('assessGroup — referência sem a própria linha', () => {
  const item = (key: string, clicks: number, outcomes: number, parentKey?: string) => ({
    key,
    label: key,
    perf: { impressions: clicks * 10, clicks, cost: clicks * 2, conversions: outcomes },
    outcomes,
    parentKey,
  });

  const opts = {
    dimension: 'term' as const,
    groupLabel: 'todos os termos',
    parentLabel: 'mesma campanha',
    maturity: 1,
    costTarget: 15,
    costTargetIsAverage: false,
  };

  it('usa a taxa dos demais termos da mesma campanha como referência', () => {
    const rows = assessGroup(
      [item('a', 60, 0, 'c1'), item('b', 200, 40, 'c1'), item('c', 200, 2, 'c2')],
      ctx,
      opts,
    );
    const a = rows.find((r) => r.key === 'a');
    // Referência: 40/200 = 20%. 0 resultado em 60 cliques: (0,8)^60 ≈ 0,0000015.
    expect(a?.assessment.chanceByLuck).toBeLessThan(0.001);
  });

  it('referência com menos de 30 cliques não vale', () => {
    const rows = assessGroup([item('a', 60, 0, 'c1'), item('b', 10, 5, 'c1')], ctx, opts);
    const a = rows.find((r) => r.key === 'a');
    expect(a?.assessment.verdict).toBe('INSUFFICIENT_DATA');
    expect(a?.assessment.reason).toBe('NO_GOAL_DATA');
  });

  it('linha fora da referência (termo negativado) não muda o veredito dos demais', () => {
    const withNeg = assessGroup(
      [
        item('a', 60, 0, 'c1'),
        item('b', 200, 40, 'c1'),
        { ...item('neg', 400, 0, 'c1'), excludeFromBaseline: true, forcedWaste: 'Termo hoje negativado.' },
      ],
      ctx,
      opts,
    );
    const without = assessGroup([item('a', 60, 0, 'c1'), item('b', 200, 40, 'c1')], ctx, opts);
    const a1 = withNeg.find((r) => r.key === 'a');
    const a2 = without.find((r) => r.key === 'a');
    expect(a1?.assessment.chanceByLuck).toBeCloseTo(a2?.assessment.chanceByLuck ?? -1, 10);
    const neg = withNeg.find((r) => r.key === 'neg');
    expect(neg?.assessment.verdict).toBe('PROBABLE_WASTE');
    expect(neg?.blocked).toBeUndefined();
  });

  it('linha já bloqueada mantém o custo do período, mas não projeta gasto mensal', () => {
    const rows = assessGroup(
      [{ ...item('neg', 40, 0, 'c1'), excludeFromBaseline: true, blocked: true, forcedWaste: 'Termo hoje negativado.' }],
      ctx,
      opts,
    );
    expect(rows[0].blocked).toBe(true);
    expect(rows[0].perf.cost).toBe(80);
    expect(rows[0].monthlyCost).toBe(0);
  });

  it('o custo mensalizado considera o tamanho da janela', () => {
    const rows = assessGroup([item('a', 60, 0)], { ...ctx, windowDays: 15 }, opts);
    expect(rows[0].monthlyCost).toBeCloseTo(120 * 2, 5); // R$ 120 em 15 dias → R$ 240/mês
  });

  it('resumo por veredito soma o custo de cada grupo', () => {
    const rows = assessGroup([item('a', 5, 0), item('b', 200, 40)], ctx, opts);
    const s = summarize(rows);
    expect(s.INSUFFICIENT_DATA.rows + s.PERFORMING.rows + s.ABOVE_TARGET.rows).toBe(2);
  });
});

describe('categoryTotals', () => {
  it('separa o custo de uma dimensão em desperdício real, dentro da meta e o resto, com a fração de cada um', () => {
    const rows = assessGroup(
      [
        { key: 'neg', label: 'neg', perf: { impressions: 0, clicks: 10, cost: 30, conversions: 0 }, outcomes: 0, blocked: true, excludeFromBaseline: true, forcedWaste: 'Bloqueado.' },
        { key: 'ok', label: 'ok', perf: { impressions: 0, clicks: 200, cost: 70, conversions: 20 }, outcomes: 20 },
      ],
      ctx,
      { dimension: 'term', groupLabel: 'todos', maturity: 1, costTarget: 15, costTargetIsAverage: false },
    );
    const t = categoryTotals(rows);
    expect(t.WASTE.cost).toBe(30);
    expect(t.WASTE.share).toBeCloseTo(0.3, 5);
    expect(t.GOOD.cost).toBe(70);
    expect(t.EXPENSIVE.rows).toBe(0);
  });
});

describe('costReference', () => {
  it('prefere a meta configurada; senão usa a média da conta', () => {
    expect(costReference({ ...defaultGoal(), targetCostPerGoal: 20 }, 400, 10)).toEqual({ target: 20, isAverage: false });
    expect(costReference(defaultGoal(), 400, 10)).toEqual({ target: 40, isAverage: true });
    expect(costReference(defaultGoal(), 400, 0)).toEqual({ target: null, isAverage: false });
  });
});

describe('detectConversionOutages', () => {
  const series = (start: string, days: number, clicks: number, convFor: (i: number) => number, id = '1'): DailyRow[] =>
    Array.from({ length: days }, (_, i) => ({
      date: addDays(start, i),
      campaignId: id,
      campaignName: `Campanha ${id}`,
      impressions: clicks * 10,
      clicks,
      cost: clicks * 3,
      conversions: convFor(i),
    }));

  it('acusa dias seguidos sem conversão numa conta que costuma converter', () => {
    const rows = series('2026-08-01', 40, 20, (i) => (i < 30 ? 3 : 0));
    const out = detectConversionOutages(rows);
    const account = out.find((o) => o.scope === 'ACCOUNT');
    expect(account).toBeDefined();
    expect(account?.days).toBe(10);
    expect(account?.ongoing).toBe(true);
    expect(account?.chanceByLuck).toBeLessThan(0.01);
  });

  it('não acusa uma pausa curta quando a taxa histórica é baixa (Display)', () => {
    // 0,7% de conversão: 10 dias com 20 cliques cada sem converter é perfeitamente normal.
    const rows = series('2026-08-01', 40, 20, (i) => (i % 14 === 0 ? 1 : 0));
    const out = detectConversionOutages(rows, { minConversions: 2 });
    expect(out.filter((o) => o.days >= 10)).toHaveLength(0);
  });

  it('não acusa quando não há conversões suficientes para saber a taxa normal', () => {
    const rows = series('2026-08-01', 30, 20, () => 0);
    expect(detectConversionOutages(rows)).toHaveLength(0);
  });

  it('um dia sem linha no relatório interrompe a sequência', () => {
    const a = series('2026-08-01', 10, 20, (i) => (i < 4 ? 3 : 0));
    const b = series('2026-08-13', 10, 20, () => 0); // pulou 2 dias
    const out = detectConversionOutages([...a, ...b], { alpha: 0.05 });
    const account = out.filter((o) => o.scope === 'ACCOUNT');
    for (const f of account) expect(f.from >= '2026-08-13' || f.to <= '2026-08-10').toBe(true);
  });

  it('identifica a campanha afetada', () => {
    const healthy = series('2026-08-01', 40, 20, () => 3, 'ok');
    const broken = series('2026-08-01', 40, 20, (i) => (i < 25 ? 3 : 0), 'quebrada');
    const out = detectConversionOutages([...healthy, ...broken]);
    expect(out.some((o) => o.scope === 'CAMPAIGN' && o.campaignId === 'quebrada')).toBe(true);
    expect(out.some((o) => o.scope === 'CAMPAIGN' && o.campaignId === 'ok')).toBe(false);
  });
});
