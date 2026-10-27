// Testes das operações de público do Display (sem rede). Rodam com: npm run test:api
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceMutateOperations, buildCustomAudienceOperation, mergeAudienceRestriction, validateAudienceRequest } from './display-audience.js';

const base = { customerId: '260-390-2377', campaignId: '55', name: ' Meu público ', keywords: ['Software X', 'software x', '"gestão"'], urls: ['https://exemplo.com.br/blog/', 'outro.com'], mode: 'restrict' };
const groups = [{ resourceName: 'customers/2603902377/adGroups/9', restrictions: [{ targetingDimension: 'TOPIC', bidOnly: true }] }];
const audienceName = 'customers/2603902377/customAudiences/123';

test('validateAudienceRequest normaliza e remove repetidos', () => {
  const v = validateAudienceRequest(base);
  assert.equal(v.customerId, '2603902377');
  assert.equal(v.name, 'Meu público');
  assert.deepEqual(v.keywords, ['Software X', 'gestão']);
  assert.deepEqual(v.urls, ['exemplo.com.br/blog/', 'outro.com']);
  assert.equal(v.mode, 'RESTRICT');
});

test('validateAudienceRequest recusa dados incompletos ou inseguros', () => {
  assert.throws(() => validateAudienceRequest({ ...base, customerId: '123' }), (e) => e.status === 400);
  assert.throws(() => validateAudienceRequest({ ...base, campaignId: '' }), (e) => e.status === 400);
  assert.throws(() => validateAudienceRequest({ ...base, name: '  ' }), (e) => e.status === 400);
  assert.throws(() => validateAudienceRequest({ ...base, keywords: [], urls: [] }), (e) => e.status === 400);
  assert.throws(() => validateAudienceRequest({ ...base, mode: 'TUDO' }), (e) => e.status === 400);
  assert.throws(() => validateAudienceRequest({ ...base, urls: ['sem ponto'] }), (e) => e.status === 400);
  assert.throws(() => validateAudienceRequest({ ...base, keywords: Array.from({ length: 51 }, (_, i) => `k${i}`) }), (e) => e.status === 400);
});

test('mergeAudienceRestriction preserva outras dimensões e troca só o público', () => {
  const merged = mergeAudienceRestriction([{ targetingDimension: 'TOPIC', bidOnly: true }, { targetingDimension: 'AUDIENCE', bidOnly: true }], 'RESTRICT');
  assert.deepEqual(merged, [{ targetingDimension: 'TOPIC', bidOnly: true }, { targetingDimension: 'AUDIENCE', bidOnly: false }]);
});

test('buildCustomAudienceOperation monta o público sem nome de recurso (o Google o atribui)', () => {
  const { create } = buildCustomAudienceOperation(base);
  assert.equal(create.name, 'Meu público');
  assert.equal(create.type, 'AUTO');
  assert.equal('resourceName' in create, false);
  assert.equal(create.members.length, 4);
  assert.deepEqual(create.members[0], { memberType: 'KEYWORD', keyword: 'Software X' });
  assert.deepEqual(create.members.at(-1), { memberType: 'URL', url: 'outro.com' });
});

test('buildAudienceMutateOperations liga o público a cada grupo e desliga a segmentação otimizada', () => {
  const ops = buildAudienceMutateOperations(base, groups, audienceName);
  assert.equal(ops.length, 2);
  assert.equal(ops[0].adGroupCriterionOperation.create.customAudience.customAudience, audienceName);
  const upd = ops[1].adGroupOperation;
  assert.match(upd.updateMask, /optimized_targeting_enabled/);
  assert.equal(upd.update.optimizedTargetingEnabled, false);
  assert.deepEqual(upd.update.targetingSetting.targetRestrictions.at(-1), { targetingDimension: 'AUDIENCE', bidOnly: false });
});

test('sem nome do público (validação) só vêm os ajustes dos grupos', () => {
  const ops = buildAudienceMutateOperations(base, groups);
  assert.equal(ops.length, 1);
  assert.ok(ops[0].adGroupOperation);
});

test('modo OBSERVE só observa e não mexe na segmentação otimizada', () => {
  const upd = buildAudienceMutateOperations({ ...base, mode: 'OBSERVE' }, groups, audienceName).at(-1).adGroupOperation;
  assert.equal(upd.updateMask, 'targeting_setting.target_restrictions');
  assert.equal('optimizedTargetingEnabled' in upd.update, false);
  assert.equal(upd.update.targetingSetting.targetRestrictions.at(-1).bidOnly, true);
});

test('recusa grupo de outra conta e campanha sem grupos', () => {
  assert.throws(() => buildAudienceMutateOperations(base, [{ resourceName: 'customers/1111111111/adGroups/9' }]), (e) => e.status === 400);
  assert.throws(() => buildAudienceMutateOperations(base, []), (e) => e.status === 400);
});

test('modo EXISTING só desliga a expansão e fixa os públicos já existentes, sem criar público', () => {
  const ops = buildAudienceMutateOperations({ customerId: '2603902377', campaignId: '55', mode: 'existing' }, groups, audienceName);
  assert.equal(ops.length, 1);
  const upd = ops[0].adGroupOperation;
  assert.equal(upd.update.optimizedTargetingEnabled, false);
  assert.deepEqual(upd.update.targetingSetting.targetRestrictions.at(-1), { targetingDimension: 'AUDIENCE', bidOnly: false });
});
