// Mantém web/api idêntica a api/.
// A Vercel pode usar a raiz do repositório OU a pasta web/ como diretório raiz do projeto,
// então as funções existem nos dois lugares. Edite sempre em api/ e rode: npm run sync:api
// Com --check, só confere (sem escrever) e sai com erro se as pastas divergirem. Usado no CI.
import { cp, rm, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'api');
const to = path.join(root, 'web', 'api');

async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();
}

if (process.argv.includes('--check')) {
  const [a, b] = await Promise.all([listFiles(from), listFiles(to)]);
  const problems = [];
  for (const f of new Set([...a, ...b])) {
    if (!a.includes(f)) problems.push(`só em web/api: ${f}`);
    else if (!b.includes(f)) problems.push(`falta em web/api: ${f}`);
    else if (!(await readFile(path.join(from, f))).equals(await readFile(path.join(to, f)))) problems.push(`diferente: ${f}`);
  }
  if (problems.length) {
    console.error(`web/api está fora de sincronia com api/:\n  ${problems.join('\n  ')}\nRode: npm run sync:api`);
    process.exit(1);
  }
  console.log(`web/api igual a api/ (${a.length} arquivos).`);
} else {
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
  console.log(`web/api sincronizada com api/ (${(await listFiles(to)).length} arquivos).`);
}
