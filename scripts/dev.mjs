// Sobe a API (porta 3000) e o painel (porta 4200) juntos. Ctrl+C encerra os dois.
// Uso: npm start           (painel Angular, versão Oficial)
//      npm run start:react (painel React com Vite, em web-react/)

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(path.join(root, 'server', '.env'))) {
  console.error('Ainda não há server/.env. Rode primeiro: npm run setup');
  process.exit(1);
}
const react = process.argv.includes('react');
const webDir = react ? 'web-react' : 'web';
if (!existsSync(path.join(root, webDir, 'node_modules'))) {
  console.error(
    react
      ? 'Dependências do painel React não instaladas. Rode primeiro: npm run install:react'
      : 'Dependências do painel não instaladas. Rode primeiro: npm run install:all',
  );
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  ['api', process.execPath, ['--env-file=server/.env', 'server/index.mjs']],
  ['web', npm, ['--prefix', webDir, react ? 'run' : 'start', ...(react ? ['dev'] : [])], { shell: process.platform === 'win32' }],
].map(([name, cmd, args, opts]) => {
  const p = spawn(cmd, args, { cwd: root, env: process.env, ...opts });
  const prefix = (chunk) =>
    String(chunk)
      .split('\n')
      .filter(Boolean)
      .map((l) => `[${name}] ${l}`)
      .join('\n');
  p.stdout.on('data', (c) => console.log(prefix(c)));
  p.stderr.on('data', (c) => console.error(prefix(c)));
  p.on('exit', (code) => {
    console.log(`[${name}] encerrado (${code ?? 'sinal'}).`);
    shutdown();
  });
  return p;
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  procs.forEach((p) => p.exitCode === null && p.kill());
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log('Abrindo… quando aparecer "Local: http://localhost:4200", é só acessar no navegador.');
