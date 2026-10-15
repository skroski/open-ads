import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, max, min, required } from '@angular/forms/signals';
import { BusinessConfigStore } from '../../core/business-config.store';
import { LeadsStore } from '../../core/collections';
import { ToastService } from '../../core/toast.service';
import { today } from '../../domain/dates';
import {
  ImportIssue,
  LEAD_FIELDS,
  LeadField,
  SAMPLE_CSV,
  guessMapping,
  normalizeRows,
  observedSalesCycleDays,
  parseCsv,
} from '../../domain/lead-import';
import { Lead, LeadStatus } from '../../domain/models';
import { median } from '../../domain/stats';
import { Icon } from '../../shared/icon';
import { AppModal } from '../../shared/modal';

const STATUS_LABEL: Record<LeadStatus, string> = {
  OPEN: 'Em aberto',
  QUALIFIED: 'Qualificado',
  PROPOSAL: 'Proposta',
  WON: 'Venda',
  LOST: 'Perdido',
  DISQUALIFIED: 'Sem perfil',
};

const STATUS_CLASS: Record<LeadStatus, string> = {
  OPEN: 'badge badge-soft badge-sm',
  QUALIFIED: 'badge badge-soft badge-info badge-sm',
  PROPOSAL: 'badge badge-soft badge-accent badge-sm',
  WON: 'badge badge-soft badge-success badge-sm',
  LOST: 'badge badge-soft badge-warning badge-sm',
  DISQUALIFIED: 'badge badge-soft badge-error badge-sm',
};

