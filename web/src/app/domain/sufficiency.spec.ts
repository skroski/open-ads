import { describeShortfall, evaluateSufficiency, summarizeHistory } from './sufficiency';
import { addDays } from './dates';
import { DailyRow } from './models';

const END = '2026-10-24';

function day(offset: number, p: Partial<DailyRow> = {}): DailyRow {
  return {
    date: addDays(END, -offset),
    campaignId: '1',
    campaignName: 'Camp',
    impressions: 100,
    clicks: 5,
    cost: 10,
    conversions: 0,
    ...p,
  };
}

const series = (n: number, p: Partial<DailyRow> = {}): DailyRow[] => Array.from({ length: n }, (_, i) => day(i, p));

describe('summarizeHistory', () => {
  it('conta só dias com impressões dentro da janela e ignora o resto', () => {
    const rows = [...series(10), day(5, { campaignId: '2', impressions: 50 }), day(3, { impressions: 0, clicks: 0 }), day(200)];
    const h = summarizeHistory(rows, END);
    // 10 dias distintos: a linha extra do dia 5 não cria dia novo, a sem impressões não apaga o dia 3
    // e o dia 200 fica fora da janela.
    expect(h.activeDays).toBe(10);
    expect(h.clicks).toBe(10 * 5 + 5 + 0);
    expect(summarizeHistory([day(3, { impressions: 0, clicks: 0 })], END).activeDays).toBe(0);
  });

  it('calcula o ritmo dos últimos 14 dias', () => {
    const h = summarizeHistory(series(40, { clicks: 14, conversions: 7 }), END);
    expect(h.recentClicksPerDay).toBe(14);
    expect(h.recentConversionsPerDay).toBe(7);
  });
});

describe('evaluateSufficiency', () => {
  it('conta nova: falta histórico e cliques, e o prazo vem do ritmo atual', () => {
    const h = summarizeHistory(series(10, { clicks: 5 }), END);
    const r = evaluateSufficiency('FORECAST_VOLUME', h);
    expect(r.status).toBe('insufficient');
    if (r.status !== 'insufficient') return;
    expect(r.missing.activeDays).toBe(32);
    expect(r.missing.clicks).toBe(50);
    // 32 dias de histórico mandam mais que 50 cliques a 5/dia (10 dias)
    expect(r.etaDays).toBe(32);
  });

  it('prazo nulo quando não há ritmo recente para o que falta', () => {
    const h = summarizeHistory(series(60, { clicks: 1, conversions: 0 }).filter((r) => r.date < addDays(END, -20)), END);
    const r = evaluateSufficiency('FORECAST_CONVERSIONS', h);
    expect(r.status).toBe('insufficient');
    if (r.status !== 'insufficient') return;
    expect(r.etaDays).toBeNull();
  });

  it('pronto: informa quantas vezes o mínimo foi atingido', () => {
    const h = summarizeHistory(series(90, { clicks: 10, conversions: 1 }), END);
    const r = evaluateSufficiency('FORECAST_CONVERSIONS', h);
    // janela cheia (90 dias) conta como folga total; o limitante são as 90 conversões ÷ 30 exigidas
    expect(r).toEqual({ status: 'ready', ratio: 3 });
  });

  it('bloqueia recursos de conversão quando o rastreamento falhou, mas não o de volume', () => {
    const h = summarizeHistory(series(90, { clicks: 10, conversions: 1 }), END);
    expect(evaluateSufficiency('FORECAST_CONVERSIONS', h, { trackingBroken: true }).status).toBe('blocked');
    expect(evaluateSufficiency('RATE_ESTIMATE', h, { trackingBroken: true }).status).toBe('blocked');
    expect(evaluateSufficiency('FORECAST_VOLUME', h, { trackingBroken: true }).status).toBe('ready');
  });

  it('aceita uma regra própria', () => {
    const h = summarizeHistory(series(5), END);
    const rule = { minActiveDays: 5, minClicks: 10, minConversions: 0 };
    expect(evaluateSufficiency('FORECAST_VOLUME', h, { rule }).status).toBe('ready');
  });
});

describe('describeShortfall', () => {
  it('escreve o que falta e o prazo em linguagem simples', () => {
    const h = summarizeHistory(series(90, { clicks: 10, conversions: 0 }).map((r, i) => (i < 18 ? { ...r, conversions: 1 } : r)), END);
    const r = evaluateSufficiency('FORECAST_CONVERSIONS', h);
    expect(describeShortfall(r)).toBe('Faltam 12 conversões. No ritmo atual, cerca de 12 dias.');
  });

  it('avisa quando não dá para estimar o prazo', () => {
    expect(describeShortfall({ status: 'insufficient', missing: { activeDays: 1, clicks: 0, conversions: 0 }, etaDays: null })).toBe(
      'Faltam 1 dia de histórico. Sem ritmo recente para estimar o prazo.',
    );
  });
});
