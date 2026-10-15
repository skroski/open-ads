import { DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FunnelStage, STAGE_HELP, STAGE_LABEL } from '../domain/models';
import { StageSource } from '../domain/funnel';

export interface FunnelBar {
  stage: FunnelStage;
  count: number;
  source: StageSource;
}

interface Row {
  stage: FunnelStage;
  label: string;
  help: string;
  count: number;
  source: StageSource;
  available: boolean;
  /** Largura 0–100. */
  width: number;
  /** Conversão a partir do estágio disponível anterior (fração), quando faz sentido. */
  fromPrevious: number | null;
}

const SOURCE_LABEL: Record<StageSource, string> = {
  ADS: 'Google Ads',
  CRM: 'CRM',
  NONE: 'indisponível',
};

/**
 * Funil como barras horizontais: uma série só, uma cor, valor na ponta.
 * Estágio sem fonte de dados aparece como "indisponível" (nunca como zero).
 */
@Component({
  selector: 'app-funnel-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, PercentPipe],
  template: `
    <ol class="flex flex-col gap-3" aria-label="Funil de qualidade">
      @for (r of rows(); track r.stage) {
        <li>
          <div class="flex items-baseline justify-between gap-3">
            <div class="min-w-0">
              <span class="text-sm font-medium" [attr.title]="r.help">{{ r.label }}</span>
              <span class="ml-2 text-xs text-base-content/60">{{ sourceLabel(r.source) }}</span>
            </div>
            <div class="shrink-0 text-right text-sm tabular">
              @if (r.available) {
                <span class="font-semibold">{{ r.count | number: '1.0-1' }}</span>
                @if (r.fromPrevious !== null) {
                  <span class="ml-1.5 text-xs text-base-content/60">{{ r.fromPrevious | percent: '1.0-1' }} do anterior</span>
                }
              } @else {
                <span class="text-base-content/50">—</span>
              }
            </div>
          </div>
          <div class="mt-1 h-2.5 rounded-full bg-base-200" role="img" [attr.aria-label]="ariaFor(r)">
            @if (r.available) {
              <div
                class="h-full rounded-full bg-primary"
                [style.width.%]="r.width"
                [style.min-width.px]="r.count > 0 ? 6 : 0"
              ></div>
            }
          </div>
        </li>
      }
    </ol>
  `,
})
export class FunnelBars {
  readonly bars = input.required<readonly FunnelBar[]>();

  protected readonly rows = computed<Row[]>(() => {
    const bars = this.bars();
    const max = Math.max(1, ...bars.filter((b) => b.source !== 'NONE').map((b) => b.count));
    let previous: number | null = null;
    return bars.map((b) => {
      const available = b.source !== 'NONE';
      const fromPrevious = available && previous !== null && previous > 0 ? b.count / previous : null;
      if (available) previous = b.count;
      return {
        stage: b.stage,
        label: STAGE_LABEL[b.stage],
        help: STAGE_HELP[b.stage],
        count: b.count,
        source: b.source,
        available,
        width: available ? (b.count / max) * 100 : 0,
        fromPrevious,
      };
    });
  });

  protected sourceLabel = (s: StageSource): string => SOURCE_LABEL[s];

  protected ariaFor(r: Row): string {
    return r.available
      ? `${r.label}: ${r.count} (${SOURCE_LABEL[r.source]})`
      : `${r.label}: indisponível, sem fonte de dados`;
  }
}
