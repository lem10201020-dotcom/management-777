// F-01 로그인·권한
import bcrypt from 'bcryptjs';
import { validateLogin, passwordError, hasErrors } from '../../../js/utils/validate.js';
import { HttpError, badRequest } from '../http.js';
import { createSession, destroySession, requireUser } from '../session.js';
import { audit } from '../audit.js';
import { getSettings } from '../settings.js';

export const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);
const MAX_FAILS = 5;
const LOCK_MINUTES = 10;
let dummyHash;

const publicUser = (u) => ({
  id: u.id, login_id: u.login_id, name: u.name, team: u.team, roles: u.roles,
  approver_step: u.approver_step, can_drive: u.can_drive, must_change_password: u.must_change_password,
});

async function login({ sql, req, res, body }) {
  const { value, errors } = validateLogin(await body());
  if (hasErrors(errors)) throw badRequest('입력값을 확인해 주세요.', errors);
  const invalid = new HttpError(401, '아이디 또는 비밀번호가 맞지 않습니다.', { code: 'INVALID_CREDENTIALS' });
  const [u] = await sql`select * from users where login_id = ${value.login_id}`;
  if (!u) {
    dummyHash ??= bcrypt.hashSync('dummy-password-0', BCRYPT_COST);
    await bcrypt.compare(value.password, dummyHash); // 응답 시간 균일화
    await audit(sql, null, 'login_failed', 'user', null, { login_id: value.login_id });
    throw invalid;
  }
  if (u.locked_until && u.locked_until.getTime() > Date.now()) {
    const min = Math.ceil((u.locked_until.getTime() - Date.now()) / 60000);
    throw new HttpError(423, `로그인을 여러 번 실패해 잠시 잠겼습니다. ${min}분 후 다시 시도해 주세요.`, { code: 'LOCKED' });
  }
  const ok = await bcrypt.compare(value.password, u.password_hash);
  if (!ok) {
    const fails = u.failed_attempts + 1;
    const lock = fails >= MAX_FAILS;
    await sql`
      update users set failed_attempts = ${lock ? 0 : fails},
        locked_until = ${lock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null}
      where id = ${u.id}`;
    await audit(sql, u.id, 'login_failed', 'user', u.id, { lock });
    if (lock) throw new HttpError(423, `로그인을 ${MAX_FAILS}회 실패해 ${LOCK_MINUTES}분 동안 잠겼습니다.`, { code: 'LOCKED' });
    throw invalid;
  }
  if (!u.is_active) throw new HttpError(403, '사용이 중지된 계정입니다. 관리자에게 문의하세요.', { code: 'INACTIVE' });
  await sql`update users set failed_attempts = 0, locked_until = null where id = ${u.id}`;
  await createSession(sql, req, res, u.id);
  await audit(sql, u.id, 'login', 'user', u.id);
  return { user: publicUser(u), settings: await getSettings(sql) };
}

async function logout({ sql, req, res, user }) {
  await destroySession(sql, req, res);
  if (user) await audit(sql, user.id, 'logout', 'user', user.id);
  return { ok: true };
}

async function me({ sql, user }) {
  if (!user) return { user: null };
  return { user: publicUser(user), settings: await getSettings(sql) };
}

async function changePassword({ sql, user, body }) {
  requireUser(user);
  const { current_password: cur, new_password: next } = await body();
  const fields = {};
  if (typeof cur !== 'string' || !cur) fields.current_password = '현재 비밀번호를 입력해 주세요.';
  const pwErr = passwordError(next);
  if (pwErr) fields.new_password = pwErr;
  else if (next === cur) fields.new_password = '현재 비밀번호와 다른 비밀번호를 입력해 주세요.';
  if (hasErrors(fields)) throw badRequest('입력값을 확인해 주세요.', fields);
  const [row] = await sql`select password_hash from users where id = ${user.id}`;
  if (!(await bcrypt.compare(cur, row.password_hash))) {
    throw badRequest('현재 비밀번호가 맞지 않습니다.', { current_password: '현재 비밀번호가 맞지 않습니다.' });
  }
  const hash = await bcrypt.hash(next, BCRYPT_COST);
  await sql`update users set password_hash = ${hash}, must_change_password = false, updated_at = now() where id = ${user.id}`;
  await audit(sql, user.id, 'password_change', 'user', user.id);
  return { ok: true };
}

async function updateMe({ sql, user, body }) {
  requireUser(user);
  const { phone_ext } = await body();
  const v = typeof phone_ext === 'string' ? phone_ext.trim() : '';
  if (v && !/^\d{2,6}$/.test(v)) throw badRequest('입력값을 확인해 주세요.', { phone_ext: '내선번호는 숫자 2~6자리로 입력해 주세요.' });
  await sql`update users set phone_ext = ${v || null}, updated_at = now() where id = ${user.id}`;
  return { ok: true };
}

export const routes = [
  ['POST', '/auth/login', login, { public: true }],
  ['POST', '/auth/logout', logout, { public: true }],
  ['GET', '/auth/me', me, { public: true }],
  ['POST', '/auth/password', changePassword, { allowPasswordChange: true }],
  ['PATCH', '/auth/me', updateMe],
];
