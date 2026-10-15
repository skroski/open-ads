import { AdRow, PageAudit, SearchIntent, SearchTermRow } from './models';
import { PreparedRule, contentTokens, coverage, firstMatch, normalizeUrl, prepareRules, urlWords } from './text';

/**
 * Intenção de busca e coerência entre o que a pessoa procurou, o que o anúncio
 * prometeu e o que a página entrega. Tudo é heurística explícita: cada resultado
 * mostra a base (anúncio, título, URL) e quando a página não foi lida, o resultado
 * é "indisponível", nunca zero.
 */

const R = (list: string[]): PreparedRule[] => prepareRules(list);

const JOB = R(['vaga', 'vagas', 'emprego', 'empregos', 'estagio', 'estagiario', 'curriculo', 'salario', 'concurso', 'trabalhe conosco', 'carreira']);
const FREE = R(['gratis', 'gratuito', 'gratuita', 'free', 'download', 'baixar', 'crack', 'pirata', 'torrent', 'de graca']);
const SUPPORT = R(['suporte', 'sac', 'telefone', 'reclame aqui', 'reclamacao', 'ouvidoria', 'login', 'entrar', 'acessar', 'senha', 'esqueci', 'cancelar', 'segunda via', '2 via', '0800', 'atendimento ao cliente']);
const TRANSACTIONAL = R(['preco', 'precos', 'valor', 'valores', 'quanto custa', 'orcamento', 'cotacao', 'contratar', 'comprar', 'assinar', 'plano', 'planos', 'mensalidade']);
const COMMERCIAL = R(['melhor', 'melhores', 'comparar', 'comparativo', 'vs', 'versus', 'alternativa', 'alternativas', 'software', 'sistema', 'plataforma', 'ferramenta', 'aplicativo', 'app', 'solucao', 'agencia', 'empresa', 'servico', 'servicos', 'consultoria', 'automacao', 'chatbot', 'crm', 'erp', 'ia']);
const INFORMATIONAL = R(['como', 'o que e', 'o que significa', 'por que', 'porque', 'qual', 'quais', 'quando', 'onde', 'tutorial', 'guia', 'passo a passo', 'dicas', 'exemplo', 'exemplos', 'ideias', 'artigo', 'curso', 'aula', 'definicao', 'significado', 'vantagens', 'beneficios']);

export const INTENT_LABEL: Record<SearchIntent, string> = {
  INFORMATIONAL: 'Quer aprender',
  COMMERCIAL: 'Está pesquisando soluções',
  TRANSACTIONAL: 'Quer contratar ou comprar',
  NAVIGATIONAL: 'Procura sua marca',
  SUPPORT: 'Procura suporte ou acesso',
  JOB: 'Procura emprego',
  FREE: 'Quer algo gratuito',
  UNKNOWN: 'Intenção não identificada',
};

/** Prioridade: quem não compra (emprego, grátis, suporte) é separado antes de tudo. */
export function inferIntent(term: string, brand: readonly PreparedRule[] = []): SearchIntent {
  if (firstMatch(term, JOB)) return 'JOB';
  if (firstMatch(term, FREE)) return 'FREE';
  if (firstMatch(term, SUPPORT)) return 'SUPPORT';
  if (brand.length && firstMatch(term, brand)) return 'NAVIGATIONAL';
  if (firstMatch(term, TRANSACTIONAL)) return 'TRANSACTIONAL';
  if (firstMatch(term, INFORMATIONAL)) return 'INFORMATIONAL';
  if (firstMatch(term, COMMERCIAL)) return 'COMMERCIAL';
  return 'UNKNOWN';
}

/** Quanto a intenção combina com uma oferta de venda de solução. */
export function intentFit(intent: SearchIntent): 'GOOD' | 'WEAK' | 'BAD' {
  if (intent === 'JOB' || intent === 'FREE' || intent === 'SUPPORT') return 'BAD';
  if (intent === 'INFORMATIONAL') return 'WEAK';
  return 'GOOD';
}

// ───────────────────────── Coerência ─────────────────────────

