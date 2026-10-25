import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { FORECAST as FORECAST_RULES } from '../domain/config';
import { addDays } from '../domain/dates';
import { SOURCE_LABEL } from '../domain/provenance';
import { DailyRow } from '../domain/models';
import { brl, num, pct } from '../domain/format';
import { ForecastMetric, ForecastReady, METHOD_TEXT, METRIC_LABEL, dailySeries, forecastMetric } from '../domain/forecast';
import { describeShortfall } from '../domain/sufficiency';
import { EChart } from './echart';
import { Icon } from './icon';

const METRICS: readonly ForecastMetric[] = ['clicks', 'cost', 'conversions'];
const SHOWN_HISTORY_DAYS = 42;

// Classes escritas por inteiro: o Tailwind só gera o que encontra no código.
const CONFIDENCE_LABEL = { HIGH: 'Confiança alta', MEDIUM: 'Confiança média', LOW: 'Confiança baixa' } as const;

const ACTUAL = '#3d7ea6';
const FORECAST = '#d98a00';

const dm = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

function format(metric: ForecastMetric, value: number): string {
  if (metric === 'cost') return brl(value);
  if (metric === 'conversions') return num(value, 1);
  return num(value);
}

/**
 * Previsão dos próximos dias sobre o histórico da conta. O gráfico mantém o realizado em linha cheia e a
 * previsão tracejada, com a faixa provável (80%) sombreada. Quando não há base para prever, diz o que falta.
 */
@Component({
  selector: 'app-forecast-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EChart, Icon],
  template: `
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Para onde vai</h2>
        <p class="text-sm text-base-content/70">
          Previsão calculada sobre o histórico da sua conta, não uma promessa do Google Ads.
        </p>
      </div>
      <div role="tablist" class="tabs tabs-box tabs-sm" aria-label="Métrica da previsão">
        @for (m of metrics; track m) {
          <button
            type="button"
            role="tab"
            class="tab"
            [class.tab-active]="m === metric()"
            [attr.aria-selected]="m === metric()"
            (click)="metric.set(m)"
          >
            {{ label(m) }}
          </button>
        }
      </div>
    </div>

    @switch (result().status) {
      @case ('ready') {
        @if (ready(); as r) {
          <app-echart [option]="option()" [height]="280" [label]="ariaLabel()" />
          <div class="mt-2 flex flex-col gap-1 text-sm">
            <p>
              <strong>Próximos {{ r.horizon }} dias:</strong>
              {{ fmt(r.total.value) }} {{ unit() }}, com 80% de chance de ficar entre {{ fmt(r.total.low) }} e
              {{ fmt(r.total.high) }}.
            </p>
            <p class="text-base-content/70">
              Teste com dias passados: nos {{ r.tests }} testes mais recentes, o total previsto errou em média
              {{ pct(r.error) }}. {{ confidenceLabel() }}.
            </p>
            <details class="text-xs text-base-content/60">
              <summary class="cursor-pointer">Como chegamos aqui</summary>
              <p class="mt-1">
                Origem: {{ source('GOOGLE_ADS') }} ({{ r.basis.days }} dias, de {{ dm(r.basis.from) }} a {{ dm(r.basis.to) }})
                e {{ source('CALCULATION').toLowerCase() }}. {{ method }} Hoje ainda não entra no realizado, pois o
                dia não terminou.
              </p>
              @for (reason of r.confidence.reasons; track $index) {
                <p>{{ reason }}</p>
              }
            </details>
          </div>
        }
      }
      @case ('insufficient') {
        <div role="status" class="alert alert-soft mt-3">
          <app-icon name="clock" />
          <div class="text-sm">
            <p class="font-medium">Ainda não há dados para prever {{ label(metric()).toLowerCase() }}.</p>
            <p>{{ shortfall() }}</p>
            <p class="text-xs text-base-content/60">
              Em vez de chutar, o painel espera. Quando o histórico chegar, a previsão aparece aqui.
            </p>
          </div>
        </div>
      }
      @case ('blocked') {
        <div role="status" class="alert alert-warning alert-soft mt-3">
          <app-icon name="warning" />
          <span class="text-sm">{{ blockedReason() }}</span>
        </div>
      }
      @case ('unstable') {
        <div role="status" class="alert alert-soft mt-3">
          <app-icon name="info" />
          <div class="text-sm">
            <p class="font-medium">Previsão instável nesta conta.</p>
            <p>
              Em dias passados, o total previsto errou em média {{ pct(unstableError()) }}, acima do limite de
              {{ pct(maxError) }}. Por isso a previsão não é exibida.
            </p>
          </div>
        </div>
      }
    }
  `,
})
export class ForecastChart {
  readonly daily = input.required<readonly DailyRow[]>();
  /** Último dia com dados fechados (YYYY-MM-DD). */
  readonly end = input.required<string>();
  readonly trackingBroken = input(false);

