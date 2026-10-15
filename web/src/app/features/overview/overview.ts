import { CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Insights } from '../../core/insights';
import { Workspace } from '../../core/workspace';
import { AccountStore } from '../../core/account.store';
import { BusinessConfigStore } from '../../core/business-config.store';
import { days, num, pct } from '../../domain/format';
import { evaluateGoal } from '../../domain/funnel';
import { STAGE_LABEL, WasteDimension } from '../../domain/models';
import { ConfidenceBadge } from '../../shared/badges';
import { DataState } from '../../shared/data-state';
import { FunnelBars } from '../../shared/funnel-bars';
import { Icon } from '../../shared/icon';
import { IconName } from '../../shared/icons';
import { PageHeader } from '../../shared/page-header';
import { EChart, VERDICT_COLOR } from '../../shared/echart';
import { brl } from '../../domain/format';
import { wasteCategory } from '../../domain/waste';
import { WasteRow } from '../../domain/models';
import type { EChartsCoreOption } from 'echarts/core';
import { Sparkline } from '../../shared/sparkline';

interface HealthItem {
  label: string;
  ok: boolean;
  detail: string;
  route?: string;
}

const DIMENSIONS: ReadonlyArray<{ key: Exclude<WasteDimension, never>; label: string }> = [
  { key: 'campaign', label: 'Campanhas' },
  { key: 'term', label: 'Termos de busca' },
  { key: 'keyword', label: 'Palavras-chave' },
  { key: 'ad', label: 'Anúncios' },
  { key: 'region', label: 'Regiões' },
  { key: 'device', label: 'Dispositivos' },
  { key: 'hour', label: 'Horários' },
  { key: 'page', label: 'Páginas de destino' },
  { key: 'placement', label: 'Posicionamentos (Display)' },
];

const CATEGORY_ICON: Record<string, IconName> = {
  TRACKING: 'warning',
  WASTE: 'ban',
  CAMPAIGN: 'folder',
  FUNNEL: 'funnel',
  LANDING_PAGE: 'link',
  CONTENT: 'document',
  DATA_QUALITY: 'database',
};

const CATEGORY_LABEL: Record<string, string> = {
  TRACKING: 'Medição',
  WASTE: 'Desperdício',
  CAMPAIGN: 'Campanha',
  FUNNEL: 'Funil',
  LANDING_PAGE: 'Página',
  CONTENT: 'Conteúdo',
  DATA_QUALITY: 'Qualidade dos dados',
};