export interface PageText {
  /** Palavras (já tratadas) que descrevem a página. */
  words: string[];
  /** De onde vieram: leitura real do HTML ou só o endereço. */
  basis: 'AUDIT' | 'URL' | 'NONE';
}

export function pageTextOf(url: string, audit: PageAudit | undefined, extraTitles: readonly string[] = []): PageText {
  const words = new Set<string>(urlWords(url));
  let basis: PageText['basis'] = words.size ? 'URL' : 'NONE';
  const add = (text: string | undefined): void => {
    if (text) contentTokens(text).forEach((w) => words.add(w));
  };
  extraTitles.forEach(add);
  if (audit?.ok) {
    add(audit.title);
    add(audit.metaDescription);
    audit.h1.forEach(add);
    audit.h2.forEach(add);
    basis = 'AUDIT';
  }
  if (extraTitles.length && basis === 'NONE') basis = 'URL';
  return { words: Array.from(words), basis };
}

export interface Coherence {
  /** Termo → anúncio (0–1), ou null quando não há texto de anúncio. */
  termToAd: number | null;
  /** Termo → página (0–1), ou null quando a página é desconhecida. */
  termToPage: number | null;
  /** Elo mais fraco da cadeia. */
  weakest: 'AD' | 'PAGE' | null;
  basis: PageText['basis'];
  /** Mínimo entre os elos conhecidos. */
  score: number | null;
}

const LOW = 0.34;

export function coherenceOf(term: string, adTexts: readonly string[], page: PageText): Coherence {
  const termTokens = contentTokens(term);
  const adWords = adTexts.flatMap((t) => contentTokens(t));
  const termToAd = termTokens.length && adWords.length ? coverage(termTokens, adWords) : null;
  const termToPage = termTokens.length && page.words.length ? coverage(termTokens, page.words) : null;
  const known = [termToAd, termToPage].filter((v): v is number => v !== null);
  const score = known.length ? Math.min(...known) : null;
  let weakest: Coherence['weakest'] = null;
  if (score !== null && score < LOW) {
    weakest = termToAd !== null && termToAd <= (termToPage ?? 1) ? 'AD' : 'PAGE';
  }
  return { termToAd, termToPage, weakest, basis: page.basis, score };
}

export const LOW_COHERENCE = LOW;

// ───────────────────────── Agrupamento de buscas por assunto ─────────────────────────

export interface TermCluster {
  id: string;
  /** Palavras que definem o assunto, da mais frequente para a menos. */
  topics: string[];
  label: string;
  terms: SearchTermRow[];
  clicks: number;
  cost: number;
  conversions: number;
  impressions: number;
  intent: SearchIntent;
}

/**
 * Agrupa termos parecidos de forma gulosa: cada termo entra no grupo mais
 * semelhante (Jaccard ≥ 0,5 sobre as palavras de conteúdo) ou abre um novo.
 */
