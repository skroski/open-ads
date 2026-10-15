import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Icon } from './icon';

/**
 * Indicador do topo das telas (daisyUI `stat`). Use dentro de `<div class="stats">`.
 *
 * A variação só aparece quando existe período anterior de verdade (`delta` não nulo);
 * sem ela, mostra `note`. `goodWhen` diz se subir é bom (verde) ou ruim (vermelho).
 */
@Component({
  selector: 'app-kpi',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { class: 'stat' },
  template: `
    <div class="stat-title flex items-center gap-2">
      {{ label() }}
      @if (tip()) {
        <span class="tooltip tooltip-bottom" [attr.data-tip]="tip()">
          <button type="button" class="inline-flex cursor-help text-base-content/60" [attr.aria-label]="'Sobre: ' + label()">
            <app-icon name="info" size="xs" />
          </button>
        </span>
      }
    </div>
    <div class="stat-value" [class.opacity-40]="unavailable()">{{ value() }}</div>
    <div class="stat-desc flex min-h-[22px] flex-wrap items-center gap-2">
      @if (delta() !== null) {
        <span [class]="deltaClass()" [attr.aria-label]="deltaAria()">
          <app-icon [name]="(delta() ?? 0) >= 0 ? 'trend-up' : 'trend-down'" size="xs" />
          {{ deltaText() }}
        </span>
        <span>vs. período anterior</span>
      } @else if (note()) {
        <span>{{ note() }}</span>
      }
    </div>
  `,
})
export class Kpi {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly tip = input('');
  /** Variação relativa (0,12 = +12%). null = sem período anterior comparável. */
  readonly delta = input<number | null>(null);
  readonly goodWhen = input<'up' | 'down' | 'neutral'>('up');
  readonly note = input('');
  /** Valor indisponível: aparece esmaecido. */
  readonly unavailable = input(false);

  protected readonly deltaText = computed(() => {
    const d = this.delta() ?? 0;
    return `${(Math.abs(d) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
  });

  protected readonly deltaClass = computed(() => {
    const d = this.delta() ?? 0;
    const good = this.goodWhen();
    const tone =
      good === 'neutral' || Math.abs(d) < 0.005
        ? 'badge-neutral'
        : (d > 0) === (good === 'up')
          ? 'badge-success'
          : 'badge-error';
    return `badge badge-soft badge-sm gap-1 tabular font-semibold ${tone}`;
  });

  protected readonly deltaAria = computed(() => {
    const d = this.delta() ?? 0;
    return `${d >= 0 ? 'Alta' : 'Queda'} de ${this.deltaText()} em relação ao período anterior`;
  });
}
