/**
 * Camada HTTP fina sobre as funções `/api`. Reproduz os dois interceptors do Angular:
 * - código de acesso (`PANEL_ACCESS_TOKEN`), pedido só quando a API responde 401;
 * - MCC (`x-login-customer-id`) cadastrado para a conta, quando houver.
 * E a mesma mensagem de erro do `describeError` do Angular.
 */

const TOKEN_KEY = 'openads.accessToken';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly body: unknown,
  ) {
    super(`${status} ${statusText}`.trim());
  }
}

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let pendingAsk: Promise<string | null> | null = null;

/** Pergunta o código uma única vez, mesmo com várias chamadas falhando juntas. */
function askToken(): Promise<string | null> {
  pendingAsk ??= Promise.resolve().then(() => {
    const value = (globalThis.prompt?.('Este painel é protegido. Informe o código de acesso:') ?? '').trim();
    pendingAsk = null;
    if (!value) return null;
    try {
      localStorage.setItem(TOKEN_KEY, value);
    } catch {
      /* vale só para esta sessão de página */
    }
    return value;
  });
  return pendingAsk;
}

/** MCC de cada conta de cliente (preenchido pelo AccountProvider). */
let managerByAccount: ReadonlyMap<string, string> = new Map();

export function setManagerIds(entries: Iterable<[accountId: string, managerId: string]>): void {
  managerByAccount = new Map(entries);
}

async function send(url: string, body: unknown, headers: Record<string, string>, token: string | null, signal?: AbortSignal) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
    signal,
  });
}

export async function post<T>(
  url: string,
  body: unknown,
  options: { customerId?: string; loginCustomerId?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.customerId) headers['x-customer-id'] = options.customerId;
  const manager = options.loginCustomerId ?? (options.customerId ? managerByAccount.get(options.customerId.replace(/\D/g, '')) : undefined);
  if (manager) headers['x-login-customer-id'] = manager;

  let response = await send(url, body, headers, storedToken(), options.signal);
  if (response.status === 401) {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* o código será pedido de novo */
    }
    const token = await askToken();
    if (token) response = await send(url, body, headers, token, options.signal);
  }

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* corpo que não é JSON: segue como texto */
  }
  if (!response.ok) throw new HttpError(response.status, response.statusText, parsed);
  return parsed as T;
}

/** Extrai uma mensagem legível de qualquer erro vindo de um carregamento. */
export function describeError(error: unknown): string {
  if (error instanceof HttpError) {
    const body = error.body as { error?: unknown } | string | null;
    if (body && typeof body === 'object' && body.error) return String(body.error);
    if (typeof body === 'string' && body.trim()) return body.slice(0, 400);
    return `${error.status} ${error.statusText}`.trim();
  }
  if (error instanceof TypeError) return 'Sem conexão com o servidor. Verifique se o proxy local está rodando.';
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Erro desconhecido';
}
