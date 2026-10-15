import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  model,
  viewChild,
} from '@angular/core';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const WIDTH: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

/**
 * Modal sobre o <dialog> nativo do daisyUI: foco preso, ESC fecha, clique fora fecha.
 * `[(open)]` mantém o estado do pai em sincronia com o elemento.
 */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="modal" (close)="open.set(false)">
      <div class="modal-box w-full {{ width() }}">
        <ng-content />
      </div>
      <form method="dialog" class="modal-backdrop">
        <button type="submit" aria-label="Fechar">fechar</button>
      </form>
    </dialog>
  `,
})
export class AppModal {
  readonly open = model(false);
  readonly size = input<ModalSize>('md');

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly width = computed(() => WIDTH[this.size()]);

  constructor() {
    effect(() => {
      const el = this.dialog().nativeElement;
      const wantOpen = this.open();
      if (wantOpen && !el.open) el.showModal();
      else if (!wantOpen && el.open) el.close();
    });
  }
}
