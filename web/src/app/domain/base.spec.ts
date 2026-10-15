import { addDays, eachDay, inclusiveDays, previousWindow, resolveWindow, windowOf } from './dates';
import { classifyKeyword, classifyTerm, DEFAULT_AUDIT_RULES, parseTermList, prepareAuditRules } from './classify';
import { chanceOfZero, median, sampleSizePerVariant, twoProportionTest, wilson } from './stats';
import { coverage, matchesRule, normalizeUrl, tokens, urlWords } from './text';

describe('dates', () => {
  const today = new Date(2026, 9, 13); // 13/10/2026

  it('resolve os períodos nomeados como o Google Ads (sem incluir hoje)', () => {
    expect(resolveWindow('LAST_7_DAYS', today)).toEqual({ from: '2026-10-06', to: '2026-10-12', days: 7 });
    expect(resolveWindow('LAST_30_DAYS', today)).toEqual({ from: '2026-09-13', to: '2026-10-12', days: 30 });
    expect(resolveWindow('YESTERDAY', today)).toEqual({ from: '2026-10-12', to: '2026-10-12', days: 1 });
    expect(resolveWindow('TODAY', today).days).toBe(1);
  });

  it('resolve mês atual e mês anterior', () => {
    expect(resolveWindow('THIS_MONTH', today)).toEqual({ from: '2026-10-01', to: '2026-10-13', days: 13 });
    expect(resolveWindow('LAST_MONTH', today)).toEqual({ from: '2026-09-01', to: '2026-09-30', days: 30 });
  });

  it('calcula o período anterior com o mesmo tamanho, sem sobrepor', () => {
    const w = resolveWindow('LAST_7_DAYS', today);
    const prev = previousWindow(w);
    expect(prev).toEqual({ from: '2026-09-29', to: '2026-10-05', days: 7 });
    expect(addDays(prev.to, 1)).toBe(w.from);
  });

  it('atravessa virada de mês e de ano', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(inclusiveDays('2026-02-27', '2026-03-02')).toBe(4);
    expect(eachDay('2026-02-27', '2026-03-01')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
    expect(windowOf('2026-01-01', '2026-01-01').days).toBe(1);
  });
});

describe('text', () => {
  it('normaliza acentos e pontuação', () => {
    expect(tokens('IA p/ Clínicas Odontológicas!')).toEqual(['ia', 'p', 'clinicas', 'odontologicas']);
  });

  it('casa palavras inteiras: "ia" não casa com "odontologica"', () => {
    expect(matchesRule(tokens('software odontologica'), tokens('ia'))).toBe(false);
    expect(matchesRule(tokens('ia odontologica'), tokens('ia'))).toBe(true);
  });

  it('casa frases na ordem e tolera plural por prefixo (4+ letras)', () => {
    expect(matchesRule(tokens('quanto custa um sistema'), tokens('quanto custa'))).toBe(true);
    expect(matchesRule(tokens('custa quanto'), tokens('quanto custa'))).toBe(false);
    expect(matchesRule(tokens('cursos online'), tokens('curso'))).toBe(true);
    expect(matchesRule(tokens('sacola'), tokens('sac'))).toBe(false);
  });

  it('mede cobertura de palavras com tolerância a plural', () => {
    expect(coverage(['clinica', 'odontologica'], ['ia', 'clinicas', 'odontologicas'])).toBe(1);
    expect(coverage(['clinica', 'preco'], ['clinica'])).toBe(0.5);
  });

  it('agrupa variações da mesma URL', () => {
    const a = normalizeUrl('https://www.exemplo.com.br/');
    expect(a).toBe('exemplo.com.br');
    expect(normalizeUrl('http://exemplo.com.br')).toBe(a);
    expect(normalizeUrl('https://exemplo.com.br/ia/?utm_source=x#topo')).toBe('exemplo.com.br/ia');
  });

  it('extrai palavras do caminho da URL', () => {
    expect(urlWords('https://x.com/ia-para-clinicas-odontologicas/')).toEqual(['ia', 'clinica', 'odontologica']);
  });
});

describe('classify', () => {
  const rules = prepareAuditRules({ ...DEFAULT_AUDIT_RULES, brandTerms: ['acme'] });

  it('marca vence qualquer outra regra', () => {
    expect(classifyTerm('acme login', rules).category).toBe('BRAND');
  });

  it('desqualifica por palavra inteira', () => {
    expect(classifyTerm('curso de ia gratis', rules).category).toBe('UNQUALIFIED');
  });

  it('não classifica como qualificado só porque "odontologica" termina em "ia"', () => {
    expect(classifyTerm('odontologica perto de mim', rules).category).toBe('GENERAL');
    expect(classifyTerm('ia odontologica', rules).category).toBe('QUALIFIED');
  });

  it('reconhece concorrente antes de qualificado', () => {
    expect(classifyTerm('rd station preco', rules).category).toBe('COMPETITOR');
  });

  it('classifica palavras-chave anunciadas', () => {
    expect(classifyKeyword('software para clínicas odontológicas', rules).category).toBe('QUALIFIED');
    expect(classifyKeyword('login acme', rules).category).toBe('BRAND');
    expect(classifyKeyword('tutorial chatbot', rules).category).toBe('RISK');
  });

  it('interpreta listas digitadas', () => {
    expect(parseTermList('Gratis, grátis;\n curso ,, gratis')).toEqual(['gratis', 'grátis', 'curso']);
  });
});

describe('stats', () => {
  it('chance de zero resultados por acaso', () => {
    expect(chanceOfZero(0.1, 0)).toBe(1);
    expect(chanceOfZero(0.1, 10)).toBeCloseTo(0.3487, 3);
    expect(chanceOfZero(0, 100)).toBe(1);
  });

  it('a chance cai conforme os cliques sem resultado aumentam', () => {
    const p = 0.33;
    expect(chanceOfZero(p, 5)).toBeGreaterThan(0.1);
    expect(chanceOfZero(p, 8)).toBeLessThan(0.05);
  });

  it('intervalo de Wilson contém a proporção e respeita 0..1', () => {
    const w = wilson(5, 20);
    expect(w.low).toBeLessThan(0.25);
    expect(w.high).toBeGreaterThan(0.25);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it('teste de duas proporções detecta diferença grande e recusa amostra pequena', () => {
    const big = twoProportionTest(60, 600, 120, 600);
    expect(big.valid).toBe(true);
    expect(big.pValue).toBeLessThan(0.001);
    expect(big.relativeLift).toBeCloseTo(1, 5);

    const small = twoProportionTest(1, 10, 3, 10);
    expect(small.valid).toBe(false);
  });

  it('tamanho de amostra cresce quando o efeito a detectar é menor', () => {
    const big = sampleSizePerVariant(0.05, 0.5);
    const small = sampleSizePerVariant(0.05, 0.1);
    expect(small).toBeGreaterThan(big);
    expect(Number.isFinite(big)).toBe(true);
  });

  it('mediana', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});
