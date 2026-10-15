import { Lead, LeadStatus } from './models';
import { normalize } from './text';

/**
 * Importação de leads de um CRM qualquer a partir de CSV.
 * Não existe integração única com "o CRM", então o formato é flexível: as colunas
 * são reconhecidas pelo nome e o usuário confirma o mapeamento antes de importar.
 *
 * Privacidade: nome, e-mail e telefone NUNCA são lidos. Só o necessário para medir
 * origem, etapa e valor.
 */

export type LeadField =
  | 'externalId'
  | 'createdAt'
  | 'campaign'
  | 'term'
  | 'gclid'
  | 'source'
  | 'landingPage'
  | 'region'
  | 'status'
  | 'value'
  | 'marginPct'
  | 'qualifiedAt'
  | 'proposalAt'
  | 'wonAt'
  | 'lostReason'
  | 'firstResponseMinutes';

export const LEAD_FIELDS: ReadonlyArray<{ key: LeadField; label: string; help: string; required?: boolean }> = [
  { key: 'createdAt', label: 'Data do primeiro contato', help: 'Quando o lead entrou. Obrigatória.', required: true },
  { key: 'status', label: 'Etapa / status', help: 'Ex.: novo, qualificado, proposta, ganho, perdido.' },
  { key: 'campaign', label: 'Campanha', help: 'Nome (ou UTM) da campanha de origem.' },
  { key: 'value', label: 'Valor da venda (R$)', help: 'Só para vendas fechadas.' },
  { key: 'marginPct', label: 'Margem da venda (%)', help: 'Opcional. Senão vale a margem padrão da meta.' },
  { key: 'externalId', label: 'ID no CRM', help: 'Evita duplicar ao importar de novo.' },
  { key: 'term', label: 'Termo de busca', help: 'Opcional (UTM term).' },
  { key: 'source', label: 'Origem / canal', help: 'Ex.: google, instagram.' },
  { key: 'landingPage', label: 'Página de entrada', help: 'URL em que o lead chegou.' },
  { key: 'region', label: 'Região / estado', help: 'Para checar a área de atendimento.' },
  { key: 'qualifiedAt', label: 'Data da qualificação', help: 'Opcional.' },
  { key: 'proposalAt', label: 'Data da proposta', help: 'Opcional.' },
  { key: 'wonAt', label: 'Data do fechamento', help: 'Mede o ciclo de venda.' },
  { key: 'lostReason', label: 'Motivo da perda', help: 'Ex.: sem perfil, preço, sem resposta.' },
  { key: 'firstResponseMinutes', label: 'Minutos até a 1ª resposta', help: 'Mede falhas no atendimento.' },
  { key: 'gclid', label: 'GCLID', help: 'Opcional (rastreio do clique).' },
];

/** Palavras que identificam cada campo no cabeçalho (já normalizadas). */
const HEADER_HINTS: Record<LeadField, string[]> = {
  createdAt: ['data do contato', 'data de criacao', 'data criacao', 'criado em', 'created', 'created at', 'data', 'entrada', 'data entrada', 'date'],
  status: ['etapa', 'status', 'fase', 'estagio', 'stage', 'situacao'],
  campaign: ['campanha', 'campaign', 'utm campaign', 'utm_campaign'],
  value: ['valor da venda', 'valor venda', 'receita', 'valor fechado', 'valor', 'value', 'revenue', 'amount', 'ticket'],
  marginPct: ['margem', 'margin'],
  externalId: ['id externo', 'id crm', 'lead id', 'id do lead', 'codigo', 'id'],
  term: ['termo de busca', 'termo', 'palavra chave', 'keyword', 'utm term', 'utm_term'],
  source: ['origem', 'canal', 'source', 'utm source', 'utm_source', 'fonte'],
  landingPage: ['pagina de entrada', 'landing page', 'landing', 'pagina', 'url'],
  region: ['regiao', 'estado', 'uf', 'region', 'state', 'cidade'],
  qualifiedAt: ['data qualificacao', 'qualificado em', 'qualified at', 'data qualificado'],
  proposalAt: ['data proposta', 'proposta em', 'proposal at'],
  wonAt: ['data fechamento', 'data da venda', 'fechado em', 'ganho em', 'won at', 'closed at', 'data ganho'],
  lostReason: ['motivo da perda', 'motivo perda', 'motivo', 'lost reason', 'razao'],
  firstResponseMinutes: ['minutos ate a primeira resposta', 'tempo primeira resposta', 'primeira resposta', 'sla', 'first response'],
  gclid: ['gclid'],
};

const NEVER_IMPORT = ['nome', 'name', 'email', 'e mail', 'telefone', 'phone', 'celular', 'whatsapp', 'cpf', 'cnpj'];

/** Divide o CSV em linhas e células (aspas, vírgula/ponto e vírgula/tab, BOM, CRLF). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of firstLine) if (ch in counts) counts[ch as keyof typeof counts]++;
  const delimiter = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',') as string;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** Sugere, para cada campo, o índice da coluna cujo cabeçalho melhor combina (ou -1). */
export function guessMapping(headers: readonly string[]): Record<LeadField, number> {
  const normalized = headers.map((h) => normalize(h));
  const used = new Set<number>();
  const out = {} as Record<LeadField, number>;

  // Campos com dicas mais específicas escolhem primeiro, para "data" não roubar "data da venda".
  const order = [...LEAD_FIELDS].map((f) => f.key).sort((a, b) => longest(HEADER_HINTS[b]) - longest(HEADER_HINTS[a]));
  for (const field of order) {
    let best = -1;
    let bestScore = 0;
    normalized.forEach((h, idx) => {
      if (used.has(idx) || !h || NEVER_IMPORT.some((n) => h === n || h.startsWith(`${n} `))) return;
      HEADER_HINTS[field].forEach((hint) => {
        const score = h === hint ? 100 + hint.length : h.includes(hint) && hint.length >= 4 ? hint.length : 0;
        if (score > bestScore) {
          bestScore = score;
          best = idx;
        }
      });
    });
    out[field] = best;
    if (best >= 0) used.add(best);
  }
  return out;
}

