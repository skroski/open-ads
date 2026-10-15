import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BatchNegatives } from '../core/batch-negatives';
import { MatchType } from '../domain/models';
import { Icon } from './icon';
import { MATCH_LABEL } from './labels';
import { AppModal } from './modal';

@Component({
  selector: 'app-batch-negative-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppModal, Icon],
  template: `
    <app-modal [open]="batch.open()" (openChange)="batch.open.set($event)" size="lg">
      <h3 class="flex items-center gap-2 text-lg font-semibold">
        <app-icon name="ban" /> Negativar palavras em lote
        <span class="badge badge-soft badge-neutral">{{ batch.terms().length }} termos</span>
      </h3>
      <p class="mt-1 text-sm text-base-content/70">
        As palavras negativas são gravadas direto na conta do Google Ads e passam a bloquear esse tráfego.
      </p>

      @if (batch.error(); as message) {
        <div role="alert" class="alert alert-error alert-soft mt-4">
          <app-icon name="warning" />
          <span class="break-words text-sm">{{ message }}</span>
        </div>
      }

      <div class="mt-5 grid gap-4 sm:grid-cols-2">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Tipo de correspondência</legend>
          <div class="join w-full">
            @for (m of matchTypes; track m) {
              <button
                type="button"
                class="btn btn-sm join-item flex-1"
                [class.btn-active]="batch.matchType() === m"
                [attr.aria-pressed]="batch.matchType() === m"
                (click)="batch.matchType.set(m)"
              >
                {{ label(m) }}
              </button>
            }
          </div>
          <p class="label whitespace-normal">
            @switch (batch.matchType()) {
              @case ('EXACT') {
                Bloqueia só a busca idêntica. É a opção mais segura.
              }
              @case ('PHRASE') {
                Bloqueia buscas que contenham a expressão, na mesma ordem.
              }
              @default {
                Bloqueia buscas com as palavras em qualquer ordem. Use com cuidado.
              }
            }
          </p>
        </fieldset>

        <fieldset class="fieldset">
          <legend class="fieldset-legend">Campanha de destino</legend>
          <select
            class="select w-full"
            (change)="onTarget($event)"
            aria-label="Campanha de destino"
          >
            <option value="ALL" [selected]="batch.target() === 'ALL'">Todas as campanhas da conta</option>
            @for (c of batch.campaigns(); track c.id) {
              <option [value]="c.id" [selected]="batch.target() === c.id">{{ c.name }}</option>
            }
          </select>
          <p class="label whitespace-normal">"Todas" protege a conta inteira contra esses termos.</p>
        </fieldset>
      </div>

      <div class="mt-4">
        <div class="mb-2 flex items-center justify-between text-sm font-medium">
          <span>Termos a negativar</span>
          <button type="button" class="btn btn-ghost btn-xs" (click)="batch.clear()">Remover todos</button>
        </div>
        <div
          class="flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-box border border-base-300 bg-base-200 p-3"
        >
          @for (term of batch.terms(); track term) {
            <span class="badge badge-neutral badge-lg gap-1 font-mono text-xs">
              {{ shown(term) }}
              <button
                type="button"
                class="opacity-70 hover:opacity-100"
                [attr.aria-label]="'Remover ' + term"
                (click)="batch.remove(term)"
              >
                <app-icon name="x" size="xs" />
              </button>
            </span>
          } @empty {
            <span class="text-sm text-base-content/60">Nenhum termo selecionado.</span>
          }
        </div>
      </div>

      <div class="modal-action">
        <button type="button" class="btn btn-ghost" (click)="batch.open.set(false)">Cancelar</button>
        <button
          type="button"
          class="btn btn-error"
          [disabled]="batch.submitting() || batch.terms().length === 0"
          (click)="batch.submit()"
        >
          @if (batch.submitting()) {
            <span class="loading loading-spinner loading-xs"></span> Enviando…
          } @else {
            <app-icon name="check" size="sm" /> Confirmar e negativar
          }
        </button>
      </div>
    </app-modal>
  `,
})
export class BatchNegativeModal {
  protected readonly batch = inject(BatchNegatives);
  protected readonly matchTypes: readonly MatchType[] = ['EXACT', 'PHRASE', 'BROAD'];

  protected label(m: MatchType): string {
    return MATCH_LABEL[m];
  }

  protected shown(term: string): string {
    const m = this.batch.matchType();
    return m === 'EXACT' ? `[${term}]` : m === 'PHRASE' ? `"${term}"` : term;
  }

  protected onTarget(event: Event): void {
    this.batch.target.set((event.target as HTMLSelectElement).value);
  }
}
