// API 통합 테스트 도우미: 테스트 전용 DB(TEST_DATABASE_URL) + 실제 핸들러를 띄운다.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';

export const TEST_DB = process.env.TEST_DATABASE_URL || '';
export const skip = !TEST_DB ? 'TEST_DATABASE_URL 이 없어 API 테스트를 건너뜁니다.' : false;

export async function startServer() {
  if (!/test/i.test(TEST_DB)) throw new Error('안전장치: TEST_DATABASE_URL 의 DB 이름에 "test"가 들어가야 합니다.');
  process.env.DATABASE_URL = TEST_DB;
  process.env.SESSION_SECRET ||= 'test-secret-0123456789abcdef0123456789';
  process.env.BCRYPT_COST = '4';
  const { getSql, closeSql } = await import('../../api/_lib/db.js');
  const { default: handler } = await import('../../api/index.js');
  const sql = getSql();
  // 테스트 DB 초기화 (테스트 전용 DB에서만 실행됨)
  await sql.unsafe('drop schema if exists public cascade; create schema public;');
  await sql.unsafe(await readFile(new URL('../../db/schema.sql', import.meta.url), 'utf8'));
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  return {
    sql, base,
    async close() { await new Promise((r) => server.close(r)); await closeSql(); },
  };
}

export async function seedUsers(sql) {
  const hash = await bcrypt.hash('Sample1234', 4);
  const rows = [
    ['staff01', '홍길동', ['staff'], null], ['staff02', '김가상', ['staff'], null],
    ['mgr01', '이담당', ['staff', 'manager'], null], ['apv01', '박팀장', ['staff', 'approver'], 1],
    ['apv02', '최관장', ['approver'], 2], ['admin01', '관리자', ['admin'], null],
  ];
  const ids = {};
  for (const [login, name, roles, step] of rows) {
    const [u] = await sql`insert into users (login_id, name, roles, approver_step, password_hash, must_change_password)
      values (${login}, ${name}, ${roles}, ${step}, ${hash}, false) returning id`;
    ids[login] = u.id;
  }
  await sql`insert into users (login_id, name, roles, password_hash, must_change_password, is_active)
    values ('old01', '정퇴사', '{staff}', ${hash}, false, false)`;
  return ids;
}

/** 쿠키를 유지하는 간단한 클라이언트 */
export function client(base) {
  let cookie = '';
  async function call(method, path, body, headers = {}) {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch { /* 빈 응답 */ }
    return { status: res.status, data };
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}, h) => call('POST', p, b, h),
    patch: (p, b = {}) => call('PATCH', p, b),
    async login(id, pw = 'Sample1234') { const r = await call('POST', '/auth/login', { login_id: id, password: pw }); return r; },
  };
}

export const typedSig = (name) => ({ type: 'typed', name, password: 'Sample1234' });
