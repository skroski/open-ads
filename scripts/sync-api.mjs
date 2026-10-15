// Mantém web/api idêntica a api/.
// A Vercel pode usar a raiz do repositório OU a pasta web/ como diretório raiz do projeto,
// então as funções existem nos dois lugares. Edite sempre em api/ e rode: npm run sync:api
import { cp, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'api');
const to = path.join(root, 'web', 'api');

await rm(to, { recursive: true, force: true });
await cp(from, to, { recursive: true });
const files = await readdir(to, { recursive: true });
console.log(`web/api sincronizada com api/ (${files.length} itens).`);
