// POST /api/explain — resume em linguagem simples um texto que o painel já montou
// (recomendação com fatos, hipóteses e o que não se sabe). Opcional: sem ANTHROPIC_API_KEY
// responde { configured: false } e o painel segue só com a explicação determinística.
//
// Corpo: { text }   Resposta: { configured: boolean, reason?, text? }
//
// Variáveis: ANTHROPIC_API_KEY (ativa o recurso) e ANTHROPIC_MODEL (opcional).
// O SDK é carregado sob demanda: se as dependências ainda não foram instaladas, só este
// endpoint avisa; o restante da API continua funcionando.

import { HttpError, endpoint } from './_lib/http.js';
import {
  DEFAULT_MODEL,
  assertSameOriginJson,
  buildParams,
  createLimiter,
  normalizeInput,
  readOutput,
} from './_lib/explain.js';

// Teto de gasto por instância do servidor: 30 resumos a cada 10 minutos.
const limiter = createLimiter({ max: 30, windowMs: 10 * 60 * 1000 });

let loaded;

async function loadClient() {
  if (loaded) return loaded;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return { reason: 'A IA não está configurada neste servidor: defina ANTHROPIC_API_KEY.' };
  }
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    return {
      reason: 'O pacote @anthropic-ai/sdk não está instalado. Rode "npm install" na raiz do projeto (e em web/ se a Vercel usar essa pasta).',
    };
  }
  loaded = { Anthropic, client: new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 }) };
  return loaded;
}

// Mensagens próprias: o corpo do erro da Anthropic não é repassado ao navegador.
function toHttpError(err, Anthropic) {
  if (err instanceof HttpError) return err;
  console.error('Falha em /api/explain:', err?.name ?? 'Error', err?.status ?? '');
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(502, 'A Anthropic recusou a chave definida em ANTHROPIC_API_KEY.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new HttpError(429, 'A IA atingiu o limite de uso. Tente de novo em instantes.');
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new HttpError(502, 'Modelo não encontrado. Confira ANTHROPIC_MODEL.');
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new HttpError(504, 'A IA demorou demais para responder.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new HttpError(502, 'Não foi possível falar com a Anthropic.');
  }
  if (err instanceof Anthropic.APIError) {
    return new HttpError(502, `A IA respondeu com erro (${err.status}).`);
  }
  return new HttpError(502, 'Falha ao gerar o resumo.');
}

export default endpoint(async ({ body, headers }) => {
  assertSameOriginJson(headers);
  const text = normalizeInput(body?.text);

  const { client, Anthropic, reason } = await loadClient();
  if (!client) return { configured: false, reason };

  if (!limiter.take()) {
    throw new HttpError(429, 'Muitos resumos em pouco tempo. Tente novamente em alguns minutos.');
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  try {
    const message = await client.messages.create(buildParams(text, model));
    const out = readOutput(message);
    return out.text ? { configured: true, text: out.text } : { configured: true, reason: out.reason };
  } catch (err) {
    throw toHttpError(err, Anthropic);
  }
});