@Component({
  selector: 'app-leads-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppModal, CurrencyPipe, DecimalPipe, FormField, FormRoot, Icon],
  template: `
    <section class="card card-border bg-base-100">
      <div class="card-body gap-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="card-title text-base"><app-icon name="database" size="sm" /> Leads e vendas do CRM</h2>
            <p class="max-w-3xl text-sm text-base-content/70">
              O Google Ads só enxerga o contato inicial. Qualificação, proposta, venda e receita vêm daqui.
              Nome, e-mail e telefone <strong>não</strong> são importados.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-sm" (click)="openImport()">
              <app-icon name="upload" size="sm" /> Importar CSV
            </button>
            <button type="button" class="btn btn-sm" (click)="openManual()">
              <app-icon name="plus" size="sm" /> Adicionar lead
            </button>
            <button type="button" class="btn btn-ghost btn-sm" (click)="downloadTemplate()">
              <app-icon name="download" size="sm" /> Modelo
            </button>
          </div>
        </div>

        @if (leads().length) {
          <div class="stats stats-vertical w-full border border-base-300 sm:stats-horizontal">
            <div class="stat py-3">
              <div class="stat-title">Leads salvos</div>
              <div class="stat-value text-xl">{{ leads().length | number: '1.0-0' }}</div>
              <div class="stat-desc">de {{ oldest() }} até {{ newest() }}</div>
            </div>
            <div class="stat py-3">
              <div class="stat-title">Vendas</div>
              <div class="stat-value text-xl">{{ wonCount() }}</div>
              <div class="stat-desc">{{ revenue() | currency: 'BRL' : 'symbol' : '1.2-2' }} de receita</div>
            </div>
            <div class="stat py-3">
              <div class="stat-title">Ciclo de venda observado</div>
              <div class="stat-value text-xl">
                @if (cycle(); as c) {
                  {{ c.median | number: '1.0-0' }} dias
                } @else {
                  <span class="text-base-content/40">—</span>
                }
              </div>
              <div class="stat-desc">
                @if (cycle(); as c) {
                  Mediana de {{ c.n }} vendas.
                  <button type="button" class="link" (click)="useCycle(c.median)">Usar como meu ciclo</button>
                } @else {
                  Precisa de 3+ vendas com data de fechamento
                }
              </div>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>Contato em</th>
                  <th>Etapa</th>
                  <th>Campanha</th>
                  <th class="text-right">Valor</th>
                  <th>Motivo da perda</th>
                  <th><span class="sr-only">Remover</span></th>
                </tr>
              </thead>
              <tbody>
                @for (l of recent(); track l.id) {
                  <tr class="hover:bg-base-200/60">
                    <td class="tabular">{{ l.createdAt }}</td>
                    <td><span [class]="statusClass(l.status)">{{ statusLabel(l.status) }}</span></td>
                    <td class="max-w-56 truncate" [attr.title]="l.campaign">
                      @if (l.campaign) {
                        {{ l.campaign }}
                      } @else {
                        <span class="text-base-content/40">sem origem</span>
                      }
                    </td>
                    <td class="text-right tabular">
                      @if (l.value !== undefined) {
                        {{ l.value | currency: 'BRL' : 'symbol' : '1.2-2' }}
                      } @else {
                        <span class="text-base-content/40">—</span>
                      }
                    </td>
                    <td class="max-w-40 truncate text-base-content/70">{{ l.lostReason }}</td>
                    <td>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs btn-square"
                        aria-label="Remover lead"
                        (click)="remove(l.id)"
                      >
                        <app-icon name="trash" size="xs" />
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="flex items-center justify-between text-xs text-base-content/60">
            <span>Mostrando os {{ recent().length }} mais recentes de {{ leads().length }}.</span>
            <button type="button" class="btn btn-ghost btn-xs text-error" (click)="clearAll()">Apagar todos</button>
          </div>
        } @else {
          <div class="rounded-box border border-dashed border-base-300 p-6 text-center text-sm text-base-content/70">
            Nenhum lead salvo ainda. Importe um CSV do seu CRM para medir custo por lead qualificado, custo por
            cliente e ROI.
          </div>
        }
      </div>
    </section>

    <!-- Importação de CSV -->
    <app-modal [(open)]="importOpen" size="xl">
      <h3 class="flex items-center gap-2 text-lg font-semibold"><app-icon name="upload" /> Importar leads (CSV)</h3>

      @if (!rows().length) {
        <p class="mt-2 text-sm text-base-content/70">
          Exporte do seu CRM uma planilha com ao menos a data do primeiro contato e a etapa. Aceitamos vírgula,
          ponto e vírgula ou tabulação.
        </p>
        <input type="file" accept=".csv,text/csv,text/plain" class="file-input mt-4 w-full" (change)="onFile($event)" />
      } @else {
        <p class="mt-2 text-sm text-base-content/70">
          Arquivo <strong>{{ fileName() }}</strong>: {{ rows().length - 1 }} linhas. Confira como cada informação foi
          reconhecida.
        </p>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          @for (f of fields; track f.key) {
            <fieldset class="fieldset">
              <legend class="fieldset-legend">
                {{ f.label }}
                @if (f.required) {
                  <span class="text-error">*</span>
                }
              </legend>
              <select class="select select-sm w-full" [attr.aria-label]="f.label" (change)="setColumn(f.key, $event)">
                <option value="-1" [selected]="mapping()[f.key] === -1">— não importar —</option>
                @for (h of headers(); track $index) {
                  <option [value]="$index" [selected]="mapping()[f.key] === $index">{{ h }}</option>
                }
              </select>
              <p class="label whitespace-normal">{{ f.help }}</p>
            </fieldset>
          }
        </div>

        <div class="mt-4 rounded-box border border-base-300 p-3 text-sm">
          <div class="font-medium">
            {{ preview().leads.length }} leads válidos
            @if (preview().issues.length) {
              · {{ preview().issues.length }} avisos
            }
          </div>
          @if (preview().issues.length) {
            <ul class="mt-2 max-h-28 list-disc overflow-y-auto pl-5 text-xs text-base-content/70">
              @for (i of issueList(); track i.line + i.message) {
                <li>Linha {{ i.line }}: {{ i.message }}</li>
              }
            </ul>
          }
        </div>
      }

      <div class="modal-action">
        <button type="button" class="btn btn-ghost" (click)="importOpen.set(false)">Cancelar</button>
        @if (rows().length) {
          <button type="button" class="btn btn-ghost" (click)="resetImport()">Trocar arquivo</button>
          <button
            type="button"
            class="btn btn-primary"
            [disabled]="!preview().leads.length || mapping().createdAt < 0"
            (click)="confirmImport()"
          >
            Importar {{ preview().leads.length }} leads
          </button>
        }
      </div>
    </app-modal>

    <!-- Lead manual -->
    <app-modal [(open)]="manualOpen" size="md">
      <h3 class="flex items-center gap-2 text-lg font-semibold"><app-icon name="plus" /> Adicionar lead</h3>
      <form [formRoot]="manualForm" class="mt-4 grid gap-3 sm:grid-cols-2">
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Primeiro contato em</legend>
          <input type="date" class="input w-full" [formField]="manualForm.createdAt" />
          @if (manualForm.createdAt().touched() && manualForm.createdAt().errors().length) {
            <p class="label text-error">{{ manualForm.createdAt().errors()[0].message }}</p>
          }
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Etapa</legend>
          <select class="select w-full" [formField]="manualForm.status">
            <option value="OPEN">Em aberto</option>
            <option value="QUALIFIED">Qualificado</option>
            <option value="PROPOSAL">Proposta</option>
            <option value="WON">Venda</option>
            <option value="LOST">Perdido</option>
            <option value="DISQUALIFIED">Sem perfil</option>
          </select>
        </fieldset>
        <fieldset class="fieldset sm:col-span-2">
          <legend class="fieldset-legend">Campanha</legend>
          <input type="text" class="input w-full" placeholder="Nome da campanha de origem" [formField]="manualForm.campaign" />
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Valor da venda (R$)</legend>
          <input type="number" step="0.01" class="input w-full" [formField]="manualForm.value" />
          @if (manualForm.value().touched() && manualForm.value().errors().length) {
            <p class="label text-error">{{ manualForm.value().errors()[0].message }}</p>
          }
        </fieldset>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Margem (%)</legend>
          <input type="number" class="input w-full" [formField]="manualForm.marginPct" />
          @if (manualForm.marginPct().touched() && manualForm.marginPct().errors().length) {
            <p class="label text-error">{{ manualForm.marginPct().errors()[0].message }}</p>
          }
        </fieldset>
        <fieldset class="fieldset sm:col-span-2">
          <legend class="fieldset-legend">Motivo da perda (se houver)</legend>
          <input type="text" class="input w-full" [formField]="manualForm.lostReason" />
        </fieldset>
        <div class="modal-action sm:col-span-2">
          <button type="button" class="btn btn-ghost" (click)="manualOpen.set(false)">Cancelar</button>
          <button type="submit" class="btn btn-primary">Salvar lead</button>
        </div>
      </form>
    </app-modal>
  `,
})
export class LeadsPanel {
  private readonly store = inject(LeadsStore);
  private readonly cfg = inject(BusinessConfigStore);
  private readonly toast = inject(ToastService);

