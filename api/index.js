// Vercel Serverless Function — 모든 /api/* 요청을 하나의 함수에서 처리한다.
// (vercel.json 의 rewrite: /api/(.*) → /api?path=$1)
import { getSql } from './_lib/db.js';
import { HttpError, readJson, send } from './_lib/http.js';
import { getSessionUser } from './_lib/session.js';
import { routes as auth } from './_lib/routes/auth.js';
import { routes as vehicles } from './_lib/routes/vehicles.js';
import { routes as users } from './_lib/routes/users.js';
import { routes as reservations } from './_lib/routes/reservations.js';
import { routes as usageLogs } from './_lib/routes/usage-logs.js';
import { routes as ledgers } from './_lib/routes/ledgers.js';
import { routes as dashboard } from './_lib/routes/dashboard.js';

const table = [...auth, ...vehicles, ...users, ...reservations, ...usageLogs, ...ledgers, ...dashboard].map(
  ([method, pattern, handler, opts = {}]) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; })}$`);
    return { method, re, keys, handler, opts };
  },
);

function match(method, path) {
  let pathMatched = false;
  for (const r of table) {
    const m = r.re.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, Number(m[i + 1])]));
    return { route: r, params };
  }
  return { pathMatched };
}

/** CSRF 방어: 상태 변경 요청은 같은 출처에서만 허용 (SECURITY.md 4장) */
function checkOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin) {
    let originHost;
    try { originHost = new URL(origin).host; } catch { originHost = ''; }
    if (originHost !== host) throw new HttpError(403, '허용되지 않은 요청입니다.');
  } else if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
    throw new HttpError(403, '허용되지 않은 요청입니다.');
  }
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('application/json')) throw new HttpError(415, '요청 형식이 올바르지 않습니다.');
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = url.searchParams.get('path');
    if (path === null) path = url.pathname.replace(/^\/api\/?/, '');
    path = `/${path.replace(/^\/+|\/+$/g, '')}`;
    url.searchParams.delete('path');

    const { route, params, pathMatched } = match(req.method, path);
    if (!route) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? '허용되지 않은 방식입니다.' : '요청한 기능을 찾을 수 없습니다.');
    checkOrigin(req);

    const sql = getSql();
    const user = await getSessionUser(sql, req);
    if (!route.opts.public) {
      if (!user) throw new HttpError(401, '로그인이 필요합니다.', { code: 'UNAUTHENTICATED' });
      if (user.must_change_password && !route.opts.allowPasswordChange) {
        throw new HttpError(403, '처음 로그인했거나 비밀번호가 초기화되었습니다. 비밀번호를 먼저 변경해 주세요.', { code: 'PASSWORD_CHANGE_REQUIRED' });
      }
    }
    let bodyCache;
    const ctx = { req, res, sql, user, params, query: url.searchParams, body: async () => (bodyCache ??= await readJson(req)) };
    const data = await route.handler(ctx);
    send(res, 200, data);
  } catch (err) {
    if (err instanceof HttpError) {
      send(res, err.status, { error: { message: err.message, ...err.extra } });
    } else {
      console.error('[api] unexpected error', err);
      send(res, 500, { error: { message: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' } });
    }
  }
}
