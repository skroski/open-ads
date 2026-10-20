import { defaultGoal } from './config';
import { AssessContext, GroupOptions } from './waste';
import { RegionRow, SearchTermRow } from './models';
import { WasteEnv, WasteInputs, wasteDevices, wasteHours, wastePages, wasteRegions, wasteTerms } from './waste-dimensions';

const context: AssessContext = {
  thresholds: { zeroResultAlpha: 0.1, minClicks: 8, aboveTargetFactor: 1.5 },
  goal: defaultGoal(),
  windowDays: 30,
};

const env: WasteEnv = {
  context,
  adsMeasured: true,
  outcomesOf: () => null,
  options: (dimension, groupLabel, extra = {}): GroupOptions => ({
    dimension,
    groupLabel,
    maturity: 1,
    costTarget: 20,
    costTargetIsAverage: false,
    ...extra,
  }),
};

const inputs = (over: Partial<WasteInputs> = {}): WasteInputs => ({
  funnel: null,
  campaigns: [],
  campaignMaturity: new Map(),
  campaignNames: new Map(),
  channelNames: new Map(),
  terms: [],
  keywords: [],
  regions: [],
  devices: [],
  hours: [],
  landingPages: [],
  ads: [],
  placements: [],
  ga4Rows: null,
  brand: [],
  adsByGroup: new Map(),
  crmByTerm: { available: false, map: new Map() },
  auditOf: () => undefined,
  serviceArea: { regionIds: [], regionNames: {} },
  serviceHours: null,
  ...over,
});

/** Textos que a linha mostra como motivo: sinais e evidências. */
const texts = (row?: { assessment: { signals: string[]; evidence: { text: string }[] } }): string[] => [
  ...(row?.assessment.signals ?? []),
  ...(row?.assessment.evidence.map((e) => e.text) ?? []),
];

const perf = (clicks: number, cost: number, conversions: number) => ({ impressions: clicks * 10, clicks, cost, conversions });

describe('wasteDevices', () => {
  it('uma linha por dispositivo, com rótulo em português', () => {
    const rows = wasteDevices(
      inputs({
        devices: [
          { device: 'MOBILE', ...perf(100, 200, 10) },
          { device: 'DESKTOP', ...perf(100, 200, 10) },
        ],
      }),
      env,
    );
    expect(rows.map((r) => r.label).sort()).toEqual(['Celular', 'Computador']);
    expect(rows.every((r) => r.dimension === 'device')).toBe(true);
  });
});

describe('wastePages — limites do cruzamento com Analytics', () => {
  const page = { ...perf(200, 200, 0), url: 'https://exemplo.com/oferta', normalizedUrl: 'exemplo.com/oferta', campaignId: '1', campaignName: 'Display' };
  it('uma página ausente do relatório do GA4 não vira zero sessões nem falha de rastreamento', () => {
    const rows = wastePages(inputs({ landingPages: [page], ga4Rows: [{ path: '/outro', sessions: 100, engagedSessions: 30, keyEvents: 4, avgEngagementSec: 10 }] }), env);
    expect(rows[0].assessment.verdict).not.toBe('TRACKING_FAILURE');
    expect(rows[0].assessment.evidence.some((e) => e.source === 'GA4' && e.kind === 'UNAVAILABLE')).toBe(true);
  });
  it('mostra engajamento como contexto de todas as origens, sem confirmar desperdício de mídia', () => {
    const rows = wastePages(inputs({ landingPages: [page], ga4Rows: [{ path: '/oferta', sessions: 100, engagedSessions: 5, keyEvents: 0, avgEngagementSec: 2 }] }), env);
    expect(rows[0].assessment.evidence.some((e) => e.source === 'GA4' && e.kind === 'FACT' && e.text.includes('todas as origens'))).toBe(true);
    expect(rows[0].assessment.evidence.some((e) => e.source === 'GA4' && e.kind === 'HYPOTHESIS')).toBe(true);
    expect(rows[0].assessment.verdict).not.toBe('PROBABLE_WASTE');
  });
});

