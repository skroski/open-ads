import { ChangeDetectionStrategy, Component, inject, model, signal } from '@angular/core';
import { FormField, FormRoot, form, pattern, required } from '@angular/forms/signals';
import { BRAND } from '../brand';
import { AccountStore, digitsOnly } from '../core/account.store';
import { ToastService } from '../core/toast.service';
import { Icon } from './icon';
import { AppModal } from './modal';

const CUSTOMER_ID = /^\s*\d{3}[-\s]?\d{3}[-\s]?\d{4}\s*$/;
const OPTIONAL_CUSTOMER_ID = /^\s*(\d{3}[-\s]?\d{3}[-\s]?\d{4})?\s*$/;

const formatId = (id: string): string => {
  const d = digitsOnly(id);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d;
};

@Component({
  selector: 'app-account-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppModal, Icon, FormField, FormRoot],
  template: `
    <app-modal [(open)]="open" size="md">
      <h3 class="flex items-center gap-2 text-lg font-semibold">
        <app-icon name="building" /> Contas de clientes
      </h3>
      <p class="mt-1 text-sm text-base-content/70">
        Cada conta guarda as próprias metas, regras e histórico neste navegador. Alterne entre elas aqui.
      </p>

      <ul class="list mt-4 max-h-64 overflow-y-auto rounded-box border border-base-300">
        @for (acc of accounts.accounts(); track acc.id) {
          <li class="list-row items-center">
            <span
              class="status"
              [class.status-success]="isActive(acc.id)"
              [class.status-neutral]="!isActive(acc.id)"
            ></span>
            <div class="min-w-0">
              <div class="truncate font-medium">{{ acc.name }}</div>
              <div class="font-mono text-xs text-base-content/60">
                {{ formatId(acc.id) }}
                @if (acc.loginCustomerId) {
                  · via MCC {{ formatId(acc.loginCustomerId) }}
                }
              </div>
            </div>
            <div class="flex items-center gap-1">
              @if (isActive(acc.id)) {
                <span class="badge badge-soft badge-success">Ativa</span>
              } @else {
                <button type="button" class="btn btn-sm" (click)="choose(acc.id)">Selecionar</button>
              }
              <button
                type="button"
                class="btn btn-ghost btn-sm btn-square"
                [attr.aria-label]="'Tirar ' + acc.name + ' da lista'"
                (click)="remove(acc.id, acc.name)"
              >
                <app-icon name="trash" size="sm" />
              </button>
            </div>
          </li>
        } @empty {
          <li class="list-row text-sm text-base-content/60">Nenhuma conta cadastrada ainda.</li>
        }
      </ul>

      <div class="divider text-xs">Adicionar um cliente</div>

      <form [formRoot]="form" class="flex flex-col gap-2">
        <div class="grid gap-3 sm:grid-cols-2">
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Customer ID do cliente</legend>
            <input
              type="text"
              class="input w-full font-mono"
              placeholder="123-456-7890"
              inputmode="numeric"
              [formField]="form.id"
            />
            @if (form.id().touched() && form.id().errors().length) {
              <p class="label text-error">{{ form.id().errors()[0].message }}</p>
            }
          </fieldset>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Apelido (opcional)</legend>
            <input type="text" class="input w-full" [placeholder]="'Ex.: ' + brand.examples.accountName" [formField]="form.name" />
          </fieldset>
          <fieldset class="fieldset sm:col-span-2">
            <legend class="fieldset-legend">MCC que gerencia o cliente (opcional)</legend>
            <input
              type="text"
              class="input w-full font-mono"
              placeholder="123-456-7890"
              inputmode="numeric"
              [formField]="form.manager"
            />
            @if (form.manager().touched() && form.manager().errors().length) {
              <p class="label text-error">{{ form.manager().errors()[0].message }}</p>
            } @else {
              <p class="label whitespace-normal">
                O cliente precisa antes dar acesso ao seu login do Google ou vincular a conta ao seu MCC.
              </p>
            }
          </fieldset>
        </div>
        <div class="flex justify-end">
          <button type="submit" class="btn btn-primary">
            <app-icon name="plus" size="sm" /> Salvar e usar esta conta
          </button>
        </div>
      </form>

      <div class="divider text-xs">Ou importar todos os clientes de um MCC</div>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
        <fieldset class="fieldset grow">
          <legend class="fieldset-legend">ID do MCC</legend>
          <input
            #mcc
            type="text"
            class="input w-full font-mono"
            placeholder="123-456-7890"
            inputmode="numeric"
          />
        </fieldset>
        <button type="button" class="btn" [disabled]="importing()" (click)="importFrom(mcc.value)">
          @if (importing()) {
            <span class="loading loading-spinner loading-sm"></span>
          } @else {
            <app-icon name="download" size="sm" />
          }
          Importar clientes
        </button>
      </div>

      <div class="modal-action">
        <button type="button" class="btn btn-ghost" (click)="open.set(false)">Fechar</button>
      </div>
    </app-modal>
  `,
})
export class AccountModal {
  readonly open = model(false);
  protected readonly accounts = inject(AccountStore);
  private readonly toast = inject(ToastService);
  protected readonly brand = BRAND;
  protected readonly formatId = formatId;
  protected readonly importing = signal(false);

  private readonly value = signal({ id: '', name: '', manager: '' });

  protected readonly form = form(
    this.value,
    (p) => {
      required(p.id, { message: 'Informe o Customer ID da conta.' });
      pattern(p.id, CUSTOMER_ID, { message: 'Use 10 dígitos, ex.: 123-456-7890.' });
      pattern(p.manager, OPTIONAL_CUSTOMER_ID, { message: 'Use 10 dígitos, ex.: 123-456-7890.' });
    },
    {
      submission: {
        action: async () => {
          const { id, name, manager } = this.value();
          if (this.accounts.add(id, name, manager)) {
            this.value.set({ id: '', name: '', manager: '' });
            this.form().reset();
            this.open.set(false);
          }
          return undefined;
        },
      },
    },
  );

  protected isActive(id: string): boolean {
    return digitsOnly(id) === this.accounts.selectedId();
  }

  protected choose(id: string): void {
    this.accounts.select(id);
    this.open.set(false);
  }

  protected remove(id: string, name: string): void {
    if (!confirm(`Tirar "${name}" da lista? Nada é apagado no Google Ads.`)) return;
    this.accounts.remove(id);
  }

  protected async importFrom(managerId: string): Promise<void> {
    if (!CUSTOMER_ID.test(managerId)) {
      this.toast.error('Informe os 10 dígitos do MCC, ex.: 123-456-7890.');
      return;
    }
    this.importing.set(true);
    try {
      const added = await this.accounts.importFromManager(managerId);
      this.toast.success(added ? `${added} conta(s) de cliente importada(s).` : 'Nenhuma conta nova: todas já estavam na lista.');
    } catch (err: unknown) {
      const e = err as { error?: { error?: string }; message?: string };
      this.toast.error(`Não foi possível ler o MCC: ${String(e?.error?.error ?? e?.message ?? 'erro desconhecido').slice(0, 200)}`);
    } finally {
      this.importing.set(false);
    }
  }
}