@Component({
  selector: 'app-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    DecimalPipe,
    PercentPipe,
    RouterLink,
    ConfidenceBadge,
    DataState,
    FunnelBars,
    Icon,
    EChart,
    PageHeader,
    Sparkline,
  ],
  template: `
    <app-page-header
      group="Inteligência"
      title="Visão geral"
      [subtitle]="'Do clique à venda: ' + account.rangeLabel().toLowerCase() + '. Cada número diz de onde vem; o que não pôde ser medido aparece como indisponível.'"
    />

    <app-data-state
      [loading]="insights.loadingCore()"
      [error]="insights.coreError()"
      [hasData]="!!f()"
      (retry)="ws.reloadAll()"
    >
      @if (f(); as funnel) {
        <div class="flex flex-col gap-block">
          <!-- Alertas que invalidam o resto -->
          @for (o of outagesInPeriod(); track o.from + o.campaignId) {
            <div role="alert" class="alert alert-warning alert-soft">
              <app-icon name="warning" />
              <div class="min-w-0">
                <h3 class="font-semibold">
                  {{ o.ongoing ? 'Conversões pararam' : 'Houve um período sem conversões' }}
                  {{ o.scope === 'ACCOUNT' ? 'na conta' : 'em "' + o.campaignName + '"' }}
                </h3>
                <div class="text-sm">
                  {{ o.days }} dias seguidos ({{ o.from }} a {{ o.to }}) com {{ o.clicks | number: '1.0-0' }} cliques e
                  nenhuma conversão registrada.
                  @if (o.ongoing) {
                    Vale testar o formulário e a etiqueta de medição antes de decidir qualquer corte.
                  } @else {
                    Se a medição já existia, ela falhou nesse trecho; se foi criada depois, esse gasto não pode ser avaliado.
                  }
                </div>
              </div>
              <a routerLink="/acoes" class="btn btn-sm">Ver detalhes</a>
            </div>
          }

          @if (insights.maturity() < 0.5) {
            <div role="status" class="alert alert-info alert-soft">
              <app-icon name="clock" />
              <span class="text-sm">
                Só {{ insights.maturity() | percent: '1.0-0' }} deste período já teve tempo de gerar
                {{ goalLabel() }} (prazo típico: {{ lagText() }}). Evite cortes baseados nele; ele amadurece em
                {{ insights.maturesOnDate() }}.
              </span>
            </div>
          }

          <!-- Números principais -->
          <section aria-label="Resultados do período">
            <div class="stats w-full">
              <div class="stat">
                <div class="stat-title">Investimento</div>
                <div class="stat-value">{{ funnel.total.cost | currency: 'BRL' : 'symbol' : '1.2-2' }}</div>
                <div class="stat-desc">
                  {{ funnel.total.impressions | number: '1.0-0' }} impressões · {{ funnel.total.clicks | number: '1.0-0' }} cliques
                  @if (costDelta(); as d) {
                    · {{ d }} vs. período anterior
                  }
                </div>
              </div>

              <div class="stat">
                <div class="stat-title">{{ stageLabel('CONTACT') }}</div>
                <div class="stat-value">
                  @if (funnel.total.stages.CONTACT.source === 'NONE') {
                    <span class="text-base-content/50">—</span>
                  } @else {
                    {{ funnel.total.stages.CONTACT.count | number: '1.0-1' }}
                  }
                </div>
                <div class="stat-desc">
                  @if (funnel.total.costPer.CONTACT !== null) {
                    {{ funnel.total.costPer.CONTACT | currency: 'BRL' : 'symbol' : '1.2-2' }} por contato ·
                    {{ sourceName(funnel.total.stages.CONTACT.source) }}
                  } @else {
                    Sem conversões de contato no período
                  }
                </div>
              </div>

              <div class="stat">
                <div class="stat-title">{{ stageLabel('QUALIFIED') }}</div>
                <div class="stat-value">
                  @if (funnel.total.stages.QUALIFIED.source === 'NONE') {
                    <span class="text-base-content/50">—</span>
                  } @else {
                    {{ funnel.total.stages.QUALIFIED.count | number: '1.0-0' }}
                  }
                </div>
                <div class="stat-desc">
                  @if (funnel.total.costPer.QUALIFIED !== null) {
                    {{ funnel.total.costPer.QUALIFIED | currency: 'BRL' : 'symbol' : '1.2-2' }} por lead qualificado
                  } @else if (funnel.total.stages.QUALIFIED.source === 'NONE') {
                    Indisponível: importe os leads do CRM
                  } @else {
                    Nenhum lead qualificado ainda
                  }
                </div>
              </div>

              <div class="stat">
                <div class="stat-title">Vendas e retorno</div>
                <div class="stat-value">
                  @if (funnel.total.stages.SALE.source === 'NONE') {
                    <span class="text-base-content/50">—</span>
                  } @else {
                    {{ funnel.total.stages.SALE.count | number: '1.0-0' }}
                  }
                </div>
                <div class="stat-desc">
                  @if (funnel.total.revenue !== null) {
                    {{ funnel.total.revenue | currency: 'BRL' : 'symbol' : '1.2-2' }} de receita
                    @if (funnel.total.roi !== null) {
                      · ROI {{ funnel.total.roi | percent: '1.0-0' }}
                    }
                  } @else {
                    Receita e ROI só existem com vendas do CRM
                  }
                </div>
              </div>
            </div>
          </section>

          <!-- Evolução do período -->
          @if (evolution(); as ev) {
            <section class="card card-border bg-base-100">
              <div class="card-body gap-4">
                <h2 class="text-base font-semibold">Evolução do período</h2>
                <p class="text-sm text-base-content/70">
                  Custo, cliques e conversões do Google Ads por dia. Cada linha usa a própria escala.
                </p>
                <app-echart [option]="ev" [height]="280" label="Custo, cliques e conversões por dia no período" />
              </div>
            </section>
          }

          <div class="grid gap-block lg:grid-cols-5">
            <!-- Funil -->
            <section class="card card-border bg-base-100 lg:col-span-3">
              <div class="card-body gap-4">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <h2 class="card-title text-base">Funil do período</h2>
                    <p class="text-sm text-base-content/70">
                      Um clique não é um contato, e um contato não é um lead qualificado.
                    </p>
                  </div>
                  <a routerLink="/funil" class="btn btn-ghost btn-sm">Detalhar</a>
                </div>
                <app-funnel-bars [bars]="bars()" />
                @if (funnel.adsValue.isStatic) {
                  <div role="note" class="alert alert-soft alert-warning">
                    <app-icon name="info" />
                    <span class="text-sm">
                      O Google Ads atribui o mesmo valor a cada conversão ({{ funnel.adsValue.perConversion | currency: 'BRL' }}).
                      Isso não é receita e não entra no ROI.
                    </span>
                  </div>
                }
              </div>
            </section>

            <!-- Meta -->
            <section class="card card-border bg-base-100 lg:col-span-2">
              <div class="card-body gap-4">
                <h2 class="card-title text-base">Seu bom resultado</h2>
                <p class="text-sm text-base-content/70">
                  @if (config().goal.targetCostPerGoal !== null) {
                    Meta: {{ goalLabel() }} a até {{ config().goal.targetCostPerGoal | currency: 'BRL' }} cada.
                  } @else {
                    Meta: {{ goalLabel() }}. Defina quanto vale pagar para avaliar com uma régua sua.
                  }
                </p>

                @if (goalEval(); as g) {
                  <div class="flex items-end justify-between gap-3">
                    <div>
                      <div class="text-3xl font-semibold tabular">
                        @if (g.costPerGoal !== null) {
                          {{ g.costPerGoal | currency: 'BRL' : 'symbol' : '1.2-2' }}
                        } @else {
                          <span class="text-base-content/40">—</span>
                        }
                      </div>
                      <div class="text-sm text-base-content/70">por {{ goalLabel() }}</div>
                    </div>
                    @if (spark().cost.length > 1) {
                      <div class="text-base-content/70">
                        <app-sparkline [values]="spark().cost" label="Custo diário no período" />
                        <div class="text-right text-xs">custo por dia</div>
                      </div>
                    }
                  </div>

                  <div>
                    @switch (g.status) {
                      @case ('MET') {
                        <span class="badge badge-soft badge-success">Dentro da meta</span>
                      }
                      @case ('ABOVE') {
                        <span class="badge badge-soft badge-warning">Acima da meta</span>
                      }
                      @case ('NO_TARGET') {
                        <span class="badge badge-soft">Sem meta definida</span>
                      }
                      @case ('NO_RESULTS') {
                        <span class="badge badge-soft badge-error">Nenhum resultado no período</span>
                      }
                      @default {
                        <span class="badge badge-dash">Sem dados deste estágio</span>
                      }
                    }
                  </div>
                }
                <a routerLink="/funil" class="btn btn-sm self-start">Configurar meta</a>
              </div>
            </section>
          </div>

          <!-- Onde olhar primeiro -->
          <section class="card card-border bg-base-100">
            <div class="card-body gap-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h2 class="card-title text-base">Onde olhar primeiro</h2>
                  <p class="text-sm text-base-content/70">
                    Ordenado por impacto estimado e confiança. Cada item mostra a evidência e como validar.
                  </p>
                </div>
                <a routerLink="/acoes" class="btn btn-ghost btn-sm">Todas ({{ insights.openRecommendations().length }})</a>
              </div>

              <ul class="list">
                @for (r of top(); track r.id) {
                  <li class="list-row items-center">
                    <span class="grid size-9 place-items-center rounded-box bg-base-200">
                      <app-icon [name]="icon(r.category)" size="sm" />
                    </span>
                    <div class="min-w-0">
                      <div class="font-medium break-words">{{ r.title }}</div>
                      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/60">
                        <span>{{ category(r.category) }}</span>
                        @if (r.impact.monthlyCostBrl) {
                          <span>· até {{ r.impact.monthlyCostBrl | currency: 'BRL' : 'symbol' : '1.0-0' }}/mês</span>
                        }
                      </div>
                    </div>
                    <app-confidence [level]="r.confidence.level" />
                    <a routerLink="/acoes" class="btn btn-ghost btn-sm btn-square" aria-label="Abrir no plano de ação">
                      <app-icon name="arrow-right" size="sm" />
                    </a>
                  </li>
                } @empty {
                  <li class="list-row text-sm text-base-content/60">
                    Nenhuma recomendação aberta. Isso pode mudar quando mais dados chegarem.
                  </li>
                }
              </ul>
            </div>
          </section>

          <div class="grid gap-block lg:grid-cols-2">
            <!-- Desperdícios identificados -->
            <section class="card card-border bg-base-100">
              <div class="card-body gap-0 p-0">
                <div class="flex items-start justify-between gap-3 px-6 pt-4 pb-2">
                  <div>
                    <h2 class="text-base font-semibold">Desperdícios identificados</h2>
                    <p class="text-sm text-base-content/70">Campanhas e termos sem resultado, do maior gasto para o menor.</p>
                  </div>
                  <a routerLink="/desperdicios" class="link-brand whitespace-nowrap text-sm">Ver todos »</a>
                </div>
                <ul>
                  @for (w of topWaste(); track w.dimension + w.key) {
                    <li class="flex items-center justify-between gap-3 border-t border-base-300 px-6 py-3">
                      <div class="min-w-0">
                        <div class="text-sm font-medium break-words">{{ w.label }}</div>
                        <div class="text-xs text-base-content/60">
                          {{ w.dimension === 'campaign' ? 'Campanha' : 'Termo' }} · {{ w.perf.clicks | number: '1.0-0' }} cliques, nenhum resultado
                          @if (w.blocked) {
                            · já bloqueado
                          }
                        </div>
                      </div>
                      <div class="flex flex-none flex-col items-end gap-1">
                        <span class="font-display text-base font-medium tabular">{{ money(w.perf.cost) }}</span>
                        <span class="badge badge-soft badge-xs" [class.badge-error]="w.assessment.confidence.level === 'HIGH'" [class.badge-warning]="w.assessment.confidence.level !== 'HIGH'">
                          {{ w.assessment.confidence.level === 'HIGH' ? 'Crítico' : 'Atenção' }}
                        </span>
                      </div>
                    </li>
                  } @empty {
                    <li class="border-t border-base-300 px-6 py-4 text-sm text-base-content/60">
                      Nenhum desperdício confirmado em campanhas ou termos neste período.
                    </li>
                  }
                </ul>
              </div>
            </section>

            <!-- Saúde dos dados -->
            <section class="card card-border bg-base-100">
              <div class="card-body gap-4">
                <h2 class="card-title text-base">Saúde dos dados</h2>
                <p class="text-sm text-base-content/70">
                  Quanto mais completo, mais firmes ficam as conclusões.
                </p>
                <ul class="flex flex-col gap-2">
                  @for (h of health(); track h.label) {
                    <li class="flex items-start gap-3 text-sm">
                      <span
                        class="mt-1 grid size-5 shrink-0 place-items-center rounded-full"
                        [class]="h.ok ? 'bg-success text-success-content' : 'bg-base-300 text-base-content/70'"
                      >
                        <app-icon [name]="h.ok ? 'check' : 'x'" size="xs" [stroke]="2.5" />
                      </span>
                      <div class="min-w-0 grow">
                        <div class="font-medium">{{ h.label }}</div>
                        <div class="text-xs text-base-content/60">{{ h.detail }}</div>
                      </div>
                      @if (!h.ok && h.route) {
                        <a [routerLink]="h.route" class="btn btn-ghost btn-xs">Resolver</a>
                      }
                    </li>
                  }
                </ul>
              </div>
            </section>
          </div>
        </div>
      }
    </app-data-state>
  `,
})
export class Overview {
  protected readonly insights = inject(Insights);
  protected readonly ws = inject(Workspace);
  protected readonly account = inject(AccountStore);
  private readonly cfg = inject(BusinessConfigStore);