describe('wasteRegions', () => {
  const region = (regionId: string, regionName: string, clicks: number, cost: number): RegionRow => ({
    regionId,
    regionName,
    locationType: 'LOCATION_OF_PRESENCE',
    ...perf(clicks, cost, 0),
  });

  it('com área de atendimento configurada, região de fora com gasto é desperdício provável', () => {
    const rows = wasteRegions(
      inputs({
        regions: [region('1', 'São Paulo', 80, 160), region('2', 'Manaus', 40, 90)],
        serviceArea: { regionIds: ['1'], regionNames: { '1': 'São Paulo' } },
      }),
      env,
    );
    const manaus = rows.find((r) => r.key === '2');
    expect(manaus?.assessment.verdict).toBe('PROBABLE_WASTE');
    expect(rows.find((r) => r.key === '1')?.assessment.verdict).not.toBe('PROBABLE_WASTE');
  });

  it('sem área configurada, nenhuma região é condenada só por localização', () => {
    const rows = wasteRegions(inputs({ regions: [region('2', 'Manaus', 40, 90)] }), env);
    expect(rows[0].assessment.verdict).not.toBe('PROBABLE_WASTE');
  });

  it('soma linhas repetidas da mesma região', () => {
    const rows = wasteRegions(inputs({ regions: [region('1', 'SP', 10, 20), region('1', 'SP', 5, 10)] }), env);
    expect(rows).toHaveLength(1);
    expect(rows[0].perf).toMatchObject({ clicks: 15, cost: 30 });
  });
});

describe('wasteHours', () => {
  it('gera linhas por hora e por dia e marca o que está fora do horário de atendimento', () => {
    const hours = [
      { weekday: 1, hour: 3, campaignId: '1', ...perf(30, 60, 0) },
      { weekday: 1, hour: 10, campaignId: '1', ...perf(30, 60, 3) },
      { weekday: 7, hour: 10, campaignId: '1', ...perf(30, 60, 3) },
    ];
    const rows = wasteHours(
      inputs({ hours, serviceHours: { weekdays: [1, 2, 3, 4, 5], startHour: 8, endHour: 18 } }),
      env,
    );
    expect(rows.map((r) => r.key)).toEqual(expect.arrayContaining(['h:3', 'h:10', 'd:1', 'd:7']));
    const night = rows.find((r) => r.key === 'h:3');
    expect(texts(night).some((s) => s.includes('Fora do horário de atendimento'))).toBe(true);
    const day = rows.find((r) => r.key === 'h:10');
    expect(texts(day).some((s) => s.includes('Fora do horário'))).toBe(false);
    expect(texts(rows.find((r) => r.key === 'd:7')).some((s) => s.includes('Fora do horário'))).toBe(true);
  });
});

describe('wasteTerms', () => {
  const term = (over: Partial<SearchTermRow>): SearchTermRow => ({
    term: 'implante dentário',
    campaignId: '1',
    campaignName: 'Pesquisa',
    adGroupId: '10',
    adGroupName: 'G',
    excluded: false,
    alreadyNegative: false,
    category: 'GENERAL',
    categoryReason: '',
    ...perf(40, 100, 0),
    ...over,
  });

  it('termo já negativado e sem resultado conta como desperdício bloqueado', () => {
    const rows = wasteTerms(inputs({ terms: [term({ alreadyNegative: true })] }), env);
    expect(rows[0].blocked).toBe(true);
    expect(rows[0].assessment.verdict).toBe('PROBABLE_WASTE');
  });

  it('termo negativado que converteu avisa para revisar a negativa', () => {
    const rows = wasteTerms(inputs({ terms: [term({ alreadyNegative: true, conversions: 3 })] }), env);
    expect(rows[0].blocked).toBe(true);
    expect(texts(rows[0]).some((s) => s.includes('pode estar bloqueando'))).toBe(true);
  });

  it('ignora termos sem cliques e sem custo', () => {
    const rows = wasteTerms(inputs({ terms: [term({ ...perf(0, 0, 0) })] }), env);
    expect(rows).toHaveLength(0);
  });

  it('termo da lista "sem intenção de compra" leva o motivo como fato', () => {
    const rows = wasteTerms(
      inputs({ terms: [term({ category: 'UNQUALIFIED', categoryReason: 'Busca por emprego.' })] }),
      env,
    );
    expect(texts(rows[0]).includes('Busca por emprego.')).toBe(true);
  });
});
