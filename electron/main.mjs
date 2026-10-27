// Electron Main Process para OpenAds Desktop
// Gerencia o ciclo de vida da aplicação, o assistente de configuração (Wizard)
// e a inicialização dos servidores internos (API e dashboard).

import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';

import { ENV_PATH, readEnv, updateEnv } from '../server/env-file.mjs';
import { SCOPES, obtainRefreshToken } from '../server/oauth-flow.mjs';
import { createStaticProxyServer, isPortAvailable } from './server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const REQUIRED_KEYS = [
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
];

const API_PORT = 3000;
const DASHBOARD_PORT = 4200;

let mainWindow = null;
let apiProcess = null;
let staticServer = null;
let dashboardUrl = `http://127.0.0.1:${DASHBOARD_PORT}`;

// ───────────────────────── Funções Auxiliares ─────────────────────────

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const fmtId = (v) => digits(v).replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');

async function isConfigured() {
  if (process.argv.includes('--wizard') || process.argv.includes('--setup')) return false;
  if (!existsSync(ENV_PATH)) return false;
  const { values } = await readEnv();
  return REQUIRED_KEYS.every((k) => Boolean(values[k]?.trim()));
}

async function checkPortResponding(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(800);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// ───────────────────────── Gerenciamento de Servidores ─────────────────────────

async function startApiServer() {
  const isUp = await checkPortResponding(API_PORT);
  if (isUp) {
    console.log(`[Electron] API já está respondendo na porta ${API_PORT}.`);
    return;
  }

  if (apiProcess && apiProcess.exitCode === null) return;

  const { values } = await readEnv();
  const apiScript = path.join(rootDir, 'server', 'index.mjs');

  console.log('[Electron] Iniciando servidor da API...');
  apiProcess = fork(apiScript, [], {
    cwd: rootDir,
    env: {
      ...process.env,
      ...values,
      PORT: String(API_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  apiProcess.stdout?.on('data', (c) => console.log(`[API stdout] ${c.toString().trim()}`));
  apiProcess.stderr?.on('data', (c) => console.error(`[API stderr] ${c.toString().trim()}`));
  apiProcess.on('exit', (code) => {
    console.log(`[API] Processo finalizado (${code}).`);
    apiProcess = null;
  });

  // Aguarda a porta subir
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await checkPortResponding(API_PORT)) {
      console.log(`[Electron] API online na porta ${API_PORT}.`);
      break;
    }
  }
}

async function startDashboardServer() {
  const staticDir = path.join(rootDir, 'web', 'dist', 'web', 'browser');
  if (!staticServer) {
    staticServer = createStaticProxyServer({
      staticDir,
      apiPort: API_PORT,
      port: DASHBOARD_PORT,
    });
  }

  try {
    const res = await staticServer.start();
    dashboardUrl = res.url;
    console.log(`[Electron] Dashboard sendo servido em ${dashboardUrl}`);
  } catch (err) {
    console.warn(`[Electron] Erro ao iniciar servidor estático: ${err.message}. Verificando porta existente...`);
    dashboardUrl = `http://127.0.0.1:${DASHBOARD_PORT}`;
  }
}

function stopServers() {
  if (staticServer) {
    try {
      staticServer.stop();
    } catch {}
    staticServer = null;
  }
  if (apiProcess && apiProcess.exitCode === null) {
    try {
      apiProcess.kill();
    } catch {}
    apiProcess = null;
  }
}

// ───────────────────────── Criação da Janela ─────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 680,
    title: 'OpenAds Desktop',
    backgroundColor: '#1f1f1f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  setupAppMenu();

  return mainWindow;
}

function loadWizard() {
  if (!mainWindow) return;
  const wizardPath = path.join(__dirname, 'wizard', 'index.html');
  mainWindow.loadFile(wizardPath);
}

async function loadDashboard() {
  if (!mainWindow) return;
  await startApiServer();
  await startDashboardServer();
  mainWindow.loadURL(dashboardUrl);
}

// ───────────────────────── Menu Nativo da Aplicação ─────────────────────────

function setupAppMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [
          {
            label: 'OpenAds',
            submenu: [
              { label: 'Sobre o OpenAds', click: () => showAbout() },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit', label: 'Encerrar OpenAds' },
            ],
          },
        ]
      : []),
    {
      label: 'Painel',
      submenu: [
        { label: 'Recarregar Tela', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { label: 'Ferramentas de Desenvolvedor', accelerator: 'Alt+CmdOrCtrl+I', click: () => mainWindow?.webContents.toggleDevTools() },
        { type: 'separator' },
        {
          label: 'Abrir no Navegador Externo',
          accelerator: 'CmdOrCtrl+O',
          click: () => shell.openExternal(dashboardUrl),
        },
      ],
    },
    {
      label: 'Configurações',
      submenu: [
        {
          label: '⚙️ Assistente de Chaves (Wizard)',
          accelerator: 'CmdOrCtrl+W',
          click: () => loadWizard(),
        },
        {
          label: '🩺 Diagnóstico do Sistema',
          click: async () => {
            loadWizard();
            mainWindow?.webContents.executeJavaScript('window.openDoctorModal?.()');
          },
        },
        { type: 'separator' },
        {
          label: '🔄 Reiniciar Servidor de API (:3000)',
          click: async () => {
            if (apiProcess) apiProcess.kill();
            await startApiServer();
          },
        },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: '📖 Guia de Instalação (Passo a Passo)',
          click: () => shell.openExternal('https://github.com/skroski/open-ads/blob/main/INSTALL.md'),
        },
        {
          label: '💡 Documentação e Código Fonte',
          click: () => shell.openExternal('https://github.com/skroski/open-ads'),
        },
        { type: 'separator' },
        {
          label: '☕ Apoiar o Projeto (Pix / Contato)',
          click: () => {
            loadWizard();
            mainWindow?.webContents.executeJavaScript('window.openDonationModal?.()');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Sobre o OpenAds',
    message: 'OpenAds Desktop · v1.0.0',
    detail:
      'Painel inteligente de auditoria e análise de Google Ads, 100% privado no seu computador.\n\nCriado por Daniel Skroski.\nLicença GPL-2.0-or-later.',
  });
}

// ───────────────────────── IPC Handlers ─────────────────────────

ipcMain.handle('wizard:get-status', async () => {
  const { values } = await readEnv();
  const configured = REQUIRED_KEYS.every((k) => Boolean(values[k]?.trim()));
  
  return {
    configured,
    envPath: ENV_PATH,
    nodeVersion: process.versions.node,
    platform: process.platform,
    keys: {
      hasClientId: Boolean(values.GOOGLE_ADS_CLIENT_ID),
      clientIdPreview: values.GOOGLE_ADS_CLIENT_ID
        ? `${values.GOOGLE_ADS_CLIENT_ID.slice(0, 12)}...apps.googleusercontent.com`
        : '',
      hasClientSecret: Boolean(values.GOOGLE_ADS_CLIENT_SECRET),
      hasRefreshToken: Boolean(values.GOOGLE_ADS_REFRESH_TOKEN),
      customerId: values.GOOGLE_ADS_CUSTOMER_ID ? fmtId(values.GOOGLE_ADS_CUSTOMER_ID) : '',
      loginCustomerId: values.GOOGLE_ADS_LOGIN_CUSTOMER_ID ? fmtId(values.GOOGLE_ADS_LOGIN_CUSTOMER_ID) : '',
      allowedHosts: values.PAGE_AUDIT_ALLOWED_HOSTS || '',
      hasAnthropicKey: Boolean(values.ANTHROPIC_API_KEY),
      hasPanelToken: Boolean(values.PANEL_ACCESS_TOKEN),
    },
  };
});

ipcMain.handle('wizard:get-brand-info', async () => {
  try {
    const brandMod = await import('../web/src/app/brand.ts');
    return {
      brand: brandMod.BRAND,
      author: brandMod.AUTHOR,
      donation: brandMod.DONATION,
    };
  } catch (err) {
    return {
      brand: { logoStrong: 'Open', logoLight: 'Ads' },
      author: { name: 'Daniel Skroski' },
      donation: { pixKey: '41999865410', pixType: 'Telefone' },
    };
  }
});

ipcMain.handle('wizard:select-json-file', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecione o arquivo JSON do cliente OAuth do Google Cloud',
    filters: [{ name: 'Arquivo JSON do Google', extensions: ['json'] }],
    properties: ['openFile'],
  });

  if (res.canceled || !res.filePaths.length) return null;

  const content = await readFile(res.filePaths[0], 'utf8');
  return parseClientJson(content);
});

