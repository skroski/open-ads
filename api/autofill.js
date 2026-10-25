// POST /api/autofill — a IA sugere o contexto do negócio e a etapa de conversões ambíguas, usando
// só a ficha de fatos que o painel montou a partir da conta. A resposta passa pela guarda numérica
// (número fora da ficha e evidência inexistente são descartados). Não altera nada na conta de
// anúncios. Opcional: sem ANTHROPIC_API_KEY responde { configured: false }.
//
// Corpo: { facts: [{ id, text }], context?: boolean, ambiguous?: string[], terms?: string[], themes?: boolean }
// (fatos de contexto do negócio têm id "x…"; são obrigatórios ao avaliar termos)
// Resposta: { configured, reason?, context?, stages?, termVerdicts?, themes?, dropped? }

import { HttpError, endpoint } from './_lib/http.js';
import { DEFAULT_MODEL, assertSameOriginJson, createLimiter } from './_lib/explain.js';
import { buildParams, normalizeRequest, readOutput } from './_lib/autofill.js';

// Teto de gasto por instância do servidor: 10 pedidos a cada 10 minutos.
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
  console.error('Falha em /api/autofill:', err?.name ?? 'Error', err?.status ?? '');
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(502, 'A Anthropic recusou a chave definida em ANTHROPIC_API_KEY.');
  }
  if (err instanceof Anthropic.RateLimitError) return new HttpError(429, 'A IA atingiu o limite de uso. Tente de novo em instantes.');
  if (err instanceof Anthropic.NotFoundError) return new HttpError(502, 'Modelo não encontrado. Confira ANTHROPIC_MODEL.');
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new HttpError(504, 'A IA demorou demais para responder.');
  if (err instanceof Anthropic.APIConnectionError) return new HttpError(502, 'Não foi possível falar com a Anthropic.');
  if (err instanceof Anthropic.APIError) return new HttpError(502, `A IA respondeu com erro (${err.status}).`);
  return new HttpError(502, 'Falha ao gerar as sugestões.');
}

export default endpoint(async ({ body, headers }) => {
  assertSameOriginJson(headers);
  const req = normalizeRequest(body);

  const { client, Anthropic, reason } = await loadClient();
  if (!client) return { configured: false, reason };

  if (!limiter.take()) throw new HttpError(429, 'Muitos pedidos em pouco tempo. Tente novamente em alguns minutos.');

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  try {
    const message = await client.messages.create(buildParams(req, model));
    const out = readOutput(message, req);
    return out.reason
      ? { configured: true, reason: out.reason, dropped: out.dropped ?? 0 }
      : { configured: true, context: out.context, stages: out.stages, termVerdicts: out.termVerdicts, themes: out.themes, dropped: out.dropped };
  } catch (err) {
    throw toHttpError(err, Anthropic);
  }
});
