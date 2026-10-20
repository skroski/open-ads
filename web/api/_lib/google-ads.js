// Consulta GAQL mínima (somente leitura) usada pelo leitor de páginas para descobrir
// quais domínios a conta realmente anuncia.

import { getAccessToken } from './google-auth.js';
import { HttpError } from './http.js';

const API_VERSION = 'v25';

export function adsConfigured() {
  const e = process.env;
  return Boolean(e.GOOGLE_ADS_CLIENT_ID && e.GOOGLE_ADS_CLIENT_SECRET && e.GOOGLE_ADS_REFRESH_TOKEN);
}

/** loginCustomerId: conta administradora (MCC) pela qual o acesso chega à conta, se houver. */
export function customerId(value) {
  const id = String(value ?? '').replace(/-/g, '').trim();
  if (!/^\d{10}$/.test(id)) throw new HttpError(400, 'Informe uma conta Google Ads com 10 dígitos.');
  return id;
}

/** Leituras podem repetir falhas transitórias; mutações não são repetidas. */
export async function runGaql(query, targetCustomerId, loginCustomerId) {
  if (typeof query !== 'string' || !query.trim() || query.length > 50_000) {
    throw new HttpError(400, 'Informe uma consulta GAQL válida.');
  }
  const id = customerId(targetCustomerId || process.env.GOOGLE_ADS_CUSTOMER_ID);
  const login = loginCustomerId || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  const loginId = login ? customerId(login) : null;
  const token = await getAccessToken('ads');
  if (!token) throw new HttpError(503, 'Configure o Google Ads com npm run setup no seu terminal.');
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? { 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN } : {}),
    ...(loginId ? { 'login-customer-id': loginId } : {}),
    'Content-Type': 'application/json',
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    let data;
    try {
      res = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers/${id}/googleAds:searchStream`, {
        method: 'POST', headers, body: JSON.stringify({ query }), signal: AbortSignal.timeout(20_000),
      });
      data = await res.json();
    } catch {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      throw new HttpError(504, 'Não foi possível concluir a leitura do Google Ads. Tente novamente.');
    }
    if (res.ok) {
      if (!Array.isArray(data) || data.some((batch) => batch.error || (batch.results !== undefined && !Array.isArray(batch.results)))) {
        throw new HttpError(502, 'O Google Ads retornou um relatório inválido. Tente novamente.');
      }
      return data.flatMap((batch) => batch.results ?? []);
    }
    if ([500, 502, 503, 504].includes(res.status) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      continue;
    }
    const messages = {
      400: 'O Google Ads recusou a consulta. Confira campos, filtros e período.',
      401: 'A autorização do Google expirou. Renove com npm run token no seu terminal.',
      403: 'Sem permissão no Google Ads. Confira acesso à conta, MCC e nível da API.',
      429: 'Limite de consultas do Google Ads atingido. Aguarde antes de tentar novamente.',
    };
    // Não propaga payloads do provedor, que podem conter conteúdo da consulta.
    throw new HttpError(res.status === 429 ? 429 : 502, messages[res.status] ?? 'O Google Ads está indisponível. Tente novamente mais tarde.');
  }
}

/** Chamada de escrita (…:mutate). `path` é o serviço, ex.: "campaignCriteria". */
export async function mutateAds(path, payload, customerId, loginCustomerId) {
  const token = await getAccessToken('ads');
  if (!token) throw new HttpError(503, 'Google Ads não configurado no servidor.');
  const id = String(customerId || process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/\D/g, '');
  const login = String(loginCustomerId || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/\D/g, '');
  const res = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers/${id}/${path}:mutate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? { 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN } : {}),
      ...(login ? { 'login-customer-id': login } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Google Ads API erro: ${JSON.stringify(data)}`);
  return data;
}
