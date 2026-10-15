import { CandidatePage, LOW_COHERENCE, PageRecommendation, PageText, coherenceOf, recommendPage } from './intent';
import { KeywordRow } from './models';
import { contentTokens } from './text';

/**
 * Aderência entre as palavras-chave de cada grupo de anúncios e a página para onde o
 * anúncio leva. O Índice de Qualidade do Google pesa a "experiência na página de
 * destino": quem busca X e cai numa página sobre Y volta para trás, e o clique fica
 * mais caro.
 *
 * Usa a mesma medida de aderência da tela de Intenção (palavras da busca presentes no
 * texto da página). Sem leitura real da página, a medida usa só as palavras da URL e
 * fica marcada como estimativa.
 */

export interface MisalignedKeyword {
  text: string;
  /** 0–1: fração das palavras da palavra-chave presentes na página. */
  fit: number;
}

export interface AdGroupFit {
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  /** Página usada hoje (URL da palavra, senão a do anúncio). */
  url: string | null;
  basis: PageText['basis'];
  keywords: number;
  /** Média da aderência palavra → página das palavras ativas. */
  avgFit: number | null;
  misaligned: MisalignedKeyword[];
  /** Palavras que o Google avalia com página de destino abaixo da média. */
  landingBelow: number;
  /** Palavras que o Google já avaliou (têm nota de página). */
  landingRated: number;
  qualityAvg: number | null;
  cost: number;
  suggestion: PageRecommendation | null;
}

export interface FitInput {
  keywords: readonly KeywordRow[];
  /** URLs dos anúncios por grupo. */
  adUrlsByGroup: ReadonlyMap<string, readonly string[]>;
  pageOf: (url: string) => PageText;
  candidates: readonly CandidatePage[];
}

/** Assunto do grupo: palavras de conteúdo mais frequentes entre as palavras-chave. */
function groupTopics(texts: readonly string[], max = 6): string[] {
  const freq = new Map<string, number>();
  for (const t of texts) for (const w of new Set(contentTokens(t))) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

const mean = (values: readonly number[]): number | null =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

export function adGroupFits(input: FitInput): AdGroupFit[] {
  const groups = new Map<string, KeywordRow[]>();
  for (const k of input.keywords) {
    if (k.status !== 'ENABLED') continue;
    groups.set(k.adGroupId, [...(groups.get(k.adGroupId) ?? []), k]);
  }

  const out: AdGroupFit[] = [];
  for (const [adGroupId, kws] of groups) {
    const first = kws[0];
    const urls = [
      ...new Set([...kws.flatMap((k) => k.finalUrls ?? []), ...(input.adUrlsByGroup.get(adGroupId) ?? [])]),
    ];
    const url = urls[0] ?? null;
    const page = url ? input.pageOf(url) : { words: [], basis: 'NONE' as const };

    const fits = kws
      .map((k) => ({ text: k.text, fit: coherenceOf(k.text, [], page).termToPage }))
      .filter((f): f is MisalignedKeyword => f.fit !== null);
    const scores = kws.map((k) => k.quality?.score).filter((v): v is number => typeof v === 'number');
    const rated = kws.filter((k) => k.quality?.landingPage);

    out.push({
      campaignId: first.campaignId,
      campaignName: first.campaignName,
      adGroupId,
      adGroupName: first.adGroupName,
      url,
      basis: page.basis,
      keywords: kws.length,
      avgFit: mean(fits.map((f) => f.fit)),
      misaligned: fits.filter((f) => f.fit < LOW_COHERENCE).sort((a, b) => a.fit - b.fit),
      landingBelow: rated.filter((k) => k.quality?.landingPage === 'BELOW_AVERAGE').length,
      landingRated: rated.length,
      qualityAvg: mean(scores),
      cost: kws.reduce((s, k) => s + k.cost, 0),
      suggestion: input.candidates.length
        ? recommendPage({ topics: groupTopics(kws.map((k) => k.text)), label: first.adGroupName }, urls, input.candidates)
        : null,
    });
  }

  const problems = (g: AdGroupFit): number => g.misaligned.length + g.landingBelow;
  return out.sort((a, b) => Number(problems(b) > 0) - Number(problems(a) > 0) || b.cost - a.cost);
}
