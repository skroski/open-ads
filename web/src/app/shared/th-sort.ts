import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Icon } from './icon';

export type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-th-sort',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <button
      type="button"
      class="group inline-flex items-center gap-1.5 cursor-pointer select-none font-medium text-inherit hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded transition-colors"
      [class.justify-end]="align() === 'right'"
      [class.w-full]="align() === 'right'"
      (click)="toggle()"
      [attr.aria-sort]="active() ? (direction() === 'asc' ? 'ascending' : 'descending') : 'none'"
    >
      <span><ng-content /></span>
      <span
        class="inline-flex items-center transition-opacity"
        [class.opacity-100]="active()"
        [class.opacity-30]="!active()"
        [class.group-hover:opacity-75]="!active()"
      >
        @if (active()) {
          @if (direction() === 'asc') {
            <app-icon name="chevron-up" size="xs" class="text-primary" />
          } @else {
            <app-icon name="chevron-down" size="xs" class="text-primary" />
          }
        } @else {
          <app-icon name="chevrons-up-down" size="xs" class="opacity-40 group-hover:opacity-100" />
        }
      </span>
    </button>
  `,
})
export class ThSort {
  readonly field = input.required<string>();
  readonly current = input<string | null>(null);
  readonly direction = input<SortDirection>('desc');
  readonly align = input<'left' | 'right' | 'center'>('left');
  readonly sort = output<{ field: string; direction: SortDirection }>();

  protected readonly active = computed(() => this.current() === this.field());

  toggle(): void {
    let nextDir: SortDirection;
    if (this.active()) {
      nextDir = this.direction() === 'desc' ? 'asc' : 'desc';
    } else {
      nextDir = this.align() === 'right' ? 'desc' : 'asc';
    }
    this.sort.emit({ field: this.field(), direction: nextDir });
  }
}