export function clusterTerms(terms: readonly SearchTermRow[], brand: readonly PreparedRule[] = []): TermCluster[] {
  interface Work {
    words: Map<string, number>;
    terms: SearchTermRow[];
  }
  const clusters: Work[] = [];
  const ordered = [...terms].filter((t) => t.clicks > 0).sort((a, b) => b.cost - a.cost);

  const sim = (a: Set<string>, b: Map<string, number>): number => {
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    const union = a.size + b.size - inter;
    return union ? inter / union : 0;
  };

  for (const t of ordered) {
    const words = new Set(contentTokens(t.term));
    if (!words.size) continue;
    let best: Work | null = null;
    let bestSim = 0;
    for (const c of clusters) {
      const s = sim(words, c.words);
      if (s > bestSim) {
        bestSim = s;
        best = c;
      }
    }
    if (best && bestSim >= 0.5) {
      best.terms.push(t);
      words.forEach((w) => best.words.set(w, (best.words.get(w) ?? 0) + 1));
    } else {
      clusters.push({ words: new Map(Array.from(words).map((w) => [w, 1])), terms: [t] });
    }
  }

  return clusters
    .map((c, i) => {
      const topics = Array.from(c.words.entries())
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
        .slice(0, 4)
        .map(([w]) => w);
      const lead = c.terms[0];
      return {
        id: `c${i}-${topics.join('-')}`,
        topics,
        label: lead.term,
        terms: c.terms,
        clicks: c.terms.reduce((s, t) => s + t.clicks, 0),
        cost: c.terms.reduce((s, t) => s + t.cost, 0),
        conversions: c.terms.reduce((s, t) => s + t.conversions, 0),
        impressions: c.terms.reduce((s, t) => s + t.impressions, 0),
        intent: inferIntent(lead.term, brand),
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

// ───────────────────────── Página recomendada ─────────────────────────

export interface CandidatePage {
  url: string;
  normalizedUrl: string;
  words: string[];
  basis: PageText['basis'];
  /** Ex.: "usada nos anúncios", "conteúdo publicado". */
  origin: string;
}

export interface PageRecommendation {
  kind: 'KEEP' | 'REDIRECT' | 'CREATE' | 'UNKNOWN';
  best?: CandidatePage;
  bestScore: number;
  currentScore: number | null;
  /** Título sugerido, quando faltar uma página. */
  suggestedTitle?: string;
  note: string;
}

/**
 * Compara o assunto do grupo com as páginas conhecidas.
 * - KEEP: a página atual já é a que melhor cobre o assunto.
 * - REDIRECT: outra página cobre claramente melhor (diferença ≥ 0,25).
 * - CREATE: nenhuma página cobre o assunto (cobertura < 0,34).
 * - UNKNOWN: não há como medir (páginas sem texto conhecido).
 */
export function recommendPage(
  cluster: Pick<TermCluster, 'topics' | 'label'>,
  currentUrls: readonly string[],
  candidates: readonly CandidatePage[],
): PageRecommendation {
  const topics = cluster.topics;
  const scored = candidates
    .filter((c) => c.words.length > 0)
    .map((c) => ({ page: c, score: coverage(topics, c.words) }))
    .sort((a, b) => b.score - a.score);

  const currentNorm = new Set(currentUrls.map(normalizeUrl));
  const currentScored = scored.filter((s) => currentNorm.has(s.page.normalizedUrl));
  const currentScore = currentScored.length ? Math.max(...currentScored.map((s) => s.score)) : null;
  const top = scored[0];

  if (!top) {
    return {
      kind: 'UNKNOWN',
      bestScore: 0,
      currentScore,
      note: 'Nenhuma página conhecida tem texto suficiente para comparar. Audite as páginas do site.',
    };
  }

  if (top.score < LOW) {
    return {
      kind: 'CREATE',
      best: top.page,
      bestScore: top.score,
      currentScore,
      suggestedTitle: topics.slice(0, 3).join(' ') || cluster.label,
      note: 'Nenhuma página conhecida cobre este assunto.',
    };
  }

  const isCurrent = currentNorm.has(top.page.normalizedUrl);
  if (isCurrent || (currentScore !== null && top.score - currentScore < 0.25)) {
    return { kind: 'KEEP', best: top.page, bestScore: top.score, currentScore, note: 'A página atual já é a mais adequada.' };
  }

  return {
    kind: 'REDIRECT',
    best: top.page,
    bestScore: top.score,
    currentScore,
    note:
      currentScore === null
        ? 'Existe uma página que cobre melhor este assunto do que as usadas hoje.'
        : 'Outra página cobre este assunto bem melhor do que a atual.',
  };
}

// ───────────────────────── Termo → anúncios → páginas ─────────────────────────

/** Anúncios e URLs finais de cada grupo de anúncios, para ligar termo → página. */
export function indexAdsByGroup(ads: readonly AdRow[]): Map<string, { texts: string[]; urls: string[] }> {
  const map = new Map<string, { texts: string[]; urls: string[] }>();
  for (const ad of ads) {
    const entry = map.get(ad.adGroupId) ?? { texts: [], urls: [] };
    entry.texts.push(...ad.headlines, ...ad.descriptions);
    for (const u of ad.finalUrls) if (!entry.urls.includes(u)) entry.urls.push(u);
    map.set(ad.adGroupId, entry);
  }
  return map;
}
