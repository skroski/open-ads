import { useEffect, useRef } from 'react';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { init, use, type EChartsCoreOption, type EChartsType } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useResolvedTheme } from '../theme';

// Só o que o app usa: mantém o pacote pequeno.
use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

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

/**
 * Gráfico ECharts. Recebe a opção pronta; o componente cuida do tema (texto e linhas
 * acompanham claro/escuro), do redimensionamento e de liberar o gráfico ao sair da tela.
 */
export function EChart({ option, height = 300, label }: { option: EChartsCoreOption; height?: number; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const theme = useResolvedTheme();

  useEffect(() => {
    if (!el.current) return;
    chart.current = init(el.current, undefined, { renderer: 'canvas' });
    const resize = new ResizeObserver(() => chart.current?.resize());
    resize.observe(el.current);
    return () => {
      resize.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chart.current) return;
    const dark = theme === 'dark';
    const text = dark ? '#bbbcbe' : '#5d6367';
    const line = dark ? 'rgba(255,255,255,.12)' : '#e6e6e6';
    chart.current.setOption(
      {
        textStyle: { fontFamily: 'Jost, sans-serif', color: text },
        legend: { type: 'scroll', textStyle: { color: text }, pageTextStyle: { color: text } },
        tooltip: { backgroundColor: '#2b2b2b', borderWidth: 0, textStyle: { color: '#fff', fontFamily: 'Jost, sans-serif' } },
        ...option,
        ...(option['legend'] ? { legend: { type: 'scroll', ...(option['legend'] as object), textStyle: { color: text }, pageTextStyle: { color: text } } } : {}),
        ...(option['xAxis'] ? { xAxis: axis(option['xAxis'], text, line) } : {}),
        ...(option['yAxis'] ? { yAxis: axis(option['yAxis'], text, line) } : {}),
      },
      { notMerge: true },
    );
  }, [option, theme]);

  return <div ref={el} role="img" aria-label={label} style={{ height }} className="block w-full" />;
}
