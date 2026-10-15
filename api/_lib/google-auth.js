// Token de acesso OAuth do Google, com cache em memória.
// GA4 e Search Console aceitam um refresh token próprio; sem ele, usam o do Google Ads
// (que só serve se foi gerado com os escopos necessários — veja server/get-refresh-token.mjs).

const cache = new Map();

export function oauthClient() {
  return {
    clientId: process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
  };
}

export function refreshTokenFor(kind) {
  const e = process.env;
  if (kind === 'analytics') return e.GOOGLE_ANALYTICS_REFRESH_TOKEN || e.GOOGLE_ADS_REFRESH_TOKEN;
  if (kind === 'searchconsole') {
    return e.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN || e.GOOGLE_ANALYTICS_REFRESH_TOKEN || e.GOOGLE_ADS_REFRESH_TOKEN;
  }
  return e.GOOGLE_ADS_REFRESH_TOKEN;
}

export async function getAccessToken(kind) {
  const { clientId, clientSecret } = oauthClient();
  const refreshToken = refreshTokenFor(kind);
  if (!clientId || !clientSecret || !refreshToken) return null;

  const key = `${clientId}:${refreshToken.slice(-12)}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.value;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Falha ao gerar o token de acesso: ${data.error_description ?? data.error}`);
  cache.set(key, { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}
