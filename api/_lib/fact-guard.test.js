// Testes da guarda numérica. Rodam com: npm run test:api
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FACTS, allowedNumbers, normalizeFacts, numbersAreGrounded, numbersIn, validEvidence } from './fact-guard.js';

const facts = normalizeFacts([
  { id: 'c1', text: 'Campanha "Tênis de corrida" gastou R$ 1.200,50 e teve 18 conversões.' },
  { id: 'a1', text: 'Título do anúncio: Loja 24 horas em Curitiba' },
]);

test('normalizeFacts exige lista, ids simples e únicos, e limita a quantidade', () => {
  assert.throws(() => normalizeFacts([]), (e) => e.status === 400);
  assert.throws(() => normalizeFacts([{ id: 'x y', text: 't' }]), (e) => e.status === 400);
  assert.throws(() => normalizeFacts([{ id: 'a', text: 't' }, { id: 'a', text: 'u' }]), (e) => e.status === 400);
  assert.throws(() => normalizeFacts([{ id: 'a', text: '  ' }]), (e) => e.status === 400);
  assert.throws(() => normalizeFacts(Array.from({ length: MAX_FACTS + 1 }, (_, i) => ({ id: `f${i}`, text: 't' }))), (e) => e.status === 413);
});

test('numbersIn normaliza separadores e ignora pontuação final', () => {
  assert.deepEqual([...numbersIn('R$ 1.200,50 e 18 itens. Total: 24.')].sort(), ['120050', '18', '24']);
  assert.deepEqual([...numbersIn('sem números')], []);
});

test('a IA só pode citar números da ficha de fatos', () => {
  const allowed = allowedNumbers(facts);
  assert.equal(numbersAreGrounded('Atende 24 horas e converteu 18 vezes.', allowed), true);
  assert.equal(numbersAreGrounded('Atende desde 1998.', allowed), false);
  assert.equal(numbersAreGrounded('Custa R$ 45.', allowed), false);
  assert.equal(numbersAreGrounded('Texto sem números.', allowed), true);
});

test('validEvidence recusa ids inventados ou ausentes', () => {
  assert.deepEqual(validEvidence(['c1', 'a1', 'c1'], facts), ['c1', 'a1']);
  assert.equal(validEvidence(['c1', 'zzz'], facts), null);
  assert.equal(validEvidence([], facts), null);
  assert.equal(validEvidence('c1', facts), null);
  assert.deepEqual(validEvidence([], facts, 0), []);
});