  protected readonly fields = LEAD_FIELDS;
  protected readonly leads = this.store.items;

  protected readonly recent = computed(() =>
    [...this.leads()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50),
  );
  protected readonly oldest = computed(() => this.leads().reduce((m, l) => (l.createdAt < m ? l.createdAt : m), '9999'));
  protected readonly newest = computed(() => this.leads().reduce((m, l) => (l.createdAt > m ? l.createdAt : m), '0000'));
  protected readonly wonCount = computed(() => this.leads().filter((l) => l.status === 'WON').length);
  protected readonly revenue = computed(() =>
    this.leads().reduce((s, l) => s + (l.status === 'WON' ? (l.value ?? 0) : 0), 0),
  );
  protected readonly cycle = computed(() => {
    const days = observedSalesCycleDays(this.leads());
    const m = days.length >= 3 ? median(days) : null;
    return m === null ? null : { median: Math.round(m), n: days.length };
  });

  // ── Importação
  protected readonly importOpen = signal(false);
  protected readonly rows = signal<string[][]>([]);
  protected readonly fileName = signal('');
  protected readonly mapping = signal<Record<LeadField, number>>(guessMapping([]));

  protected readonly headers = computed(() => this.rows()[0] ?? []);
  protected readonly preview = computed(() => normalizeRows(this.rows().slice(1), this.mapping()));
  protected readonly issueList = computed<ImportIssue[]>(() => this.preview().issues.slice(0, 50));

