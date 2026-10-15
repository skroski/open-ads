import { WasteCategory } from '../domain/waste';
import { BarItem } from './bar-list';
import { VERDICT_COLOR } from './echart';

/** Nome, explicação e cor de cada categoria de gasto, iguais em todas as telas. */
export interface CategoryInfo {
  label: string;
  short: string;
  tip: string;
  color: string;
  tone: BarItem['tone'];
}

export const BADGE_TONE: Record<WasteCategory, string> = {
  WASTE: 'badge-error',
  EXPENSIVE: 'badge-warning',
  GOOD: 'badge-success',
  UNKNOWN: 'badge-neutral',
  TRACKING: 'badge-info',
};

export const CATEGORY: Record<WasteCategory, CategoryInfo> = {
  WASTE: {
    label: 'Desperdício real',
    short: 'Desperdício',
    tip: 'Gasto sem resultado que o acaso não explica e outro sinal confirma, mais o gasto em termos que você já bloqueou.',
    color: VERDICT_COLOR.waste,
    tone: 'error',
  },
  EXPENSIVE: {
    label: 'Caro (acima da meta)',
    short: 'Caro',
    tip: 'Traz resultado, mas cada resultado custa bem mais do que a meta (ou do que a média da conta).',
    color: VERDICT_COLOR.above,
    tone: 'warning',
  },
  GOOD: {
    label: 'Dentro da meta',
    short: 'Rende',
    tip: 'Traz resultado a um custo dentro da meta. Lucro de verdade só aparece com a receita das vendas vinda do CRM.',
    color: VERDICT_COLOR.performing,
    tone: 'success',
  },
  UNKNOWN: {
    label: 'Sem conclusão',
    short: 'Sem conclusão',
    tip: 'Poucos cliques, período ainda maturando ou sem segundo sinal. Não corte com base nisso.',
    color: VERDICT_COLOR.insufficient,
    tone: 'neutral',
  },
  TRACKING: {
    label: 'Falha de medição',
    short: 'Medição',
    tip: 'A medição ou a página parecem falhar. Corrija antes de julgar.',
    color: VERDICT_COLOR.tracking,
    tone: 'info',
  },
};
