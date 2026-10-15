import { AuditRules, KeywordCategory, TermCategory } from './models';
import { PreparedRule, firstMatch, prepareRules } from './text';
import { BRAND } from '../brand';

/** Regras padrão, usadas quando a conta ainda não tem uma configuração própria. */
export const DEFAULT_AUDIT_RULES: AuditRules = {
  brandTerms: [...BRAND.defaultBrandTerms],
  unqualifiedTerms: [
    'gratis',
    'gratuito',
    'free',
    'curso',
    'como fazer',
    'tutorial',
    'download',
    'crack',
    'pdf',
    'caseiro',
    'faça você mesmo',
    'diy',
    'amador',
    'vagas',
    'trabalhe conosco',
    'estagio',
    'salario',
    'quanto ganha',
    'curriculo',
    'concurso',
    'reclame aqui',
    'telefone',
    'sac',
    '0800',
    'ouvidoria',
    'login',
    'entrar na conta',
    'esqueci senha',
    'suporte',
  ],
  qualifiedTerms: [
    'software',
    'sistema',
    'agencia',
    'empresa',
    'plataforma',
    'gestao',
    'consultoria',
    'servico',
    'contratar',
    'orcamento',
    'quanto custa',
    'preco',
    'valor',
    'comprar',
    'desenvolvimento',
    'site',
    'automacao',
    'ia',
    'clinica',
    'consultorio',
  ],
  competitorTerms: [
    'scribenote',
    'vetsmart',
    'nuvemvet',
    'vetus',
    'simplesvet',
    'vetwork',
    'vet soft',
    'zello',
    'rd station',
    'hubspot',
    'kommo',
  ],
};

export interface PreparedRules {
  brand: PreparedRule[];
  unqualified: PreparedRule[];
  qualified: PreparedRule[];
  competitor: PreparedRule[];
}

/**
 * Prepara as regras uma vez só. `extraBrand` recebe pistas de marca vindas dos
 * nomes da conta e das campanhas (ex.: "Acme Display" → "acme").
 */
export function prepareAuditRules(rules: AuditRules, extraBrand: readonly string[] = []): PreparedRules {
  return {
    brand: prepareRules([...rules.brandTerms, ...extraBrand]),
    unqualified: prepareRules(rules.unqualifiedTerms),
    qualified: prepareRules(rules.qualifiedTerms),
    competitor: prepareRules(rules.competitorTerms),
  };
}

export interface Classification<C extends string> {
  category: C;
  reason: string;
  matched?: string;
}

/** Prioridade: marca > desqualificado > concorrente > qualificado > geral. */
export function classifyTerm(term: string, rules: PreparedRules): Classification<TermCategory> {
  const brand = firstMatch(term, rules.brand);
  if (brand) {
    return {
      category: 'BRAND',
      matched: brand,
      reason: `Contém o nome da sua marca ("${brand}"). Quem busca assim em geral já conhece a empresa.`,
    };
  }
  const unq = firstMatch(term, rules.unqualified);
  if (unq) {
    return {
      category: 'UNQUALIFIED',
      matched: unq,
      reason: `Contém "${unq}", da lista de termos sem intenção de compra.`,
    };
  }
  const comp = firstMatch(term, rules.competitor);
  if (comp) {
    return {
      category: 'COMPETITOR',
      matched: comp,
      reason: `Menciona "${comp}", da sua lista de concorrentes.`,
    };
  }
  const qual = firstMatch(term, rules.qualified);
  if (qual) {
    return {
      category: 'QUALIFIED',
      matched: qual,
      reason: `Contém "${qual}", da lista de termos de alta intenção comercial.`,
    };
  }
  return { category: 'GENERAL', reason: 'Nenhuma regra da conta reconhece este termo.' };
}

export function classifyKeyword(text: string, rules: PreparedRules): Classification<KeywordCategory> {
  const brand = firstMatch(text, rules.brand);
  if (brand) {
    return {
      category: 'BRAND',
      matched: brand,
      reason: `Palavra da sua marca ("${brand}"): risco de pagar por quem já é cliente.`,
    };
  }
  const unq = firstMatch(text, rules.unqualified);
  if (unq) {
    return {
      category: 'RISK',
      matched: unq,
      reason: `Contém "${unq}": tende a atrair buscas sem intenção de compra.`,
    };
  }
  const qual = firstMatch(text, rules.qualified);
  if (qual) {
    return {
      category: 'QUALIFIED',
      matched: qual,
      reason: `Contém "${qual}": intenção comercial.`,
    };
  }
  return { category: 'GENERAL', reason: 'Palavra sem classificação específica.' };
}

/**
 * Pistas de marca extraídas do nome da conta e das campanhas.
 * As marcas reconhecidas ficam em brand.ts (white label).
 */
export function brandHintsFrom(accountName: string, campaignNames: readonly string[]): string[] {
  const hints = new Set<string>();
  const scan = (name: string): void => {
    const n = name.toLowerCase();
    for (const h of BRAND.brandHints) {
      if (h.match.some((m) => n.includes(m))) h.terms.forEach((t) => hints.add(t));
    }
  };
  scan(accountName);
  campaignNames.forEach(scan);
  return [...hints];
}

/** Interpreta uma lista digitada ("a, b\nc") em termos únicos e normalizados. */
export function parseTermList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,\n;]/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0),
    ),
  );
}
