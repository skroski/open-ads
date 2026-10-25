import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BatchNegatives } from '../../core/batch-negatives';
import { Insights } from '../../core/insights';
import { PageAudits } from '../../core/page-audits';
import { Workspace } from '../../core/workspace';
import { pct } from '../../domain/format';
import { CategoryTotal, WASTE_CATEGORIES, WasteCategory, categoryTotals, summarize, wasteCategory } from '../../domain/waste';
import { brl } from '../../domain/format';
import { Verdict, WasteDimension, WasteRow } from '../../domain/models';
import { ConfidenceBadge, VerdictBadge } from '../../shared/badges';
import { DataState } from '../../shared/data-state';
import { EvidenceList } from '../../shared/evidence-list';
import { HourHeatmap } from '../../shared/hour-heatmap';
import { Icon } from '../../shared/icon';
import { INSUFFICIENT_LABEL } from '../../shared/labels';
import { BarItem, BarList } from '../../shared/bar-list';
import { Diagnosis, DiagnosisTone } from '../../shared/diagnosis';
import { EChart } from '../../shared/echart';
import { BADGE_TONE, CATEGORY, CategoryInfo } from '../../shared/waste-category';
import { Kpi } from '../../shared/kpi';
import { OffTarget } from './off-target';
import { ExportData, PageHeader } from '../../shared/page-header';
import type { EChartsCoreOption } from 'echarts/core';

interface Tab {
  key: WasteDimension;
  label: string;
  hint: string;
}

const TABS: readonly Tab[] = [
  { key: 'campaign', label: 'Campanhas', hint: 'Cada campanha comparada com as do mesmo tipo.' },
  { key: 'term', label: 'Termos de busca', hint: 'O que as pessoas digitaram. Cada termo é comparado com os demais da mesma campanha.' },
  { key: 'keyword', label: 'Palavras-chave', hint: 'Palavras que você anuncia, com o desempenho do período.' },
  { key: 'ad', label: 'Anúncios', hint: 'Cada anúncio comparado com os da mesma campanha.' },
  { key: 'region', label: 'Regiões', hint: 'Onde estão os cliques. Regiões fora da área atendida são desperdício por definição.' },
  { key: 'device', label: 'Dispositivos', hint: 'Celular, computador e tablet.' },
  { key: 'hour', label: 'Horários', hint: 'Hora do dia e dia da semana, frente ao seu horário de atendimento.' },
  { key: 'page', label: 'Páginas de destino', hint: 'Para onde o clique vai. Leia a página para checar medição e botões de contato.' },
  { key: 'placement', label: 'Posicionamentos', hint: 'Onde o Display apareceu: sites, aplicativos e YouTube.' },
];

const ORDER: Record<Verdict, number> = {
  PROBABLE_WASTE: 0,
  TRACKING_FAILURE: 1,
  ABOVE_TARGET: 2,
  INSUFFICIENT_DATA: 3,
  PERFORMING: 4,
};

const PAGE_SIZE = 100;

/**
 * Linhas que somam o gasto do recorte sem repetir clique. Horários traz duas visões
 * do mesmo gasto (hora do dia e dia da semana): para totais, só a por hora.
 */
function forTotals(dimension: WasteDimension, rows: readonly WasteRow[]): WasteRow[] {
  return dimension === 'hour' ? rows.filter((r) => r.key.startsWith('h:')) : [...rows];
}

