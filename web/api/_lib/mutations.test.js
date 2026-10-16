// Testes das validações das rotas que escrevem no Google Ads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKeywordOperation, buildNegativeOperations, MAX_NEGATIVE_OPERATIONS } from './mutations.js';

const status = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.status;
  }
  return null;
};

test('negativas: monta uma operação por campanha × palavra, sem duplicadas', () => {
  const ops = buildNegativeOperations({
    customerId: '123-456-7890',
    campaignIds: ['11', '22', '11'],
    keywords: ['grátis', ' [Grátis] ', { text: 'curso', matchType: 'phrase' }],
    matchType: 'exact',
  });
  assert.equal(ops.length, 4);
  assert.deepEqual(ops[0].create, {
    campaign: 'customers/1234567890/campaigns/11',
    negative: true,
    keyword: { text: 'grátis', matchType: 'EXACT' },
  });
  assert.equal(ops[1].create.keyword.matchType, 'PHRASE');
});

test('negativas: aceita campaignId e text no formato antigo', () => {
  const ops = buildNegativeOperations({ customerId: '1', campaignId: '9', text: 'barato' });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].create.keyword.matchType, 'EXACT');
});

test('negativas: recusa entradas inválidas', () => {
  const base = { customerId: '1', campaignId: '9', text: 'x' };
  assert.equal(status(() => buildNegativeOperations({ ...base, customerId: '' })), 400);
  assert.equal(status(() => buildNegativeOperations({ ...base, campaignId: undefined })), 400);
  assert.equal(status(() => buildNegativeOperations({ ...base, text: '   ' })), 400);
  assert.equal(status(() => buildNegativeOperations({ ...base, matchType: 'LOUCO' })), 400);
  assert.equal(status(() => buildNegativeOperations({ ...base, text: 'a'.repeat(81) })), 400);
});

test('negativas: respeita o teto de operações por chamada', () => {
  const keywords = Array.from({ length: MAX_NEGATIVE_OPERATIONS + 1 }, (_, i) => `termo ${i}`);
  assert.equal(status(() => buildNegativeOperations({ customerId: '1', campaignId: '9', keywords })), 400);
  assert.equal(buildNegativeOperations({ customerId: '1', campaignId: '9', keywords: keywords.slice(0, MAX_NEGATIVE_OPERATIONS) }).length, MAX_NEGATIVE_OPERATIONS);
});

const RN = 'customers/1234567890/adGroupCriteria/555~777';

test('palavra-chave: pausa por padrão e aceita ENABLED', () => {
  const base = { customerId: '1234567890', resourceName: RN };
  assert.deepEqual(buildKeywordOperation(base), { updateMask: 'status', update: { resourceName: RN, status: 'PAUSED' } });
  assert.equal(buildKeywordOperation({ ...base, status: 'ENABLED' }).update.status, 'ENABLED');
  assert.equal(status(() => buildKeywordOperation({ ...base, status: 'REMOVED' })), 400);
});

test('palavra-chave: remoção e lance', () => {
  const base = { customerId: '1234567890', resourceName: RN };
  assert.deepEqual(buildKeywordOperation({ ...base, action: 'REMOVE' }), { remove: RN });
  assert.equal(buildKeywordOperation({ ...base, cpcBidBrl: 1.25 }).update.cpcBidMicros, 1_250_000);
  assert.equal(buildKeywordOperation({ ...base, cpcBidMicros: 2_000_000 }).update.cpcBidMicros, 2_000_000);
  assert.equal(status(() => buildKeywordOperation({ ...base, cpcBidBrl: 0 })), 400);
  assert.equal(status(() => buildKeywordOperation({ ...base, cpcBidBrl: 'abc' })), 400);
  assert.equal(status(() => buildKeywordOperation({ ...base, cpcBidBrl: 5000 })), 400);
});

test('palavra-chave: resourceName precisa ser da conta informada', () => {
  assert.equal(status(() => buildKeywordOperation({ customerId: '1234567890', resourceName: 'customers/1234567890/campaigns/1' })), 400);
  assert.equal(status(() => buildKeywordOperation({ customerId: '999', resourceName: RN })), 400);
  assert.equal(status(() => buildKeywordOperation({ customerId: '1234567890' })), 400);
});
