import { defaultBusinessConfig } from './config';
import { SuggestInput, Suggestion, applySuggestions, suggestParameters } from './config-suggest';
import { AdRow, ConversionActionInfo, ConversionBreakdownRow, HourRow, RegionRow } from './models';

const action = (name: string, category = 'DEFAULT', extra: Partial<ConversionActionInfo> = {}): ConversionActionInfo => ({
  id: name,
  name,
  category,
  type: 'WEBPAGE',
  status: 'ENABLED',
  primary: true,
  includeInConversions: true,
  countingType: 'ONE_PER_CLICK',
  ...extra,
});

const breakdown = (actionName: string, conversions: number): ConversionBreakdownRow => ({
  campaignId: '1',
  actionName,
  category: 'DEFAULT',
  conversions,
  allConversions: conversions,
  value: 0,
});

const region = (regionId: string, regionName: string, conversions: number): RegionRow => ({
  regionId,
  regionName,
  locationType: 'LOCATION_OF_PRESENCE',
  impressions: 1000,
  clicks: 50,
  cost: 100,
  conversions,
});

const hour = (weekday: number, h: number, conversions: number): HourRow => ({
  weekday,
  hour: h,
  campaignId: '1',
  impressions: 100,
  clicks: 10,
  cost: 10,
  conversions,
});

const ad = (finalUrls: string[], clicks: number): AdRow => ({
  adId: String(Math.random()),
  type: 'RSA',
  status: 'ENABLED',
  finalUrls,
  headlines: [],
  descriptions: [],
  campaignId: '1',
  campaignName: 'C',
  adGroupId: '1',
  adGroupName: 'G',
  impressions: 1000,
  clicks,
  cost: 50,
  conversions: 0,
});

/** Conta com volume: 600 cliques, 60 conversões e R$ 1.800 em 30 dias. */
function rich(over: Partial<SuggestInput> = {}): SuggestInput {
  return {
    config: defaultBusinessConfig(),
    windowDays: 30,
    totals: { impressions: 20000, clicks: 600, cost: 1800, conversions: 60 },
    conversionActions: [action('Formulário enviado', 'SUBMIT_LEAD_FORM'), action('Clique no WhatsApp', 'DEFAULT')],
    conversionBreakdown: [breakdown('Formulário enviado', 40), breakdown('Clique no WhatsApp', 20)],
    regions: [region('1001', 'Curitiba', 40), region('1002', 'Pinhais', 12), region('1003', 'Rio de Janeiro', 0)],
    campaignLocations: [
      { campaignId: '1', regionId: '1001', negative: false },
      { campaignId: '1', regionId: '1002', negative: false },
      { campaignId: '1', regionId: '1004', negative: false },
      { campaignId: '1', regionId: '1003', negative: true },
    ],
    hours: [
      ...[8, 9, 10, 11, 14, 15, 16, 17].flatMap((h) => [1, 2, 3, 4, 5].map((d) => hour(d, h, 1.5))),
      hour(6, 10, 0.5),
    ],
    ads: [ad(['https://www.exemplo.com.br/lp'], 400), ad(['https://exemplo.com.br/outra', 'https://pagina.io/x'], 100)],
    trackingBroken: false,
    ...over,
  };
}

const byKey = (list: Suggestion[], key: string): Suggestion => {
  const s = list.find((x) => x.key === key);
  if (!s) throw new Error(`sem sugestão ${key}`);
  return s;
};

