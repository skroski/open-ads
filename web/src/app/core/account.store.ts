import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GoogleAdsApi } from '../data/google-ads.api';
import { CustomRange, DATE_RANGE_OPTIONS, DateRangeOption, previousWindow, resolveWindow, validateCustomRange } from '../domain/dates';
import { AccountRef } from '../domain/models';
import { ManagerIds } from './manager-ids';

const KEY_ACCOUNTS = 'gads_saved_accounts';
const KEY_SELECTED = 'gads_selected_account_id';
const KEY_RANGE = 'gads_date_range';
const KEY_CUSTOM = 'gads_date_custom';

export const digitsOnly = (value: string): string => (value ?? '').replace(/\D/g, '');

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento: a escolha vale só nesta sessão */
  }
}

/** Conta ativa, lista de contas conhecidas e período de análise (compartilhado por todas as telas). */
@Injectable({ providedIn: 'root' })
export class AccountStore {
  private readonly api = inject(GoogleAdsApi);

  readonly accounts = signal<AccountRef[]>(this.loadAccounts());
  readonly selectedId = signal<string>(digitsOnly(this.readSelected()));
  readonly range = signal<DateRangeOption>(this.loadRange());

  /** O servidor ainda está descobrindo qual é a conta padrão. */
  readonly discovering = signal(false);
  readonly discoveryError = signal<string | null>(null);

  readonly customRange = signal<CustomRange | null>(this.loadCustom());

  readonly window = computed(() => resolveWindow(this.range(), new Date(), this.customRange()));
  readonly previous = computed(() => previousWindow(this.window()));
  readonly rangeLabel = computed(
    () => DATE_RANGE_OPTIONS.find((o) => o.value === this.range())?.label ?? this.range(),
  );

  readonly selected = computed<AccountRef | null>(() => {
    const id = this.selectedId();
    if (!id) return null;
    return this.accounts().find((a) => digitsOnly(a.id) === id) ?? { id, name: `Conta ${id}` };
  });

  constructor() {
    const managers = inject(ManagerIds);
    managers.set(this.managerEntries(this.accounts()));
    effect(() => managers.set(this.managerEntries(this.accounts())));
    this.discover();
  }

  private managerEntries(accounts: readonly AccountRef[]): Array<[string, string]> {
    return accounts
      .filter((a) => a.loginCustomerId)
      .map((a) => [digitsOnly(a.id), digitsOnly(a.loginCustomerId!)] as [string, string]);
  }

  /**
   * Pergunta ao servidor quais contas estão acessíveis. Sem conta salva, o
   * servidor responde com a conta padrão configurada no ambiente.
   */
  discover(): void {
    this.discovering.set(true);
    this.discoveryError.set(null);
    this.api.accounts(this.selectedId() || undefined).subscribe({
      next: ({ results, currentCustomerId }) => {
        const found: AccountRef[] = results
          .map((r) => ({
            id: digitsOnly(String(r.customerClient?.id ?? '')),
            name: String(r.customerClient?.descriptiveName ?? '').trim(),
            manager: Boolean(r.customerClient?.manager),
          }))
          .filter((a) => a.id !== '')
          .map((a) => ({ ...a, name: a.name || `Conta ${a.id}` }));

        const byId = new Map<string, AccountRef>();
        this.accounts().forEach((a) => byId.set(digitsOnly(a.id), a));
        // Contas descobertas preservam o MCC e o apelido que o usuário cadastrou.
        found
          .filter((a) => !a.manager)
          .forEach((a) => {
            const saved = byId.get(a.id);
            byId.set(a.id, saved ? { ...a, name: saved.name || a.name, loginCustomerId: saved.loginCustomerId } : a);
          });
        const merged = Array.from(byId.values());
        this.accounts.set(merged);
        write(KEY_ACCOUNTS, JSON.stringify(merged));

        if (!this.selectedId()) {
          const fallback = digitsOnly(currentCustomerId) || merged[0]?.id || '';
          if (fallback) this.selectedId.set(fallback);
        }
        this.discovering.set(false);
      },
      error: (err) => {
        this.discoveryError.set(
          err?.error?.error ?? err?.message ?? 'Não foi possível consultar as contas do Google Ads.',
        );
        this.discovering.set(false);
      },
    });
  }

  select(id: string): void {
    const clean = digitsOnly(id);
    if (!clean) return;
    this.selectedId.set(clean);
    write(KEY_SELECTED, clean);
  }

