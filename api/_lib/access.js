// Controle de acesso das funções de API.
//
// PANEL_ACCESS_TOKEN (opcional): quando definido, toda chamada precisa do cabeçalho
// "Authorization: Bearer <token>". Sem ele, o painel local (127.0.0.1) segue aberto.
// Na Vercel (variável VERCEL), as rotas que ESCREVEM no Google Ads recusam qualquer
// chamada enquanto o token não estiver configurado: sem login, o endereço público
// permitiria alterar a conta de qualquer lugar.

import { timingSafeEqual } from 'node:crypto';

const BEARER = /^Bearer\s+(.+)$/i;

function sameSecret(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Devolve null se a chamada pode seguir, ou { status, error } se deve ser recusada. */
export function checkAccess(headers = {}, { write = false } = {}) {
  const expected = (process.env.PANEL_ACCESS_TOKEN ?? '').trim();
  if (!expected) {
    if (write && process.env.VERCEL) {
      return {
        status: 403,
        error: 'Alterações no Google Ads ficam bloqueadas online até você definir PANEL_ACCESS_TOKEN nas variáveis de ambiente.',
      };
    }
    return null;
  }
  const given = BEARER.exec(String(headers.authorization ?? ''))?.[1]?.trim() ?? '';
  if (!given || !sameSecret(given, expected)) {
    return { status: 401, error: 'Acesso não autorizado. Informe o código de acesso do painel.' };
  }
  return null;
}
