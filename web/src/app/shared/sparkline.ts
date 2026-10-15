import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Linha de tendência de 2px, área a 10%, ponto final de 8px com anel da cor do fundo.
 * Cor herdada do texto (currentColor), então funciona nos dois temas.
 */
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + w + ' ' + h"
      class="h-8 w-28 overflow-visible"
      role="img"
      [attr.aria-label]="label()"
    >
      @if (path(); as p) {
        <path [attr.d]="p.area" fill="currentColor" fill-opacity="0.1" />
        <path
          [attr.d]="p.line"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle [attr.cx]="p.x" [attr.cy]="p.y" r="4" fill="currentColor" class="stroke-base-100" stroke-width="2" />
      }
    </svg>
  `,
})
export class Sparkline {
  readonly values = input.required<readonly number[]>();
  readonly label = input('Tendência no período');

  protected readonly w = 112;
  protected readonly h = 32;

  protected readonly path = computed(() => {
    const v = this.values();
    if (v.length < 2) return null;
    const pad = 5;
    const min = Math.min(...v);
    const max = Math.max(...v);
    const span = max - min || 1;
    const step = (this.w - pad * 2) / (v.length - 1);
    const pts = v.map((val, i) => [pad + i * step, this.h - pad - ((val - min) / span) * (this.h - pad * 2)] as const);
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    const area = `${line} L${last[0].toFixed(1)} ${this.h} L${pts[0][0].toFixed(1)} ${this.h} Z`;
    return { line, area, x: last[0], y: last[1] };
  });
}
