// Testes do controle de acesso. Rodam com: npm run test:api
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAccess } from './access.js';

function withEnv(env, fn) {
  const before = { token: process.env.PANEL_ACCESS_TOKEN, vercel: process.env.VERCEL };
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    return fn();
  } finally {
    before.token === undefined ? delete process.env.PANEL_ACCESS_TOKEN : (process.env.PANEL_ACCESS_TOKEN = before.token);
    before.vercel === undefined ? delete process.env.VERCEL : (process.env.VERCEL = before.vercel);
  }
}

test('sem token e fora da Vercel, tudo segue aberto (painel local)', () => {
  withEnv({ PANEL_ACCESS_TOKEN: undefined, VERCEL: undefined }, () => {
    assert.equal(checkAccess({}), null);
    assert.equal(checkAccess({}, { write: true }), null);
  });
});

test('na Vercel sem token, leitura segue e escrita é bloqueada', () => {
  withEnv({ PANEL_ACCESS_TOKEN: undefined, VERCEL: '1' }, () => {
    assert.equal(checkAccess({}), null);
    assert.equal(checkAccess({}, { write: true })?.status, 403);
  });
});

test('com token, exige Bearer correto em leitura e escrita', () => {
  withEnv({ PANEL_ACCESS_TOKEN: 'segredo-123', VERCEL: '1' }, () => {
    assert.equal(checkAccess({})?.status, 401);
    assert.equal(checkAccess({ authorization: 'Bearer errado' })?.status, 401);
    assert.equal(checkAccess({ authorization: 'segredo-123' })?.status, 401);
    assert.equal(checkAccess({ authorization: 'Bearer segredo-123' }), null);
    assert.equal(checkAccess({ authorization: 'bearer segredo-123' }, { write: true }), null);
    assert.equal(checkAccess({ authorization: 'Bearer segredo-12' }, { write: true })?.status, 401);
  });
});
