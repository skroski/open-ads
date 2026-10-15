import { diffDays } from './dates';
import { CandidatePage, TermCluster, inferIntent, recommendPage } from './intent';
import {
  Confidence,
  ContentItem,
  ContentRole,
  Evidence,
  Ga4PageRow,
  SearchConsolePageRow,
  SearchConsoleQueryRow,
  SearchIntent,
} from './models';
import { brl, num } from './format';
import { normalizeUrl } from './text';

/**
 * Oportunidades de conteúdo a partir de buscas reais (pagas e orgânicas), do
 * desempenho das páginas e do histórico de publicações. Cada oportunidade diz de
 * onde veio a demanda e o que não foi possível medir.
 */

export type OpportunityType = 'PUBLISH' | 'UPDATE' | 'DISTRIBUTE';

export interface ContentOpportunity {
  id: string;
  type: OpportunityType;
  topic: string;
  intent: SearchIntent;
  role: ContentRole;
  demand: {
    clicks: number;
    impressions: number;
    cost: number;
    conversions: number;
    paid: boolean;
    organic: boolean;
    support?: boolean;
  };
  matchedUrl?: string;
  evidence: Evidence[];
  confidence: Confidence;
  action: string;
  priority: number;
}

export interface ContentInput {
  clusters: readonly TermCluster[];
  /** Consultas orgânicas do Search Console, já agrupadas por assunto. */
  organicClusters: readonly TermCluster[];
  /** Dúvidas do atendimento (cada uma vira um grupo; `clicks` carrega a contagem). */
  supportClusters: readonly TermCluster[];
  candidates: readonly CandidatePage[];
  registry: readonly ContentItem[];
  gscPages: readonly SearchConsolePageRow[] | null;
  gscQueries: readonly SearchConsoleQueryRow[] | null;
  ga4Pages: readonly Ga4PageRow[] | null;
  /** URLs (normalizadas) que recebem tráfego pago. */
  paidUrls: readonly string[];
  today: string;
}

export function roleOf(intent: SearchIntent, hasKeyEvents = false): ContentRole {
  if (hasKeyEvents || intent === 'TRANSACTIONAL') return 'CONVERT';
  if (intent === 'COMMERCIAL') return 'DECIDE';
  return 'ATTRACT';
}

export const ROLE_LABEL: Record<ContentRole, string> = {
  ATTRACT: 'Atrai visitas',
  DECIDE: 'Ajuda na decisão',
  CONVERT: 'Gera oportunidade comercial',
};

function pathOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url;
  }
}

