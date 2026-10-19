import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DATE_RANGE_OPTIONS, previousWindow, resolveWindow, type DateRangeOption, type DateWindow } from '@shared/domain/dates';
import type { AccountRef } from '@shared/domain/models';
import { accounts as fetchAccounts } from '../lib/api';
import { setManagerIds } from '../lib/http';
import { readJson, readString, writeString } from '../lib/storage';

/** Mesmas chaves do AccountStore do Angular: conta e período valem nas duas versões. */
const KEY_ACCOUNTS = 'gads_saved_accounts';
const KEY_SELECTED = 'gads_selected_account_id';
const KEY_RANGE = 'gads_date_range';

export const digitsOnly = (value: string): string => (value ?? '').replace(/\D/g, '');

function loadAccounts(): AccountRef[] {
  const saved = readJson<AccountRef[]>(KEY_ACCOUNTS, []);
  // Remove o exemplo fictício que versões anteriores gravavam como conta de teste.
  return Array.isArray(saved) ? saved.filter((a) => digitsOnly(a?.id ?? '') !== '9999999999') : [];
}

function loadRange(): DateRangeOption {
  const v = readString(KEY_RANGE) as DateRangeOption;
  return DATE_RANGE_OPTIONS.some((o) => o.value === v) ? v : 'LAST_30_DAYS';
}

function managerEntries(list: readonly AccountRef[]): Array<[string, string]> {
  return list.filter((a) => a.loginCustomerId).map((a) => [digitsOnly(a.id), digitsOnly(a.loginCustomerId!)] as [string, string]);
}

export interface AccountContextValue {
  accounts: AccountRef[];
  selectedId: string;
  selected: AccountRef | null;
  range: DateRangeOption;
  rangeLabel: string;
  window: DateWindow;
  previous: DateWindow;
  discovering: boolean;
  discoveryError: string | null;
  discover(): void;
  select(id: string): void;
  setRange(range: DateRangeOption): void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

/** Conta ativa, lista de contas conhecidas e período de análise, compartilhados por todas as telas. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountRef[]>(loadAccounts);
  const [selectedId, setSelectedId] = useState<string>(() => digitsOnly(readString(KEY_SELECTED)));
  const [range, setRangeState] = useState<DateRangeOption>(loadRange);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  setManagerIds(managerEntries(accounts));

  /**
   * Pergunta ao servidor quais contas estão acessíveis. Sem conta salva, o
   * servidor responde com a conta padrão configurada no ambiente.
   */
  const discover = useCallback(() => {
    setDiscovering(true);
    setDiscoveryError(null);
    fetchAccounts(selectedId || undefined)
      .then(({ results, currentCustomerId }) => {
        const found: AccountRef[] = results
          .map((r) => ({
            id: digitsOnly(String(r.customerClient?.id ?? '')),
            name: String(r.customerClient?.descriptiveName ?? '').trim(),
            manager: Boolean(r.customerClient?.manager),
          }))
          .filter((a) => a.id !== '')
          .map((a) => ({ ...a, name: a.name || `Conta ${a.id}` }));

        setAccounts((current) => {
          const byId = new Map<string, AccountRef>();
          current.forEach((a) => byId.set(digitsOnly(a.id), a));
          // Contas descobertas preservam o MCC e o apelido que o usuário cadastrou.
          found
            .filter((a) => !a.manager)
            .forEach((a) => {
              const saved = byId.get(a.id);
              byId.set(a.id, saved ? { ...a, name: saved.name || a.name, loginCustomerId: saved.loginCustomerId } : a);
            });
          const merged = Array.from(byId.values());
          writeString(KEY_ACCOUNTS, JSON.stringify(merged));
          setSelectedId((id) => id || digitsOnly(currentCustomerId) || merged[0]?.id || '');
          return merged;
        });
      })
      .catch((err: { message?: string; body?: { error?: string } }) => {
        setDiscoveryError(
          (err as { body?: { error?: string } })?.body?.error ?? err?.message ?? 'Não foi possível consultar as contas do Google Ads.',
        );
      })
      .finally(() => setDiscovering(false));
  }, [selectedId]);

  useEffect(() => {
    discover();
    // Só na abertura: trocar de conta não precisa redescobrir a lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = useCallback((id: string) => {
    const clean = digitsOnly(id);
    if (!clean) return;
    setSelectedId(clean);
    writeString(KEY_SELECTED, clean);
  }, []);

  const setRange = useCallback((next: DateRangeOption) => {
    setRangeState(next);
    writeString(KEY_RANGE, next);
  }, []);

  /** Sem depender da lista de contas: a janela só muda quando o período muda. */
  const window = useMemo(() => resolveWindow(range), [range]);
  const previous = useMemo(() => previousWindow(window), [window]);

  const value = useMemo<AccountContextValue>(() => {
    const selected = selectedId ? (accounts.find((a) => digitsOnly(a.id) === selectedId) ?? { id: selectedId, name: `Conta ${selectedId}` }) : null;
    return {
      accounts,
      selectedId,
      selected,
      range,
      rangeLabel: DATE_RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range,
      window,
      previous,
      discovering,
      discoveryError,
      discover,
      select,
      setRange,
    };
  }, [accounts, selectedId, range, window, previous, discovering, discoveryError, discover, select, setRange]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount precisa estar dentro de <AccountProvider>.');
  return ctx;
}