  protected openImport(): void {
    this.resetImport();
    this.importOpen.set(true);
  }

  protected resetImport(): void {
    this.rows.set([]);
    this.fileName.set('');
    this.mapping.set(guessMapping([]));
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      this.toast.error('O arquivo precisa ter o cabeçalho e ao menos uma linha de dados.');
      return;
    }
    this.fileName.set(file.name);
    this.rows.set(parsed);
    this.mapping.set(guessMapping(parsed[0]));
  }

  protected setColumn(field: LeadField, event: Event): void {
    const idx = Number((event.target as HTMLSelectElement).value);
    this.mapping.update((m) => ({ ...m, [field]: idx }));
  }

  protected async confirmImport(): Promise<void> {
    const { leads } = this.preview();
    const result = await this.store.importMany(leads);
    this.toast.success(
      `${result.added} leads novos${result.updated ? ` e ${result.updated} atualizados` : ''}. O funil foi recalculado.`,
    );
    this.importOpen.set(false);
    this.resetImport();
  }

  protected downloadTemplate(): void {
    const blob = new Blob(['﻿' + SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-leads.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Lead manual
  protected readonly manualOpen = signal(false);
  private readonly manualValue = signal({
    createdAt: today(),
    status: 'OPEN' as LeadStatus,
    campaign: '',
    value: 0,
    marginPct: 0,
    lostReason: '',
  });

  protected readonly manualForm = form(
    this.manualValue,
    (p) => {
      required(p.createdAt, { message: 'Informe a data do primeiro contato.' });
      min(p.value, 0, { message: 'O valor não pode ser negativo.' });
      min(p.marginPct, 0, { message: 'Use entre 0 e 100.' });
      max(p.marginPct, 100, { message: 'Use entre 0 e 100.' });
    },
    {
      submission: {
        action: async () => {
          const v = this.manualValue();
          const won = v.status === 'WON';
          await this.store.add({
            createdAt: v.createdAt,
            status: v.status,
            campaign: v.campaign.trim() || undefined,
            value: won && v.value > 0 ? v.value : undefined,
            marginPct: won && v.marginPct > 0 ? v.marginPct : undefined,
            lostReason: v.lostReason.trim() || undefined,
            wonAt: won ? v.createdAt : undefined,
          } as Omit<Lead, 'id' | 'accountId'>);
          this.toast.success('Lead salvo.');
          this.manualOpen.set(false);
          return undefined;
        },
      },
    },
  );

  protected openManual(): void {
    this.manualValue.set({ createdAt: today(), status: 'OPEN', campaign: '', value: 0, marginPct: 0, lostReason: '' });
    this.manualForm().reset();
    this.manualOpen.set(true);
  }

  // ── Ações
  protected statusLabel = (s: LeadStatus): string => STATUS_LABEL[s];
  protected statusClass = (s: LeadStatus): string => STATUS_CLASS[s];

  protected async remove(id: string): Promise<void> {
    await this.store.remove(id);
  }

  protected async clearAll(): Promise<void> {
    if (!confirm('Apagar todos os leads salvos desta conta? Isso não afeta o Google Ads.')) return;
    await this.store.clear();
    this.toast.info('Leads apagados.');
  }

  protected useCycle(days: number): void {
    this.cfg.updateGoal({ salesCycleDays: days });
    this.toast.success(`Ciclo de venda ajustado para ${days} dias.`);
  }
}
