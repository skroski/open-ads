/**
 * Equivalentes dos pipes `currency`, `number` e `percent` do Angular em pt-BR.
 * Os textos montados fora dos templates continuam vindo de `@shared/domain/format`.
 */

const cache = new Map<string, Intl.NumberFormat>();

function formatter(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', options);
    cache.set(key, f);
  }
  return f;
}

const safe = (v: number): number => (Number.isFinite(v) ? v : 0);

/** `currency: 'BRL' : 'symbol' : '1.min-max'` */
export function currency(value: number, minDigits = 2, maxDigits = 2): string {
  return formatter(`c${minDigits}-${maxDigits}`, {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: minDigits,
    maximumFractionDigits: maxDigits,
  }).format(safe(value));
}

/** `number: '1.min-max'` */
export function decimal(value: number, minDigits = 0, maxDigits = 0): string {
  return formatter(`d${minDigits}-${maxDigits}`, {
    minimumFractionDigits: minDigits,
    maximumFractionDigits: maxDigits,
  }).format(safe(value));
}

/** `percent: '1.min-max'`: recebe a fração (0.5 → "50%"). */
export function percent(ratio: number, minDigits = 0, maxDigits = 0): string {
  return formatter(`p${minDigits}-${maxDigits}`, {
    style: 'percent',
    minimumFractionDigits: minDigits,
    maximumFractionDigits: maxDigits,
  }).format(safe(ratio));
}
