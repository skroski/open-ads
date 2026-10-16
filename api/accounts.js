// Vercel Serverless Function: POST /api/accounts
// Lista contas acessíveis via customer_client

import { checkAccess } from './_lib/access.js';

const API_VERSION = 'v25';

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

export default async function handler(req, res) {
  const denied = req.method === 'OPTIONS' ? null : checkAccess(req.headers);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  const env = {
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId: process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    customerId: process.env.GOOGLE_ADS_CUSTOMER_ID,
  };

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {}
  }

  const targetCustomerId = req.headers['x-customer-id'] || body?.customerId || env.customerId;
  const targetLoginCustomerId = req.headers['x-login-customer-id'] || body?.loginCustomerId || env.loginCustomerId;

  try {
    const accessToken = await getAccessToken(env);
    const customerId = String(targetCustomerId).replace(/\D/g, '');
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      // Opcional desde set/2026: o acesso vem do projeto do Google Cloud dono do OAuth.
    ...(env.developerToken ? { 'developer-token': env.developerToken } : {}),
      'Content-Type': 'application/json',
    };
    if (targetLoginCustomerId) {
      headers['login-customer-id'] = String(targetLoginCustomerId).replace(/\D/g, '');
    }

    const query = `
      SELECT
        customer_client.client_customer,
        customer_client.descriptive_name,
        customer_client.id,
        customer_client.manager,
        customer_client.status
      FROM customer_client
      WHERE customer_client.status = ENABLED
    `;

    const apiRes = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`,
      { method: 'POST', headers, body: JSON.stringify({ query }) },
    );
    const text = await apiRes.text();
    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: text });
    }
    const results = JSON.parse(text).flatMap((batch) => batch.results ?? []);
    return res.status(200).json({ results, currentCustomerId: targetCustomerId });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
