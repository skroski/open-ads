// Token de acesso OAuth do Google, com cache em memória.
// GA4 e Search Console aceitam um refresh token próprio; sem ele, usam o do Google Ads
// (que só serve se foi gerado com os escopos necessários — veja server/get-refresh-token.mjs).

import { HttpError } from './http.js';

const cache = new Map();
const pending = new Map();

export function oauthClient() {
  return {
    clientId: process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
  };
}

export function refreshTokenFor(kind) {
  const e = process.env;
  if (kind === 'analytics') return e.GOOGLE_ANALYTICS_REFRESH_TOKEN || e.GOOGLE_ADS_REFRESH_TOKEN;
  // O GTM pode usar uma conta diferente da que opera anúncios. Na ausência de um
  // token dedicado, mantém a experiência simples e tenta o token principal.
  if (kind === 'tagmanager') return e.GOOGLE_TAG_MANAGER_REFRESH_TOKEN || e.GOOGLE_ADS_REFRESH_TOKEN;
  if (kind === 'searchconsole') {
    return e.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN || e.GOOGLE_ANALYTICS_REFRESH_TOKEN || e.GOOGLE_ADS_REFRESH_TOKEN;
  }
  return e.GOOGLE_ADS_REFRESH_TOKEN;
}

export async function getAccessToken(kind) {
  const { clientId, clientSecret } = oauthClient();
  const refreshToken = refreshTokenFor(kind);
  if (!clientId || !clientSecret || !refreshToken) return null;

  const key = JSON.stringify([clientId, clientSecret, refreshToken]);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.value;

  // As telas consultam em paralelo; compartilhe a renovação em andamento.
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    let res;
    let data;
    try {
      res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
        signal: AbortSignal.timeout(15_000),
      });
      data = await res.json();
    } catch {
      throw new HttpError(504, 'Não foi possível obter autorização do Google. Tente novamente.');
    }
    if (!res.ok || typeof data.access_token !== 'string') {
      throw new HttpError(502, data.error === 'invalid_grant'
        ? 'A autorização do Google expirou ou foi revogada. Execute npm run token no seu terminal.'
        : 'Não foi possível autorizar o acesso ao Google. Confira a configuração com npm run doctor.');
    }
    const lifetime = Number(data.expires_in);
    cache.set(key, { value: data.access_token, expiresAt: Date.now() + (Number.isFinite(lifetime) ? lifetime : 0) * 1000 });
    return data.access_token;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}
