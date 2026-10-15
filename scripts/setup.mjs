// Assistente de instalação: pergunta as chaves no terminal, grava server/.env e testa a
// conexão com o Google Ads. Nada do que você digita é exibido nem enviado a terceiros:
// os valores vão só para o arquivo server/.env desta máquina e para o próprio Google.
//
// Uso: npm run setup

import { readFile } from 'node:fs/promises';
import readline from 'node:readline';
import { ENV_PATH, readEnv, updateEnv } from '../server/env-file.mjs';
import { SCOPES, obtainRefreshToken } from '../server/oauth-flow.mjs';

const API = 'https://googleads.googleapis.com/v25';
const ok = (m) => console.log(`✅ ${m}`);
const warn = (m) => console.log(`⚠️  ${m}`);
const step = (n, m) => console.log(`\n━━━ Passo ${n} · ${m} ━━━`);

// ───────────────────────── perguntas ─────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
const write = rl._writeToOutput?.bind(rl);
if (write) rl._writeToOutput = (s) => (muted && !s.includes('\n') ? write('*') : write(s));

// Fila de linhas: funciona digitando ou com respostas enviadas por pipe.
const queued = [];
const waiting = [];
let closed = false;
rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : queued.push(line)));
rl.on('close', () => {
  closed = true;
  waiting.splice(0).forEach((r) => r(null));
});
const nextLine = () =>
  queued.length ? Promise.resolve(queued.shift()) : closed ? Promise.resolve(null) : new Promise((r) => waiting.push(r));

async function ask(question, { secret = false, fallback = '' } = {}) {
  const hint = fallback ? (secret ? ' [Enter mantém o atual]' : ` [${fallback}]`) : '';
  process.stdout.write(`${question}${hint}: `);
  muted = secret;
  const answer = await nextLine();
  muted = false;
  if (secret || answer === null) process.stdout.write('\n');
  if (answer === null) throw new Error('Entrada encerrada antes do fim do assistente.');
  return answer.trim() || fallback;
}

async function yes(question, def = true) {
  const a = (await ask(`${question} (${def ? 'S/n' : 's/N'})`)).toLowerCase();
  return a ? a.startsWith('s') || a.startsWith('y') : def;
}

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const fmtId = (v) => digits(v).replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');

// ───────────────────────── Google ─────────────────────────

async function accessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description ?? data.error ?? `HTTP ${res.status}`);
  return data.access_token;
}

function adsHeaders(env, token, loginId) {
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (env.GOOGLE_ADS_DEVELOPER_TOKEN) h['developer-token'] = env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (loginId) h['login-customer-id'] = digits(loginId);
  return h;
}

async function adsError(res) {
  const text = await res.text();
  const code = text.match(/"(CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION|DEVELOPER_TOKEN_NOT_APPROVED|USER_PERMISSION_DENIED|CUSTOMER_NOT_ENABLED|NOT_ADS_USER|SERVICE_DISABLED|PERMISSION_DENIED|AUTHORIZATION_ERROR)"?/)?.[1];
  const hints = {
    CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION:
      'O projeto do Google Cloud está no acesso Test. Peça o acesso Explorer em Cloud Console → Google Ads API → Visão geral.',
    DEVELOPER_TOKEN_NOT_APPROVED: 'O acesso do projeto não libera contas reais. Peça o acesso Explorer ou Basic no Cloud Console.',
    USER_PERMISSION_DENIED: 'Seu login não acessa esta conta. Se o acesso vem por um MCC, informe o ID do MCC.',
    NOT_ADS_USER: 'O login usado na autorização não tem acesso a nenhuma conta do Google Ads.',
    SERVICE_DISABLED: 'A Google Ads API não está ativada no projeto do Google Cloud (APIs e serviços → Biblioteca).',
    CUSTOMER_NOT_ENABLED: 'A conta está cancelada ou ainda não foi ativada.',
  };
  return new Error(hints[code] ?? `Google Ads respondeu ${res.status}${code ? ` (${code})` : ''}.`);
}

