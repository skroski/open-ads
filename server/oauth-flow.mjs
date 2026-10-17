// Fluxo OAuth de "App para computador": abre o login do Google no navegador, recebe o
// código em http://localhost:8787 e troca por um refresh token. Usado por
// get-refresh-token.mjs e pelo assistente de instalação (scripts/setup.mjs).

import http from 'node:http';
import { exec } from 'node:child_process';

export const SCOPES = {
  ads: 'https://www.googleapis.com/auth/adwords',
  analytics: 'https://www.googleapis.com/auth/analytics.readonly',
  searchConsole: 'https://www.googleapis.com/auth/webmasters.readonly',
  tagManager: 'https://www.googleapis.com/auth/tagmanager.readonly',
};

const PORT = 8787;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

export function openInBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* sem navegador padrão: o link também é impresso no terminal */
  });
}

/** Resolve com o refresh token, ou rejeita se o usuário negar ou algo falhar. */
export function obtainRefreshToken({ clientId, clientSecret, scopes }) {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  }).toString();

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const finish = (status, text, err, token) => {
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(text);
        server.close();
        if (err) reject(err);
        else resolve(token);
      };
      if (error || !code) {
        finish(400, `Autorização não concluída: ${error ?? 'código ausente'}`, new Error(error ?? 'código ausente'));
        return;
      }
      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code',
          }),
        });
        const data = await tokenRes.json();
        if (!tokenRes.ok || !data.refresh_token) {
          throw new Error(data.error_description ?? data.error ?? 'refresh_token ausente na resposta');
        }
        finish(200, 'Pronto! Pode fechar esta aba e voltar ao terminal.', null, data.refresh_token);
      } catch (err) {
        finish(500, 'Erro ao trocar o código por token. Veja o terminal.', err);
      }
    });

    server.on('error', (err) =>
      reject(err.code === 'EADDRINUSE' ? new Error(`A porta ${PORT} está ocupada. Feche o outro processo e tente de novo.`) : err),
    );
    server.listen(PORT, '127.0.0.1', () => {
      console.log('\nAbrindo o navegador para você entrar com a conta Google que acessa o Google Ads...');
      console.log('Se o navegador não abrir, copie e cole este link:\n');
      console.log(authUrl.toString());
      console.log('');
      openInBrowser(authUrl.toString());
    });
  });
}
