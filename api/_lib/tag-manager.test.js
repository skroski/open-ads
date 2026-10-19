// Contrato da leitura do GTM: nenhuma chamada de escrita chega ao Google e o
// inventário devolve apenas os campos necessários à interface.
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import tagManager, { mapAccounts, mapContainers, mapWorkspaces } from '../tag-manager.js';

const realFetch = globalThis.fetch;
const KEYS = ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_TAG_MANAGER_REFRESH_TOKEN'];
let saved;
let calls;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    GOOGLE_ADS_CLIENT_ID: 'test-client',
    GOOGLE_ADS_CLIENT_SECRET: 'test-secret',
    GOOGLE_ADS_REFRESH_TOKEN: `test-refresh-${Math.random()}-xxxxxxxxxxxx`,
    GOOGLE_TAG_MANAGER_REFRESH_TOKEN: `test-gtm-refresh-${Math.random()}-xxxxxxxxxxxx`,
  });
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
    }
    if (String(url).endsWith('/tags')) {
      return new Response(
        JSON.stringify({ tag: [{ tagId: '7', name: 'GA4', type: 'gaawe', parameter: [{ key: 'secret', value: 'não vaza' }] }] }),
        { status: 200 },
      );
    }
    if (String(url).endsWith('/triggers')) return new Response(JSON.stringify({ trigger: [{ triggerId: '3', name: 'Todas as páginas', type: 'PAGEVIEW' }] }), { status: 200 });
    if (String(url).endsWith('/variables')) return new Response(JSON.stringify({ variable: [{ variableId: '2', name: 'URL da página', type: 'v' }] }), { status: 200 });
    return new Response(JSON.stringify({ account: [] }), { status: 200 });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of KEYS) saved[key] === undefined ? delete process.env[key] : (process.env[key] = saved[key]);
});

function call(body) {
  const res = { statusCode: 0, body: '', writeHead(code) { this.statusCode = code; }, end(value) { this.body = value ?? ''; } };
  return tagManager({ method: 'POST', headers: {}, body }, res).then(() => ({ status: res.statusCode, json: JSON.parse(res.body) }));
}

test('mapeia os recursos do GTM sem depender de nomes ou IDs específicos', () => {
  assert.deepEqual(mapAccounts({ account: [{ path: 'accounts/1', accountId: '1', name: 'Agência' }] }), [{ path: 'accounts/1', id: '1', name: 'Agência' }]);
  assert.deepEqual(mapContainers({ container: [{ path: 'accounts/1/containers/2', containerId: '2', publicId: 'GTM-ABC', name: 'Site', usageContext: ['WEB'] }] }), [
    { path: 'accounts/1/containers/2', id: '2', publicId: 'GTM-ABC', name: 'Site', usageContext: ['WEB'] },
  ]);
  assert.deepEqual(mapWorkspaces({ workspace: [{ path: 'accounts/1/containers/2/workspaces/3', workspaceId: '3', name: 'Default' }] }), [
    { path: 'accounts/1/containers/2/workspaces/3', id: '3', name: 'Default', description: '' },
  ]);
});

test('snapshot é somente leitura e não devolve parâmetros sensíveis das tags', async () => {
  const { status, json } = await call({ resource: 'snapshot', parent: 'accounts/1/containers/2/workspaces/3' });
  assert.equal(status, 200);
  assert.equal(json.configured, true);
  assert.deepEqual(json.snapshot.tags, [{ id: '7', name: 'GA4', type: 'gaawe', paused: false, firingTriggerIds: [], consentStatus: 'NOT_SET' }]);
  assert.equal(JSON.stringify(json).includes('não vaza'), false);
  const gtmCalls = calls.filter((entry) => entry.url.includes('tagmanager.googleapis.com'));
  assert.equal(gtmCalls.length, 3);
  assert.ok(gtmCalls.every((entry) => !entry.init.method || entry.init.method === 'GET'));
});

test('recusa caminho arbitrário antes de consultar o Google', async () => {
  const { status } = await call({ resource: 'snapshot', parent: 'https://outro-site.example' });
  assert.equal(status, 400);
  assert.equal(calls.length, 0);
});
