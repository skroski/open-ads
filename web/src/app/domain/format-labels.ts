import { ConfidenceLevel } from './models';

export const CONFIDENCE_TEXT: Record<ConfidenceLevel, string> = {
  HIGH: 'Alta: os números sustentam a conclusão e há mais de um sinal concordando.',
  MEDIUM: 'Média: a conclusão é razoável, mas falta volume ou uma segunda confirmação. Valide antes de agir em grande escala.',
  LOW: 'Baixa: trate como uma pista a investigar, não como uma decisão.',
};