  protected readonly dimensions = DIMENSIONS;
  protected readonly config = this.cfg.config;
  protected readonly f = this.insights.funnel;

  protected readonly goalLabel = computed(() => STAGE_LABEL[this.config().goal.goalStage].toLowerCase());
  protected readonly lagText = computed(() => days(this.insights.goalLagDays()));

  protected readonly bars = computed(() => {
    const f = this.f();
    if (!f) return [];
    return this.insights.stageOrder.map((stage) => ({
      stage,
      count: f.total.stages[stage].count,
      source: f.total.stages[stage].source,
    }));
  });

  protected readonly goalEval = computed(() => {
    const f = this.f();
    return f ? evaluateGoal(f.total, this.config().goal, this.config().thresholds.aboveTargetFactor) : null;
  });

  protected readonly top = computed(() => this.insights.openRecommendations().slice(0, 5));

  protected money = (v: number): string => brl(v);

  /** Maiores desperdícios reais em campanhas e termos (lista, não soma: são recortes diferentes). */
  protected readonly topWaste = computed<WasteRow[]>(() => {
    const w = this.insights.wasteByDimension();
    return [...w.campaign, ...w.term]
      .filter((r) => wasteCategory(r) === 'WASTE')
      .sort((a, b) => b.perf.cost - a.perf.cost)
      .slice(0, 5);
  });

