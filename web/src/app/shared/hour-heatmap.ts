import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { HourRow } from '../domain/models';
import { brl, num } from '../domain/format';

interface Cell {
  weekday: number;
  hour: number;
  cost: number;
  clicks: number;
  conversions: number;
  level: number;
  text: string;
}

const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

/** Cinco degraus de um só tom: do vazio ao mais caro. Classes completas para o Tailwind enxergar. */
const LEVEL_CLASS = ['bg-base-200', 'bg-primary/20', 'bg-primary/40', 'bg-primary/65', 'bg-primary'];

/**
 * Mapa de calor dia da semana × hora, colorido pelo custo. Um só tom (sequencial),
 * leitura por hover ou foco e valores exatos na tabela por horário, ao lado.
 */
@Component({
  selector: 'app-hour-heatmap',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3">
      <p class="min-h-5 text-sm text-base-content/70" aria-live="polite">
        @if (active(); as c) {
          <strong>{{ c.text }}</strong>
        } @else {
          Passe o mouse ou foque uma célula para ver o custo e os resultados.
        }
      </p>

      <div class="overflow-x-auto">
        <div class="grid min-w-[40rem] grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] gap-1 text-[10px]">
          <div></div>
          @for (h of hours; track h) {
            <div class="text-center text-base-content/60">{{ h % 3 === 0 ? h : '' }}</div>
          }
          @for (d of dayNames; track d; let dayIndex = $index) {
            <div class="self-center pr-1 text-right text-base-content/70">{{ d }}</div>
            @for (h of hours; track h) {
              @let c = cell(dayIndex, h);
              <button
                type="button"
                class="aspect-square min-h-4 rounded-[3px] outline-offset-1 focus-visible:outline-2"
                [class]="levelClass(c.level)"
                [attr.aria-label]="c.text"
                (mouseenter)="active.set(c)"
                (focus)="active.set(c)"
                (mouseleave)="active.set(null)"
                (blur)="active.set(null)"
              ></button>
            }
          }
        </div>
      </div>

      <div class="flex items-center gap-2 text-xs text-base-content/60">
        <span>Menos</span>
        @for (c of legend; track c) {
          <span class="size-3.5 rounded-[3px]" [class]="c"></span>
        }
        <span>Mais custo</span>
      </div>
    </div>
  `,
})
export class HourHeatmap {
  readonly rows = input.required<readonly HourRow[]>();

  protected readonly hours = Array.from({ length: 24 }, (_, i) => i);
  protected readonly dayNames = DAYS;
  protected readonly legend = LEVEL_CLASS;
  protected readonly active = signal<Cell | null>(null);

  private readonly grid = computed(() => {
    const map = new Map<string, { cost: number; clicks: number; conversions: number }>();
    for (const r of this.rows()) {
      const k = `${r.weekday}:${r.hour}`;
      const e = map.get(k) ?? { cost: 0, clicks: 0, conversions: 0 };
      e.cost += r.cost;
      e.clicks += r.clicks;
      e.conversions += r.conversions;
      map.set(k, e);
    }
    const max = Math.max(0, ...Array.from(map.values(), (v) => v.cost));
    return { map, max };
  });

  protected cell(dayIndex: number, hour: number): Cell {
    const weekday = dayIndex + 1;
    const { map, max } = this.grid();
    const v = map.get(`${weekday}:${hour}`) ?? { cost: 0, clicks: 0, conversions: 0 };
    const level = v.cost <= 0 || max <= 0 ? 0 : Math.min(4, 1 + Math.floor((v.cost / max) * 4 - 0.0001));
    const hh = String(hour).padStart(2, '0');
    return {
      weekday,
      hour,
      ...v,
      level,
      text: `${DAYS[dayIndex]} às ${hh}h: ${brl(v.cost)}, ${num(v.clicks)} cliques, ${num(v.conversions, 1)} conversões`,
    };
  }

  protected levelClass = (level: number): string => LEVEL_CLASS[level];
}
