import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface BarItem {
  label: string;
  value: number;
  /** Texto exibido à direita (ex.: "R$ 1.930"). */
  display: string;
  tag?: string;
  /** Cor da barra (daisyUI `progress-*`). */
  tone?: 'error' | 'warning' | 'success' | 'info' | 'neutral';
  sub?: string;
}

// Nomes completos (não montados), para o Tailwind gerar as classes.
const TONE_CLASS: Record<NonNullable<BarItem['tone']>, string> = {
  error: 'progress-error',
  warning: 'progress-warning',
  success: 'progress-success',
  info: 'progress-info',
  neutral: 'progress-neutral',
};

/** Ranking em barras horizontais (daisyUI `progress`), proporcional ao maior valor. */
@Component({
  selector: 'app-bar-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="flex flex-col gap-4">
      @for (it of items(); track it.label + $index) {
        <li>
          <div class="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="font-medium break-words">{{ it.label }}</span>
              @if (it.tag) {
                <span class="badge badge-outline badge-xs">{{ it.tag }}</span>
              }
            </span>
            <span class="whitespace-nowrap font-medium tabular">{{ it.display }}</span>
          </div>
          <progress
            [class]="'progress h-2 w-full ' + toneClass(it.tone)"
            [value]="it.value"
            [max]="max()"
            [attr.aria-label]="it.label + ': ' + it.display"
          ></progress>
          @if (it.sub) {
            <div class="mt-1 text-xs text-base-content/60">{{ it.sub }}</div>
          }
        </li>
      } @empty {
        <li class="text-sm text-base-content/60">{{ empty() }}</li>
      }
    </ul>
  `,
})
export class BarList {
  readonly items = input.required<readonly BarItem[]>();
  readonly empty = input('Nada para mostrar no período.');
  protected readonly max = computed(() => Math.max(1, ...this.items().map((i) => i.value)));
  protected toneClass(t: BarItem['tone']): string {
    return t ? TONE_CLASS[t] : '';
  }
}
