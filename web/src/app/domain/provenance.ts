import { Confidence, ConfidenceLevel, ParamStatus } from './models';

/** De onde veio um valor exibido ou preenchido. Nenhum número aparece sem isto. */
export type ValueSource = 'GOOGLE_ADS' | 'CALCULATION' | 'AI' | 'USER' | 'DEFAULT';

export interface Provenance {
  source: ValueSource;
  /** Ex.: "últimos 90 dias" ou "mediana de 12 semanas". */
  detail: string;
  /** Ids dos fatos que sustentam um texto da IA. */
  evidenceIds?: string[];
}

export const SOURCE_LABEL: Record<ValueSource, string> = {
  GOOGLE_ADS: 'Google Ads',
  CALCULATION: 'Calculado',
  AI: 'IA, com base nos seus dados',
  USER: 'Informado por você',
  DEFAULT: 'Padrão do painel',
};

/** Estado de um parâmetro na tela: "sugerido" só existe aqui, nunca é gravado. */
export type ParamDisplayState = ParamStatus | 'SUGGESTED' | 'DEFAULT';

export const PARAM_STATE_LABEL: Record<ParamDisplayState, string> = {
  SUGGESTED: 'Sugerido',
  CONFIRMED: 'Confirmado por você',
  MANUAL: 'Informado por você',
  DEFAULT: 'Padrão do painel',
};

const ORDER: ConfidenceLevel[] = ['LOW', 'MEDIUM', 'HIGH'];

export interface ConfidenceInput {
  /** Observado ÷ mínimo exigido (ver `Sufficiency`). */
  ratio: number;
  /** Fração (0–1) do que sustenta o resultado que foi digitada ou importada pela pessoa. */
  userShare?: number;
  /** Erro do backtest (sMAPE, 0–1), quando houver previsão. */
  backtestError?: number | null;
}

/** Confiança derivada de volume, de quanto foi informado à mão e do erro em dias passados. */
export function deriveConfidence(input: ConfidenceInput): Confidence {
  const reasons: string[] = [];
  let level: ConfidenceLevel = input.ratio >= 3 ? 'HIGH' : input.ratio >= 1.5 ? 'MEDIUM' : 'LOW';
  reasons.push(
    level === 'HIGH'
      ? 'Volume de dados bem acima do mínimo.'
      : level === 'MEDIUM'
        ? 'Volume de dados acima do mínimo, sem folga grande.'
        : 'Volume de dados perto do mínimo.',
  );

  const lower = (to: ConfidenceLevel): void => {
    if (ORDER.indexOf(to) < ORDER.indexOf(level)) level = to;
  };

  if ((input.userShare ?? 0) > 0.5) {
    lower(ORDER[Math.max(0, ORDER.indexOf(level) - 1)]);
    reasons.push('Mais da metade dos dados foi informada por você, não medida.');
  }
  if (input.backtestError != null) {
    if (input.backtestError > 0.3) {
      lower('LOW');
      reasons.push('Em dias passados o método errou muito nesta conta.');
    } else if (input.backtestError > 0.15) {
      lower('MEDIUM');
      reasons.push('Em dias passados o método errou de forma moderada nesta conta.');
    } else {
      reasons.push('Em dias passados o método acertou de perto nesta conta.');
    }
  }
  return { level, reasons };
}
