// POST /api/analytics — relatórios do Google Analytics 4 (Data API v1beta), somente leitura.
//
// Corpo: { report: 'pages' | 'channels', propertyId, from, to }
// Resposta: { configured: boolean, reason?, rows? }
//
// Exige o escopo https://www.googleapis.com/auth/analytics.readonly no refresh token
// e a "Google Analytics Data API" ativa no projeto do Google Cloud.

import { HttpError, endpoint, isIsoDate } from './_lib/http.js';
import { getAccessToken } from './_lib/google-auth.js';

const NOT_AUTHORIZED =
  'O acesso ao Google Analytics não foi autorizado. Gere um novo refresh token com server/get-refresh-token.mjs (ele agora pede o escopo do Analytics), ative a "Google Analytics Data API" no Google Cloud e confirme que o usuário tem acesso à propriedade.';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function buildRequest(report, from, to) {
  const dateRanges = [{ startDate: from, endDate: to }];
  if (report === 'pages') {
    return {
      dateRanges,
      dimensions: [{ name: 'landingPage' }],
      metrics: [
        { name: 'sessions' },
        { name: 'engagedSessions' },
        { name: 'keyEvents' },
        { name: 'userEngagementDuration' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: '1000',
    };
  }
  return {
    dateRanges,
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }, { name: 'keyEvents' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: '50',
  };
}

export function mapRows(report, data) {
  const rows = data.rows ?? [];
  if (report === 'pages') {
    return rows.map((r) => {
      const sessions = num(r.metricValues?.[0]?.value);
      const engagementSeconds = num(r.metricValues?.[3]?.value);
      return {
        path: r.dimensionValues?.[0]?.value ?? '',
        sessions,
        engagedSessions: num(r.metricValues?.[1]?.value),
        keyEvents: num(r.metricValues?.[2]?.value),
        avgEngagementSec: sessions > 0 ? engagementSeconds / sessions : 0,
      };
    });
  }
  return rows.map((r) => ({
    channel: r.dimensionValues?.[0]?.value ?? '',
    sessions: num(r.metricValues?.[0]?.value),
    keyEvents: num(r.metricValues?.[1]?.value),
  }));
}

export default endpoint(async ({ body }) => {
  const { report, propertyId, from, to } = body ?? {};
  if (report !== 'pages' && report !== 'channels') throw new HttpError(400, 'Relatório inválido.');
  if (!/^\d{6,15}$/.test(String(propertyId ?? ''))) throw new HttpError(400, 'ID da propriedade do GA4 inválido.');
  if (!isIsoDate(from) || !isIsoDate(to)) throw new HttpError(400, 'Período inválido.');

  let token;
  try {
    token = await getAccessToken('analytics');
  } catch (err) {
    return { configured: false, reason: err.message };
  }
  if (!token) {
    return {
      configured: false,
      reason: 'Credenciais OAuth ausentes no servidor (GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET e um refresh token).',
    };
  }

  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequest(report, from, to)),
  });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 || res.status === 403) {
    const apiMessage = data?.error?.message ? ` (${data.error.message})` : '';
    return { configured: false, reason: `${NOT_AUTHORIZED}${apiMessage}` };
  }
  if (!res.ok) throw new HttpError(502, `Google Analytics respondeu ${res.status}: ${data?.error?.message ?? 'erro'}`);

  return { configured: true, rows: mapRows(report, data) };
});
