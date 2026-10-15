// POST /api/keyword-ideas — ideias de palavras-chave do Planejador do Google Ads
// (KeywordPlanIdeaService.GenerateKeywordIdeas). Somente leitura.
//
// Corpo: { keywords?: string[], url?: string, language?: string, geoTargets?: string[] }
// Cabeçalhos opcionais: x-customer-id (conta do Google Ads) e x-login-customer-id (MCC)
//
// Exige acesso Basic ou Standard na API (no projeto do Google Cloud). Com Test ou Explorer o Google
// recusa o método; a resposta traz code = DEVELOPER_TOKEN_NOT_APPROVED para o app explicar.

import { HttpError, endpoint } from './_lib/http.js';
import { getAccessToken } from './_lib/google-auth.js';

const API_VERSION = 'v25';
const PORTUGUESE = 'languageConstants/1014';
const BRAZIL = 'geoTargetConstants/2076';
const MAX_SEEDS = 20;

const constant = (value, prefix, fallback) =>
  typeof value === 'string' && new RegExp(`^${prefix}/\\d+$`).test(value) ? value : fallback;

export default endpoint(async ({ body, headers }) => {
  const keywords = (Array.isArray(body?.keywords) ? body.keywords : [])
    .filter((k) => typeof k === 'string' && k.trim())
    .map((k) => k.replace(/[[\]"+]/g, '').trim().slice(0, 80))
    .slice(0, MAX_SEEDS);
  const url = typeof body?.url === 'string' && /^https:\/\//.test(body.url) ? body.url.slice(0, 500) : undefined;
  if (!keywords.length && !url) throw new HttpError(400, 'Informe palavras-chave ou uma URL como semente.');

  const token = await getAccessToken('ads');
  if (!token) throw new HttpError(500, 'Credenciais do Google Ads não configuradas no servidor.');

  const customerId = String(headers['x-customer-id'] || process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/\D/g, '');
  const request = {
    language: constant(body?.language, 'languageConstants', PORTUGUESE),
    geoTargetConstants: (Array.isArray(body?.geoTargets) ? body.geoTargets : [BRAZIL])
      .map((g) => constant(g, 'geoTargetConstants', null))
      .filter(Boolean)
      .slice(0, 10),
    keywordPlanNetwork: 'GOOGLE_SEARCH',
    includeAdultKeywords: false,
    pageSize: 50,
  };
  if (keywords.length && url) request.keywordAndUrlSeed = { url, keywords };
  else if (keywords.length) request.keywordSeed = { keywords };
  else request.urlSeed = { url };

  const reqHeaders = {
    Authorization: `Bearer ${token}`,
    // Opcional desde set/2026: o acesso vem do projeto do Google Cloud dono do OAuth.
    ...(process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? { 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN } : {}),
    'Content-Type': 'application/json',
  };
  const login = headers['x-login-customer-id'] || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (login) reqHeaders['login-customer-id'] = String(login).replace(/\D/g, '');

  const res = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}:generateKeywordIdeas`, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(request),
  });
  const text = await res.text();
  if (!res.ok) {
    if (/DEVELOPER_TOKEN_NOT_APPROVED|CLOUD_PROJECT_NOT_APPROVED/.test(text)) {
      return {
        ideas: [],
        code: 'DEVELOPER_TOKEN_NOT_APPROVED',
        error: 'O acesso à API está no nível Test ou Explorer, que não libera o Planejador de Palavras-chave.',
      };
    }
    throw new HttpError(res.status, `Google Ads API respondeu ${res.status}.`);
  }

  const data = JSON.parse(text);
  const micros = (v) => (v ? Number(v) / 1_000_000 : null);
  return {
    ideas: (data.results ?? []).map((r) => ({
      text: r.text,
      avgMonthlySearches: Number(r.keywordIdeaMetrics?.avgMonthlySearches ?? 0),
      competition: r.keywordIdeaMetrics?.competition ?? 'UNSPECIFIED',
      lowBid: micros(r.keywordIdeaMetrics?.lowTopOfPageBidMicros),
      highBid: micros(r.keywordIdeaMetrics?.highTopOfPageBidMicros),
    })),
  };
});
