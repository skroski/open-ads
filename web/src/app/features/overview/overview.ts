import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { EChartsCoreOption } from 'echarts/core';

import { AccountStore } from '../../core/account.store';
import { BusinessConfigStore } from '../../core/business-config.store';
import { Insights, RecommendationView } from '../../core/insights';
import { Workspace } from '../../core/workspace';
import { brl, num, pct } from '../../domain/format';
import { evaluateGoal } from '../../domain/funnel';
import { FunnelStage, STAGE_LABEL } from '../../domain/models';
import { ConfidenceBadge } from '../../shared/badges';
import { DataState } from '../../shared/data-state';
import { EChart } from '../../shared/echart';
import { ForecastChart } from '../../shared/forecast-chart';
import { Icon } from '../../shared/icon';
import { IconName } from '../../shared/icons';

interface DashboardKpi {
  label: string;
  value: string;
  comparison: string;
  reference: string;
  interpretation: string;
  source: string;
  confidence: string;
  unavailable?: boolean;
}

interface VerdictFact {
  label: string;
  value: string;
  note: string;
}

interface DashboardVerdict {
  state: string;
  tone: 'attention' | 'risk' | 'healthy' | 'neutral';
  headline: string;
  reason: string;
  action: string;
  route: string;
  facts: VerdictFact[];
}

interface FlowStage {
  label: string;
  value: string;
  note: string;
  source: string;
  available: boolean;
  warning: boolean;
}

const CATEGORY_ICON: Record<string, IconName> = {
  TRACKING: 'warning',
  WASTE: 'ban',
  CAMPAIGN: 'folder',
  FUNNEL: 'funnel',
  LANDING_PAGE: 'link',
  CONTENT: 'document',
  DATA_QUALITY: 'database',
};

const DECISION_LABEL: Record<string, string> = {
  TRACKING: 'Investigar primeiro',
  WASTE: 'Corrigir agora',
  CAMPAIGN: 'Investigar primeiro',
  FUNNEL: 'Melhorar a medição',
  LANDING_PAGE: 'Investigar primeiro',
  CONTENT: 'Preparar oportunidade',
  DATA_QUALITY: 'Completar a leitura',
};