@Component({
  selector: 'app-waste-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    DecimalPipe,
    RouterLink,
    ConfidenceBadge,
    DataState,
    EvidenceList,
    HourHeatmap,
    BarList,
    Diagnosis,
    EChart,
    Icon,
    Kpi,
    OffTarget,
    PageHeader,
    VerdictBadge,
  ],
  template: `
    <app-page-header data-open-help="desperdicios-introducao"
      group="Inteligência"
      title="Desperdícios"
      subtitle="Veja quais gastos merecem revisão e quais trazem resultado. Cada análise mostra a evidência, a confiança e o que ainda falta saber."
      [exportData]="exportData()"
    />

    <div class="flex flex-col gap-block">
      @if (insights.maturity() < 0.5) {
        <div role="status" class="alert alert-info alert-soft">
          <app-icon name="clock" />
          <span class="text-sm">
            Só {{ pct(insights.maturity()) }} deste período teve tempo de gerar resultado final. Os vereditos de
            corte ficam cautelosos até {{ insights.maturesOnDate() }}.
          </span>
        </div>
      }

      <app-data-state
        [loading]="insights.loadingCore()"
        [error]="insights.coreError()"
        [hasData]="!!insights.funnel()"
        (retry)="ws.reloadAll()"
      >
        <app-off-target />

        <!-- Recorte e categoria -->
        <section class="card card-border bg-base-100" data-open-help="desperdicios-recorte">
          <div class="card-body gap-4">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <label class="flex flex-wrap items-center gap-2 text-sm">
                <span class="font-medium">Analisar por</span>
                <select class="select select-sm w-52" aria-label="Recorte da análise" [value]="dimension()" (change)="select(val($event))">
                  @for (t of tabs; track t.key) {
                    <option [value]="t.key">{{ t.label }}</option>
                  }
                </select>
              </label>
              <div class="filter" role="group" aria-label="Separar por categoria">
                <input class="btn btn-sm filter-reset" type="radio" name="waste-cat" aria-label="Todas" [checked]="category() === 'ALL'" (change)="category.set('ALL')" />
                @for (c of categories; track c) {
                  <input
                    class="btn btn-sm"
                    type="radio"
                    name="waste-cat"
                    [attr.aria-label]="info(c).short + ' (' + totals()[c].rows + ')'"
                    [checked]="category() === c"
                    (change)="category.set(c)"
                  />
                }
              </div>
            </div>
            <p class="text-sm text-base-content/70">{{ currentTab().hint }}</p>
          </div>
        </section>

        <!-- Indicadores do recorte escolhido -->
        <div class="stats" data-open-help="desperdicios-indicadores">
          <app-kpi
            label="Investimento analisado"
            [value]="money(totalCost())"
            tip="Soma do custo das linhas deste recorte. Recortes diferentes contam o mesmo clique de jeitos diferentes, por isso os números não se somam entre recortes."
            [note]="countable().length + ' itens em ' + currentTab().label.toLowerCase()"
          />
          <app-kpi
            [label]="info('WASTE').label"
            [value]="money(totals().WASTE.cost)"
            [tip]="info('WASTE').tip"
            [note]="share(totals().WASTE) + ' do investimento · ' + totals().WASTE.rows + ' itens'"
          />
          <app-kpi
            [label]="info('GOOD').label"
            [value]="money(totals().GOOD.cost)"
            [tip]="info('GOOD').tip"
            [note]="share(totals().GOOD) + ' do investimento · ' + totals().GOOD.rows + ' itens'"
          />
          <app-kpi
            label="Caro ou sem conclusão"
            [value]="money(totals().EXPENSIVE.cost + totals().UNKNOWN.cost + totals().TRACKING.cost)"
            tip="Acima da meta, sem dados suficientes ou com falha de medição: pede revisão, não corte automático."
            [note]="totals().EXPENSIVE.rows + ' caros · ' + totals().UNKNOWN.rows + ' sem conclusão · ' + totals().TRACKING.rows + ' medição'"
          />
        </div>

        <app-diagnosis [kind]="diagnosis().tone" [title]="diagnosis().title">{{ diagnosis().text }}</app-diagnosis>

        <!-- Gráficos -->
        <div class="grid gap-block lg:grid-cols-5">
          <section class="card card-border bg-base-100 lg:col-span-3">
            <div class="card-body gap-4">
              <h2 class="text-base font-semibold">Para onde vai a verba, em cada recorte</h2>
              <p class="text-sm text-base-content/70">Custo do período por categoria. Clique numa barra para abrir o recorte.</p>
              <app-echart [option]="byDimensionChart()" [height]="330" label="Custo por categoria em cada recorte da conta" (pick)="pickDimension($event.name)" />
            </div>
          </section>
          <section class="card card-border bg-base-100 lg:col-span-2">
            <div class="card-body gap-4">
              <h2 class="text-base font-semibold">{{ currentTab().label }}: divisão do custo</h2>
              <p class="text-sm text-base-content/70">Clique numa fatia para filtrar a tabela.</p>
              <app-echart [option]="donutChart()" [height]="330" [label]="'Divisão do custo de ' + currentTab().label" (pick)="pickCategory($event.name)" />
            </div>
          </section>
        </div>

        <!-- Desperdício real × o que rende -->
        <div class="grid gap-block lg:grid-cols-2" data-open-help="desperdicios-prioridades">
          <section class="card card-border bg-base-100">
            <div class="card-body gap-4">
              <div>
                <h2 class="text-base font-semibold">Maiores gastos com desperdício provável</h2>
                <p class="text-sm text-base-content/70">{{ currentTab().label }} sem resultado, do maior gasto para o menor.</p>
              </div>
              <app-bar-list [items]="topBars('WASTE')" empty="Nenhum desperdício provável identificado neste recorte." />
            </div>
          </section>
          <section class="card card-border bg-base-100">
            <div class="card-body gap-4">
              <div>
                <h2 class="text-base font-semibold">O que rende (dentro da meta)</h2>
                <p class="text-sm text-base-content/70">{{ currentTab().label }} com resultado a custo dentro da meta.</p>
              </div>
              <app-bar-list [items]="topBars('GOOD')" empty="Nada dentro da meta neste recorte ainda." />
            </div>
          </section>
        </div>

        <!-- Avisos por dimensão -->
        @switch (dimension()) {
          @case ('term') {
            @if (insights.searchCoverage(); as cov) {
              <div role="note" class="alert alert-soft">
                <app-icon name="info" />
                <span class="text-sm">
                  Estes termos explicam {{ pct(cov) }} do custo de Pesquisa. O restante vem de termos de baixo
                  volume que o Google oculta e <strong>não entra</strong> nesta análise.
                </span>
              </div>
            }
          }
          @case ('region') {
            @if (!insights.serviceAreaConfigured()) {
              <div role="note" class="alert alert-soft alert-warning">
                <app-icon name="map-pin" />
                <span class="text-sm">
                  A área de atendimento ainda não foi configurada, então nenhuma região é tratada como "fora da
                  área".
                  <a routerLink="/configuracoes" class="link">Configurar agora</a>.
                </span>
              </div>
            }
            @if (insights.regionCoverage(); as cov) {
              @if (!cov.consistent) {
                <div role="note" class="alert alert-soft alert-warning">
                  <app-icon name="warning" />
                  <span class="text-sm">
                    A soma dos cliques por região ({{ cov.geoClicks | number: '1.0-0' }}) difere do total das
                    campanhas ({{ cov.campaignClicks | number: '1.0-0' }}). Considere as regiões como amostra.
                  </span>
                </div>
              }
            }
          }
          @case ('placement') {
            <div role="note" class="alert alert-soft">
              <app-icon name="info" />
              <span class="text-sm">
                Com a taxa de conversão baixa do Display, um posicionamento isolado raramente tem cliques
                suficientes para uma conclusão. Veja também o veredito da campanha inteira.
              </span>
            </div>
          }
          @case ('page') {
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="btn btn-sm" [disabled]="audits.running().size > 0" (click)="auditAll()">
                @if (audits.running().size > 0) {
                  <span class="loading loading-spinner loading-xs"></span>
                } @else {
                  <app-icon name="eye" size="sm" />
                }
                Ler todas as páginas
              </button>
              <span class="text-xs text-base-content/60">
                Lê o HTML de cada página para checar título, medição, formulário e botões de contato.
              </span>
              @if (audits.lastError(); as e) {
                <span class="text-xs text-error">{{ e }}</span>
              }
            </div>
          }
        }

        @if (dimension() === 'hour') {
          <section class="card card-border bg-base-100">
            <div class="card-body gap-4">
              <h2 class="card-title text-base">Custo por dia e hora</h2>
              <app-hour-heatmap [rows]="hourRows()" />
            </div>
          </section>
        }

        <!-- Filtros da tabela -->
        <div class="flex flex-wrap items-center gap-2">
          <label class="input input-sm w-full sm:w-72">
            <app-icon name="search" size="xs" class="opacity-60" />
            <input type="search" placeholder="Filtrar por nome ou campanha…" aria-label="Filtrar linhas" [value]="query()" (input)="query.set(val($event))" />
          </label>
          @if (category() !== 'ALL') {
            <span [class]="'badge badge-soft ' + badgeTone(category())">{{ info(asCat(category())).label }}</span>
          }
          <span class="ml-auto text-sm text-base-content/60 tabular">{{ filtered().length }} de {{ rows().length }}</span>
          @if (dimension() === 'term' && negatable().length) {
            <button type="button" class="btn btn-error btn-sm" (click)="batch.show(negatableTerms())">
              <app-icon name="ban" size="sm" /> Negativar os {{ negatable().length }} com desperdício provável
            </button>
          }
        </div>

        <!-- Tabela -->
        <div class="overflow-x-auto rounded-box border border-base-300 bg-base-100">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Item</th>
                <th class="text-right">Impressões</th>
                <th class="text-right">Cliques</th>
                <th class="text-right">Custo</th>
                <th class="text-right">Resultados</th>
                <th class="text-right">Custo/resultado</th>
                <th>Veredito</th>
                <th><span class="sr-only">Detalhes</span></th>
              </tr>
            </thead>
            <tbody>
              @for (r of visible(); track r.key) {
                <tr class="hover:bg-base-200/60">
                  <td class="max-w-80">
                    <div class="font-medium break-words">{{ r.label }}</div>
                    @if (r.blocked) {
                      <span class="badge badge-soft badge-neutral badge-xs" title="O termo já está negativado. O valor é o gasto que ele teve no período.">
                        Já bloqueado · gasto do período
                      </span>
                    }
                    @if (r.sublabel) {
                      <div class="truncate text-xs text-base-content/60" [attr.title]="r.sublabel">{{ r.sublabel }}</div>
                    }
                  </td>
                  <td class="text-right tabular">{{ r.perf.impressions | number: '1.0-0' }}</td>
                  <td class="text-right tabular">{{ r.perf.clicks | number: '1.0-0' }}</td>
                  <td class="text-right tabular font-semibold">{{ r.perf.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</td>
                  <td class="text-right tabular">
                    @if (r.outcomesKnown === false) {
                      <span class="text-base-content/40">—</span>
                    } @else {
                      {{ r.outcomes | number: '1.0-1' }}
                    }
                  </td>
                  <td class="text-right tabular">
                    @if (r.outcomes > 0) {
                      {{ r.perf.cost / r.outcomes | currency: 'BRL' : 'symbol' : '1.2-2' }}
                    } @else {
                      <span class="text-base-content/40">—</span>
                    }
                  </td>
                  <td>
                    <div class="flex flex-col items-start gap-1">
                      <app-verdict [verdict]="r.assessment.verdict" />
                      @if (r.assessment.reason) {
                        <span class="text-xs text-base-content/60">{{ reasonLabel(r) }}</span>
                      }
                    </div>
                  </td>
                  <td class="whitespace-nowrap">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      [attr.aria-expanded]="isOpen(r)"
                      (click)="toggle(r)"
                    >
                      {{ isOpen(r) ? 'Fechar' : 'Evidências' }}
                    </button>
                  </td>
                </tr>
                @if (isOpen(r)) {
                  <tr class="bg-base-200/50">
                    <td colspan="8">
                      <div class="grid gap-4 p-2 lg:grid-cols-3">
                        <div class="lg:col-span-2">
                          <h3 class="mb-2 text-sm font-semibold">Por que este veredito</h3>
                          <app-evidence-list [items]="r.assessment.evidence" />
                        </div>
                        <div class="flex flex-col gap-3 text-sm">
                          <div>
                            <app-confidence [level]="r.assessment.confidence.level" />
                            <ul class="mt-2 list-disc pl-5 text-xs text-base-content/70">
                              @for (reason of r.assessment.confidence.reasons; track reason) {
                                <li>{{ reason }}</li>
                              }
                            </ul>
                          </div>
                          @if (r.monthlyCost > 0) {
                            <div class="text-xs text-base-content/70">
                              Ritmo atual: {{ r.monthlyCost | currency: 'BRL' : 'symbol' : '1.0-0' }} por mês.
                            </div>
                          }
                          <div class="flex flex-wrap gap-2">
                            @if (dimension() === 'term' && r.assessment.verdict !== 'PERFORMING' && !r.blocked) {
                              <button type="button" class="btn btn-xs" (click)="batch.show([r.label])">
                                <app-icon name="ban" size="xs" /> Negativar
                              </button>
                            }
                            @if (dimension() === 'page' && pageUrl(r); as url) {
                              <button
                                type="button"
                                class="btn btn-xs"
                                [disabled]="audits.isRunning(url)"
                                (click)="audits.audit(url, true)"
                              >
                                @if (audits.isRunning(url)) {
                                  <span class="loading loading-spinner loading-xs"></span>
                                } @else {
                                  <app-icon name="eye" size="xs" />
                                }
                                Ler a página agora
                              </button>
                              <a [href]="url" target="_blank" rel="noopener" class="btn btn-ghost btn-xs">Abrir</a>
                            }
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td colspan="8" class="py-12 text-center text-base-content/60">
                    Nada para mostrar com os filtros atuais.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (filtered().length > shown()) {
          <div class="flex justify-center">
            <button type="button" class="btn btn-sm" (click)="shown.set(shown() + pageSize)">
              Mostrar mais ({{ filtered().length - shown() }} restantes)
            </button>
          </div>
        }
      </app-data-state>
    </div>
  `,
})
export class WastePage {
  protected readonly insights = inject(Insights);
  protected readonly ws = inject(Workspace);
  protected readonly batch = inject(BatchNegatives);
  protected readonly audits = inject(PageAudits);

