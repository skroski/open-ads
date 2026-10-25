// Guarda numérica: a IA recebe uma "ficha de fatos" e só pode escrever o que ela sustenta.
// Aqui ficam as verificações que rodam no servidor antes de qualquer texto da IA chegar ao painel.
// Sem SDK e sem rede, então é testável sozinho.

import { HttpError } from './http.js';

export const MAX_FACTS = 60;
export const MAX_FACT_CHARS = 300;

const clip = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Valida a ficha de fatos enviada pelo painel: lista de { id, text } com ids únicos. */
export function normalizeFacts(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, 'Envie os fatos no campo "facts".');
  if (raw.length > MAX_FACTS) throw new HttpError(413, `Máximo de ${MAX_FACTS} fatos por vez.`);
  const seen = new Set();
  return raw.map((f) => {
    const id = clip(f?.id, 40);
    if (!/^[\w:.-]+$/.test(id)) throw new HttpError(400, 'Todo fato precisa de um "id" simples (letras, números, - _ : .).');
    if (seen.has(id)) throw new HttpError(400, `Fato repetido: ${id}.`);
    seen.add(id);
    const text = clip(f.text, MAX_FACT_CHARS);
    if (!text) throw new HttpError(400, `O fato ${id} está vazio.`);
    return { id, text };
  });
}

/**
 * Números de um texto, normalizados para só dígitos ("1.200,50" e "120050" são o mesmo).
 * A comparação é propositalmente estrita: se a IA reescrever "R$ 45,00" como "R$ 45", o número é recusado.
 */
export function numbersIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/\d[\d.,]*/g)) {
    const digits = m[0].replace(/[.,]+$/, '').replace(/[.,]/g, '');
    if (digits) out.add(digits);
  }
  return out;
}

/** Todos os números que a IA tem permissão de citar. */
export function allowedNumbers(facts) {
  const out = new Set();
  for (const f of facts) for (const n of numbersIn(`${f.id} ${f.text}`)) out.add(n);
  return out;
}

/** O texto só cita números que existem na ficha de fatos. */
export function numbersAreGrounded(text, allowed) {
  for (const n of numbersIn(text)) if (!allowed.has(n)) return false;
  return true;
}

/** Evidências válidas: ao menos `min` ids, todos presentes na ficha. Devolve a lista limpa ou null. */
export function validEvidence(ids, facts, min = 1) {
  if (!Array.isArray(ids)) return null;
  const known = new Set(facts.map((f) => f.id));
  const clean = [...new Set(ids.map((i) => clip(i, 40)))];
  if (clean.length < min || clean.some((i) => !known.has(i))) return null;
  return clean;
}
