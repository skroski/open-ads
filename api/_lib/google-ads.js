// Consulta GAQL mínima (somente leitura) usada pelo leitor de páginas para descobrir
// quais domínios a conta realmente anuncia.

import { getAccessToken } from './google-auth.js';

const API_VERSION = 'v25';

export function adsConfigured() {
  const e = process.env;
  return Boolean(e.GOOGLE_ADS_CLIENT_ID && e.GOOGLE_ADS_CLIENT_SECRET && e.GOOGLE_ADS_REFRESH_TOKEN);
}

/** loginCustomerId: conta administradora (MCC) pela qual o acesso chega à conta, se houver. */
export async function runGaql(query, customerId, loginCustomerId) {
  const token = await getAccessToken('ads');
  const id = String(customerId || process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/\D/g, '');
  const headers = {
    Authorization: `Bearer ${token}`,
    // Opcional desde set/2026: o acesso vem do projeto do Google Cloud dono do OAuth.
    ...(process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? { 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN } : {}),
    'Content-Type': 'application/json',
  };
  const login = String(loginCustomerId || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/\D/g, '');
  if (login) headers['login-customer-id'] = String(login).replace(/\D/g, '');
  const res = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers/${id}/googleAds:searchStream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google Ads API respondeu ${res.status}`);
  return JSON.parse(text).flatMap((b) => b.results ?? []);
}