  /** Preenchido pela query string (?dim=region) graças ao withComponentInputBinding. */
  readonly dim = input<string | undefined>(undefined);

  protected readonly tabs = TABS;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly pct = (v: number): string => pct(v, 0);

  protected readonly dimension = linkedSignal<WasteDimension>(() => {
    const d = this.dim();
    return TABS.some((t) => t.key === d) ? (d as WasteDimension) : 'campaign';
  });

  protected readonly categories = WASTE_CATEGORIES;
  protected readonly category = signal<'ALL' | WasteCategory>('ALL');
  protected readonly query = signal('');
  protected readonly shown = signal(PAGE_SIZE);
  private readonly opened = signal<ReadonlySet<string>>(new Set());

  protected readonly currentTab = computed(() => TABS.find((t) => t.key === this.dimension()) ?? TABS[0]);
  protected readonly rows = computed(() => this.insights.wasteByDimension()[this.dimension()]);
  protected readonly summary = computed(() => summarize(this.rows()));

  private readonly countable = computed(() => forTotals(this.dimension(), this.rows()));
  protected readonly totals = computed(() => categoryTotals(this.countable()));
  protected readonly totalCost = computed(() => this.countable().reduce((s, r) => s + r.perf.cost, 0));

  protected readonly filtered = computed(() => {
    const c = this.category();
    const q = this.query().toLowerCase().trim();
    return this.rows()
      .filter((r) => c === 'ALL' || wasteCategory(r) === c)
      .filter((r) => !q || r.label.toLowerCase().includes(q) || (r.sublabel ?? '').toLowerCase().includes(q))
      .sort(
        (a, b) =>
          ORDER[a.assessment.verdict] - ORDER[b.assessment.verdict] || b.perf.cost - a.perf.cost,
      );
  });