/** Tela de entrada: decisão, evidência e limites dos dados antes do detalhe técnico. */
@Component({
  selector: 'app-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ConfidenceBadge, DataState, EChart, ForecastChart, Icon],
  template: `
    <header class="overview-heading" data-open-help="visao-geral-introducao">
      <div class="overview-eyebrow">Hoje · {{ account.rangeLabel() }}</div>
      <h1>O seu dinheiro está sendo bem usado?</h1>
      <p>Uma leitura para decidir o próximo passo, com a origem e os limites de cada número visíveis.</p>
    </header>

    <app-data-state
      [loading]="insights.loadingCore()"
      [error]="insights.coreError()"
      [hasData]="!!f()"
      (retry)="ws.reloadAll()"
    >
      @if (f(); as funnel) {
        <div class="overview-stack">
          <section
            aria-label="Veredito executivo"
            class="overview-verdict"
            [class.overview-verdict--attention]="verdict().tone === 'attention'"
            [class.overview-verdict--risk]="verdict().tone === 'risk'"
            [class.overview-verdict--healthy]="verdict().tone === 'healthy'"
            [class.overview-verdict--neutral]="verdict().tone === 'neutral'"
          >
            <div class="overview-verdict__copy">
              <span class="overview-state" [class.overview-state--healthy]="verdict().tone === 'healthy'">
                <app-icon [name]="verdict().tone === 'healthy' ? 'check' : verdict().tone === 'neutral' ? 'info' : 'warning'" size="xs" />
                {{ verdict().state }}
              </span>
              <h2>{{ verdict().headline }}</h2>
              <p>{{ verdict().reason }}</p>
              <div class="overview-verdict__actions">
                <a [routerLink]="verdict().route" class="btn btn-neutral btn-sm">
                  {{ verdict().action }} <app-icon name="arrow-right" size="xs" />
                </a>
                <a href="#prioridades" class="btn btn-ghost btn-sm">Ver evidências</a>
              </div>
            </div>

            <dl class="overview-verdict__facts">
              @for (fact of verdict().facts; track fact.label) {
                <div>
                  <dt>{{ fact.label }}</dt>
                  <dd>{{ fact.value }}</dd>
                  <p>{{ fact.note }}</p>
                </div>
              }
            </dl>
          </section>

          <section aria-label="Métricas essenciais" class="overview-kpis">
            @for (kpi of kpis(); track kpi.label) {
              <article class="overview-kpi" [class.overview-kpi--unavailable]="kpi.unavailable">
                <div class="overview-kpi__label">{{ kpi.label }}</div>
                <div class="overview-kpi__value">{{ kpi.value }}</div>
                <div class="overview-kpi__comparison">{{ kpi.comparison }}</div>
                <div class="overview-kpi__reference">{{ kpi.reference }}</div>
                <p>{{ kpi.interpretation }}</p>
                <footer>
                  <span class="overview-source">{{ kpi.source }}</span>
                  <span class="overview-confidence">{{ kpi.confidence }}</span>
                </footer>
              </article>
            }
          </section>

          <section class="overview-flow" aria-labelledby="flow-title">
            <div class="overview-section-heading">
              <div>
                <h2 id="flow-title">Fluxo do investimento</h2>
                <p>Do dinheiro investido à venda: onde ele vira resultado e onde a visão termina.</p>
              </div>
              <div class="overview-legend" aria-label="Legenda do fluxo">
                <span><i class="overview-legend__available"></i>Dado disponível</span>
                <span><i class="overview-legend__unavailable"></i>Indisponível</span>
                @if (outagesInPeriod().length) {
                  <span><i class="overview-legend__warning"></i>Medição em risco</span>
                }
              </div>
            </div>

            <ol class="overview-flow__stages">
              @for (stage of flow(); track stage.label) {
                <li [class.is-unavailable]="!stage.available" [class.is-warning]="stage.warning">
                  <div class="overview-flow__stage-label">{{ stage.label }}</div>
                  <strong>{{ stage.value }}</strong>
                  <span>{{ stage.note }}</span>
                  <small>{{ stage.source }}</small>
                </li>
              }
            </ol>

            @if (!funnel.crmPresent) {
              <div class="overview-flow__limit">
                <app-icon name="info" size="sm" />
                <p>
                  A visão termina em <strong>{{ goalLabel() }}</strong>. Para medir vendas, receita e retorno, importe os dados do CRM.
                </p>
                <a routerLink="/funil" class="btn btn-sm btn-outline">Configurar CRM</a>
              </div>
            }
          </section>

          <section id="prioridades" class="overview-priorities" data-open-help="visao-geral-prioridades">
            <div class="overview-section-heading">
              <div>
                <h2>Decisões prioritárias</h2>
                <p>Ordem por estado de decisão, dinheiro envolvido e confiança. Uma recomendação não altera a conta sozinha.</p>
              </div>
              <a routerLink="/oportunidades" class="btn btn-outline btn-sm">Ver todas ({{ insights.openRecommendations().length }})</a>
            </div>

            <div class="overview-priority-list">
              @for (r of top(); track r.id; let position = $index) {
                <article class="overview-priority">
                  <div class="overview-priority__number">{{ position + 1 }}</div>
                  <div class="overview-priority__body">
                    <div class="overview-priority__meta">
                      <span>{{ decisionLabel(r) }}</span>
                      <app-confidence [level]="r.confidence.level" />
                    </div>
                    <h3>{{ r.title }}</h3>
                    <p>{{ r.problem }}</p>
                    <dl>
                      <div>
                        <dt>Evidência principal</dt>
                        <dd>{{ evidenceText(r) }}</dd>
                      </div>
                      <div>
                        <dt>Como validar</dt>
                        <dd>{{ r.validation }}</dd>
                      </div>
                    </dl>
                  </div>
                  <a [routerLink]="routeFor(r)" class="btn btn-neutral btn-sm overview-priority__action">
                    {{ r.actionButton?.label || 'Abrir análise' }} <app-icon name="arrow-right" size="xs" />
                  </a>
                </article>
              } @empty {
                <div class="overview-empty-priority">
                  <app-icon name="check" size="md" />
                  <div>
                    <h3>Nada exige ação agora</h3>
                    <p>Não há recomendações abertas com os dados disponíveis neste período.</p>
                  </div>
                </div>
              }
            </div>
          </section>

          @if (evolution(); as chart) {
            <section class="overview-evolution" aria-labelledby="evolution-title">
              <div class="overview-section-heading">
                <div>
                  <h2 id="evolution-title">Como chegamos aqui?</h2>
                  <p>Custo por conversão registrada no Google Ads. A referência aparece apenas quando foi configurada.</p>
                </div>
              </div>
              <app-echart [option]="chart" [height]="280" label="Evolução diária do custo por conversão registrada" />
              @if (outagesInPeriod().length) {
                <p class="overview-chart-note">
                  <app-icon name="warning" size="xs" /> Há períodos com conversões interrompidas; dias sem resultado não têm custo calculado.
                </p>
              }
            </section>
          }

          <section class="overview-evolution" aria-label="Previsão dos próximos dias">
            <app-forecast-chart
              [daily]="ws.daily.value() ?? []"
              [end]="ws.dailyWindow().to"
              [trackingBroken]="trackingBroken()"
            />
          </section>

          <details class="overview-media-metrics">
            <summary>Ver métricas de mídia</summary>
            <div>
              <dl>
                <div><dt>Impressões</dt><dd>{{ num(funnel.total.impressions) }}</dd></div>
                <div><dt>Cliques</dt><dd>{{ num(funnel.total.clicks) }}</dd></div>
                <div><dt>CTR</dt><dd>{{ ctr(funnel.total.clicks, funnel.total.impressions) }}</dd></div>
                <div><dt>CPC</dt><dd>{{ costPerClick(funnel.total.cost, funnel.total.clicks) }}</dd></div>
              </dl>
              <p>Indicadores de apoio do Google Ads. Eles ajudam a investigar, mas não substituem custo por resultado, qualidade e receita.</p>
            </div>
          </details>
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

  protected readonly f = this.insights.funnel;
  protected readonly config = this.cfg.config;
  protected readonly goalLabel = computed(() => STAGE_LABEL[this.config().goal.goalStage].toLowerCase());
  protected readonly top = computed(() => this.insights.openRecommendations().slice(0, 5));

  /** Falha de medição em andamento na conta toda: bloqueia previsões que dependem de conversão. */
  protected readonly trackingBroken = computed(() =>
    this.insights.outages().some((outage) => outage.scope === 'ACCOUNT' && outage.ongoing),
  );

  protected readonly outagesInPeriod = computed(() => {
    const from = this.account.window().from;
    return this.insights.outages().filter((outage) => outage.ongoing || outage.to >= from);
  });

  protected readonly goalEval = computed(() => {
    const funnel = this.f();
    return funnel
      ? evaluateGoal(funnel.total, this.config().goal, this.config().thresholds.aboveTargetFactor)
      : null;
  });

  protected readonly readingConfidence = computed(() => {
    const funnel = this.f();
    if (!funnel) return { label: 'Indisponível', note: 'A leitura ainda não terminou.' };
    if (this.outagesInPeriod().length) return { label: 'Baixa', note: 'Há conversões interrompidas no período.' };
    if (!funnel.crmPresent || this.insights.maturity() < 0.8) {
      return {
        label: 'Média',
        note: !funnel.crmPresent
          ? 'O CRM não está conectado para confirmar vendas.'
          : `${pct(this.insights.maturity(), 0)} do período já amadureceu.`,
      };
    }
    return { label: 'Alta', note: 'Fontes e maturidade suficientes para esta leitura.' };
  });

  protected readonly verdict = computed<DashboardVerdict>(() => {
    const funnel = this.f();
    const target = this.config().goal.targetCostPerGoal;
    const confidence = this.readingConfidence();
    const goal = this.goalEval();
    const outcomeLabel = this.goalLabel();
    const facts: VerdictFact[] = [
      {
        label: 'Referência',
        value: target === null ? 'Não definida' : brl(target),
        note: target === null ? `Defina o custo aceitável por ${outcomeLabel}.` : `Por ${outcomeLabel}.`,
      },
      {
        label: 'Período maduro',
        value: pct(this.insights.maturity(), 0),
        note: `Janela para gerar ${outcomeLabel}.`,
      },
      { label: 'Confiança da leitura', value: confidence.label, note: confidence.note },
    ];

    if (!funnel || !goal) {
      return {
        state: 'Sem dados',
        tone: 'neutral',
        headline: 'Ainda não há dados suficientes para concluir.',
        reason: 'Conclua a leitura da conta antes de decidir sobre orçamento ou cortes.',
        action: 'Ver medição',
        route: '/funil',
        facts,
      };
    }

    const outage = this.outagesInPeriod()[0];
    if (outage) {
      return {
        state: 'Medição em risco',
        tone: 'risk',
        headline: 'Há um trecho sem conversões registradas que precisa ser investigado antes de otimizar a conta.',
        reason: `${outage.days} dias com ${num(outage.clicks)} cliques e nenhuma conversão registrada. Esse período não deve sustentar cortes ou aumentos de orçamento.`,
        action: 'Verificar medição',
        route: '/funil',
        facts,
      };
    }

    if (target === null) {
      return {
        state: 'Sem referência',
        tone: 'neutral',
        headline: `Há resultado, mas ainda não existe uma régua para avaliar o custo por ${outcomeLabel}.`,
        reason: `O painel mostra o custo observado; a conclusão depende de você definir quanto vale pagar por ${outcomeLabel}.`,
        action: 'Definir referência',
        route: '/funil',
        facts,
      };
    }

    if (goal.status === 'ABOVE') {
      const cpo = goal.costPerGoal === null ? '—' : brl(goal.costPerGoal);
      return {
        state: 'Atenção',
        tone: 'attention',
        headline: `O custo por ${outcomeLabel} está em ${cpo}, acima da sua referência.`,
        reason: 'Revise as oportunidades antes de aumentar o orçamento. Custo alto é um sinal para investigar, não uma ordem para pausar.',
        action: 'Revisar oportunidades',
        route: '/oportunidades',
        facts,
      };
    }

    if (goal.status === 'NO_RESULTS' || goal.status === 'NO_DATA') {
      return {
        state: 'Sem conclusão',
        tone: 'neutral',
        headline: `Ainda não há ${outcomeLabel} suficiente para comparar o custo com segurança.`,
        reason: 'Espere mais dados ou confira se a conversão está configurada antes de interpretar o investimento.',
        action: 'Ver medição',
        route: '/funil',
        facts,
      };
    }

    return {
      state: 'Dentro da referência',
      tone: 'healthy',
      headline: `O custo por ${outcomeLabel} está dentro da referência definida para a conta.`,
      reason: 'Acompanhe as oportunidades abertas e a maturação do período antes de ampliar o investimento.',
      action: 'Ver oportunidades',
      route: '/oportunidades',
      facts,
    };
  });

  protected readonly kpis = computed<DashboardKpi[]>(() => {
    const funnel = this.f();
    if (!funnel) return [];
    const goalStage = this.config().goal.goalStage;
    const outcome = funnel.total.stages[goalStage];
    const cost = funnel.total.costPer[goalStage];
    const target = this.config().goal.targetCostPerGoal;
    const confidence = this.readingConfidence().label.toLowerCase();
    const targetReference = target === null
      ? `Defina uma referência para ${this.goalLabel()}.`
      : `Referência: ${brl(target)} por ${this.goalLabel()}.`;

    return [
      {
        label: 'Investimento',
        value: brl(funnel.total.cost),
        comparison: this.costDelta(),
        reference: `${num(funnel.total.impressions)} impressões e ${num(funnel.total.clicks)} cliques.`,
        interpretation: 'O investimento mostra o tamanho da aposta; sozinho, não diz se ela foi bem usada.',
        source: 'Google Ads',
        confidence: `Confiança ${confidence}`,
      },
      {
        label: STAGE_LABEL[goalStage],
        value: outcome.source === 'NONE' ? '—' : num(outcome.count, 1),
        comparison: outcome.source === 'NONE' ? 'Indisponível' : `${this.goalLabel()} registrados no período.`,
        reference: outcome.source === 'NONE' ? 'A fonte desse estágio não está conectada.' : `Fonte: ${this.sourceName(outcome.source)}.`,
        interpretation: outcome.source === 'NONE'
          ? 'A ausência de fonte não é zero: conecte ou importe os dados necessários.'
          : 'Este é o resultado mais profundo disponível para a leitura atual.',
        source: this.sourceName(outcome.source),
        confidence: `Confiança ${confidence}`,
        unavailable: outcome.source === 'NONE',
      },
      {
        label: `Custo por ${this.goalLabel()}`,
        value: cost === null ? '—' : brl(cost),
        comparison: cost === null ? 'Sem resultado suficiente para calcular.' : targetReference,
        reference: target === null ? 'Sem referência definida.' : cost !== null && cost > target ? 'Acima da referência.' : 'Dentro da referência.',
        interpretation: cost === null
          ? 'Não calculamos custo quando falta resultado mensurado.'
          : 'O custo é investimento dividido pelo resultado no estágio escolhido.',
        source: `Cálculo · ${this.sourceName(outcome.source)}`,
        confidence: `Confiança ${confidence}`,
        unavailable: cost === null,
      },
      {
        label: 'Receita e retorno',
        value: funnel.total.roi === null ? '—' : pct(funnel.total.roi, 0),
        comparison: funnel.total.revenue === null ? 'Indisponível · CRM não conectado' : `${brl(funnel.total.revenue)} de receita confirmada.`,
        reference: funnel.total.revenue === null ? 'Não calculamos retorno sem vendas confirmadas.' : 'Receita confirmada no CRM.',
        interpretation: funnel.total.revenue === null
          ? 'Contatos registrados não comprovam venda. O retorno só aparece com receita importada.'
          : 'Retorno calculado sobre a receita disponível no CRM.',
        source: 'CRM',
        confidence: funnel.total.revenue === null ? 'Confiança indisponível' : `Confiança ${confidence}`,
        unavailable: funnel.total.revenue === null,
      },
    ];
  });

  protected readonly flow = computed<FlowStage[]>(() => {
    const funnel = this.f();
    if (!funnel) return [];
    const stages: FunnelStage[] = ['CLICK', 'INTERACTION', 'CONTACT', 'QUALIFIED', 'SALE'];
    const firstUnavailable = stages.findIndex((stage) => funnel.total.stages[stage].source === 'NONE');
    const hasOutage = this.outagesInPeriod().length > 0;
    return stages.map((stage, index) => {
      const data = funnel.total.stages[stage];
      const available = data.source !== 'NONE';
      return {
        label: STAGE_LABEL[stage],
        value: available ? num(data.count, 1) : '—',
        note: available
          ? stage === 'CLICK'
            ? `${brl(funnel.total.cost)} investidos`
            : 'Resultado registrado no período'
          : index === firstUnavailable
            ? 'A visão termina aqui'
            : 'Exige uma fonte anterior',
        source: this.sourceName(data.source),
        available,
        warning: hasOutage && stage === 'CONTACT',
      };
    });
  });

  /** Série diária para a leitura do histórico; sem conversão diária, não há custo exibido. */
  protected readonly evolution = computed<EChartsCoreOption | null>(() => {
    const window = this.account.window();
    const byDay = new Map<string, { cost: number; conversions: number }>();
    for (const row of this.ws.daily.value() ?? []) {
      if (row.date < window.from || row.date > window.to) continue;
      const entry = byDay.get(row.date) ?? { cost: 0, conversions: 0 };
      entry.cost += row.cost;
      entry.conversions += row.conversions;
      byDay.set(row.date, entry);
    }
    const dates = [...byDay.keys()].sort();
    if (dates.length < 2) return null;
    const target = this.config().goal.targetCostPerGoal;
    const label = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
    const costPerConversion = dates.map((date) => {
      const day = byDay.get(date);
      return day && day.conversions > 0 ? Math.round((day.cost / day.conversions) * 100) / 100 : null;
    });
    return {
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: number | string) => typeof value === 'number' ? brl(value) : String(value),
      },
      legend: { bottom: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4 },
      grid: { left: 10, right: 10, top: 18, bottom: 36, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: dates.map(label) },
      yAxis: { type: 'value', min: 0, axisLabel: { formatter: (value: number) => brl(value).replace(',00', '') } },
      series: [
        {
          name: 'Custo por conversão registrada',
          type: 'line',
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2.5, color: '#1d1f21' },
          itemStyle: { color: '#1d1f21' },
          data: costPerConversion,
        },
        ...(target === null ? [] : [{
          name: 'Referência',
          type: 'line' as const,
          showSymbol: false,
          lineStyle: { width: 1.5, type: 'dashed' as const, color: '#f2a60d' },
          itemStyle: { color: '#f2a60d' },
          data: dates.map(() => target),
        }]),
      ],
    };
  });

  protected readonly costDelta = computed(() => {
    const now = this.f()?.total.cost ?? 0;
    const previous = (this.ws.previousCampaigns.value() ?? []).reduce((sum, campaign) => sum + campaign.cost, 0);
    if (!previous) return 'Sem comparação anterior disponível.';
    const change = (now - previous) / previous;
    if (Math.abs(change) < 0.005) return 'Praticamente igual ao período anterior.';
    return `${change > 0 ? '+' : '−'}${pct(Math.abs(change), 0)} vs. período anterior.`;
  });

  protected readonly num = num;
  protected readonly ctr = (clicks: number, impressions: number) => impressions > 0 ? pct(clicks / impressions, 2) : '—';
  protected readonly costPerClick = (cost: number, clicks: number) => clicks > 0 ? brl(cost / clicks) : '—';
  protected readonly decisionLabel = (recommendation: RecommendationView) => DECISION_LABEL[recommendation.category] ?? 'Investigar';
  protected readonly routeFor = (recommendation: RecommendationView) => recommendation.actionButton?.route ?? '/oportunidades';
  protected readonly evidenceText = (recommendation: RecommendationView) =>
    recommendation.evidence[0]?.text ?? 'A análise não trouxe uma evidência resumida para este item.';
  protected readonly sourceName = (source: 'ADS' | 'CRM' | 'NONE') => source === 'ADS' ? 'Google Ads' : source === 'CRM' ? 'CRM' : 'Indisponível';

  constructor() {
    this.insights.needCore();
  }
}
