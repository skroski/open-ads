// Testes do núcleo do /api/display-demographics (sem rede). Rodam com: npm run test:api
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperations, criteriaQuery, readCriteria, validateRequest } from './display-demographics.js';

const ok = { campaignId: '55', dimension: 'AGE', segment: 'AGE_RANGE_65_UP', change: 'exclude' };

test('validateRequest aceita um pedido válido e assume prévia', () => {
  assert.deepEqual(validateRequest(ok), { ...ok, step: 'preview' });
  assert.equal(validateRequest({ ...ok, step: 'apply' }).step, 'apply');
});

test('validateRequest recusa campanha, dimensão, perfil e mudança inválidos', () => {
  for (const bad of [{ campaignId: '' }, { dimension: 'COR' }, { segment: 'MALE' }, { change: 'delete' }, { step: 'agora' }]) {
    assert.throws(() => validateRequest({ ...ok, ...bad }), (e) => e.status === 400);
  }
});

test('criteriaQuery só aceita dígitos no id da campanha e filtra Display ativo', () => {
  const q = criteriaQuery('GENDER', "55' OR 1=1");
  assert.match(q, /FROM gender_view/);
  assert.match(q, /campaign\.id = 5511 AND/);
  assert.match(q, /advertising_channel_type = 'DISPLAY'/);
});

const g = 'customers/1/adGroups/10';
const crit = (segment, negative = false, adGroup = g) => ({
  adGroupId: adGroup.split('/').pop(),
  adGroup,
  resourceName: `customers/1/adGroupCriteria/${adGroup.split('/').pop()}~${segment}`,
  segment,
  negative,
});
const age = [crit('AGE_RANGE_18_24', true), crit('AGE_RANGE_25_34'), crit('AGE_RANGE_65_UP')];

test('readCriteria lê o tipo do campo certo e descarta linhas incompletas', () => {
  const rows = [
    { adGroup: { id: '10', resourceName: g }, adGroupCriterion: { resourceName: 'r1', negative: true, ageRange: { type: 'AGE_RANGE_18_24' } } },
    { adGroup: { id: '10', resourceName: g }, adGroupCriterion: { resourceName: 'r2', ageRange: { type: 'AGE_RANGE_25_34' } } },
    { adGroup: { id: '10', resourceName: g }, adGroupCriterion: { resourceName: 'r3' } },
  ];
  const out = readCriteria(rows, 'AGE');
  assert.deepEqual(out.map((c) => [c.segment, c.negative]), [['AGE_RANGE_18_24', true], ['AGE_RANGE_25_34', false]]);
});

test('excluir: remove o critério positivo e cria um negativo', () => {
  const { operations, adGroups } = buildOperations(ok, age);
  assert.equal(adGroups, 1);
  assert.deepEqual(operations, [
    { adGroupCriterionOperation: { remove: 'customers/1/adGroupCriteria/10~AGE_RANGE_65_UP' } },
    { adGroupCriterionOperation: { create: { adGroup: g, ageRange: { type: 'AGE_RANGE_65_UP' }, negative: true } } },
  ]);
});

test('reincluir: remove o negativo e cria um positivo', () => {
  const { operations } = buildOperations({ ...ok, segment: 'AGE_RANGE_18_24', change: 'include' }, age);
  assert.deepEqual(operations[1], { adGroupCriterionOperation: { create: { adGroup: g, ageRange: { type: 'AGE_RANGE_18_24' } } } });
  assert.equal(operations.length, 2);
});

test('já no estado pedido: nada a fazer', () => {
  const r = buildOperations({ ...ok, segment: 'AGE_RANGE_18_24' }, age);
  assert.deepEqual(r, { operations: [], adGroups: 0, unchanged: 1 });
});

test('sem critério para o perfil: só cria', () => {
  const r = buildOperations({ ...ok, segment: 'AGE_RANGE_55_64' }, age);
  assert.equal(r.operations.length, 1);
  assert.ok(r.operations[0].adGroupCriterionOperation.create);
});

test('nunca exclui o último perfil ativo da dimensão', () => {
  const only = [crit('AGE_RANGE_18_24', true), crit('AGE_RANGE_65_UP')];
  assert.throws(() => buildOperations(ok, only), (e) => e.status === 400 && /deixaria de entregar/.test(e.message));
});

test('vários grupos: cada um é tratado à parte', () => {
  const g2 = 'customers/1/adGroups/11';
  const both = [...age, crit('AGE_RANGE_25_34', false, g2), crit('AGE_RANGE_65_UP', true, g2)];
  const r = buildOperations(ok, both);
  assert.equal(r.adGroups, 1);
  assert.equal(r.unchanged, 1);
});