describe('suggestParameters — conta com dados', () => {
  const list = suggestParameters(rich());

  it('mapeia conversões pelo nome e pela categoria', () => {
    const s = byKey(list, 'mapping');
    expect(s.status).toBe('ready');
    const applied = s.apply!(defaultBusinessConfig());
    expect(applied.mapping).toEqual({ 'Formulário enviado': 'CONTACT', 'Clique no WhatsApp': 'INTERACTION' });
    expect(applied.paramStatus.mapping).toBe('CONFIRMED');
  });

  it('escolhe como meta a etapa mais avançada com volume e calcula o custo de partida', () => {
    const goal = byKey(list, 'goalStage');
    expect(goal.status).toBe('ready');
    expect(goal.summary).toBe('Contato iniciado');
    expect(goal.provenance?.source).toBe('GOOGLE_ADS');
    // 40 formulários no período; R$ 1.800 ÷ 40 = R$ 45,00
    const cost = byKey(list, 'targetCostPerGoal');
    expect(cost.status).toBe('ready');
    expect(cost.summary).toBe('R$ 45,00');
  });

  it('região: só o que é segmentado e converteu; o resto vira dúvida', () => {
    const s = byKey(list, 'serviceArea');
    expect(s.status).toBe('ready');
    const applied = s.apply!(defaultBusinessConfig());
    expect(applied.serviceArea.regionIds.sort()).toEqual(['1001', '1002']);
    expect(applied.serviceArea.regionNames['1001']).toBe('Curitiba');
    expect(s.doubts?.join(' ')).toContain('região 1004');
  });

  it('horário: faixa que concentra as conversões', () => {
    const s = byKey(list, 'serviceHours');
    expect(s.status).toBe('ready');
    const applied = s.apply!(defaultBusinessConfig());
    expect(applied.serviceHours).toEqual({ startHour: 8, endHour: 18, weekdays: [1, 2, 3, 4, 5] });
  });

  it('mínimo de cliques vem da taxa de conversão', () => {
    const s = byKey(list, 'minClicks');
    // 60/600 = 10% → 3 ÷ 0,1 = 30 cliques
    expect(s.status).toBe('ready');
    expect(s.apply!(defaultBusinessConfig()).thresholds.minClicks).toBe(30);
  });

  it('domínios: sem "www.", do mais clicado ao menos', () => {
    const s = byKey(list, 'domains');
    expect(s.apply!(defaultBusinessConfig()).domains).toEqual(['exemplo.com.br', 'pagina.io']);
  });

  it('margem, CAC e ROI nunca são estimados', () => {
    const s = byKey(list, 'economics');
    expect(s.status).toBe('needs_user');
    expect(s.apply).toBeUndefined();
  });

  it('aplicar tudo grava os estados como confirmados', () => {
    const cfg = applySuggestions(defaultBusinessConfig(), list);
    expect(Object.keys(cfg.paramStatus).sort()).toEqual(
      ['domains', 'goalStage', 'mapping', 'minClicks', 'serviceArea', 'serviceHours', 'targetCostPerGoal'].sort(),
    );
    expect(cfg.goal.targetCostPerGoal).toBe(45);
  });
});

describe('suggestParameters — conta nova', () => {
  const list = suggestParameters(
    rich({
      totals: { impressions: 800, clicks: 40, cost: 120, conversions: 4 },
      conversionBreakdown: [breakdown('Formulário enviado', 4)],
    }),
  );

  it('sem volume, diz o que falta e o prazo em vez de sugerir', () => {
    const goal = byKey(list, 'goalStage');
    expect(goal.status).toBe('insufficient');
    expect(goal.reason).toContain('Faltam 26 conversões');
    expect(goal.etaDays).toBe(Math.ceil(26 / (4 / 30)));
    expect(byKey(list, 'targetCostPerGoal').status).toBe('insufficient');
    expect(byKey(list, 'serviceArea').status).toBe('insufficient');
    expect(byKey(list, 'serviceHours').status).toBe('insufficient');
    expect(byKey(list, 'minClicks').status).toBe('insufficient');
  });

  it('o que não depende de volume continua sugerido', () => {
    expect(byKey(list, 'mapping').status).toBe('ready');
    expect(byKey(list, 'domains').status).toBe('ready');
  });
});

