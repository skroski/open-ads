import { CONFIDENCE_TEXT } from './format-labels';
import { Evidence, Recommendation } from './models';

/**
 * Explicação em linguagem simples, montada só com os campos da recomendação.
 * Nada é inventado aqui: fato, hipótese e "o que não sabemos" aparecem em blocos
 * separados, para ninguém confundir o que foi medido com o que é suposição.
 */

export interface NarrativeSection {
  title: string;
  text?: string;
  items?: string[];
}

export interface Narrative {
  headline: string;
  sections: NarrativeSection[];
}

const SOURCE: Record<Evidence['source'], string> = {
  GOOGLE_ADS: 'Google Ads',
  GA4: 'Google Analytics',
  SEARCH_CONSOLE: 'Search Console',
  SITE: 'site',
  CRM: 'CRM',
  CONFIG: 'sua configuração',
  CALCULATION: 'cálculo do painel',
};

function lines(evidence: readonly Evidence[], kind: Evidence['kind']): string[] {
  return evidence.filter((e) => e.kind === kind).map((e) => `${e.text} (${SOURCE[e.source]})`);
}

export function narrate(rec: Recommendation): Narrative {
  const facts = lines(rec.evidence, 'FACT');
  const hypotheses = lines(rec.evidence, 'HYPOTHESIS');
  const unknown = lines(rec.evidence, 'UNAVAILABLE');

  const sections: NarrativeSection[] = [{ title: 'O que encontramos', text: rec.problem }];
  if (facts.length) sections.push({ title: 'O que foi medido', items: facts });
  if (hypotheses.length) sections.push({ title: 'O que é suposição (ainda não comprovado)', items: hypotheses });
  if (unknown.length) sections.push({ title: 'O que ainda não sabemos', items: unknown });
  sections.push({
    title: 'O que isso pode significar',
    text: rec.impact.description,
    items: [`Base da estimativa: ${rec.impact.basis}`],
  });
  sections.push({ title: 'O que fazer', text: rec.action });
  sections.push({ title: 'Como saber se funcionou', text: rec.validation });
  sections.push({
    title: 'Quão confiável é esta conclusão',
    text: CONFIDENCE_TEXT[rec.confidence.level],
    items: rec.confidence.reasons,
  });

  return { headline: rec.title, sections };
}

export function toPlainText(n: Narrative): string {
  const parts: string[] = [n.headline, ''];
  for (const s of n.sections) {
    parts.push(s.title.toUpperCase());
    if (s.text) parts.push(s.text);
    s.items?.forEach((i) => parts.push(`- ${i}`));
    parts.push('');
  }
  return parts.join('\n').trim();
}