ipcMain.handle('wizard:parse-json-content', (_event, content) => {
  return parseClientJson(content);
});

function parseClientJson(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const client = parsed.installed ?? parsed.web;
    if (!client?.client_id || !client?.client_secret) {
      throw new Error('O arquivo JSON não possui os campos client_id e client_secret esperados do Google Cloud.');
    }
    return {
      success: true,
      clientId: client.client_id,
      clientSecret: client.client_secret,
      isWeb: Boolean(parsed.web),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

ipcMain.handle('wizard:start-oauth', async (_event, { clientId, clientSecret, includeExtras = true }) => {
  try {
    const scopes = includeExtras
      ? [SCOPES.ads, SCOPES.analytics, SCOPES.searchConsole, SCOPES.tagManager]
      : [SCOPES.ads];

    mainWindow?.webContents.send('oauth:status', { step: 'waiting_browser', message: 'Abrindo o navegador para autorização...' });

    const refreshToken = await obtainRefreshToken({
      clientId,
      clientSecret,
      scopes,
    });

    return { success: true, refreshToken };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

const ADS_API = 'https://googleads.googleapis.com/v25';

function adsHeaders(token, developerToken, loginCustomerId) {
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (developerToken) h['developer-token'] = developerToken;
  if (loginCustomerId) h['login-customer-id'] = digits(loginCustomerId);
  return h;
}

async function getAccessTokenFromRefresh(clientId, clientSecret, refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || `Erro HTTP ${res.status}`);
  return data.access_token;
}

ipcMain.handle('wizard:list-accounts', async (_event, { clientId, clientSecret, refreshToken, developerToken }) => {
  try {
    const token = await getAccessTokenFromRefresh(clientId, clientSecret, refreshToken);
    const res = await fetch(`${ADS_API}/customers:listAccessibleCustomers`, {
      headers: adsHeaders(token, developerToken),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Ads respondeu ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const ids = (data.resourceNames ?? []).map((r) => r.split('/')[1]);

    if (!ids.length) {
      return { success: true, accounts: [] };
    }

    // Descreve as primeiras contas
    const accounts = await Promise.all(
      ids.slice(0, 30).map(async (id) => {
        try {
          const descRes = await fetch(`${ADS_API}/customers/${id}/googleAds:search`, {
            method: 'POST',
            headers: adsHeaders(token, developerToken),
            body: JSON.stringify({ query: 'SELECT customer.descriptive_name, customer.manager FROM customer LIMIT 1' }),
          });
          if (!descRes.ok) return { id, formattedId: fmtId(id), name: '(sem permissão direta)', manager: false };
          const c = (await descRes.json()).results?.[0]?.customer ?? {};
          return {
            id,
            formattedId: fmtId(id),
            name: c.descriptiveName || '(sem nome definido)',
            manager: Boolean(c.manager),
          };
        } catch {
          return { id, formattedId: fmtId(id), name: '(erro ao ler)', manager: false };
        }
      })
    );

    return { success: true, accounts, totalFound: ids.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('wizard:test-account', async (_event, { clientId, clientSecret, refreshToken, customerId, loginCustomerId, developerToken }) => {
  try {
    const token = await getAccessTokenFromRefresh(clientId, clientSecret, refreshToken);
    const res = await fetch(`${ADS_API}/customers/${digits(customerId)}/googleAds:search`, {
      method: 'POST',
      headers: adsHeaders(token, developerToken, loginCustomerId),
      body: JSON.stringify({ query: 'SELECT campaign.id FROM campaign LIMIT 1' }),
    });

    if (!res.ok) {
      const text = await res.text();
      const code = text.match(/"(CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION|DEVELOPER_TOKEN_NOT_APPROVED|USER_PERMISSION_DENIED|CUSTOMER_NOT_ENABLED|NOT_ADS_USER|SERVICE_DISABLED|PERMISSION_DENIED|AUTHORIZATION_ERROR)"?/)?.[1];
      const hints = {
        CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION: 'O projeto do Google Cloud está no acesso Test. Peça o acesso Explorer em Cloud Console → Google Ads API → Visão geral.',
        DEVELOPER_TOKEN_NOT_APPROVED: 'O acesso do projeto não libera contas reais. Peça o acesso Explorer ou Basic no Cloud Console.',
        USER_PERMISSION_DENIED: 'Seu login não acessa esta conta diretamente. Se o acesso vem por um MCC, informe o ID do MCC.',
        NOT_ADS_USER: 'O login usado na autorização não tem acesso a nenhuma conta do Google Ads.',
        SERVICE_DISABLED: 'A Google Ads API não está ativada no projeto do Google Cloud.',
        CUSTOMER_NOT_ENABLED: 'A conta está cancelada ou ainda não foi ativada.',
      };
      throw new Error(hints[code] ?? `Google Ads respondeu HTTP ${res.status}${code ? ` (${code})` : ''}`);
    }

    return { success: true, message: `Conta ${fmtId(customerId)} conectada e respondendo com sucesso!` };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('wizard:save-config', async (_event, patch) => {
  try {
    await updateEnv(patch);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('wizard:run-doctor', async () => {
  const checks = [];

  // 1. Node runtime
  const [major, minor] = process.versions.node.split('.').map(Number);
  checks.push({
    id: 'node',
    label: `Node.js ${process.versions.node}`,
    passed: major > 20 || (major === 20 && minor >= 6),
    fix: 'Instale o Node 22 LTS em https://nodejs.org se for rodar via terminal.',
  });

  // 2. server/.env e chaves
  const hasEnv = existsSync(ENV_PATH);
  const { values } = await readEnv();
  const missing = REQUIRED_KEYS.filter((k) => !values[k]);

  checks.push({
    id: 'env_file',
    label: 'Arquivo server/.env configurado',
    passed: hasEnv && missing.length === 0,
    fix: missing.length ? `Faltam: ${missing.join(', ')}` : undefined,
  });

  // 3. Portas
  const port3000Free = await isPortAvailable(3000);
  const port4200Free = await isPortAvailable(4200);

  checks.push({
    id: 'ports',
    label: 'Portas de rede (3000 e 4200)',
    passed: true,
    detail: `Porta 3000: ${port3000Free ? 'livre' : 'em uso (será reutilizada)'} · Porta 4200: ${port4200Free ? 'livre' : 'em uso'}`,
  });

  // 4. Teste de login no Google
  if (values.GOOGLE_ADS_CLIENT_ID && values.GOOGLE_ADS_CLIENT_SECRET && values.GOOGLE_ADS_REFRESH_TOKEN) {
    try {
      const token = await getAccessTokenFromRefresh(
        values.GOOGLE_ADS_CLIENT_ID,
        values.GOOGLE_ADS_CLIENT_SECRET,
        values.GOOGLE_ADS_REFRESH_TOKEN
      );
      checks.push({
        id: 'google_auth',
        label: 'Autorização com o Google ativa',
        passed: true,
      });

      // 5. Teste da Google Ads API
      try {
        const adsRes = await fetch(`${ADS_API}/customers:listAccessibleCustomers`, {
          headers: adsHeaders(token, values.GOOGLE_ADS_DEVELOPER_TOKEN),
        });
        checks.push({
          id: 'ads_api',
          label: 'Google Ads API conectada',
          passed: adsRes.ok,
          fix: adsRes.ok ? undefined : `Status HTTP ${adsRes.status}. Verifique se a API está ativada no Cloud.`,
        });
      } catch (e) {
        checks.push({
          id: 'ads_api',
          label: 'Google Ads API conectada',
          passed: false,
          fix: e.message,
        });
      }
    } catch (err) {
      checks.push({
        id: 'google_auth',
        label: 'Autorização com o Google',
        passed: false,
        fix: err.message,
      });
    }
  }

  return checks;
});

ipcMain.handle('app:launch-dashboard', async () => {
  await loadDashboard();
  return { success: true };
});

ipcMain.handle('app:open-wizard', () => {
  loadWizard();
  return { success: true };
});

ipcMain.handle('app:open-external', (_event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
});

ipcMain.handle('app:restart-server', async () => {
  if (apiProcess) apiProcess.kill();
  await startApiServer();
  return { success: true };
});

// ───────────────────────── Ciclo de Vida do Electron ─────────────────────────

app.whenReady().then(async () => {
  createMainWindow();

  const configured = await isConfigured();
  if (configured) {
    console.log('[Electron] Painel já configurado. Carregando dashboard...');
    await loadDashboard();
  } else {
    console.log('[Electron] Iniciando assistente de configuração (Wizard)...');
    loadWizard();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  stopServers();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopServers();
});