  /** Série diária da conta: custo, cliques e conversões, cada um no próprio eixo. */
  protected readonly evolution = computed<EChartsCoreOption | null>(() => {
    const w = this.account.window();
    const byDay = new Map<string, { cost: number; clicks: number; conversions: number }>();
    for (const r of this.ws.daily.value() ?? []) {
      if (r.date < w.from || r.date > w.to) continue;
      const d = byDay.get(r.date) ?? { cost: 0, clicks: 0, conversions: 0 };
      d.cost += r.cost;
      d.clicks += r.clicks;
      d.conversions += r.conversions;
      byDay.set(r.date, d);
    }
    const dates = [...byDay.keys()].sort();
    if (dates.length < 2) return null;
    const label = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    const line = (name: string, color: string, axis: number, values: number[], money = false) => ({
      name,
      type: 'line',
      yAxisIndex: axis,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2, color },
      itemStyle: { color },
      data: values,
      tooltip: money ? { valueFormatter: (v: number) => brl(v) } : undefined,
    });
    const hidden = { show: false };
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4 },
      grid: { left: 8, right: 8, top: 12, bottom: 34, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: dates.map(label) },
      yAxis: [
        { type: 'value', min: 0, axisLabel: { formatter: (v: number) => brl(v).replace(',00', '') } },
        { type: 'value', min: 0, axisLabel: hidden, splitLine: hidden },
        { type: 'value', min: 0, axisLabel: hidden, splitLine: hidden },
      ],
      series: [
        line('Custo', '#e98015', 0, dates.map((d) => Math.round((byDay.get(d)?.cost ?? 0) * 100) / 100), true),
        line('Cliques', VERDICT_COLOR.tracking, 1, dates.map((d) => byDay.get(d)?.clicks ?? 0)),
        line('Conversões', VERDICT_COLOR.performing, 2, dates.map((d) => Math.round((byDay.get(d)?.conversions ?? 0) * 10) / 10)),
      ],
    };
  });

  /** Falhas de medição que tocam o período analisado ou ainda estão em curso. */
  protected readonly outagesInPeriod = computed(() => {
    const from = this.account.window().from;
    return this.insights
      .outages()
      .filter((o) => o.ongoing || o.to >= from)
      .slice(0, 2);
  });

  protected readonly spark = computed(() => {
    const w = this.account.window();
    const byDay = new Map<string, number>();
    for (const r of this.ws.daily.value() ?? []) {
      if (r.date >= w.from && r.date <= w.to) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.cost);
    }
    const dates = Array.from(byDay.keys()).sort();
    return { cost: dates.map((d) => byDay.get(d) as number) };
  });

  protected readonly costDelta = computed(() => {
    const now = this.f()?.total.cost ?? 0;
    const prev = (this.ws.previousCampaigns.value() ?? []).reduce((s, c) => s + c.cost, 0);
    if (!prev) return '';
    const change = (now - prev) / prev;
    if (Math.abs(change) < 0.005) return '≈ igual';
    return `${change > 0 ? '+' : '−'}${pct(Math.abs(change), 0)}`;
  });

  protected readonly health = computed<HealthItem[]>(() => {
    const f = this.f();
    const goal = this.config().goal;
    return [
      {
        label: 'Google Ads conectado',
        ok: !!this.ws.campaigns.value(),
        detail: `${num(this.ws.campaigns.value()?.length ?? 0)} campanhas lidas`,
      },
      {
        label: 'Conversões classificadas por você',
        ok: !!f && f.unconfirmedConversions === 0,
        detail:
          f && f.unconfirmedConversions > 0
            ? `${num(f.unconfirmedConversions, 1)} conversões ainda dependem de sugestão automática`
            : 'Cada ação está mapeada para um estágio do funil',
        route: '/funil',
      },
      {
        label: 'Meta de custo definida',
        ok: goal.targetCostPerGoal !== null,
        detail:
          goal.targetCostPerGoal !== null
            ? 'Vereditos usam a sua meta'
            : 'Sem meta, a comparação usa a média da conta',
        route: '/funil',
      },
      {
        label: 'Leads e vendas do CRM',
        ok: !!f?.crmPresent,
        detail: f?.crmPresent ? 'Qualificação, venda e receita medidas' : 'Sem leads no período: qualidade e ROI indisponíveis',
        route: '/funil',
      },
      {
        label: 'Google Analytics',
        ok: this.ws.ga4Status().configured,
        detail: this.ws.ga4Status().configured ? 'Sessões e eventos por página' : (this.ws.ga4Status().reason ?? 'Não conectado'),
        route: '/configuracoes',
      },
      {
        label: 'Search Console',
        ok: this.ws.searchConsoleStatus().configured,
        detail: this.ws.searchConsoleStatus().configured
          ? 'Consultas e posição orgânica'
          : (this.ws.searchConsoleStatus().reason ?? 'Não conectado'),
        route: '/configuracoes',
      },
      {
        label: 'Área de atendimento',
        ok: this.insights.serviceAreaConfigured(),
        detail: this.insights.serviceAreaConfigured()
          ? 'Regiões fora da área são identificadas'
          : 'Informe onde a empresa atende',
        route: '/configuracoes',
      },
      {
        label: 'Período maduro',
        ok: this.insights.maturity() >= 0.8,
        detail: `${pct(this.insights.maturity(), 0)} do período já teve tempo de gerar ${this.goalLabel()}`,
      },
    ];
  });

  protected stageLabel = (s: 'CONTACT' | 'QUALIFIED'): string => STAGE_LABEL[s];
  protected sourceName = (s: 'ADS' | 'CRM' | 'NONE'): string => (s === 'ADS' ? 'Google Ads' : s === 'CRM' ? 'CRM' : 'indisponível');
  protected icon = (c: string): IconName => CATEGORY_ICON[c] ?? 'info';
  protected category = (c: string): string => CATEGORY_LABEL[c] ?? c;

  constructor() {
    this.insights.needCore();
  }
}
