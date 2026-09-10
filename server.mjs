import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

// Servidor estatico minimo: serve a raiz do projeto para que web/app.js possa
// importar o motor em src/ como modulo ES, sem build e sem dependencia.

const RAIZ = process.cwd();
const PORTA = Number(process.env.PORTA ?? 5173);
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // Redireciona em vez de servir na raiz: senao os imports relativos de
    // web/app.js resolveriam para /app.js e dariam 404.
    if (url === '/' || url === '/web' || url === '/web/') {
      res.writeHead(302, { Location: '/web/index.html' }).end();
      return;
    }
    const rel = url.slice(1);
    const caminho = normalize(join(RAIZ, rel));
    if (!caminho.startsWith(RAIZ + sep)) {
      res.writeHead(403).end('fora da raiz');
      return;
    }
    const corpo = await readFile(caminho);
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(caminho)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(corpo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('nao encontrado');
  }
}).listen(PORTA, () => console.log(`Vila da Familia em http://localhost:${PORTA}`));
