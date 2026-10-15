import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Icon } from './icon';
import { IconName } from './icons';

export type DiagnosisTone = 'bad' | 'warn' | 'info' | 'ok';

const TONE: Record<DiagnosisTone, { cls: string; icon: IconName; text: string }> = {
  bad: { cls: 'alert-error', icon: 'warning', text: 'text-error' },
  warn: { cls: 'alert-warning', icon: 'warning', text: 'text-warning' },
  info: { cls: 'alert-info', icon: 'info', text: 'text-info' },
  ok: { cls: 'alert-success', icon: 'check', text: 'text-success' },
};

/** Faixa de diagnóstico das telas analíticas (daisyUI `alert`): a leitura principal em uma frase. */
@Component({
  selector: 'app-diagnosis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <section role="status" [class]="'alert alert-soft items-start gap-4 px-6 py-4 ' + tone().cls">
      <app-icon [name]="tone().icon" [class]="tone().text" />
      <div class="min-w-0">
        <div [class]="'mb-1 font-display text-xs font-semibold uppercase tracking-[0.09em] ' + tone().text">Diagnóstico</div>
        <h2 class="text-xl font-medium leading-snug text-base-content">{{ title() }}</h2>
        <div class="mt-2 max-w-3xl text-sm leading-relaxed text-base-content text-pretty"><ng-content /></div>
      </div>
    </section>
  `,
})
export class Diagnosis {
  readonly title = input.required<string>();
  readonly kind = input<DiagnosisTone>('info');
  protected readonly tone = computed(() => TONE[this.kind()]);
}
