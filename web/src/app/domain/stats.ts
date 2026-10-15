/**
 * Estatística elementar usada para não confundir azar com padrão.
 * Tudo aqui é determinístico e simples de auditar.
 */

/**
 * Chance de observar ZERO resultados em `n` tentativas, se a taxa real fosse `p`.
 * É a pergunta certa antes de chamar algo de desperdício: com poucos cliques,
 * zero resultados é frequente mesmo numa fonte boa.
 */
export function chanceOfZero(p: number, n: number): number {
  if (n <= 0) return 1;
  const rate = Math.min(Math.max(p, 0), 0.999999);
  return (1 - rate) ** n;
}

/** Intervalo de confiança de Wilson (95%) para uma proporção. */
export function wilson(successes: number, trials: number, z = 1.96): { low: number; high: number } {
  if (trials <= 0) return { low: 0, high: 1 };
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return {
    low: Math.max(0, (centre - margin) / denom),
    high: Math.min(1, (centre + margin) / denom),
  };
}

/** Função de distribuição normal padrão (aproximação de Abramowitz & Stegun). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export interface TwoProportionResult {
  /** Diferença absoluta (b - a). */
  diff: number;
  /** Variação relativa de b sobre a, quando a > 0. */
  relativeLift: number | null;
  /** p-valor bicaudal. */
  pValue: number;
  /** Houve amostra suficiente para o teste fazer sentido. */
  valid: boolean;
}

/** Teste z de duas proporções (a = antes/controle, b = depois/variante). */
export function twoProportionTest(
  successesA: number,
  trialsA: number,
  successesB: number,
  trialsB: number,
): TwoProportionResult {
  if (trialsA <= 0 || trialsB <= 0) {
    return { diff: 0, relativeLift: null, pValue: 1, valid: false };
  }
  const pa = successesA / trialsA;
  const pb = successesB / trialsB;
  const pooled = (successesA + successesB) / (trialsA + trialsB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / trialsA + 1 / trialsB));
  // Regra prática: precisa de ao menos 5 eventos e 5 não-eventos em cada grupo.
  const valid =
    successesA >= 5 && successesB >= 5 && trialsA - successesA >= 5 && trialsB - successesB >= 5 && se > 0;
  if (se === 0) {
    return { diff: pb - pa, relativeLift: pa > 0 ? (pb - pa) / pa : null, pValue: 1, valid: false };
  }
  const z = (pb - pa) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { diff: pb - pa, relativeLift: pa > 0 ? (pb - pa) / pa : null, pValue, valid };
}

/**
 * Quantos cliques cada versão precisa para detectar uma melhora relativa
 * `minLift` (ex.: 0.2 = +20%) sobre uma taxa base `p`, com 80% de poder e 95% de confiança.
 */
export function sampleSizePerVariant(baseRate: number, minLift: number): number {
  const p1 = Math.min(Math.max(baseRate, 0.0001), 0.99);
  const p2 = Math.min(p1 * (1 + minLift), 0.999);
  if (p2 <= p1) return Number.POSITIVE_INFINITY;
  const zAlpha = 1.96;
  const zBeta = 0.84;
  const pBar = (p1 + p2) / 2;
  const num = (zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2;
  return Math.ceil(num / (p2 - p1) ** 2);
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
