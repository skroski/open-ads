/**
 * Utilitários de texto para casar termos de busca, anúncios e páginas.
 * Tudo é feito em palavras inteiras (e não com `includes`), porque um termo curto
 * como "ia" casaria com "odontologia" e contaminaria qualquer classificação.
 */

const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos',
  'nas', 'por', 'para', 'pra', 'com', 'sem', 'sobre', 'e', 'ou', 'que', 'se', 'ao', 'aos', 'como', 'qual',
  'quais', 'onde', 'the', 'and', 'for', 'to', 'of', 'in',
]);

/** Minúsculas, sem acentos, só letras/números separados por espaço único. */
export function normalize(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokens(value: string): string[] {
  const n = normalize(value);
  return n ? n.split(' ') : [];
}

/** Remove o plural simples ("clinicas" → "clinica") para comparações tolerantes. */
export function stem(token: string): string {
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

/** Tokens com significado (sem stopwords e sem sobras de 1 letra). */
export function contentTokens(value: string): string[] {
  return tokens(value)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Uma regra casa quando todas as suas palavras aparecem, em sequência, entre as
 * palavras do texto. Palavras da regra com 4+ letras também casam por prefixo
 * ("curso" casa "cursos"). Palavras curtas só casam inteiras.
 */
export function matchesRule(textTokens: string[], ruleTokens: string[]): boolean {
  if (!ruleTokens.length || !textTokens.length) return false;
  for (let start = 0; start + ruleTokens.length <= textTokens.length; start++) {
    let ok = true;
    for (let j = 0; j < ruleTokens.length; j++) {
      const word = textTokens[start + j];
      const rule = ruleTokens[j];
      if (word === rule) continue;
      if (rule.length >= 4 && word.startsWith(rule)) continue;
      ok = false;
      break;
    }
    if (ok) return true;
  }
  return false;
}

export interface PreparedRule {
  raw: string;
  tokens: string[];
}

export function prepareRules(rules: readonly string[]): PreparedRule[] {
  return rules
    .map((raw) => ({ raw, tokens: tokens(raw) }))
    .filter((r) => r.tokens.length > 0);
}

/** Devolve a primeira regra que casa com o texto (ou undefined). */
export function firstMatch(text: string, rules: readonly PreparedRule[]): string | undefined {
  const t = tokens(text);
  return rules.find((r) => matchesRule(t, r.tokens))?.raw;
}

/** Fração das palavras de `needle` presentes em `haystack` (0..1). */
export function coverage(needle: readonly string[], haystack: readonly string[]): number {
  if (!needle.length) return 0;
  const set = new Set(haystack);
  let hit = 0;
  for (const word of needle) {
    if (set.has(word)) hit++;
    else if (word.length >= 5) {
      for (const h of set) {
        if (h.length >= 5 && (h.startsWith(word) || word.startsWith(h))) {
          hit++;
          break;
        }
      }
    }
  }
  return hit / needle.length;
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size && !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Host sem "www", em minúsculas. Devolve '' quando não é uma URL válida. */
export function urlHost(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Forma canônica de uma URL para agrupar variações (http/https, www, barra final,
 * parâmetros e âncora). Ex.: `https://www.site.com.br/pagina/?utm=1` → `site.com.br/pagina`.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Palavras do caminho de uma URL ("/ia-para-clinicas/" → ["ia","clinica"]). */
export function urlWords(url: string): string[] {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return contentTokens(decodeURIComponent(u.pathname).replace(/[-_/]+/g, ' '));
  } catch {
    return [];
  }
}

export function slugId(...parts: Array<string | number | undefined>): string {
  return parts
    .filter((p) => p !== undefined && p !== '')
    .map((p) => normalize(String(p)).replace(/ /g, '-'))
    .join('~')
    .slice(0, 160);
}