  protected readonly visible = computed(() => this.filtered().slice(0, this.shown()));

  protected readonly negatable = computed(() =>
    this.rows().filter((r) => r.assessment.verdict === 'PROBABLE_WASTE' && !r.blocked),
  );
  protected readonly negatableTerms = computed(() => this.negatable().map((r) => r.label));

  protected readonly hourRows = computed(() => this.ws.hours.value() ?? []);

  /** URL completa (com https) de cada linha da dimensão "páginas", pelo cadastro do Google Ads. */
  private readonly urlByKey = computed(() => {
    const map = new Map<string, string>();
    for (const p of this.ws.landingPages.value() ?? []) if (!map.has(p.normalizedUrl)) map.set(p.normalizedUrl, p.url);
    return map;
  });

  constructor() {
    this.insights.needCore();
  }

  protected val(event: Event): never {
    return (event.target as HTMLSelectElement).value as never;
  }

  protected select(d: WasteDimension | string): void {
    if (!TABS.some((t) => t.key === d)) return;
    this.dimension.set(d as WasteDimension);
    this.shown.set(PAGE_SIZE);
    this.category.set('ALL');
    this.query.set('');
  }

  // ───── Painel ─────

  protected info = (c: WasteCategory): CategoryInfo => CATEGORY[c];
  protected asCat = (c: 'ALL' | WasteCategory): WasteCategory => c as WasteCategory;
  protected money = (v: number): string => brl(v);
  protected share = (t: CategoryTotal): string => pct(t.share, 0);
  protected badgeTone(c: 'ALL' | WasteCategory): string {
    return c === 'ALL' ? '' : BADGE_TONE[c];
  }

