// 세션 인증: HttpOnly 쿠키 + 서버 세션 테이블 (SECURITY.md 3-1)
import { createHmac, randomBytes } from 'node:crypto';
import { HttpError } from './http.js';

export const COOKIE = 'vl_sid';
const ABSOLUTE_HOURS = 8;
const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES || 30); // 기관 확인 필요

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET 환경변수(32자 이상)가 필요합니다.');
  return s;
}
const hashToken = (token) => createHmac('sha256', secret()).update(token).digest('hex');

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieAttrs(req) {
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') || process.env.NODE_ENV === 'production';
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export async function createSession(sql, req, res, userId) {
  const token = randomBytes(32).toString('base64url');
  await sql`
    insert into sessions (id, user_id, expires_at)
    values (${hashToken(token)}, ${userId}, now() + make_interval(hours => ${ABSOLUTE_HOURS}))`;
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieAttrs(req)}; Max-Age=${ABSOLUTE_HOURS * 3600}`);
}

export async function destroySession(sql, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await sql`delete from sessions where id = ${hashToken(token)}`;
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(req)}; Max-Age=0`);
}

/** 로그인 사용자 조회. 없거나 만료면 null */
export async function getSessionUser(sql, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const id = hashToken(token);
  const [row] = await sql`
    select u.id, u.login_id, u.name, u.team, u.roles, u.approver_step, u.can_drive,
           u.must_change_password, u.is_active, s.last_seen_at, s.expires_at
    from sessions s join users u on u.id = s.user_id
    where s.id = ${id}`;
  if (!row) return null;
  const idleLimit = Date.now() - IDLE_MINUTES * 60_000;
  if (!row.is_active || row.expires_at.getTime() < Date.now() || row.last_seen_at.getTime() < idleLimit) {
    await sql`delete from sessions where id = ${id}`;
    return null;
  }
  // 1분 이상 지났을 때만 갱신 (쓰기 줄이기)
  if (Date.now() - row.last_seen_at.getTime() > 60_000) {
    await sql`update sessions set last_seen_at = now() where id = ${id}`;
  }
  const { last_seen_at, expires_at, is_active, ...user } = row;
  return user;
}

export function requireUser(user) {
  if (!user) throw new HttpError(401, '로그인이 필요합니다.', { code: 'UNAUTHENTICATED' });
  return user;
}
export const hasRole = (user, ...roles) => !!user && roles.some((r) => user.roles.includes(r));
export function requireRole(user, ...roles) {
  requireUser(user);
  if (!hasRole(user, ...roles)) throw new HttpError(403, '이 작업을 할 권한이 없습니다.');
  return user;
}
