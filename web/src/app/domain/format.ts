/** Formatação pt-BR para textos montados fora dos templates (narrativas, evidências). */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function brl(value: number): string {
  return BRL.format(Number.isFinite(value) ? value : 0);
}

export function num(value: number, maxDigits = 0): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: maxDigits }).format(
    Number.isFinite(value) ? value : 0,
  );
}

/** Recebe uma fração (0.153) e devolve "15,3%". */
export function pct(ratio: number, maxDigits = 1): string {
  const v = Number.isFinite(ratio) ? ratio * 100 : 0;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: maxDigits }).format(v)}%`;
}

export function plural(n: number, one: string, many: string): string {
  return `${num(n, 0)} ${n === 1 ? one : many}`;
}

/** "3 dias", "1 dia". */
export function days(n: number): string {
  return plural(Math.round(n), 'dia', 'dias');
}

export const CHANNEL_LABEL: Record<string, string> = {
  SEARCH: 'Pesquisa',
  DISPLAY: 'Display',
  PERFORMANCE_MAX: 'Performance Max',
  VIDEO: 'Vídeo',
  SHOPPING: 'Shopping',
  DEMAND_GEN: 'Geração de demanda',
  OTHER: 'Outro',
};
