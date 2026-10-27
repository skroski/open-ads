// POST /api/hypotheses — a IA reescreve rascunhos de hipótese com base nas evidências que o painel
// já calculou (não busca dados novos nem altera a conta). Opcional: sem ANTHROPIC_API_KEY responde
// { configured: false } e o painel segue com os rascunhos determinísticos.
//
// Corpo: { items: [{ id, title, problem, action, validation, evidence: string[] }] }
// Resposta: { configured, reason?, items?: [{ id, statement, metric, risk, alternative }] }

import { HttpError, endpoint } from './_lib/http.js';
import { DEFAULT_MODEL, assertSameOriginJson, createLimiter } from './_lib/explain.js';
import { buildParams, normalizeItems, readOutput } from './_lib/hypotheses.js';

// Teto de gasto por instância do servidor: 10 lotes a cada 10 minutos.
const limiter = createLimiter({ max: 10, windowMs: 10 * 60 * 1000 });

let loaded;

async function loadClient() {
  if (loaded) return loaded;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { reason: 'A IA não está configurada neste servidor: defina ANTHROPIC_API_KEY.' };
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    return { reason: 'O pacote @anthropic-ai/sdk não está instalado. Rode "npm install" na raiz do projeto.' };
  }
  loaded = { Anthropic, client: new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 }) };
  return loaded;
}

// Mensagens próprias: o corpo do erro da Anthropic não é repassado ao navegador.
function toHttpError(err, Anthropic) {
  if (err instanceof HttpError) return err;
  console.error('Falha em /api/hypotheses:', err?.name ?? 'Error', err?.status ?? '');
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(502, 'A Anthropic recusou a chave definida em ANTHROPIC_API_KEY.');
  }
  if (err instanceof Anthropic.RateLimitError) return new HttpError(429, 'A IA atingiu o limite de uso. Tente de novo em instantes.');
  if (err instanceof Anthropic.NotFoundError) return new HttpError(502, 'Modelo não encontrado. Confira ANTHROPIC_MODEL.');
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new HttpError(504, 'A IA demorou demais para responder.');
  if (err instanceof Anthropic.APIConnectionError) return new HttpError(502, 'Não foi possível falar com a Anthropic.');
  if (err instanceof Anthropic.APIError) return new HttpError(502, `A IA respondeu com erro (${err.status}).`);
  return new HttpError(502, 'Falha ao gerar as hipóteses.');
}

export default endpoint(async ({ body, headers }) => {
  assertSameOriginJson(headers);
  const items = normalizeItems(body?.items);

  const { client, Anthropic, reason } = await loadClient();
  if (!client) return { configured: false, reason };

  if (!limiter.take()) throw new HttpError(429, 'Muitos pedidos em pouco tempo. Tente novamente em alguns minutos.');

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  try {
    const message = await client.messages.create(buildParams(items, model));
    const out = readOutput(message, items);
    return out.items ? { configured: true, items: out.items } : { configured: true, reason: out.reason };
  } catch (err) {
    throw toHttpError(err, Anthropic);
  }
});
