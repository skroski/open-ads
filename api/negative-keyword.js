// Vercel Serverless Function: POST /api/negative-keyword
// Adiciona palavras-chave negativas diretamente na campanha do Google Ads

const API_VERSION = 'v25';

async function getAccessToken(env) {
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
  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
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
    } catch {
      return res.status(400).json({ error: 'Corpo da requisição inválido' });
    }
  }

  const targetCustomerId = req.headers['x-customer-id'] || body?.customerId || env.customerId;
  const targetLoginCustomerId = req.headers['x-login-customer-id'] || body?.loginCustomerId || env.loginCustomerId;

  const { campaignId, campaignIds, text, keywords, matchType } = body || {};
  if ((!campaignId && (!campaignIds || !campaignIds.length)) || (!text && (!keywords || !keywords.length))) {
    return res.status(400).json({ error: 'Campanha e termo(s) são obrigatórios' });
  }

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

    let itemsToNegate = [];
    if (Array.isArray(keywords) && keywords.length > 0) {
      itemsToNegate = keywords.map((k) => {
        if (typeof k === 'string') return { text: k, matchType: matchType || 'EXACT' };
        return { text: k.text, matchType: k.matchType || matchType || 'EXACT' };
      });
    } else if (text) {
      itemsToNegate = [{ text, matchType: matchType || 'EXACT' }];
    }

    const targetCampaigns = Array.isArray(campaignIds) && campaignIds.length > 0
      ? campaignIds
      : campaignId ? [campaignId] : [];

    if (targetCampaigns.length === 0) {
      return res.status(400).json({ error: 'Nenhuma campanha válida especificada.' });
    }

    const operations = [];
    for (const cId of targetCampaigns) {
      const cleanCampaignId = String(cId).replace(/\D/g, '');
      const campaignResource = `customers/${customerId}/campaigns/${cleanCampaignId}`;

      for (const item of itemsToNegate) {
        const cleanText = item.text.replace(/[\[\]"]/g, '').trim();
        if (!cleanText) continue;

        operations.push({
          create: {
            campaign: campaignResource,
            negative: true,
            keyword: {
              text: cleanText,
              matchType: item.matchType || 'EXACT',
            },
          },
        });
      }
    }

    if (operations.length === 0) {
      return res.status(400).json({ error: 'Nenhuma palavra válida para negativar.' });
    }

    const apiRes = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/campaignCriteria:mutate`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ operations, partialFailure: true }),
      },
    );
    const data = await apiRes.json();
    if (!apiRes.ok) {
      return res.status(502).json({ error: `Google Ads API erro: ${JSON.stringify(data)}` });
    }
    return res.status(200).json({ success: true, result: data, totalOperations: operations.length });
  } catch (err) {
    console.error('Erro ao negativar palavra:', err.message);
    return res.status(502).json({ error: err.message });
  }
}
