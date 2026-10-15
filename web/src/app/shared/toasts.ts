import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastKind, ToastService } from '../core/toast.service';
import { Icon } from './icon';

const KIND_CLASS: Record<ToastKind, string> = {
  success: 'alert alert-success shadow-lg',
  error: 'alert alert-error shadow-lg',
  info: 'alert alert-info shadow-lg',
  warning: 'alert alert-warning shadow-lg',
};

@Component({
  selector: 'app-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="toast toast-end toast-bottom z-[60]" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div role="status" [class]="cls(t.kind)">
          <span class="max-w-sm break-words">{{ t.message }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-circle"
            aria-label="Dispensar"
            (click)="toasts.dismiss(t.id)"
          >
            <app-icon name="x" size="xs" />
          </button>
        </div>
      }
    </div>
  `,
})
export class Toasts {
  protected readonly toasts = inject(ToastService);
  protected cls = (kind: ToastKind): string => KIND_CLASS[kind];
}
