// 로컬 개발 서버: 정적 파일 + /api (Vercel 없이 실행). 운영 배포에는 사용하지 않는다.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
for (const f of ['.env.local', '.env']) if (existsSync(join(root, f))) process.loadEnvFile(join(root, f));
const { default: api } = await import('../api/index.js');
const vercel = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
const securityHeaders = vercel.headers.find((h) => h.source === '/(.*)').headers;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};
const PUBLIC = ['/index.html', '/css/', '/js/', '/assets/', '/favicon.svg'];

const server = http.createServer(async (req, res) => {
  for (const { key, value } of securityHeaders) res.setHeader(key, value);
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return api(req, res);
  let p = normalize(decodeURIComponent(url.pathname));
  if (p === '/') p = '/index.html';
  if (!PUBLIC.some((x) => p === x || p.startsWith(x))) { res.statusCode = 404; return res.end('Not found'); }
  const file = join(root, p);
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`차량예약관리대장 개발 서버: http://localhost:${port}`));
