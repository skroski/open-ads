import { AdRow, BusinessContext, CampaignRow, ConversionActionInfo, ConversionBreakdownRow, SearchTermRow } from './models';

/**
 * Ficha de fatos enviada à IA. Cada linha tem um id curto e um texto com os números exatos da
 * conta; o servidor só aceita da IA o que citar esses ids e esses números. Nada daqui sai do
 * navegador para outro lugar além do endpoint do próprio painel.
 */
export interface Fact {
  id: string;
  text: string;
}

const PER_GROUP = 15;
const clip = (s: string, n = 80): string => s.replace(/\s+/g, ' ').trim().slice(0, n);
const num = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
const money = (n: number): string => n.toFixed(2).replace('.', ',');

export interface FactSources {
  campaigns: readonly CampaignRow[];
  ads: readonly AdRow[];
  terms: readonly Pick<SearchTermRow, 'term' | 'conversions'>[];
  /** Ações de conversão que o código não soube classificar. */
  ambiguousActions: readonly ConversionActionInfo[];
  conversionBreakdown: readonly ConversionBreakdownRow[];
}

export function buildFactSheet(src: FactSources): Fact[] {
  const facts: Fact[] = [];

  [...src.campaigns]
    .filter((c) => c.status !== 'REMOVED')
    .sort((a, b) => b.cost - a.cost)
    .slice(0, PER_GROUP)
    .forEach((c, i) =>
      facts.push({
        id: `c${i + 1}`,
        text: `Campanha "${clip(c.name)}": ${num(c.clicks)} cliques, R$ ${money(c.cost)} gastos, ${num(c.conversions)} conversões`,
      }),
    );

  const seenHeadlines = new Set<string>();
  [...src.ads]
    .sort((a, b) => b.clicks - a.clicks)
    .filter((a) => {
      const key = a.headlines.slice(0, 3).join('|');
      if (!key || seenHeadlines.has(key)) return false;
      seenHeadlines.add(key);
      return true;
    })
    .slice(0, PER_GROUP)
    .forEach((a, i) =>
      facts.push({
        id: `a${i + 1}`,
        text: `Anúncio da campanha "${clip(a.campaignName, 50)}", títulos: ${a.headlines.slice(0, 3).map((h) => clip(h, 40)).join(' | ')}`,
      }),
    );

  const byTerm = new Map<string, number>();
  for (const t of src.terms) if (t.conversions > 0) byTerm.set(t.term, (byTerm.get(t.term) ?? 0) + t.conversions);
  [...byTerm]
    .sort((a, b) => b[1] - a[1])
    .slice(0, PER_GROUP)
    .forEach(([term, n], i) =>
      facts.push({ id: `t${i + 1}`, text: `Termo de busca que converteu: "${clip(term)}" (${num(n)} conversões)` }),
    );

  src.ambiguousActions.slice(0, 12).forEach((a, i) => {
    const n = src.conversionBreakdown.filter((r) => r.actionName === a.name).reduce((s, r) => s + r.conversions, 0);
    facts.push({
      id: `k${i + 1}`,
      text: `Ação de conversão "${clip(a.name, 100)}" (categoria ${a.category}), ${num(n)} conversões no período`,
    });
  });

  return facts;
}

const CONTEXT_LABEL: Record<keyof BusinessContext, string> = {
  offer: 'O que a empresa vende',
  notOffer: 'O que a empresa NÃO vende ou não atende',
  idealCustomer: 'Cliente ideal',
  notCustomer: 'Quem não é cliente',
};

/**
 * Fatos para a IA avaliar termos contra o contexto do negócio: o contexto preenchido vira fatos "x1…"
 * e cada termo vira um fato "s1…". O servidor só aceita vereditos que citem um fato de contexto.
 */
export function buildTermReviewFacts(
  context: BusinessContext,
  terms: readonly { term: string; clicks: number; cost: number }[],
): Fact[] {
  const facts: Fact[] = [];
  (Object.keys(CONTEXT_LABEL) as Array<keyof BusinessContext>)
    .filter((k) => context[k].trim())
    .forEach((k, i) => facts.push({ id: `x${i + 1}`, text: `${CONTEXT_LABEL[k]}: ${clip(context[k], 250)}` }));
  terms.forEach((t, i) =>
    facts.push({
      id: `s${i + 1}`,
      text: `Termo de busca "${clip(t.term)}": ${num(t.clicks)} cliques, R$ ${money(t.cost)} gastos, 0 conversões`,
    }),
  );
  return facts;
}
