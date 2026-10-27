// Servidor interno leve para o Electron Desktop:
// - Serve os arquivos estáticos do painel (web/dist/web/browser)
// - Faz proxy de /api/* diretamente para o servidor da API (porta 3000)
// - Garante fallback para index.html (SPA routing do Angular/React)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.webp': 'image/webp',
};

export async function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, host);
  });
}

export function createStaticProxyServer({ staticDir, apiPort = 3000, port = 4200 }) {
  let serverInstance = null;

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // 1. Rota de API: repassa para o servidor Node.js
    if (pathname.startsWith('/api/') || pathname === '/api') {
      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
          port: apiPort,
          path: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            host: `127.0.0.1:${apiPort}`,
          },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res, { end: true });
        }
      );

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: `Servidor da API não respondeu na porta ${apiPort}: ${err.message}` }));
        }
      });

      req.pipe(proxyReq, { end: true });
      return;
    }

    // 2. Arquivos estáticos
    let safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/' || safePath === '') safePath = '/index.html';

    let filePath = path.join(staticDir, safePath);

    // Se o caminho aponta para um diretório, busca index.html dentro
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    // Se o arquivo existe fisicamente
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // 3. Fallback SPA: se for requisição HTML ou rota interna do painel
    const indexHtml = path.join(staticDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexHtml).pipe(res);
      return;
    }

    // 4. Não encontrado
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Arquivo não encontrado no build do OpenAds. Verifique se npm run build foi executado.');
  });

  return {
    async start(targetPort = port) {
      let chosenPort = targetPort;
      const free = await isPortAvailable(chosenPort);
      if (!free) {
        // Se 4200 estiver ocupada, tenta 4202 ou porta dinâmica
        for (let p = 4201; p <= 4220; p++) {
          if (await isPortAvailable(p)) {
            chosenPort = p;
            break;
          }
        }
      }

      return new Promise((resolve, reject) => {
        server.once('error', reject);
        serverInstance = server.listen(chosenPort, '127.0.0.1', () => {
          resolve({ port: chosenPort, url: `http://127.0.0.1:${chosenPort}` });
        });
      });
    },
    stop() {
      if (serverInstance) {
        serverInstance.close();
        serverInstance = null;
      }
    },
  };
}
