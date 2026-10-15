import { CampaignRow, MatchType, NegativeKeyword, SearchTermRow } from './models';
import { PreparedRule, firstMatch, tokens } from './text';

/**
 * Decide se um termo de busca já é bloqueado por uma palavra negativa, respeitando o
 * tipo de correspondência. Negativas não têm variações próximas: "curso" não bloqueia
 * "cursos".
 *
 * Vale para negativas de campanha, de listas compartilhadas (já expandidas por campanha)
 * e de grupo de anúncios (que só bloqueiam dentro do próprio grupo).
 */

export interface PreparedNegative {
  matchType: MatchType;
  tokens: string[];
}

const adGroupKey = (id: string): string => `ag:${id}`;

export function prepareNegative(text: string, matchType: MatchType): PreparedNegative | null {
  const t = tokens(text.replace(/[[\]"]/g, ''));
  return t.length ? { matchType, tokens: t } : null;
}

export function prepareNegatives(negatives: readonly NegativeKeyword[]): Map<string, PreparedNegative[]> {
  const byScope = new Map<string, PreparedNegative[]>();
  for (const n of negatives) {
    const prepared = prepareNegative(n.text, n.matchType);
    if (!prepared) continue;
    const key = n.level === 'AD_GROUP' && n.adGroupId ? adGroupKey(n.adGroupId) : n.campaignId;
    const list = byScope.get(key) ?? [];
    list.push(prepared);
    byScope.set(key, list);
  }
  return byScope;
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return true;
  }
  return false;
}

/** Uma negativa bloqueia estes tokens de busca? */
export function blocks(n: PreparedNegative, termTokens: string[]): boolean {
  if (!termTokens.length) return false;
  switch (n.matchType) {
    case 'EXACT':
      return n.tokens.length === termTokens.length && n.tokens.every((w, i) => w === termTokens[i]);
    case 'PHRASE':
      return containsSequence(termTokens, n.tokens);
    case 'BROAD':
      return n.tokens.every((w) => termTokens.includes(w));
  }
}

export function isNegated(
  term: string,
  campaignId: string,
  prepared: Map<string, PreparedNegative[]>,
  adGroupId?: string,
): boolean {
  const t = tokens(term);
  if (!t.length) return false;
  const lists = [prepared.get(campaignId), adGroupId ? prepared.get(adGroupKey(adGroupId)) : undefined];
  return lists.some((list) => list?.some((n) => blocks(n, t)) ?? false);
}

// ───────────────────────── Cobertura entre campanhas ─────────────────────────

export interface CoverageLeak {
  campaignId: string;
  campaignName: string;
  /** Gasto no período em buscas que a negativa bloquearia nesta campanha. */
  leakCost: number;
  leakTerms: string[];
}

export interface NegativeGap {
  text: string;
  matchType: MatchType;
  /** Campanhas onde a negativa já vale (de campanha ou por lista compartilhada). */
  coveredIn: string[];
  /** Campanhas de Pesquisa onde ela falta e pode ser aplicada sem conflito. */
  missingIn: CoverageLeak[];
  totalLeak: number;
}

export interface GapInput {
  negatives: readonly NegativeKeyword[];
  campaigns: readonly CampaignRow[];
  /** Palavras-chave positivas, para não sugerir uma negativa que bloquearia o próprio anúncio. */
  keywords: ReadonlyArray<{ campaignId: string; text: string }>;
  terms: readonly SearchTermRow[];
  /** Regras de marca: negativas de marca costumam separar campanhas de propósito. */
  brand: readonly PreparedRule[];
}

/**
 * Negativas que valem em parte das campanhas de Pesquisa e faltam em outras.
 *
 * Fica de fora o que costuma ser separação intencional:
 *  - negativas de grupo de anúncios (direcionamento dentro da campanha);
 *  - negativas de marca (campanha de marca × genérica);
 *  - campanha onde a negativa bloquearia uma palavra-chave dela mesma.
 */
export function findNegativeGaps(input: GapInput): NegativeGap[] {
  const search = input.campaigns.filter((c) => c.channel === 'SEARCH' && c.status !== 'REMOVED');
  if (search.length < 2) return [];
  const searchIds = new Set(search.map((c) => c.id));

  // Agrupa por (texto normalizado, correspondência) quem já tem a negativa.
  const groups = new Map<string, { text: string; matchType: MatchType; prepared: PreparedNegative; campaigns: Set<string> }>();
  for (const n of input.negatives) {
    if (n.level === 'AD_GROUP' || !searchIds.has(n.campaignId)) continue;
    const prepared = prepareNegative(n.text, n.matchType);
    if (!prepared) continue;
    if (firstMatch(prepared.tokens.join(' '), input.brand)) continue;
    const key = `${n.matchType}|${prepared.tokens.join(' ')}`;
    const g = groups.get(key) ?? { text: prepared.tokens.join(' '), matchType: n.matchType, prepared, campaigns: new Set() };
    g.campaigns.add(n.campaignId);
    groups.set(key, g);
  }

  const keywordTokens = new Map<string, string[][]>();
  for (const k of input.keywords) {
    keywordTokens.set(k.campaignId, [...(keywordTokens.get(k.campaignId) ?? []), tokens(k.text.replace(/[[\]"+]/g, ''))]);
  }
  const termsByCampaign = new Map<string, Array<{ term: string; tokens: string[]; cost: number; negated: boolean }>>();
  for (const t of input.terms) {
    termsByCampaign.set(t.campaignId, [
      ...(termsByCampaign.get(t.campaignId) ?? []),
      { term: t.term, tokens: tokens(t.term), cost: t.cost, negated: t.alreadyNegative },
    ]);
  }

  const out: NegativeGap[] = [];
  for (const g of groups.values()) {
    if (g.campaigns.size === search.length) continue;
    const missingIn: CoverageLeak[] = [];
    for (const c of search) {
      // Campanha pausada não vaza: só entra como lacuna se estiver ativa.
      if (g.campaigns.has(c.id) || c.status !== 'ENABLED') continue;
      const conflicts = (keywordTokens.get(c.id) ?? []).some((kt) => blocks(g.prepared, kt));
      if (conflicts) continue;
      const leaking = (termsByCampaign.get(c.id) ?? []).filter((t) => !t.negated && blocks(g.prepared, t.tokens));
      missingIn.push({
        campaignId: c.id,
        campaignName: c.name,
        leakCost: leaking.reduce((s, t) => s + t.cost, 0),
        leakTerms: leaking.map((t) => t.term),
      });
    }
    if (!missingIn.length) continue;
    const names = new Map(search.map((c) => [c.id, c.name]));
    out.push({
      text: g.text,
      matchType: g.matchType,
      coveredIn: [...g.campaigns].map((id) => names.get(id) ?? id),
      missingIn,
      totalLeak: missingIn.reduce((s, m) => s + m.leakCost, 0),
    });
  }
  return out.sort((a, b) => b.totalLeak - a.totalLeak || b.missingIn.length - a.missingIn.length || a.text.localeCompare(b.text));
}
