import { currency, decimal, percent } from './format';

const nbsp = (s: string): string => s.replace(/ /g, ' ');

describe('formatação pt-BR (equivalente aos pipes do Angular)', () => {
  it('formata moeda em reais com duas casas por padrão', () => {
    expect(nbsp(currency(1234.5))).toBe('R$ 1.234,50');
  });

  it('formata moeda sem casas quando pedido (como "1.0-0")', () => {
    expect(nbsp(currency(1234.5, 0, 0))).toBe('R$ 1.235');
  });

  it('formata números e porcentagens', () => {
    expect(decimal(12345)).toBe('12.345');
    expect(decimal(12.5, 0, 1)).toBe('12,5');
    expect(percent(0.5)).toBe('50%');
    expect(percent(0.1234, 0, 1)).toBe('12,3%');
  });

  it('trata valores inválidos como zero', () => {
    expect(decimal(Number.NaN)).toBe('0');
  });
});