  /**
   * Cadastra (ou atualiza) uma conta de cliente. `managerId` é a conta administradora
   * (MCC) pela qual o seu login enxerga o cliente; deixe vazio se o acesso é direto.
   */
  add(id: string, name: string, managerId = ''): boolean {
    const clean = digitsOnly(id);
    if (clean.length < 8) return false;
    const manager = digitsOnly(managerId);
    const account: AccountRef = { id: clean, name: name.trim() || `Conta ${clean}` };
    if (manager && manager !== clean) account.loginCustomerId = manager;
    this.save([...this.accounts().filter((a) => digitsOnly(a.id) !== clean), account]);
    this.select(clean);
    return true;
  }

  /**
   * Cadastra de uma vez todas as contas de cliente sob uma conta administradora (MCC).
   * Devolve quantas contas novas entraram na lista.
   */
  async importFromManager(managerId: string): Promise<number> {
    const manager = digitsOnly(managerId);
    if (manager.length < 8) throw new Error('Informe os 10 dígitos do MCC.');
    const { results } = await firstValueFrom(this.api.accounts(manager, manager));
    const known = new Set(this.accounts().map((a) => digitsOnly(a.id)));
    const clients: AccountRef[] = results
      .filter((r) => !r.customerClient?.manager)
      .map((r) => {
        const id = digitsOnly(String(r.customerClient?.id ?? ''));
        const name = String(r.customerClient?.descriptiveName ?? '').trim() || `Conta ${id}`;
        return { id, name, loginCustomerId: manager };
      })
      .filter((a) => a.id !== '' && a.id !== manager);
    const byId = new Map(this.accounts().map((a) => [digitsOnly(a.id), a] as const));
    clients.forEach((c) => byId.set(c.id, { ...c, name: byId.get(c.id)?.name || c.name }));
    this.save([...byId.values()]);
    if (!this.selectedId() && clients[0]) this.select(clients[0].id);
    return clients.filter((c) => !known.has(c.id)).length;
  }

  /** Tira a conta da lista deste navegador. Não apaga nada no Google Ads nem os dados locais dela. */
  remove(id: string): void {
    const clean = digitsOnly(id);
    const next = this.accounts().filter((a) => digitsOnly(a.id) !== clean);
    this.save(next);
    if (this.selectedId() === clean) {
      const fallback = next[0]?.id ?? '';
      this.selectedId.set(digitsOnly(fallback));
      write(KEY_SELECTED, digitsOnly(fallback));
    }
  }

  private save(accounts: AccountRef[]): void {
    this.accounts.set(accounts);
    write(KEY_ACCOUNTS, JSON.stringify(accounts));
  }

  setRange(range: DateRangeOption): void {
    this.range.set(range);
    write(KEY_RANGE, range);
  }

  /** Aplica um intervalo de datas livre; devolve a mensagem de erro, ou null quando aplicou. */
  setCustomRange(from: string, to: string): string | null {
    const error = validateCustomRange(from, to);
    if (error) return error;
    this.customRange.set({ from, to });
    write(KEY_CUSTOM, JSON.stringify({ from, to }));
    this.setRange('CUSTOM');
    return null;
  }

  private loadCustom(): CustomRange | null {
    const saved = readJson<CustomRange | null>(KEY_CUSTOM, null);
    return saved && !validateCustomRange(saved.from, saved.to) ? saved : null;
  }

  private loadAccounts(): AccountRef[] {
    const saved = readJson<AccountRef[]>(KEY_ACCOUNTS, []);
    // Remove o exemplo fictício que versões anteriores gravavam como conta de teste.
    return Array.isArray(saved) ? saved.filter((a) => digitsOnly(a?.id ?? '') !== '9999999999') : [];
  }

  private readSelected(): string {
    try {
      return localStorage.getItem(KEY_SELECTED) ?? '';
    } catch {
      return '';
    }
  }

  private loadRange(): DateRangeOption {
    try {
      const v = localStorage.getItem(KEY_RANGE) as DateRangeOption | null;
      if (v === 'CUSTOM' && !this.loadCustom()) return 'LAST_30_DAYS';
      return v && DATE_RANGE_OPTIONS.some((o) => o.value === v) ? v : 'LAST_30_DAYS';
    } catch {
      return 'LAST_30_DAYS';
    }
  }
}