describe('suggestParameters — rastreamento quebrado', () => {
  it('bloqueia tudo que depende de conversão', () => {
    const list = suggestParameters(rich({ trackingBroken: true }));
    for (const k of ['goalStage', 'targetCostPerGoal', 'serviceArea', 'serviceHours', 'minClicks']) {
      expect(byKey(list, k).status).toBe('blocked');
    }
  });
});

describe('suggestParameters — o que a pessoa decidiu nunca é sobrescrito', () => {
  it('valor antigo fora do padrão conta como manual', () => {
    const config = defaultBusinessConfig();
    config.goal.targetCostPerGoal = 80;
    config.serviceHours = { startHour: 9, endHour: 17, weekdays: [1, 2, 3, 4, 5] };
    config.thresholds.minClicks = 20;
    config.domains = ['meusite.com'];
    const list = suggestParameters(rich({ config }));
    for (const k of ['targetCostPerGoal', 'serviceHours', 'minClicks', 'domains']) {
      expect(byKey(list, k).status).toBe('locked');
      expect(byKey(list, k).lockedState).toBe('MANUAL');
    }
    expect(applySuggestions(config, list).goal.targetCostPerGoal).toBe(80);
  });

  it('confirmado fica travado mesmo com o valor igual ao padrão', () => {
    const config = defaultBusinessConfig();
    config.paramStatus = { goalStage: 'CONFIRMED' };
    const s = byKey(suggestParameters(rich({ config })), 'goalStage');
    expect(s.status).toBe('locked');
    expect(s.lockedState).toBe('CONFIRMED');
  });

  it('mapeamento só acrescenta ações sem etapa, sem mexer nas já mapeadas', () => {
    const config = defaultBusinessConfig();
    config.mapping = { 'Formulário enviado': 'QUALIFIED' };
    const s = byKey(suggestParameters(rich({ config })), 'mapping');
    const applied = s.apply!(config);
    expect(applied.mapping['Formulário enviado']).toBe('QUALIFIED');
    expect(applied.mapping['Clique no WhatsApp']).toBe('INTERACTION');
  });
});

describe('suggestParameters — nomes ambíguos', () => {
  it('não chuta a etapa: separa para a pessoa (ou a IA) decidir', () => {
    const input = rich({ conversionActions: [action('Evento 7'), action('Outro evento')] });
    const s = byKey(suggestParameters(input), 'mapping');
    expect(s.status).toBe('needs_user');
    expect(s.ambiguous).toEqual(['Evento 7', 'Outro evento']);
    expect(s.apply).toBeUndefined();
  });

  it('com parte classificada, propõe essa parte e avisa das ambíguas', () => {
    const input = rich({ conversionActions: [action('Compra no site', 'PURCHASE'), action('Evento 7')] });
    const s = byKey(suggestParameters(input), 'mapping');
    expect(s.status).toBe('ready');
    expect(s.ambiguous).toEqual(['Evento 7']);
    expect(s.apply!(defaultBusinessConfig()).mapping).toEqual({ 'Compra no site': 'SALE' });
  });

  it('ações pausadas ou fora de "conversões" são ignoradas', () => {
    const input = rich({
      conversionActions: [
        action('Compra no site', 'PURCHASE'),
        action('Antiga', 'PURCHASE', { status: 'REMOVED' }),
        action('Secundária', 'PURCHASE', { includeInConversions: false }),
      ],
    });
    const s = byKey(suggestParameters(input), 'mapping');
    expect(s.apply!(defaultBusinessConfig()).mapping).toEqual({ 'Compra no site': 'SALE' });
  });
});

describe('suggestParameters — horário sem padrão', () => {
  it('conversões o dia todo pedem a decisão da pessoa', () => {
    const hours = Array.from({ length: 24 }, (_, h) => hour(1, h, 2));
    const s = byKey(suggestParameters(rich({ hours })), 'serviceHours');
    expect(s.status).toBe('needs_user');
  });
});
