// Proxy local para as funções de API. Monta os MESMOS handlers que a Vercel executa
// (../api/*.js), então o que roda em desenvolvimento é o que roda em produção.
//
// Uso: node --env-file=.env index.mjs
// Escuta só em 127.0.0.1. O Angular chega aqui pelo proxy.conf.json, sem CORS.

import http from 'node:http';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '../api');

const REQUIRED_FOR_ADS = [
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
];

async function loadRoutes() {
  const routes = new Map();
  for (const file of await readdir(apiDir)) {
    // Arquivos com "_" são utilitários, não rotas (mesma regra da Vercel).
    if (!file.endsWith('.js') || file.startsWith('_') || file.includes('.test.')) continue;
    const mod = await import(pathToFileURL(path.join(apiDir, file)).href);
    if (typeof mod.default === 'function') routes.set(`/api/${file.slice(0, -3)}`, mod.default);
  }
  return routes;
}

const routes = await loadRoutes();

/** Dá ao req/res do Node a cara do req/res da Vercel que os handlers esperam. */
function adapt(req, res, body) {
  const url = new URL(req.url, 'http://localhost');
  req.body = body;
  req.query = Object.fromEntries(url.searchParams);
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return res;
  };
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Corpo da requisição grande demais.');
  }
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const handler = routes.get(pathname);

  if (!handler) {
    sendJson(res, 404, { error: 'Rota não encontrada' });
    return;
  }

  let body = {};
  if (req.method === 'POST') {
    try {
      body = await readBody(req);
    } catch {
      sendJson(res, 400, { error: 'Corpo da requisição inválido' });
      return;
    }
  }

  adapt(req, res, body);
  try {
    await handler(req, res);
  } catch (err) {
    console.error(`Erro em ${pathname}:`, err?.message ?? err);
    if (!res.headersSent) sendJson(res, 502, { error: err?.message ?? 'Falha ao processar a requisição' });
    else res.end();
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Porta ${PORT} já está em uso por outro processo.`);
    console.error(`👉 Para liberar a porta, execute no terminal:\n   kill -9 $(lsof -ti :${PORT})\n`);
  } else {
    console.error('❌ Erro no servidor:', err);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Proxy em http://127.0.0.1:${PORT}`);
  console.log(`Rotas: ${Array.from(routes.keys()).sort().join(', ')}`);
  const missing = REQUIRED_FOR_ADS.filter((k) => !process.env[k]);
  if (missing.length) console.warn(`Atenção: faltam variáveis do Google Ads: ${missing.join(', ')}`);
});
