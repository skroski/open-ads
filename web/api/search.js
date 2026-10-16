// Vercel Serverless Function: POST /api/search
// Consulta a Google Ads API usando as credenciais configuradas nas variáveis de ambiente da Vercel.

import { checkAccess } from './_lib/access.js';

const API_VERSION = 'v25';

const DEFAULT_QUERY = `
  SELECT
    campaign.id,
    campaign.name,
    campaign.status,
    metrics.impressions,
    metrics.clicks,
    metrics.cost_micros,
    metrics.conversions
  FROM campaign
  WHERE segments.date DURING LAST_30_DAYS
    AND campaign.status != 'REMOVED'
  ORDER BY metrics.cost_micros DESC
  LIMIT 50
`;

let cachedToken = null;

async function getAccessToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      refresh_token: env.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Falha ao gerar access token: ${data.error_description ?? data.error}`);
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function runSearch(query, env, targetCustomerId, targetLoginCustomerId) {
  const accessToken = await getAccessToken(env);
  const customerId = String(targetCustomerId || env.customerId).replace(/\D/g, '');
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    // Opcional desde set/2026: o acesso vem do projeto do Google Cloud dono do OAuth.
    ...(env.developerToken ? { 'developer-token': env.developerToken } : {}),
    'Content-Type': 'application/json',
  };
  const loginId = targetLoginCustomerId || env.loginCustomerId;
  if (loginId) {
    headers['login-customer-id'] = String(loginId).replace(/\D/g, '');
  }

  const res = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`,
    { method: 'POST', headers, body: JSON.stringify({ query }) },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google Ads API respondeu ${res.status}: ${text}`);
  }
  return JSON.parse(text).flatMap((batch) => batch.results ?? []);
}

function sendJson(res, status, body) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(body);
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const denied = req.method === 'OPTIONS' ? null : checkAccess(req.headers);
  if (denied) return sendJson(res, denied.status, { error: denied.error });

  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Método não permitido. Use POST.' });
  }

  const env = {
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId: process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    customerId: process.env.GOOGLE_ADS_CUSTOMER_ID,
  };

  const missing = Object.entries(env)
    .filter(([k, v]) => k !== 'loginCustomerId' && k !== 'developerToken' && !v)
    .map(([k]) => k);

  if (missing.length) {
    return sendJson(res, 500, {
      error: `Faltam variáveis de ambiente no servidor (server/.env ou Vercel): ${missing.join(', ')}`,
    });
  }

  let body = req.body;
  if (!body && typeof req[Symbol.asyncIterator] === 'function') {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return sendJson(res, 400, { error: 'Corpo da requisição inválido' });
    }
  } else if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { error: 'Corpo da requisição inválido' });
    }
  }

  const targetCustomerId = req.headers['x-customer-id'] || body?.customerId || env.customerId;
  const targetLoginCustomerId = req.headers['x-login-customer-id'] || body?.loginCustomerId || env.loginCustomerId;
  const query = body?.query || DEFAULT_QUERY;

  try {
    const results = await runSearch(query, env, targetCustomerId, targetLoginCustomerId);
    return sendJson(res, 200, { results, currentCustomerId: targetCustomerId });
  } catch (err) {
    console.error('Erro Google Ads API:', err.message);
    return sendJson(res, 502, { error: err.message });
  }
}
