import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
/** TypeScript puro compartilhado com o painel Angular (Oficial): nada é copiado. */
const shared = path.join(repo, 'web/src/app');

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': shared } },
  // Mesmos ativos públicos do Angular (logos, favicon, áudios de ajuda).
  publicDir: path.join(repo, 'web/public'),
  server: {
    port: 4200,
    strictPort: true,
    fs: { allow: [repo] },
    // Igual ao web/proxy.conf.json. A API só escuta em 127.0.0.1.
    proxy: { '/api': { target: 'http://127.0.0.1:3000', secure: false } },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Os testes do domínio são os mesmos do Angular: rodam nas duas versões.
    include: ['src/**/*.spec.{ts,tsx}', '../web/src/app/domain/**/*.spec.ts'],
  },
});