  protected readonly diagnosis = computed<{ tone: DiagnosisTone; title: string; text: string }>(() => {
    const t = this.totals();
    const dim = this.currentTab().label.toLowerCase();
    if (!this.countable().length) {
      return { tone: 'info', title: 'Sem gasto neste recorte no período', text: 'Escolha outro recorte ou outro período.' };
    }
    if (t.TRACKING.share >= 0.2) {
      return {
        tone: 'warn',
        title: `${pct(t.TRACKING.share, 0)} do investimento em ${dim} tem indício de falha de medição`,
        text: 'Antes de cortar qualquer coisa, confira a medição de conversões: sem ela, gasto bom parece desperdício.',
      };
    }
    const parts = [
      `${pct(t.WASTE.share, 0)} tem sinais de desperdício (${brl(t.WASTE.cost)})`,
      `${pct(t.GOOD.share, 0)} está dentro da meta (${brl(t.GOOD.cost)})`,
    ];
    const rest = t.EXPENSIVE.share + t.UNKNOWN.share + t.TRACKING.share;
    const text = `${parts.join(' e ')}. ${rest > 0 ? `Os outros ${pct(rest, 0)} estão caros ou ainda sem conclusão.` : ''}`;
    if (t.WASTE.cost > 0) {
      const top = this.countable().filter((r) => wasteCategory(r) === 'WASTE').sort((a, b) => b.perf.cost - a.perf.cost)[0];
      return {
        tone: t.WASTE.share >= 0.15 ? 'bad' : 'warn',
        title: `${pct(t.WASTE.share, 0)} do investimento em ${dim} merece revisão`,
        text: `${text} O maior item é "${top.label}" (${brl(top.perf.cost)}).`,
      };
    }
    return {
      tone: t.GOOD.share > 0 ? 'ok' : 'info',
      title: t.GOOD.share > 0 ? `Nenhum desperdício provável identificado em ${dim}` : `Ainda não dá para concluir sobre ${dim}`,
      text,
    };
  });

