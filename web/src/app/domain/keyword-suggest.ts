import { KeywordRow, MatchType, SearchConsoleQueryRow, SearchTermRow } from './models';
import { contentTokens, coverage, normalize } from './text';

/**
 * Sugestões de palavras-chave tiradas dos dados da própria conta, sem depender do
 * Planejador do Google:
 *
 *  - Termos de busca: o que as pessoas já digitaram e que trouxe resultado (ou cliques
 *    repetidos), mas ainda não é palavra-chave da campanha. Virar palavra-chave dá
 *    controle de lance e de anúncio sobre uma busca que já funciona.
 *  - Search Console: buscas em que o site aparece no orgânico, ligadas à campanha cujo
 *    assunto mais se parece com elas. São demanda real que a mídia paga não cobre.
 *
 * Termos negativados, desqualificados e de concorrentes ficam de fora.
 */

export type SuggestionSource = 'SEARCH_TERM' | 'SEARCH_CONSOLE' | 'PLANNER';

export interface KeywordSuggestion {
  text: string;
  campaignId: string;
  campaignName: string;
  adGroupId?: string;
  adGroupName?: string;
  source: SuggestionSource;
  matchType: MatchType;
  reason: string;
  clicks: number;
  impressions: number;
  conversions: number;
  cost: number;
}

/** Cliques mínimos para um termo sem conversão virar sugestão. */
const MIN_CLICKS = 3;
/** Fração das palavras da busca que precisam estar no assunto da campanha. */
const MIN_TOPIC_MATCH = 0.5;

const keyOf = (campaignId: string, text: string): string => `${campaignId}|${normalize(text)}`;

function existingKeywords(keywords: readonly KeywordRow[]): { inCampaign: Set<string>; anywhere: Set<string> } {
  const inCampaign = new Set<string>();
  const anywhere = new Set<string>();
  for (const k of keywords) {
    const clean = k.text.replace(/[[\]"+]/g, '');
    inCampaign.add(keyOf(k.campaignId, clean));
    anywhere.add(normalize(clean));
  }
  return { inCampaign, anywhere };
}

export function suggestFromTerms(
  terms: readonly SearchTermRow[],
  keywords: readonly KeywordRow[],
): KeywordSuggestion[] {
  const { inCampaign } = existingKeywords(keywords);
  const acc = new Map<string, KeywordSuggestion>();
  for (const t of terms) {
    if (t.alreadyNegative || t.category === 'UNQUALIFIED' || t.category === 'COMPETITOR') continue;
    const key = keyOf(t.campaignId, t.term);
    if (inCampaign.has(key)) continue;
    const s = acc.get(key) ?? {
      text: t.term,
      campaignId: t.campaignId,
      campaignName: t.campaignName,
      adGroupId: t.adGroupId,
      adGroupName: t.adGroupName,
      source: 'SEARCH_TERM' as const,
      matchType: 'PHRASE' as MatchType,
      reason: '',
      clicks: 0,
      impressions: 0,
      conversions: 0,
      cost: 0,
    };
    s.clicks += t.clicks;
    s.impressions += t.impressions;
    s.conversions += t.conversions;
    s.cost += t.cost;
    acc.set(key, s);
  }
  return [...acc.values()]
    .filter((s) => s.conversions > 0 || s.clicks >= MIN_CLICKS)
    .map((s) => ({
      ...s,
      matchType: (s.conversions > 0 ? 'EXACT' : 'PHRASE') as MatchType,
      reason:
        s.conversions > 0
          ? `Já gerou ${fmt(s.conversions)} conversão(ões) como termo de busca, sem ser palavra-chave.`
          : `${s.clicks} cliques no período chegando por correspondência ampla; vale ter controle direto.`,
    }))
    .sort((a, b) => b.conversions - a.conversions || b.clicks - a.clicks || a.text.localeCompare(b.text));
}

export function suggestFromSearchConsole(
  rows: readonly SearchConsoleQueryRow[],
  keywords: readonly KeywordRow[],
  isUnqualified: (text: string) => boolean,
): KeywordSuggestion[] {
  const { anywhere } = existingKeywords(keywords);
  const topics = new Map<string, { name: string; words: Set<string> }>();
  for (const k of keywords) {
    if (k.status !== 'ENABLED') continue;
    const t = topics.get(k.campaignId) ?? { name: k.campaignName, words: new Set<string>() };
    contentTokens(k.text).forEach((w) => t.words.add(w));
    topics.set(k.campaignId, t);
  }

  const out: KeywordSuggestion[] = [];
  for (const r of rows) {
    if (anywhere.has(normalize(r.query)) || isUnqualified(r.query)) continue;
    const q = contentTokens(r.query);
    if (!q.length) continue;
    let best: { id: string; name: string; score: number } | null = null;
    for (const [id, t] of topics) {
      const score = coverage(q, [...t.words]);
      if (!best || score > best.score) best = { id, name: t.name, score };
    }
    if (!best || best.score < MIN_TOPIC_MATCH) continue;
    out.push({
      text: r.query,
      campaignId: best.id,
      campaignName: best.name,
      source: 'SEARCH_CONSOLE',
      matchType: 'PHRASE',
      reason: `Aparece no Google orgânico (${r.impressions} impressões, posição ${r.position.toFixed(1)}) e combina com o assunto desta campanha.`,
      clicks: r.clicks,
      impressions: r.impressions,
      conversions: 0,
      cost: 0,
    });
  }
  return out.sort((a, b) => b.impressions - a.impressions);
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}
