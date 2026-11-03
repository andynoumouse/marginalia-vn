// Serves the built online demo (scripts/build-online.mjs) as a static host would, in a subfolder like GitHub Pages'
// https://<user>.github.io/<repo>/. Nothing but files: what the editor needs from a server, the service worker does.
//   node scripts/serve-online.mjs [--dir build/online] [--base /marginalia-vn/]      (PORT=5180 by default)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; };
const dir = path.resolve(root, opt('--dir', 'build/online'));
const base = `/${opt('--base', '/marginalia-vn/').replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
const port = Number(process.env.PORT) || 5180;
if (!fs.existsSync(path.join(dir, 'index.html'))) { console.error(`${dir} has no index.html: run "npm run build:online" first.`); process.exit(1); }

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.css': 'text/css', '.map': 'application/json', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.vn': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === base.slice(0, -1)) { res.writeHead(301, { Location: base }); res.end(); return; }
  if (!url.pathname.startsWith(base)) { res.writeHead(404); res.end('Not found'); return; }
  let rel = decodeURIComponent(url.pathname.slice(base.length));
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const full = path.normalize(path.join(dir, rel));
  if (!full.startsWith(dir + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(full)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Online demo: http://localhost:${port}${base}`));