  protected topBars(c: WasteCategory): BarItem[] {
    return this.rows()
      .filter((r) => wasteCategory(r) === c)
      .sort((a, b) => b.perf.cost - a.perf.cost)
      .slice(0, 8)
      .map((r) => ({
        label: r.label,
        value: r.perf.cost,
        display: brl(r.perf.cost),
        tag: r.blocked ? 'já bloqueado' : undefined,
        tone: CATEGORY[c].tone,
        sub:
          c === 'GOOD' && r.outcomes > 0
            ? `${r.sublabel ? r.sublabel + ' · ' : ''}${r.outcomes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} resultados, ${brl(r.perf.cost / r.outcomes)} cada`
            : r.sublabel,
      }));
  }

  /** Barras empilhadas: cada recorte com o custo dividido por categoria. */
  protected readonly byDimensionChart = computed<EChartsCoreOption>(() => {
    const all = this.insights.wasteByDimension();
    const tabs = TABS.filter((t) => all[t.key].length);
    const totals = tabs.map((t) => categoryTotals(forTotals(t.key, all[t.key])));
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v: number) => brl(v),
      },
      legend: { bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10 },
      grid: { left: 8, right: 16, top: 8, bottom: 36, containLabel: true },
      xAxis: { type: 'value', axisLabel: { formatter: (v: number) => brl(v).replace(',00', '') } },
      yAxis: { type: 'category', inverse: true, data: tabs.map((t) => t.label) },
      series: WASTE_CATEGORIES.map((c) => ({
        name: CATEGORY[c].label,
        type: 'bar',
        stack: 'custo',
        barMaxWidth: 22,
        itemStyle: { color: CATEGORY[c].color },
        emphasis: { focus: 'series' },
        data: totals.map((t) => Math.round(t[c].cost * 100) / 100),
      })),
    };
  });

  protected readonly donutChart = computed<EChartsCoreOption>(() => {
    const t = this.totals();
    return {
      tooltip: { trigger: 'item', valueFormatter: (v: number) => brl(v) },
      legend: { bottom: 0, icon: 'circle', itemWidth: 9, itemHeight: 9 },
      series: [
        {
          type: 'pie',
          radius: ['48%', '72%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          label: { show: false },
          itemStyle: { borderWidth: 2, borderColor: 'transparent' },
          data: WASTE_CATEGORIES.filter((c) => t[c].cost > 0).map((c) => ({
            name: CATEGORY[c].label,
            value: Math.round(t[c].cost * 100) / 100,
            itemStyle: { color: CATEGORY[c].color },
          })),
        },
      ],
    };
  });

  protected pickDimension(label: string): void {
    const tab = TABS.find((t) => t.label === label);
    if (tab) this.select(tab.key);
  }

  protected pickCategory(label: string): void {
    const c = WASTE_CATEGORIES.find((k) => CATEGORY[k].label === label);
    if (c) this.category.set(c);
  }

  protected readonly exportData = computed<ExportData>(() => ({
    name: `desperdicios-${this.dimension()}`,
    rows: this.filtered().map((r) => ({
      Item: r.label,
      Detalhe: r.sublabel ?? '',
      Categoria: CATEGORY[wasteCategory(r)].label,
      'Já bloqueado': r.blocked ? 'sim' : '',
      Impressões: r.perf.impressions,
      Cliques: r.perf.clicks,
      'Custo (R$)': Math.round(r.perf.cost * 100) / 100,
      Resultados: r.outcomes,
      'Custo por resultado (R$)': r.outcomes > 0 ? Math.round((r.perf.cost / r.outcomes) * 100) / 100 : '',
    })),
  }));

  protected problemCount(d: WasteDimension): number {
    const s = this.insights.wasteSummaryByDimension()[d];
    return s.PROBABLE_WASTE.rows + s.TRACKING_FAILURE.rows;
  }

  protected isOpen(r: WasteRow): boolean {
    return this.opened().has(`${r.dimension}:${r.key}`);
  }

  protected toggle(r: WasteRow): void {
    const key = `${r.dimension}:${r.key}`;
    this.opened.update((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  protected reasonLabel(r: WasteRow): string {
    return r.assessment.reason ? INSUFFICIENT_LABEL[r.assessment.reason] : '';
  }

  protected pageUrl(r: WasteRow): string | undefined {
    const url = this.urlByKey().get(r.key);
    if (!url) return undefined;
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }

  protected async auditAll(): Promise<void> {
    const urls = this.rows()
      .map((r) => this.pageUrl(r))
      .filter((u): u is string => !!u);
    await this.audits.auditMany(urls);
  }
}
