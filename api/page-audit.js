// POST /api/page-audit — lê uma página do site e devolve o que importa para a análise:
// título, h1, formulário, telefone/WhatsApp, etiquetas de medição e sinais técnicos.
//
// Corpo: { url }   Cabeçalho opcional: x-customer-id (conta do Google Ads)
//
// Segurança (este endpoint faz requisições a partir do servidor):
//  - só https, porta 443, sem credenciais na URL e sem IP literal;
//  - só domínios autorizados: PAGE_AUDIT_ALLOWED_HOSTS (env, separados por vírgula) e os
//    domínios que a própria conta anuncia (lidos do Google Ads, em cache por 10 min);
//  - destino resolvido e checado na conexão: nada de rede interna ou metadados de nuvem;
//  - no máximo 3 redirecionamentos, todos revalidados; limite de tamanho e de tempo.

import https from 'node:https';
import { HttpError, endpoint } from './_lib/http.js';
import { extractAudit } from './_lib/html.js';
import { bareHost, hostAllowed, safeLookup, validateTarget } from './_lib/net-guard.js';
import { adsConfigured, runGaql } from './_lib/google-ads.js';

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const HOSTS_TTL_MS = 10 * 60 * 1000;

const hostsCache = new Map();

async function advertisedHosts(customerId, loginCustomerId) {
  const key = `${customerId || 'default'}:${loginCustomerId || ''}`;
  const hit = hostsCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.hosts;

  const hosts = new Set();
  if (adsConfigured()) {
    const queries = [
      `SELECT landing_page_view.unexpanded_final_url FROM landing_page_view WHERE segments.date DURING LAST_90_DAYS LIMIT 200`,
      `SELECT ad_group_ad.ad.final_urls FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' LIMIT 500`,
    ];
    for (const q of queries) {
      try {
        const rows = await runGaql(q, customerId, loginCustomerId);
        for (const r of rows) {
          const urls = [r.landingPageView?.unexpandedFinalUrl, ...(r.adGroupAd?.ad?.finalUrls ?? [])];
          for (const u of urls) {
            try {
              if (u) hosts.add(bareHost(new URL(u).hostname));
            } catch {
              /* URL inválida: ignora */
            }
          }
        }
      } catch {
        /* sem acesso ao Ads: segue só com a lista do ambiente */
      }
    }
  }
  hostsCache.set(key, { hosts, expiresAt: Date.now() + HOSTS_TTL_MS });
  return hosts;
}

function getOnce(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MarketingIntelBot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          resolve({ status, redirect: new URL(res.headers.location, url) });
          return;
        }
        const type = String(res.headers['content-type'] ?? '');
        if (status < 400 && type && !/html|xml/i.test(type)) {
          res.resume();
          reject(new Error(`O endereço não é uma página HTML (${type.split(';')[0]}).`));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error('Página grande demais para auditar.'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('A página demorou demais para responder.')));
    req.on('error', reject);
    req.end();
  });
}

export default endpoint(async ({ body, headers }) => {
  const customerId = headers['x-customer-id'];

  let target;
  try {
    target = validateTarget(body?.url);
  } catch (err) {
    throw new HttpError(400, err.message);
  }

  const allowed = new Set(
    String(process.env.PAGE_AUDIT_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => bareHost(h.trim()))
      .filter(Boolean),
  );
  (await advertisedHosts(customerId, headers['x-login-customer-id'])).forEach((h) => allowed.add(h));

  if (!allowed.size) {
    return {
      configured: false,
      reason: 'Nenhum domínio autorizado. Defina PAGE_AUDIT_ALLOWED_HOSTS ou conecte o Google Ads com anúncios ativos.',
    };
  }
  if (!hostAllowed(target.hostname, allowed)) {
    throw new HttpError(403, `O domínio ${bareHost(target.hostname)} não está entre os domínios autorizados.`);
  }

  const startedAt = Date.now();
  let current = target;
  let result;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      result = await getOnce(current);
      if (!result.redirect) break;
      const next = result.redirect;
      if (next.protocol !== 'https:' || !hostAllowed(next.hostname, allowed)) {
        throw new Error('A página redireciona para fora dos domínios autorizados.');
      }
      if (hop === MAX_REDIRECTS) throw new Error('Redirecionamentos demais.');
      current = validateTarget(next.toString());
    }
  } catch (err) {
    return {
      configured: true,
      audit: {
        url: target.toString(),
        fetchedAt: new Date().toISOString(),
        status: null,
        ok: false,
        h1: [],
        h2: [],
        forms: 0,
        telLinks: 0,
        whatsappLinks: 0,
        hasViewport: false,
        hasCanonical: false,
        noindex: false,
        trackingTags: [],
        wordCount: 0,
        error: err.message,
      },
    };
  }

  const ok = result.status >= 200 && result.status < 400;
  const base = {
    url: target.toString(),
    finalUrl: current.toString(),
    fetchedAt: new Date().toISOString(),
    status: result.status,
    ok,
    responseMs: Date.now() - startedAt,
  };
  if (!ok || !result.body) {
    return {
      configured: true,
      audit: {
        ...base,
        h1: [],
        h2: [],
        forms: 0,
        telLinks: 0,
        whatsappLinks: 0,
        hasViewport: false,
        hasCanonical: false,
        noindex: false,
        trackingTags: [],
        wordCount: 0,
        error: ok ? 'A página veio vazia.' : `A página respondeu ${result.status}.`,
      },
    };
  }
  return { configured: true, audit: { ...base, ...extractAudit(result.body) } };
});
