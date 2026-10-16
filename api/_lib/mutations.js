// Validação e montagem das operações que ESCREVEM no Google Ads. Funções puras:
// tudo que chega do navegador é conferido aqui antes de virar uma chamada à API.

import { HttpError } from './http.js';

export const MATCH_TYPES = ['EXACT', 'PHRASE', 'BROAD'];
export const KEYWORD_STATUSES = ['PAUSED', 'ENABLED'];
export const MAX_NEGATIVE_OPERATIONS = 500;
export const MAX_KEYWORD_LENGTH = 80;
/** Teto de segurança para um lance de CPC (R$), contra erro de digitação como 1000 no lugar de 1,00. */
export const MAX_CPC_BID_BRL = 1000;

const RESOURCE_NAME = /^customers\/(\d+)\/adGroupCriteria\/\d+~\d+$/;

export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

function matchTypeOrThrow(value, fallback) {
  const mt = String(value ?? fallback).toUpperCase();
  if (!MATCH_TYPES.includes(mt)) throw new HttpError(400, `Tipo de correspondência inválido: ${value}.`);
  return mt;
}

/** Operações de "criar negativa na campanha" para cada campanha × palavra. */
export function buildNegativeOperations({ customerId, campaignId, campaignIds, text, keywords, matchType }) {
  const customer = onlyDigits(customerId);
  if (!customer) throw new HttpError(400, 'Conta (Customer ID) não informada.');

  const campaigns = [...new Set((Array.isArray(campaignIds) && campaignIds.length ? campaignIds : [campaignId]).map(onlyDigits))].filter(Boolean);
  if (!campaigns.length) throw new HttpError(400, 'Campanha e termo(s) são obrigatórios');

  const defaultMatch = matchTypeOrThrow(matchType, 'EXACT');
  const raw = Array.isArray(keywords) && keywords.length ? keywords : text ? [text] : [];
  if (!raw.length) throw new HttpError(400, 'Campanha e termo(s) são obrigatórios');

  const seen = new Set();
  const items = [];
  for (const k of raw) {
    const word = typeof k === 'string' ? k : k?.text;
    const cleaned = String(word ?? '').replace(/[\[\]"]/g, '').trim();
    if (!cleaned) continue;
    if (cleaned.length > MAX_KEYWORD_LENGTH) throw new HttpError(400, `A palavra "${cleaned.slice(0, 20)}…" passa de ${MAX_KEYWORD_LENGTH} caracteres.`);
    const mt = typeof k === 'string' ? defaultMatch : matchTypeOrThrow(k?.matchType, defaultMatch);
    const key = `${cleaned.toLowerCase()}|${mt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ text: cleaned, matchType: mt });
  }
  if (!items.length) throw new HttpError(400, 'Nenhuma palavra válida para negativar.');

  const total = campaigns.length * items.length;
  if (total > MAX_NEGATIVE_OPERATIONS) {
    throw new HttpError(400, `Muitas operações de uma vez (${total}). O limite é ${MAX_NEGATIVE_OPERATIONS}: envie em lotes menores.`);
  }

  return campaigns.flatMap((id) =>
    items.map((item) => ({
      create: {
        campaign: `customers/${customer}/campaigns/${id}`,
        negative: true,
        keyword: { text: item.text, matchType: item.matchType },
      },
    })),
  );
}

/** Uma operação sobre uma palavra-chave: pausar/ativar, remover ou ajustar o lance. */
export function buildKeywordOperation({ customerId, resourceName, status, action, remove, cpcBidBrl, cpcBidMicros }) {
  const match = RESOURCE_NAME.exec(String(resourceName ?? ''));
  if (!match) throw new HttpError(400, 'resourceName inválido.');
  if (onlyDigits(customerId) !== match[1]) throw new HttpError(400, 'A palavra-chave não pertence à conta informada.');

  if (action === 'REMOVE' || remove === true) return { remove: resourceName };

  if (cpcBidBrl !== undefined || cpcBidMicros !== undefined || action === 'BID') {
    const micros = cpcBidMicros !== undefined ? Number(cpcBidMicros) : Math.round(Number(cpcBidBrl) * 1_000_000);
    if (!Number.isFinite(micros) || micros <= 0) throw new HttpError(400, 'Lance inválido.');
    if (micros > MAX_CPC_BID_BRL * 1_000_000) throw new HttpError(400, `Lance acima do limite de segurança (R$ ${MAX_CPC_BID_BRL}).`);
    return { updateMask: 'cpc_bid_micros', update: { resourceName, cpcBidMicros: Math.round(micros) } };
  }

  const next = status ?? 'PAUSED';
  if (!KEYWORD_STATUSES.includes(next)) throw new HttpError(400, `Status inválido: ${status}.`);
  return { updateMask: 'status', update: { resourceName, status: next } };
}
