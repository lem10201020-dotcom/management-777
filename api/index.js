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
import { routes as approvalLine } from './_lib/routes/approval-line.js';

const table = [...auth, ...vehicles, ...users, ...reservations, ...usageLogs, ...ledgers, ...dashboard, ...approvalLine].map(
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

    // 배포 상태 점검: /api/health (로그인 불필요, 개인정보 없음)
    if (path === '/health' && req.method === 'GET') {
      const checks = { database_url: !!process.env.DATABASE_URL, session_secret: (process.env.SESSION_SECRET || '').length >= 32, db: 'unchecked' };
      if (checks.database_url) {
        try { await getSql()`select 1 from users limit 1`; checks.db = 'ok'; } catch (e) { checks.db = classifySetupError(e)?.code || 'error'; }
      }
      send(res, 200, { ok: checks.database_url && checks.session_secret && checks.db === 'ok', checks });
      return;
    }

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
      return;
    }
    const setup = classifySetupError(err);
    if (setup) {
      console.error('[api] setup error', setup.code, err.message);
      send(res, 503, { error: setup });
      return;
    }
    console.error('[api] unexpected error', err);
    send(res, 500, { error: { message: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' } });
  }
}

/** 배포 설정 문제를 구분해 관리자가 고칠 수 있게 안내한다 (README 5장) */
function classifySetupError(err) {
  const msg = String(err?.message || '');
  if (msg.includes('DATABASE_URL')) {
    return { code: 'DB_NOT_CONFIGURED', message: 'DB 연결 정보(DATABASE_URL)가 설정되지 않았습니다. Vercel → Settings → Environment Variables에 Supabase 접속 주소를 등록한 뒤 다시 배포하세요.' };
  }
  if (msg.includes('SESSION_SECRET')) {
    return { code: 'SERVER_NOT_CONFIGURED', message: '세션 비밀키(SESSION_SECRET, 32자 이상)가 설정되지 않았습니다. Vercel 환경변수에 등록한 뒤 다시 배포하세요.' };
  }
  if (err?.code === '42P01') {
    return { code: 'DB_NOT_INITIALIZED', message: 'DB에 테이블이 아직 없습니다. Supabase SQL Editor에서 db/schema.sql 을 실행하거나 npm run db:setup 을 실행하세요.' };
  }
  if (err?.code === '42703') {
    return { code: 'DB_NEEDS_MIGRATION', message: 'DB 구조가 최신이 아닙니다. Supabase SQL Editor에서 db/migrations 의 새 파일(또는 db/schema.sql 전체)을 실행하거나 npm run db:setup 을 실행하세요.' };
  }
  if (['28P01', '28000'].includes(err?.code)) {
    return { code: 'DB_AUTH_FAILED', message: 'DB 비밀번호 또는 사용자 이름이 맞지 않습니다. DATABASE_URL 을 다시 확인하세요.' };
  }
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'CONNECT_TIMEOUT', 'EAI_AGAIN', '3D000', 'XX000'].includes(err?.code) || /connect|timeout|Tenant or user not found/i.test(msg)) {
    return { code: 'DB_CONNECTION_FAILED', message: 'DB 서버에 접속하지 못했습니다. DATABASE_URL 주소(Transaction pooler, 포트 6543)와 Supabase 프로젝트 상태를 확인하세요.' };
  }
  return null;
}
