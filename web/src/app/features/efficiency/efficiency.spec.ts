import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { EfficiencyPage } from './efficiency';
import { Insights } from '../../core/insights';
import { Workspace } from '../../core/workspace';
import { PageAudits } from '../../core/page-audits';
import { defaultGoal } from '../../domain/config';
import { EfficiencyRows, MediaScope } from '../../domain/efficiency';
import { WasteRow } from '../../domain/models';

const empty = (): EfficiencyRows => ({
  campaign: [],
  placement: [],
  ad: [],
  page: [],
  term: [],
  keyword: [],
  hour: [],
  device: [],
  region: [],
});
const unknown: WasteRow = {
  dimension: 'campaign',
  key: 'display',
  label: 'Display de teste',
  perf: { cost: 200, clicks: 100, impressions: 1000, conversions: 0 },
  outcomes: 0,
  outcomesKnown: false,
  monthlyCost: 200,
  assessment: {
    verdict: 'INSUFFICIENT_DATA',
    reason: 'NO_GOAL_DATA',
    confidence: { level: 'LOW', reasons: ['Sem qualificação vinculada.'] },
    signals: [],
    evidence: [{ kind: 'UNAVAILABLE', source: 'CRM', text: 'O resultado não foi informado.' }],
  },
};
const dataset = <T>(value: T) => ({
  value: signal(value),
  loading: signal(false),
  error: signal<string | null>(null),
});

describe('Eficiência da mídia — compreensão e filtros', () => {
  beforeEach(async () => {
    const ws = {
      campaigns: dataset([
        { id: 'display', name: 'Display de teste', channel: 'DISPLAY' },
        { id: 'search', name: 'Pesquisa de teste', channel: 'SEARCH' },
      ]),
      landingPages: dataset([]),
      ga4Pages: dataset({ status: { configured: false } }),
      gscPages: dataset({ status: { configured: false } }),
      placements: dataset([]),
      ads: dataset([]),
      searchTermsRaw: dataset([]),
      keywordMetrics: dataset([]),
      hours: dataset([]),
      regions: dataset([]),
      devices: dataset([]),
      anyLoading: signal(false),
      reloadAll: vi.fn(),
    };
    const insights = {
      needCore: vi.fn(),
      loadingCore: signal(false),
      coreError: signal(null),
      funnel: signal({}),
      goal: signal(defaultGoal()),
      maturity: signal(1),
      goalLagDays: signal(1),
      maturesOnDate: signal('2026-10-20'),
      goalIsAdsMeasured: signal(false),
      window: signal({ from: '2026-09-01', to: '2026-09-30', days: 30 }),
      efficiency: (scope: MediaScope) => ({
        ...empty(),
        campaign: scope === 'SEARCH' ? [] : [unknown],
      }),
    };
    await TestBed.configureTestingModule({
      imports: [EfficiencyPage],
      providers: [
        provideRouter([]),
        { provide: Workspace, useValue: ws },
        { provide: Insights, useValue: insights },
        {
          provide: PageAudits,
          useValue: {
            running: signal(new Set()),
            lastError: signal(null),
            get: () => undefined,
            auditMany: vi.fn(),
          },
        },
      ],
    }).compileComponents();
  });
  it('começa em Display e distingue resultado indisponível de zero', async () => {
    const f = TestBed.createComponent(EfficiencyPage);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector<HTMLSelectElement>('#efficiency-format')?.value).toBe('DISPLAY');
    expect(el.textContent).toContain('Não disponível');
    expect(el.textContent).toContain('Resultado desconhecido não significa zero');
    expect(el.textContent).toContain('01/09/2026 a 30/09/2026');
    expect(el.querySelectorAll('article')).toHaveLength(1);
    expect(el.textContent).not.toContain('Desperdício real');
  });
  it('restringe os recortes ao escopo e limpa a campanha ao mudar o formato', async () => {
    const f = TestBed.createComponent(EfficiencyPage);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const dimensions = el.querySelector<HTMLSelectElement>('#efficiency-dimension')!;
    expect([...dimensions.options].some((o) => o.value === 'region')).toBe(false);
    const campaign = el.querySelector<HTMLSelectElement>('#efficiency-campaign')!;
    campaign.value = 'display';
    campaign.dispatchEvent(new Event('change'));
    await f.whenStable();
    const format = el.querySelector<HTMLSelectElement>('#efficiency-format')!;
    format.value = 'SEARCH';
    format.dispatchEvent(new Event('change'));
    await f.whenStable();
    expect(campaign.value).toBe('');
    expect([...dimensions.options].some((o) => o.value === 'term')).toBe(true);
    expect([...campaign.options].some((o) => o.value === 'display')).toBe(false);
    expect(el.textContent).toContain('Não há itens disponíveis neste recorte');
  });
  it('oferece recuperação quando a busca não encontra itens', async () => {
    const f = TestBed.createComponent(EfficiencyPage);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const search = el.querySelector<HTMLInputElement>('#efficiency-search')!;
    search.value = 'ausente';
    search.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(el.textContent).toContain('Nenhum item corresponde aos filtros');
    const clear = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Limpar filtros'),
    )!;
    clear.click();
    await f.whenStable();
    expect(search.value).toBe('');
    expect(el.querySelectorAll('article')).toHaveLength(1);
  });
});