export function findContentOpportunities(input: ContentInput): ContentOpportunity[] {
  const out: ContentOpportunity[] = [];
  const registryByUrl = new Map(
    input.registry.filter((r) => r.url).map((r) => [normalizeUrl(r.url), r] as const),
  );
  const gscByPath = new Map((input.gscPages ?? []).map((p) => [pathOf(p.page), p]));
  const ga4ByPath = new Map((input.ga4Pages ?? []).map((p) => [p.path.replace(/\/+$/, '') || '/', p]));
  const paid = new Set(input.paidUrls.map(normalizeUrl));
  const organicAvailable = input.gscPages !== null && input.gscQueries !== null;

  const consider = (cluster: TermCluster, source: 'PAID' | 'ORGANIC' | 'SUPPORT'): void => {
    const isPaid = source === 'PAID';
    const isSupport = source === 'SUPPORT';
    const demandOk = isPaid ? cluster.clicks >= 5 : isSupport ? cluster.clicks >= 2 : cluster.impressions >= 50;
    if (!demandOk) return;

    const rec = recommendPage(cluster, [], input.candidates);
    const demand = {
      clicks: cluster.clicks,
      impressions: cluster.impressions,
      cost: cluster.cost,
      conversions: cluster.conversions,
      paid: isPaid,
      organic: source === 'ORGANIC',
      support: isSupport,
    };
    const intent = isSupport ? 'INFORMATIONAL' : cluster.intent === 'UNKNOWN' ? inferIntent(cluster.label) : cluster.intent;
    const evidence: Evidence[] = [
      {
        kind: 'FACT',
        source: isPaid ? 'GOOGLE_ADS' : isSupport ? 'CRM' : 'SEARCH_CONSOLE',
        text: isPaid
          ? `Buscas sobre "${cluster.label}" geraram ${num(cluster.clicks)} cliques pagos (${brl(cluster.cost)}) no período.`
          : isSupport
            ? `"${cluster.label}" foi perguntado ${num(cluster.clicks)} vezes no atendimento.`
            : `Buscas sobre "${cluster.label}" tiveram ${num(cluster.impressions)} impressões orgânicas e ${num(cluster.clicks)} cliques.`,
      },
    ];
    if (isPaid && !organicAvailable) {
      evidence.push({
        kind: 'UNAVAILABLE',
        source: 'SEARCH_CONSOLE',
        text: 'Sem Search Console, a demanda orgânica por este assunto não foi medida.',
      });
    }

    if (rec.kind === 'UNKNOWN') return;

    if (rec.kind === 'CREATE') {
      evidence.push({
        kind: 'FACT',
        source: 'CALCULATION',
        text: `Nenhuma página conhecida cobre este assunto (melhor cobertura: ${num(rec.bestScore * 100)}%).`,
      });
      out.push({
        id: `publish:${cluster.id}`,
        type: 'PUBLISH',
        topic: cluster.label,
        intent,
        role: roleOf(intent),
        demand,
        evidence,
        confidence: {
          level: cluster.clicks >= 30 ? 'MEDIUM' : 'LOW',
          reasons: [
            cluster.clicks >= 30
              ? 'Demanda real e recorrente medida nas buscas.'
              : 'Demanda ainda pequena; confirme antes de produzir.',
            'A cobertura é medida por texto e endereço das páginas conhecidas.',
          ],
        },
        action: `Publicar um conteúdo sobre "${rec.suggestedTitle ?? cluster.label}" (${intentLabel(intent)}).`,
        priority: Math.min(100, 30 + cluster.cost / 5 + cluster.impressions / 200),
      });
      return;
    }

    const page = rec.best;
    if (!page) return;
    const norm = page.normalizedUrl;
    const reg = registryByUrl.get(norm);
    const gsc = gscByPath.get(pathOf(page.url));
    const ga4 = ga4ByPath.get(pathOf(page.url));

    const reasons: string[] = [];
    if (reg) {
      const last = [reg.publishedAt, ...reg.updates.map((u) => u.at)].filter(Boolean).sort().pop();
      if (last) {
        const age = diffDays(last.slice(0, 10), input.today);
        if (age > 365) {
          reasons.push(`Sem atualização há ${num(age)} dias.`);
          evidence.push({
            kind: 'FACT',
            source: 'CRM',
            text: `"${reg.title}" foi publicada/atualizada pela última vez há ${num(age)} dias.`,
          });
        }
      }
    }
    if (gsc && gsc.impressions >= 100 && gsc.position > 3.5 && gsc.position <= 15) {
      reasons.push(`Posição média ${gsc.position.toFixed(1).replace('.', ',')} no Google.`);
      evidence.push({
        kind: 'FACT',
        source: 'SEARCH_CONSOLE',
        text: `A página aparece na posição média ${gsc.position.toFixed(1).replace('.', ',')} com ${num(gsc.impressions)} impressões: perto de ganhar mais cliques.`,
      });
    }
    if (ga4 && ga4.sessions >= 50 && ga4.avgEngagementSec < 20) {
      reasons.push('Visitantes saem rápido.');
      evidence.push({
        kind: 'FACT',
        source: 'GA4',
        text: `Engajamento médio de ${num(ga4.avgEngagementSec)}s em ${num(ga4.sessions)} sessões.`,
      });
    }
    if (rec.bestScore < 0.6) {
      reasons.push('Cobre só parte do assunto.');
      evidence.push({
        kind: 'FACT',
        source: 'CALCULATION',
        text: `A página cobre ${num(rec.bestScore * 100)}% do assunto buscado.`,
      });
    }

    if (reasons.length) {
      out.push({
        id: `update:${norm}:${cluster.id}`,
        type: 'UPDATE',
        topic: cluster.label,
        intent,
        role: roleOf(intent, (ga4?.keyEvents ?? 0) > 0),
        demand,
        matchedUrl: page.url,
        evidence,
        confidence: {
          level: gsc || ga4 ? 'MEDIUM' : 'LOW',
          reasons: [
            gsc || ga4 ? 'Há dados de desempenho da própria página.' : 'Baseado só no texto e no histórico da página.',
          ],
        },
        action: `Atualizar ${pathOf(page.url)}: ${reasons.join(' ')}`,
        priority: Math.min(100, 25 + cluster.cost / 6 + cluster.impressions / 250),
      });
      return;
    }

    // Há conteúdo bom com tração orgânica que não é usado na mídia paga.
    if (gsc && gsc.clicks >= 20 && !paid.has(norm) && isPaid) {
      evidence.push({
        kind: 'FACT',
        source: 'SEARCH_CONSOLE',
        text: `${pathOf(page.url)} recebeu ${num(gsc.clicks)} cliques orgânicos, mas não é destino de nenhum anúncio.`,
      });
      out.push({
        id: `distribute:${norm}:${cluster.id}`,
        type: 'DISTRIBUTE',
        topic: cluster.label,
        intent,
        role: roleOf(intent, (ga4?.keyEvents ?? 0) > 0),
        demand,
        matchedUrl: page.url,
        evidence,
        confidence: { level: 'MEDIUM', reasons: ['Tração orgânica medida e assunto compatível com os anúncios.'] },
        action: `Usar ${pathOf(page.url)} como destino dos anúncios sobre "${cluster.label}" e testar com um experimento.`,
        priority: Math.min(100, 20 + cluster.cost / 8),
      });
    }
  };

  input.clusters.forEach((c) => consider(c, 'PAID'));
  input.organicClusters.forEach((c) => consider(c, 'ORGANIC'));
  input.supportClusters.forEach((c) => consider(c, 'SUPPORT'));

  return out.sort((a, b) => b.priority - a.priority);
}

function intentLabel(intent: SearchIntent): string {
  switch (intent) {
    case 'INFORMATIONAL':
      return 'para quem quer aprender';
    case 'COMMERCIAL':
      return 'para quem compara soluções';
    case 'TRANSACTIONAL':
      return 'para quem quer contratar';
    default:
      return 'conforme a intenção da busca';
  }
}
