// Lê e grava server/.env preservando comentários e a ordem das linhas.
// Os valores nunca são impressos: só os nomes das variáveis.

import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENV_PATH = process.env.ENV_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');

export async function readEnv(file = ENV_PATH) {
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch {
    /* ainda não existe */
  }
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (m) values[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { text, values };
}

/** Atualiza (ou acrescenta) as variáveis dadas; `undefined` mantém o valor atual. */
export async function updateEnv(patch, file = ENV_PATH) {
  const { text } = await readEnv(file);
  const lines = text ? text.split(/\r?\n/) : ['# Gerado por npm run setup. Nunca compartilhe este arquivo nem cole os valores em chats.', ''];
  const pending = new Map(Object.entries(patch).filter(([, v]) => v !== undefined));
  const out = lines.map((line) => {
    const m = line.match(/^\s*#?\s*([A-Z0-9_]+)\s*=/);
    if (m && pending.has(m[1])) {
      const v = pending.get(m[1]);
      pending.delete(m[1]);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  for (const [k, v] of pending) out.push(`${k}=${v}`);
  await writeFile(file, `${out.join('\n')}\n`, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
}