function longest(list: string[]): number {
  return Math.max(...list.map((s) => s.length));
}

/** "R$ 1.234,56", "1234.56", "1.234" → número. */
export function parseNumber(raw: string): number | undefined {
  const s = raw.replace(/[^\d.,-]/g, '').trim();
  if (!s) return undefined;
  let n: string;
  if (s.includes(',') && s.includes('.')) {
    n = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    n = s.replace(',', '.');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    n = s.replace(/\./g, '');
  } else if (/^-?[1-9]\d{0,2}\.\d{3}$/.test(s)) {
    // "3.000" no Brasil é três mil (ponto de milhar), não "três vírgula zero".
    n = s.replace('.', '');
  } else {
    n = s;
  }
  const v = Number(n);
  return Number.isFinite(v) ? v : undefined;
}

/** "13/10/2026 14:30", "2026-10-13T10:00", "13-10-26" → "2026-10-13". */
export function parseDate(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return undefined;
}

export function parseStatus(raw: string): LeadStatus {
  const s = normalize(raw);
  if (!s) return 'OPEN';
  if (/\b(desqualific|sem perfil|descart|invalid|spam)/.test(s)) return 'DISQUALIFIED';
  if (/\b(ganh|fechad|venda|vendid|won|cliente|convertid)/.test(s)) return 'WON';
  if (/\b(perd|lost|cancel|desist)/.test(s)) return 'LOST';
  if (/\b(propost|orcament|negocia)/.test(s)) return 'PROPOSAL';
  if (/\b(qualific|sql|mql|agendad|reuniao)/.test(s)) return 'QUALIFIED';
  return 'OPEN';
}

export interface ImportIssue {
  line: number;
  message: string;
}

export interface ImportResult {
  leads: Array<Omit<Lead, 'id' | 'accountId'>>;
  issues: ImportIssue[];
}

/** Converte as linhas (sem o cabeçalho) segundo o mapeamento. */
export function normalizeRows(
  rows: readonly (readonly string[])[],
  mapping: Record<LeadField, number>,
  firstLine = 2,
): ImportResult {
  const get = (row: readonly string[], f: LeadField): string => {
    const idx = mapping[f];
    return idx >= 0 ? (row[idx] ?? '').trim() : '';
  };
  const leads: ImportResult['leads'] = [];
  const issues: ImportIssue[] = [];

  rows.forEach((row, i) => {
    const line = firstLine + i;
    const createdAt = parseDate(get(row, 'createdAt'));
    if (!createdAt) {
      issues.push({ line, message: 'Data do primeiro contato ausente ou em formato desconhecido.' });
      return;
    }
    const status = parseStatus(get(row, 'status'));
    const value = parseNumber(get(row, 'value'));
    const margin = parseNumber(get(row, 'marginPct'));
    const response = parseNumber(get(row, 'firstResponseMinutes'));
    const wonAt = parseDate(get(row, 'wonAt'));

    if (status === 'WON' && value === undefined) {
      issues.push({ line, message: 'Venda sem valor: entra no funil, mas não entra na receita nem no ROI.' });
    }
    if (margin !== undefined && (margin < 0 || margin > 100)) {
      issues.push({ line, message: `Margem fora de 0–100% (${margin}).` });
    }

    const lead: Omit<Lead, 'id' | 'accountId'> = {
      createdAt,
      status,
      externalId: get(row, 'externalId') || undefined,
      campaign: get(row, 'campaign') || undefined,
      term: get(row, 'term').toLowerCase() || undefined,
      gclid: get(row, 'gclid') || undefined,
      source: get(row, 'source') || undefined,
      landingPage: get(row, 'landingPage') || undefined,
      region: get(row, 'region') || undefined,
      qualifiedAt: parseDate(get(row, 'qualifiedAt')),
      proposalAt: parseDate(get(row, 'proposalAt')),
      wonAt: status === 'WON' ? (wonAt ?? undefined) : wonAt,
      lostReason: get(row, 'lostReason') || undefined,
      value: status === 'WON' ? value : undefined,
      marginPct: margin !== undefined && margin >= 0 && margin <= 100 ? margin : undefined,
      firstResponseMinutes: response !== undefined && response >= 0 ? response : undefined,
    };
    leads.push(lead);
  });
  return { leads, issues };
}

/** CSV de exemplo para baixar e preencher. */
export const SAMPLE_CSV = [
  'data_contato;etapa;campanha;valor_venda;margem_pct;id_crm;termo;regiao;data_fechamento;motivo_perda;minutos_primeira_resposta',
  '2026-09-20;ganho;Campanha Acme - Pesquisa;3000;50;L-1001;software clinica odontologica;SP;2026-10-02;;12',
  '2026-09-21;qualificado;Campanha Acme - Pesquisa;;;L-1002;ia odontologica;SP;;;8',
  '2026-09-22;desqualificado;Acme Display;;;L-1003;;MG;;sem perfil;240',
].join('\n');

/** Dias entre o primeiro contato e a venda, para estimar o ciclo de venda real. */
export function observedSalesCycleDays(leads: readonly Lead[]): number[] {
  return leads
    .filter((l) => l.status === 'WON' && l.wonAt && l.createdAt && l.wonAt >= l.createdAt)
    .map((l) => Math.round((new Date(`${l.wonAt}T00:00:00`).getTime() - new Date(`${l.createdAt}T00:00:00`).getTime()) / 86_400_000));
}
