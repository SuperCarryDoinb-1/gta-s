import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(workspace, 'scratchpad', 'polish-build');
if (!fs.existsSync(path.join(build, 'index.html'))) {
  console.error('Build missing: scratchpad/polish-build/index.html'); process.exit(1);
}
const root = fs.realpathSync(build);
// Automated review may use an isolated port; the user launcher stays on 5175.
const port = Number(process.env.SHANGHAI_GAME_PORT ?? 5175);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid SHANGHAI_GAME_PORT');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.wasm':'application/wasm', '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.webp':'image/webp', '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.wav':'audio/wav', '.ttf':'font/ttf', '.woff2':'font/woff2' };
const inside = target => target === root || target.startsWith(root + path.sep);
const server = http.createServer((req, res) => {
  res.setHeader('X-Shanghai-Game', 'production');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  let requested;
  try { requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end(); return; }
  const candidate = path.resolve(root, '.' + (requested === '/' ? '/index.html' : requested));
  if (!inside(candidate)) { res.writeHead(403); res.end(); return; }
  fs.realpath(candidate, (error, target) => {
    if (error) { res.writeHead(404); res.end(); return; }
    if (!inside(target)) { res.writeHead(403); res.end(); return; }
    fs.stat(target, (error, stat) => {
      if (error || !stat.isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Content-Length': stat.size,
        'Cache-Control': requested.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = fs.createReadStream(target); stream.on('error', () => res.destroy()); stream.pipe(res);
    });
  });
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Close the other game server first; the port will not change because saves are tied to it.` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Shanghai game: http://127.0.0.1:${port}/ (production, local only)`));
