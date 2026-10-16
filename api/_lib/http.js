// Utilitários HTTP dos endpoints novos (analytics, search-console, page-audit, explain).
// Funcionam tanto na Vercel (req.body já interpretado) quanto no proxy local (http puro).
//
// Estes endpoints NÃO enviam cabeçalhos CORS: o app e a API são da mesma origem
// (na Vercel) ou passam pelo proxy do Angular (em desenvolvimento). Navegadores de
// outros sites não conseguem ler as respostas.

import { checkAccess } from './access.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res, status, body) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(body);
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const MAX_BODY_BYTES = 256 * 1024;

export async function readJsonBody(req) {
  const existing = req.body;
  if (existing && typeof existing === 'object' && !(existing instanceof Uint8Array)) return existing;
  if (typeof existing === 'string') {
    try {
      return existing ? JSON.parse(existing) : {};
    } catch {
      throw new HttpError(400, 'Corpo da requisição inválido.');
    }
  }
  if (typeof req[Symbol.asyncIterator] === 'function') {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'Corpo da requisição grande demais.');
    }
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      throw new HttpError(400, 'Corpo da requisição inválido.');
    }
  }
  return {};
}

/** Roda o handler tratando método e erros de forma uniforme. */
export function endpoint(handler, { write = false } = {}) {
  return async function wrapped(req, res) {
    try {
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
      }
      if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Método não permitido. Use POST.' });
      }
      const denied = checkAccess(req.headers, { write });
      if (denied) return sendJson(res, denied.status, { error: denied.error });
      const body = await readJsonBody(req);
      const result = await handler({ body, headers: req.headers ?? {} });
      return sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error('Erro no endpoint:', err?.message ?? err);
      return sendJson(res, 502, { error: err?.message ?? 'Falha ao processar a requisição.' });
    }
  };
}

export const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
