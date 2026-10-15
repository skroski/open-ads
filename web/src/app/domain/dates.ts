/**
 * Janelas de datas. Todas as consultas usam datas explícitas (BETWEEN) em vez de
 * `DURING`, para que o período atual e o anterior sejam sempre comparáveis.
 *
 * Observação de fuso: as datas são calculadas no relógio do navegador; o Google Ads
 * usa o fuso da conta. A diferença só aparece perto da meia-noite e é irrelevante
 * para janelas de vários dias.
 */

export type DateRangeOption =
  | 'TODAY'
  | 'YESTERDAY'
  | 'LAST_7_DAYS'
  | 'LAST_14_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS'
  | 'THIS_MONTH'
  | 'LAST_MONTH';

export interface DateWindow {
  /** Primeiro dia (inclusive), formato YYYY-MM-DD. */
  from: string;
  /** Último dia (inclusive), formato YYYY-MM-DD. */
  to: string;
  /** Quantidade de dias da janela (inclusive nas duas pontas). */
  days: number;
}

export const DATE_RANGE_OPTIONS: ReadonlyArray<{ value: DateRangeOption; label: string; short: string }> = [
  { value: 'TODAY', label: 'Hoje', short: 'Hoje' },
  { value: 'YESTERDAY', label: 'Ontem', short: 'Ontem' },
  { value: 'LAST_7_DAYS', label: 'Últimos 7 dias', short: '7 dias' },
  { value: 'LAST_14_DAYS', label: 'Últimos 14 dias', short: '14 dias' },
  { value: 'LAST_30_DAYS', label: 'Últimos 30 dias', short: '30 dias' },
  { value: 'LAST_90_DAYS', label: 'Últimos 90 dias', short: '90 dias' },
  { value: 'THIS_MONTH', label: 'Este mês', short: 'Este mês' },
  { value: 'LAST_MONTH', label: 'Mês anterior', short: 'Mês ant.' },
];

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Interpreta YYYY-MM-DD como meia-noite local (evita o deslocamento de UTC do `new Date(string)`). */
export function parseIsoDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(value: string, amount: number): string {
  const d = parseIsoDate(value);
  d.setDate(d.getDate() + amount);
  return isoDate(d);
}

/** Dias entre duas datas, contando as duas pontas (mesmo dia = 1). */
export function inclusiveDays(from: string, to: string): number {
  const ms = parseIsoDate(to).getTime() - parseIsoDate(from).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Diferença em dias corridos (to - from). Pode ser negativa. */
export function diffDays(from: string, to: string): number {
  return inclusiveDays(from, to) - 1;
}

export function windowOf(from: string, to: string): DateWindow {
  return { from, to, days: Math.max(1, inclusiveDays(from, to)) };
}

export function resolveWindow(range: DateRangeOption, today: Date = new Date()): DateWindow {
  const t = isoDate(today);
  switch (range) {
    case 'TODAY':
      return windowOf(t, t);
    case 'YESTERDAY': {
      const y = addDays(t, -1);
      return windowOf(y, y);
    }
    case 'LAST_7_DAYS':
      return windowOf(addDays(t, -7), addDays(t, -1));
    case 'LAST_14_DAYS':
      return windowOf(addDays(t, -14), addDays(t, -1));
    case 'LAST_30_DAYS':
      return windowOf(addDays(t, -30), addDays(t, -1));
    case 'LAST_90_DAYS':
      return windowOf(addDays(t, -90), addDays(t, -1));
    case 'THIS_MONTH': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return windowOf(isoDate(first), t);
    }
    case 'LAST_MONTH': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return windowOf(isoDate(first), isoDate(last));
    }
  }
}

/** Janela imediatamente anterior, com o mesmo tamanho. */
export function previousWindow(w: DateWindow): DateWindow {
  const to = addDays(w.from, -1);
  const from = addDays(to, -(w.days - 1));
  return windowOf(from, to);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  // Guarda de segurança: nunca itera mais do que ~3 anos.
  for (let i = 0; i < 1100 && cursor <= to; i++) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Hoje (YYYY-MM-DD) no relógio do navegador. */
export function today(): string {
  return isoDate(new Date());
}

export function formatDateBr(value: string | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
