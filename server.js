// Продакшен-сервер: раздаёт собранную папку dist (Railway, любой Node-хостинг)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST = path.resolve('dist');
const PORT = process.env.PORT || 8080;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(DIST, url);
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const ext = path.extname(file);
  const type = MIME[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' };
  const raw = fs.createReadStream(file);
  if (/gzip/.test(req.headers['accept-encoding'] || '') && /^(text|application)/.test(type)) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    raw.pipe(zlib.createGzip()).pipe(res);
  } else {
    res.writeHead(200, headers);
    raw.pipe(res);
  }
}).listen(PORT, '0.0.0.0', () => console.log(`Белка‑летяга: http://0.0.0.0:${PORT}`));