  protected readonly metrics = METRICS;
  protected readonly metric = signal<ForecastMetric>('clicks');
  protected readonly method = METHOD_TEXT;
  protected readonly maxError = FORECAST_RULES.maxError;

  protected readonly result = computed(() =>
    forecastMetric(this.daily(), this.metric(), this.end(), { trackingBroken: this.trackingBroken() }),
  );

  protected readonly ready = computed<ForecastReady | null>(() => {
    const r = this.result();
    return r.status === 'ready' ? r : null;
  });

  protected readonly shortfall = computed(() => {
    const r = this.result();
    return r.status === 'insufficient' ? describeShortfall(r.sufficiency) : '';
  });

  protected readonly blockedReason = computed(() => {
    const r = this.result();
    return r.status === 'blocked' ? r.reason : '';
  });

  protected readonly unstableError = computed(() => {
    const r = this.result();
    return r.status === 'unstable' ? r.error : 0;
  });

  protected readonly unit = computed(() => (this.metric() === 'cost' ? '' : this.label(this.metric()).toLowerCase()));

  protected readonly confidenceLabel = computed(() => {
    const r = this.ready();
    return r ? CONFIDENCE_LABEL[r.confidence.level] : '';
  });

  protected readonly ariaLabel = computed(() => {
    const r = this.ready();
    return r
      ? `Previsão de ${this.label(this.metric()).toLowerCase()} para os próximos ${r.horizon} dias, com faixa provável de ${this.fmt(r.total.low)} a ${this.fmt(r.total.high)}.`
      : '';
  });

  protected readonly option = computed<EChartsCoreOption>(() => {
    const r = this.ready();
    if (!r) return {};
    const metric = this.metric();
    const hist = dailySeries(this.daily(), metric, this.end());
    const values = (hist?.values ?? []).slice(-SHOWN_HISTORY_DAYS);
    const first = addDays(this.end(), -(values.length - 1));
    const past = values.map((_, i) => addDays(first, i));
    const dates = [...past, ...r.points.map((p) => p.date)];
    const gap = (n: number): null[] => new Array<null>(n).fill(null);
    const round = (n: number): number => Math.round(n * 100) / 100;
    const lastActual = values.length - 1;

    const actual = [...values.map(round), ...gap(r.points.length)];
    // A linha da previsão parte do último dia realizado para não ficar solta.
    const forecast = [...gap(lastActual), round(values[lastActual] ?? 0), ...r.points.map((p) => round(p.value))];
    const low = [...gap(lastActual), round(values[lastActual] ?? 0), ...r.points.map((p) => round(p.low))];
    const range = [...gap(lastActual), 0, ...r.points.map((p) => round(p.high - p.low))];

    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: Array<{ dataIndex: number }>) => {
          const i = params[0]?.dataIndex ?? 0;
          const head = `<strong>${dm(dates[i])}</strong>`;
          if (i < past.length) return `${head}<br/>Realizado: ${format(metric, values[i])}`;
          const p = r.points[i - past.length];
          return `${head}<br/>Previsão: ${format(metric, p.value)}<br/>Faixa provável: ${format(metric, p.low)} a ${format(metric, p.high)}`;
        },
      },
      legend: { bottom: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4, data: ['Realizado', 'Previsão', 'Faixa provável (80%)'] },
      grid: { left: 10, right: 10, top: 18, bottom: 36, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: dates.map(dm) },
      yAxis: {
        type: 'value',
        min: 0,
        axisLabel: { formatter: (v: number) => (metric === 'cost' ? brl(v).replace(',00', '') : num(v)) },
      },
      series: [
        {
          name: 'Realizado',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 2.5, color: ACTUAL },
          itemStyle: { color: ACTUAL },
          data: actual,
        },
        // Base invisível da faixa: o limite inferior empilhado sob a diferença até o superior.
        {
          name: 'Limite inferior',
          type: 'line',
          stack: 'faixa',
          showSymbol: false,
          silent: true,
          lineStyle: { opacity: 0 },
          itemStyle: { opacity: 0 },
          data: low,
        },
        {
          name: 'Faixa provável (80%)',
          type: 'line',
          stack: 'faixa',
          showSymbol: false,
          silent: true,
          lineStyle: { opacity: 0 },
          itemStyle: { color: FORECAST, opacity: 0.25 },
          areaStyle: { color: FORECAST, opacity: 0.2 },
          data: range,
        },
        {
          name: 'Previsão',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 2.5, type: 'dashed', color: FORECAST },
          itemStyle: { color: FORECAST },
          data: forecast,
        },
      ],
    };
  });

  protected label(m: ForecastMetric): string {
    return METRIC_LABEL[m];
  }

  protected fmt(value: number): string {
    return format(this.metric(), value);
  }

  protected pct(ratio: number): string {
    return pct(ratio, 0);
  }

  protected source(key: 'GOOGLE_ADS' | 'CALCULATION'): string {
    return SOURCE_LABEL[key];
  }

  protected dm(date: string): string {
    return dm(date);
  }
}
