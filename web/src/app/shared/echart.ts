import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { EChartsCoreOption, EChartsType, init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { ThemeService } from '../core/theme.service';

// Só o que o app usa: mantém o pacote pequeno e fora do carregamento inicial.
use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

/** Cores das categorias de veredito, iguais às do tema (claro e escuro funcionam). */
export const VERDICT_COLOR = {
  waste: '#c0392b',
  above: '#f1a10b',
  performing: '#5c9c2f',
  insufficient: '#9a9a9a',
  tracking: '#3d7ea6',
} as const;

/**
 * Gráfico ECharts. Recebe a opção pronta; o componente cuida do tema (texto e linhas
 * acompanham claro/escuro), do redimensionamento e de liberar o gráfico ao sair da tela.
 */
@Component({
  selector: 'app-echart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full' },
  template: `<div #el role="img" [attr.aria-label]="label()" [style.height.px]="height()" class="w-full"></div>`,
})
export class EChart {
  readonly option = input.required<EChartsCoreOption>();
  readonly height = input(300);
  /** Descrição para leitores de tela. */
  readonly label = input.required<string>();

  /** Clique numa barra ou fatia: nome da categoria do eixo e da série. */
  readonly pick = output<{ name: string; seriesName?: string; dataIndex: number }>();

  private readonly el = viewChild.required<ElementRef<HTMLDivElement>>('el');
  private readonly theme = inject(ThemeService);
  private chart: EChartsType | null = null;

  constructor() {
    const resize = new ResizeObserver(() => this.chart?.resize());
    inject(DestroyRef).onDestroy(() => {
      resize.disconnect();
      this.chart?.dispose();
    });

    afterRenderEffect({
      write: () => {
        const dark = this.theme.resolved() === 'dark';
        const option = this.option();
        if (!this.chart) {
          const dom = this.el().nativeElement;
          if (dom.clientWidth === 0 && dom.clientHeight === 0) return;
          this.chart = init(dom, undefined, { renderer: 'canvas' });
          this.chart.on('click', (p) =>
            this.pick.emit({ name: String(p.name ?? ''), seriesName: p.seriesName, dataIndex: p.dataIndex ?? 0 }),
          );
          resize.observe(dom);
        }
        const text = dark ? '#bbbcbe' : '#5d6367';
        const line = dark ? 'rgba(255,255,255,.12)' : '#e6e6e6';
        this.chart.setOption(
          {
            textStyle: { fontFamily: 'Jost, sans-serif', color: text },
            legend: { type: 'scroll', textStyle: { color: text }, pageTextStyle: { color: text } },
            tooltip: {
              backgroundColor: '#2b2b2b',
              borderWidth: 0,
              textStyle: { color: '#fff', fontFamily: 'Jost, sans-serif' },
            },
            ...option,
            ...(option['legend'] ? { legend: { type: 'scroll', ...(option['legend'] as object), textStyle: { color: text }, pageTextStyle: { color: text } } } : {}),
            ...(option['xAxis'] ? { xAxis: axis(option['xAxis'], text, line) } : {}),
            ...(option['yAxis'] ? { yAxis: axis(option['yAxis'], text, line) } : {}),
          },
          { notMerge: true },
        );
      },
    });
  }
}

/** Aplica as cores do tema aos eixos sem apagar o que a tela configurou (formatador, largura…). */
function axis(value: unknown, text: string, line: string): unknown {
  const style = (a: Record<string, unknown>) => {
    const label = (a['axisLabel'] as Record<string, unknown> | undefined) ?? {};
    const axisLine = (a['axisLine'] as Record<string, unknown> | undefined) ?? {};
    const split = (a['splitLine'] as Record<string, unknown> | undefined) ?? {};
    return {
      ...a,
      axisLabel: { hideOverlap: true, ...label, color: text },
      axisLine: { ...axisLine, lineStyle: { ...(axisLine['lineStyle'] as object), color: line } },
      splitLine: { ...split, lineStyle: { ...(split['lineStyle'] as object), color: line } },
    };
  };
  return Array.isArray(value) ? value.map((a) => style(a as Record<string, unknown>)) : style(value as Record<string, unknown>);
}
