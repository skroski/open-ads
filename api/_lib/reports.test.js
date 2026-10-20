import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import report, { buildReport } from '../ads-report.js';
import search from '../search.js';
import { getAccessToken } from './google-auth.js';
import { main } from '../../plugins/openads/scripts/openads.mjs';

const realFetch = globalThis.fetch;
const keys = ['PANEL_ACCESS_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'OPENADS_API_URL'];
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
});
const body = { report: 'palavras-chave', from: '2026-09-01', to: '2026-09-30' };
async function invoke(handler, payload = body, headers = {}) {
  const res = { writeHead(status) { this.status = status; }, end(value) { this.data = value ? JSON.parse(value) : null; } };
  await handler({ method: 'POST', headers, body: payload }, res);
  return res;
}
function setup(statuses = [200]) {
  delete process.env.PANEL_ACCESS_TOKEN;
  delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  Object.assign(process.env, { GOOGLE_ADS_CLIENT_ID: 'test', GOOGLE_ADS_CLIENT_SECRET: 'test', GOOGLE_ADS_REFRESH_TOKEN: `test-${Math.random()}`, GOOGLE_ADS_CUSTOMER_ID: '1234567890' });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('oauth2')) return Response.json({ access_token: 'test', expires_in: 3600 });
    calls.push({ url, init });
    const status = statuses.shift() ?? 200;
    return Response.json(status === 200 ? [{ results: [{ metrics: { clicks: '4' } }] }] : { error: { message: 'payload privado' } }, { status });
  };
  return calls;
}

test('relatórios rejeitam datas impossíveis, inversão, injeção, nomes e limites inválidos', () => {
  for (const patch of [{ from: '2026-02-30' }, { to: '2026-08-01' }, { from: "2026-09-01' OR 1=1" }, { report: '__proto__' }, { limit: -1 }, { limit: '10' }, { limit: 5001 }]) {
    assert.throws(() => buildReport({ ...body, ...patch }), { status: 400 });
  }
  for (const name of ['conta', 'contas', 'campanhas', 'palavras-chave', 'termos', 'dispositivos']) {
    assert.match(buildReport({ ...body, report: name }).query, /^SELECT /);
  }
});

test('relatório preserva MCC, período, fonte e sinaliza limite alcançado', async () => {
  const calls = setup();
  const res = await invoke(report, { ...body, limit: 1 }, { 'x-login-customer-id': '987-654-3210' });
  assert.equal(res.status, 200);
  assert.equal(res.data.possiblyTruncated, true);
  assert.equal(res.data.source, 'Google Ads API');
  assert.deepEqual(res.data.period, { from: body.from, to: body.to });
  assert.equal(calls[0].init.headers['login-customer-id'], '9876543210');
  assert.match(calls[0].url, /customers\/1234567890\/googleAds:searchStream$/);
  assert.match(JSON.parse(calls[0].init.body).query, /FROM keyword_view/);
  assert.ok(calls[0].init.signal);
});

test('falha temporária repete leitura; cota e permissão não repetem nem expõem payload', async () => {
  let calls = setup([503, 200]);
  assert.equal((await invoke(report)).status, 200);
  assert.equal(calls.length, 2);
  for (const status of [403, 429]) {
    calls = setup([status]);
    const res = await invoke(report);
    assert.equal(res.status, status === 429 ? 429 : 502);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(JSON.stringify(res.data), /payload privado/);
  }
});

test('entrada inválida e acesso negado não chegam ao Google', async () => {
  const calls = setup();
  assert.equal((await invoke(report, body, { 'x-customer-id': 'abc123' })).status, 400);
  assert.equal(calls.length, 0);
  process.env.PANEL_ACCESS_TOKEN = 'test';
  assert.equal((await invoke(report)).status, 401);
  assert.equal(calls.length, 0);
});

test('search mantém contrato consumido pelo painel', async () => {
  setup();
  const res = await invoke(search, { query: 'SELECT customer.id FROM customer' });
  assert.equal(res.status, 200);
  assert.equal(res.data.currentCustomerId, '1234567890');
  assert.equal(res.data.results[0].metrics.clicks, '4');
});

test('cliente monta relatório e autentica sem enviar segredos no corpo', async () => {
  process.env.PANEL_ACCESS_TOKEN = 'test';
  process.env.OPENADS_API_URL = 'http://127.0.0.1:3000';
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:3000/api/ads-report');
    assert.equal(init.headers.Authorization, 'Bearer test');
    assert.equal(init.redirect, 'error');
    assert.equal(JSON.parse(init.body).report, 'palavras-chave');
    assert.doesNotMatch(init.body, /test/);
    return Response.json({ results: [] });
  };
  assert.deepEqual(await main(['palavras-chave', '--customer', '1234567890', '--from', body.from, '--to', body.to]), { results: [] });
});

test('cliente rejeita origem insegura e não oculta falhas da API', async () => {
  process.env.OPENADS_API_URL = 'http://example.com';
  await assert.rejects(main(['contas']), /HTTPS/);
  process.env.OPENADS_API_URL = 'http://127.0.0.1:3000';
  globalThis.fetch = async () => Response.json({ error: 'Acesso recusado' }, { status: 401 });
  await assert.rejects(main(['contas']), /Acesso recusado/);
  assert.ok((await main(['ajuda'])).reports.includes('palavras-chave'));
});


test('renovações OAuth simultâneas compartilham chamada e tokens diferentes não colidem', async () => {
  setup();
  let count = 0;
  globalThis.fetch = async () => {
    count++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json({ access_token: `token-${count}`, expires_in: 3600 });
  };
  const tokens = await Promise.all([getAccessToken('ads'), getAccessToken('ads'), getAccessToken('ads')]);
  assert.equal(count, 1);
  assert.deepEqual(tokens, ['token-1', 'token-1', 'token-1']);
  process.env.GOOGLE_ADS_REFRESH_TOKEN = `other-${Math.random()}`;
  assert.equal(await getAccessToken('ads'), 'token-2');
  assert.equal(count, 2);
});

test('OAuth expirado orienta renovação sem expor a resposta e permite tentar novamente', async () => {
  setup();
  globalThis.fetch = async () => Response.json({ error: 'invalid_grant', error_description: 'conteúdo privado' }, { status: 400 });
  await assert.rejects(getAccessToken('ads'), (error) => {
    assert.match(error.message, /npm run token/);
    assert.doesNotMatch(error.message, /conteúdo privado/);
    return true;
  });
  globalThis.fetch = async () => Response.json({ access_token: 'renovado', expires_in: 3600 });
  assert.equal(await getAccessToken('ads'), 'renovado');
});