async function accessibleCustomers(env, token) {
  const res = await fetch(`${API}/customers:listAccessibleCustomers`, { headers: adsHeaders(env, token) });
  if (!res.ok) throw await adsError(res);
  const data = await res.json();
  return (data.resourceNames ?? []).map((r) => r.split('/')[1]);
}

async function describe(env, token, id) {
  const res = await fetch(`${API}/customers/${id}/googleAds:search`, {
    method: 'POST',
    headers: adsHeaders(env, token),
    body: JSON.stringify({ query: 'SELECT customer.descriptive_name, customer.manager FROM customer LIMIT 1' }),
  });
  if (!res.ok) return { id, name: '(sem permissão de leitura)', manager: false };
  const c = (await res.json()).results?.[0]?.customer ?? {};
  return { id, name: c.descriptiveName || '(sem nome)', manager: Boolean(c.manager) };
}

async function testAccount(env, token, id, loginId) {
  const res = await fetch(`${API}/customers/${digits(id)}/googleAds:search`, {
    method: 'POST',
    headers: adsHeaders(env, token, loginId),
    body: JSON.stringify({ query: 'SELECT campaign.id FROM campaign LIMIT 1' }),
  });
  if (!res.ok) throw await adsError(res);
}

// ───────────────────────── fluxo ─────────────────────────

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 6)) {
  console.error(`Node ${process.versions.node} é antigo demais. Instale o Node 22 LTS em https://nodejs.org e rode de novo.`);
  process.exit(1);
}

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Instalação do painel · chaves do Google                    ║
╚══════════════════════════════════════════════════════════════╝
O que você digitar aqui fica só no arquivo server/.env deste computador.
Não cole estas chaves em chats, e-mails ou no Git.
Siga o guia INSTALL.md em paralelo: ele mostra onde clicar no Google.
`);

const { values: current } = await readEnv();
const env = { ...current };

try {
  // 1. Cliente OAuth
  step(1, 'Cliente OAuth do Google Cloud');
  console.log('No Google Cloud você baixou um arquivo JSON do cliente OAuth (tipo "App para computador").');
  const jsonPath = (await ask('Arraste o arquivo para cá e tecle Enter (ou Enter para digitar à mão)')).replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ');
  if (jsonPath) {
    const parsed = JSON.parse(await readFile(jsonPath, 'utf8'));
    const c = parsed.installed ?? parsed.web;
    if (!c?.client_id || !c?.client_secret) throw new Error('Esse JSON não parece um cliente OAuth do Google.');
    if (parsed.web) warn('Esse cliente é do tipo "Aplicativo da Web". O recomendado é "App para computador".');
    env.GOOGLE_ADS_CLIENT_ID = c.client_id;
    env.GOOGLE_ADS_CLIENT_SECRET = c.client_secret;
    ok('Client ID e Client Secret lidos do arquivo.');
  } else {
    env.GOOGLE_ADS_CLIENT_ID = await ask('Client ID (termina em .apps.googleusercontent.com)', { fallback: current.GOOGLE_ADS_CLIENT_ID });
    env.GOOGLE_ADS_CLIENT_SECRET = await ask('Client Secret', { secret: true, fallback: current.GOOGLE_ADS_CLIENT_SECRET });
  }
  if (!/\.apps\.googleusercontent\.com$/.test(env.GOOGLE_ADS_CLIENT_ID ?? '')) throw new Error('Client ID inválido.');
  if (!env.GOOGLE_ADS_CLIENT_SECRET) throw new Error('Client Secret vazio.');
  await updateEnv({ GOOGLE_ADS_CLIENT_ID: env.GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET: env.GOOGLE_ADS_CLIENT_SECRET });

  // 2. Autorização
  step(2, 'Autorizar o acesso às suas contas');
  const reuse = current.GOOGLE_ADS_REFRESH_TOKEN && !(await yes('Já existe um refresh token. Gerar um novo?', false));
  if (!reuse) {
    const extras = await yes('Também ler Google Analytics 4 e Search Console (somente leitura)?', true);
    const scopes = extras ? [SCOPES.ads, SCOPES.analytics, SCOPES.searchConsole] : [SCOPES.ads];
    console.log('Na tela do Google, entre com o login que acessa o Google Ads e marque todas as permissões.');
    console.log('Se aparecer "O Google não verificou este app", clique em Avançado → Acessar (é o seu próprio app).');
    env.GOOGLE_ADS_REFRESH_TOKEN = await obtainRefreshToken({
      clientId: env.GOOGLE_ADS_CLIENT_ID,
      clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
      scopes,
    });
    await updateEnv({ GOOGLE_ADS_REFRESH_TOKEN: env.GOOGLE_ADS_REFRESH_TOKEN });
    ok('Refresh token gravado.');
  }

  // 3. Conta padrão
  step(3, 'Escolher a conta do Google Ads');
  const token = await accessToken(env);
  const ids = await accessibleCustomers(env, token);
  if (!ids.length) throw new Error('Este login não acessa nenhuma conta do Google Ads.');
  const accounts = await Promise.all(ids.slice(0, 30).map((id) => describe(env, token, id)));
  accounts.forEach((a, i) => console.log(`  ${String(i + 1).padStart(2)}. ${fmtId(a.id)}  ${a.name}${a.manager ? '  [MCC]' : ''}`));
  if (ids.length > 30) console.log(`  … e mais ${ids.length - 30}. Digite o ID direto se não estiver na lista.`);
  const pick = await ask('Número da lista ou Customer ID da conta que abre por padrão', { fallback: fmtId(current.GOOGLE_ADS_CUSTOMER_ID) || '1' });
  const chosen = /^\d{1,2}$/.test(pick) ? accounts[Number(pick) - 1] : { id: digits(pick), manager: false };
  if (!chosen || digits(chosen.id).length !== 10) throw new Error('Escolha inválida.');
  env.GOOGLE_ADS_CUSTOMER_ID = digits(chosen.id);

  const mccs = accounts.filter((a) => a.manager);
  let login = '';
  if (chosen.manager) {
    login = chosen.id;
    console.log('Você escolheu um MCC: ele será usado como login, e o painel lista os clientes dele.');
  } else if (mccs.length) {
    login = digits(await ask('Se o acesso a essa conta vem por um MCC, informe o ID do MCC (Enter = acesso direto)', { fallback: fmtId(current.GOOGLE_ADS_LOGIN_CUSTOMER_ID) }));
  }
  env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = login;

  if (!chosen.manager) {
    await testAccount(env, token, env.GOOGLE_ADS_CUSTOMER_ID, login);
    ok(`Conta ${fmtId(env.GOOGLE_ADS_CUSTOMER_ID)} respondeu.`);
  }
  await updateEnv({ GOOGLE_ADS_CUSTOMER_ID: env.GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_LOGIN_CUSTOMER_ID: login });

  // 4. Opcionais
  step(4, 'Opcionais (Enter pula)');
  const hosts = await ask('Domínios do seu site, separados por vírgula (para auditar páginas)', { fallback: current.PAGE_AUDIT_ALLOWED_HOSTS });
  const anthropic = await yes('Quer explicações escritas por IA (precisa de chave da Anthropic, paga por uso)?', false);
  const patch = { PAGE_AUDIT_ALLOWED_HOSTS: hosts || undefined };
  if (anthropic) patch.ANTHROPIC_API_KEY = await ask('ANTHROPIC_API_KEY', { secret: true, fallback: current.ANTHROPIC_API_KEY });
  await updateEnv(patch);

  console.log(`
🎉 Tudo pronto. Chaves gravadas em ${ENV_PATH}
Para abrir o painel:  npm start
Depois acesse:        http://localhost:4200
Para conferir tudo:   npm run doctor
`);
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  console.error('O que já foi preenchido ficou salvo. Corrija e rode npm run setup de novo.');
  process.exitCode = 1;
} finally {
  rl.close();
}
