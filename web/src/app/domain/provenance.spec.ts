import { deriveConfidence } from './provenance';

describe('deriveConfidence', () => {
  it('volume bem acima do mínimo é alta; perto do mínimo é baixa', () => {
    expect(deriveConfidence({ ratio: 3 }).level).toBe('HIGH');
    expect(deriveConfidence({ ratio: 1.5 }).level).toBe('MEDIUM');
    expect(deriveConfidence({ ratio: 1 }).level).toBe('LOW');
  });

  it('dado informado à mão rebaixa um nível', () => {
    const c = deriveConfidence({ ratio: 3, userShare: 0.8 });
    expect(c.level).toBe('MEDIUM');
    expect(c.reasons.join(' ')).toContain('informada por você');
  });

  it('erro alto no backtest derruba para baixa, erro moderado limita a média', () => {
    expect(deriveConfidence({ ratio: 5, backtestError: 0.4 }).level).toBe('LOW');
    expect(deriveConfidence({ ratio: 5, backtestError: 0.2 }).level).toBe('MEDIUM');
    expect(deriveConfidence({ ratio: 5, backtestError: 0.05 }).level).toBe('HIGH');
  });

  it('nunca desce abaixo de baixa', () => {
    expect(deriveConfidence({ ratio: 1, userShare: 1 }).level).toBe('LOW');
  });
});
