// Diagnóstico da instalação: Node, dependências, server/.env, portas e conexão com o Google.
// Mostra só nomes de variáveis, nunca os valores.
// Uso: npm run doctor

import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_PATH, readEnv } from '../server/env-file.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let problems = 0;
const pass = (m) => console.log(`✅ ${m}`);
const fail = (m, fix) => {
  problems++;
  console.log(`❌ ${m}${fix ? `\n   → ${fix}` : ''}`);
};
const info = (m) => console.log(`ℹ️  ${m}`);

const [major, minor] = process.versions.node.split('.').map(Number);
if (major > 20 || (major === 20 && minor >= 6)) pass(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node} é antigo`, 'Instale o Node 22 LTS em https://nodejs.org');

if (existsSync(path.join(root, 'node_modules'))) pass('Dependências da raiz instaladas');
else fail('Dependências da raiz não instaladas', 'npm run install:all');
if (existsSync(path.join(root, 'web', 'node_modules'))) pass('Dependências do painel (web/) instaladas');
else fail('Dependências do painel não instaladas', 'npm run install:all');

const { values } = await readEnv();
if (!existsSync(ENV_PATH)) fail('server/.env não existe', 'npm run setup');
const required = ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'];
const missing = required.filter((k) => !values[k]);
if (missing.length) fail(`Faltam no server/.env: ${missing.join(', ')}`, 'npm run setup');
else pass('Variáveis obrigatórias presentes no server/.env');
for (const k of ['GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'PAGE_AUDIT_ALLOWED_HOSTS', 'ANTHROPIC_API_KEY']) {
  info(`${k}: ${values[k] ? 'definida' : 'não definida (opcional)'}`);
}

const portFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer().once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true))).listen(port, '127.0.0.1');
  });
for (const [port, what] of [
  [3000, 'servidor da API'],
  [4200, 'painel'],
]) {
  if (await portFree(port)) pass(`Porta ${port} livre (${what})`);
  else info(`Porta ${port} em uso: se for o ${what} já rodando, está tudo bem.`);
}

if (!missing.length) {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: values.GOOGLE_ADS_CLIENT_ID,
        client_secret: values.GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: values.GOOGLE_ADS_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      fail(
        `O Google recusou as credenciais (${data.error})`,
        data.error === 'invalid_grant'
          ? 'O refresh token expirou ou foi revogado. Com o app OAuth em "Teste", ele vale 7 dias: publique o app e rode npm run token.'
          : 'Confira Client ID e Secret com npm run setup.',
      );
    } else {
      pass('Login no Google funcionando');
      const headers = { Authorization: `Bearer ${data.access_token}` };
      if (values.GOOGLE_ADS_DEVELOPER_TOKEN) headers['developer-token'] = values.GOOGLE_ADS_DEVELOPER_TOKEN;
      const ads = await fetch('https://googleads.googleapis.com/v25/customers:listAccessibleCustomers', { headers });
      if (ads.ok) pass(`Google Ads API respondeu (${((await ads.json()).resourceNames ?? []).length} conta(s) acessível(is))`);
      else fail(`Google Ads API respondeu ${ads.status}`, 'Ative a Google Ads API no projeto do Google Cloud e confira o nível de acesso.');
    }
  } catch (err) {
    fail(`Sem conexão com o Google: ${err.message}`, 'Verifique a internet ou o proxy da sua rede.');
  }
}

console.log(problems ? `\n${problems} problema(s) encontrado(s).` : '\nTudo certo. Rode npm start e abra http://localhost:4200');
process.exitCode = problems ? 1 : 0;
