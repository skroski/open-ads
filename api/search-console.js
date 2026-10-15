// POST /api/search-console — Search Console (Search Analytics), somente leitura.
//
// Corpo: { dimension: 'page' | 'query' | 'date', site, from, to, page? }
//   - 'date' devolve a série diária; com `page`, filtra uma URL específica.
// Resposta: { configured: boolean, reason?, rows? }
//
// Exige o escopo https://www.googleapis.com/auth/webmasters.readonly no refresh token
// e a "Google Search Console API" ativa no projeto do Google Cloud.

import { HttpError, endpoint, isIsoDate } from './_lib/http.js';
import { getAccessToken } from './_lib/google-auth.js';

const NOT_AUTHORIZED =
  'O acesso ao Search Console não foi autorizado. Gere um novo refresh token com server/get-refresh-token.mjs (ele agora pede o escopo do Search Console), ative a "Google Search Console API" no Google Cloud e confirme que o usuário é proprietário ou tem acesso ao site.';

const SITE = /^(https?:\/\/[^\s/]+(\/[^\s]*)?|sc-domain:[a-z0-9.-]+)$/i;

export default endpoint(async ({ body }) => {
  const { dimension, site, from, to, page } = body ?? {};
  if (dimension !== 'page' && dimension !== 'query' && dimension !== 'date') {
    throw new HttpError(400, 'Dimensão inválida.');
  }
  if (page !== undefined && !/^https?:\/\/[^\s]{1,500}$/i.test(String(page))) {
    throw new HttpError(400, 'URL da página inválida.');
  }
  if (!SITE.test(String(site ?? ''))) {
    throw new HttpError(400, 'Site inválido. Use a URL exata da propriedade (https://…/) ou sc-domain:dominio.com.br.');
  }
  if (!isIsoDate(from) || !isIsoDate(to)) throw new HttpError(400, 'Período inválido.');

  let token;
  try {
    token = await getAccessToken('searchconsole');
  } catch (err) {
    return { configured: false, reason: err.message };
  }
  if (!token) {
    return {
      configured: false,
      reason: 'Credenciais OAuth ausentes no servidor (GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET e um refresh token).',
    };
  }

  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate: from,
      endDate: to,
      dimensions: [dimension],
      rowLimit: dimension === 'date' ? 500 : 1000,
      ...(page
        ? { dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: String(page) }] }] }
        : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 || res.status === 403) {
    const apiMessage = data?.error?.message ? ` (${data.error.message})` : '';
    return { configured: false, reason: `${NOT_AUTHORIZED}${apiMessage}` };
  }
  if (!res.ok) throw new HttpError(502, `Search Console respondeu ${res.status}: ${data?.error?.message ?? 'erro'}`);

  const rows = (data.rows ?? []).map((r) => {
    const key = r.keys?.[0] ?? '';
    const common = { clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, ctr: r.ctr ?? 0, position: r.position ?? 0 };
    if (dimension === 'date') return { date: key, ...common };
    return dimension === 'page' ? { page: key, ...common } : { query: key, ...common };
  });
  return { configured: true, rows };
});
