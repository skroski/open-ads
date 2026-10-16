// Testes de ponta a ponta dos handlers de escrita, com fetch simulado (nada vai ao Google).
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import negativeKeyword from '../negative-keyword.js';
import keywordStatus from '../keyword-status.js';

const realFetch = globalThis.fetch;
const KEYS = ['PANEL_ACCESS_TOKEN', 'VERCEL', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'];
let saved;
let calls;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  delete process.env.PANEL_ACCESS_TOKEN;
  delete process.env.VERCEL;
  Object.assign(process.env, {
    GOOGLE_ADS_CLIENT_ID: 'id',
    GOOGLE_ADS_CLIENT_SECRET: 'secret',
    GOOGLE_ADS_REFRESH_TOKEN: `refresh-${Math.random()}-xxxxxxxxxxxx`,
    GOOGLE_ADS_CUSTOMER_ID: '1234567890',
  });
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const json = String(url).includes('oauth2') ? { access_token: 'tok', expires_in: 3600 } : { results: [] };
    return new Response(JSON.stringify(json), { status: 200 });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
});

function call(handler, { method = 'POST', headers = {}, body = {} } = {}) {
  const res = { statusCode: 0, headers: {}, body: '', writeHead(c) { this.statusCode = c; }, end(b) { this.body = b ?? ''; } };
  const req = { method, headers, body };
  return handler(req, res).then(() => ({ status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, res }));
}

const adsCalls = () => calls.filter((c) => c.url.includes('googleads'));

test('negative-keyword: envia a mutação com as operações validadas', async () => {
  const { status, json } = await call(negativeKeyword, { body: { campaignId: '77', text: 'grátis' } });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.totalOperations, 1);
  const [c] = adsCalls();
  assert.match(c.url, /customers\/1234567890\/campaignCriteria:mutate$/);
  assert.equal(JSON.parse(c.init.body).operations[0].create.campaign, 'customers/1234567890/campaigns/77');
});

test('negative-keyword: entrada inválida nunca chega ao Google', async () => {
  const { status } = await call(negativeKeyword, { body: { campaignId: '77' } });
  assert.equal(status, 400);
  assert.equal(adsCalls().length, 0);
});

test('keyword-status: recusa palavra de outra conta', async () => {
  const { status } = await call(keywordStatus, { body: { resourceName: 'customers/999/adGroupCriteria/1~2' } });
  assert.equal(status, 400);
  assert.equal(adsCalls().length, 0);
});

test('keyword-status: pausa a palavra-chave', async () => {
  const { status } = await call(keywordStatus, { body: { resourceName: 'customers/1234567890/adGroupCriteria/1~2' } });
  assert.equal(status, 200);
  assert.equal(JSON.parse(adsCalls()[0].init.body).operations[0].update.status, 'PAUSED');
});

test('escrita só aceita POST e nunca envia CORS aberto', async () => {
  const get = await call(negativeKeyword, { method: 'GET' });
  assert.equal(get.status, 405);
  assert.equal(get.res.headers['Access-Control-Allow-Origin'], undefined);
});

test('com PANEL_ACCESS_TOKEN, sem o código a chamada é recusada antes de tocar o Google', async () => {
  process.env.PANEL_ACCESS_TOKEN = 'abc';
  const body = { campaignId: '77', text: 'x' };
  assert.equal((await call(negativeKeyword, { body })).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await call(negativeKeyword, { body, headers: { authorization: 'Bearer abc' } })).status, 200);
});

test('na Vercel sem token, a escrita fica bloqueada', async () => {
  process.env.VERCEL = '1';
  const { status } = await call(negativeKeyword, { body: { campaignId: '77', text: 'x' } });
  assert.equal(status, 403);
  assert.equal(calls.length, 0);
});
