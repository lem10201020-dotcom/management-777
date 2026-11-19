// F-09 사용자(직원) 관리
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { validateUser, hasErrors } from '../../../js/utils/validate.js';
import { badRequest, conflict, notFound } from '../http.js';
import { requireRole } from '../session.js';
import { audit } from '../audit.js';
import { BCRYPT_COST } from './auth.js';

const COLS = (sql) => sql`id, login_id, name, team, roles, approver_step, phone_ext, can_drive, is_active,
  must_change_password, created_at, updated_at`;

export function tempPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = letters + letters.toUpperCase() + digits;
  let pw = letters[randomInt(letters.length)] + digits[randomInt(digits.length)];
  while (pw.length < 10) pw += all[randomInt(all.length)];
  return pw.split('').sort(() => randomInt(3) - 1).join('');
}

async function options({ sql }) {
  const rows = await sql`select id, name, team, can_drive from users where is_active order by name`;
  return { users: rows };
}

async function list({ sql, user, query }) {
  requireRole(user, 'admin');
  const q = (query.get('q') || '').trim();
  const active = query.get('active') || 'active';
  const like = `%${q}%`;
  const rows = await sql`
    select ${COLS(sql)} from users
    where (${q} = '' or name ilike ${like} or login_id ilike ${like} or team ilike ${like})
      and (${active} = 'all' or is_active = ${active === 'active'})
    order by is_active desc, name`;
  return { users: rows };
}

async function create({ sql, user, body }) {
  requireRole(user, 'admin');
  const { value, errors } = validateUser(await body(), { isCreate: true });
  if (hasErrors(errors)) throw badRequest('입력값을 확인해 주세요.', errors);
  const pw = tempPassword();
  const hash = await bcrypt.hash(pw, BCRYPT_COST);
  try {
    const [u] = await sql`
      insert into users (login_id, name, team, roles, approver_step, phone_ext, can_drive, is_active, password_hash)
      values (${value.login_id}, ${value.name}, ${value.team}, ${value.roles}, ${value.approver_step},
              ${value.phone_ext}, ${value.can_drive}, ${value.is_active}, ${hash})
      returning ${COLS(sql)}`;
    await audit(sql, user.id, 'user_create', 'user', u.id, { login_id: u.login_id, roles: u.roles });
    return { user: u, temp_password: pw };
  } catch (e) {
    if (e.code === '23505') throw badRequest('이미 사용 중인 아이디입니다.', { login_id: '이미 사용 중인 아이디입니다.' });
    throw e;
  }
}

async function update({ sql, user, params, body }) {
  requireRole(user, 'admin');
  const [old] = await sql`select ${COLS(sql)} from users where id = ${params.id}`;
  if (!old) throw notFound('사용자를 찾을 수 없습니다.');
  const { value, errors } = validateUser(await body());
  if (hasErrors(errors)) throw badRequest('입력값을 확인해 주세요.', errors);
  const losingAdmin = old.is_active && old.roles.includes('admin') && (!value.is_active || !value.roles.includes('admin'));
  if (losingAdmin) {
    const [{ n }] = await sql`select count(*)::int as n from users where is_active and 'admin' = any(roles) and id <> ${old.id}`;
    if (n === 0) throw conflict('마지막 관리자는 비활성화하거나 관리자 역할을 해제할 수 없습니다.');
  }
  const [u] = await sql`
    update users set name = ${value.name}, team = ${value.team}, roles = ${value.roles},
      approver_step = ${value.approver_step}, phone_ext = ${value.phone_ext}, can_drive = ${value.can_drive},
      is_active = ${value.is_active}, updated_at = now()
    where id = ${old.id} returning ${COLS(sql)}`;
  if (!u.is_active) await sql`delete from sessions where user_id = ${u.id}`;
  await audit(sql, user.id, 'user_update', 'user', u.id, {
    roles: [old.roles, u.roles], is_active: [old.is_active, u.is_active],
  });
  return { user: u };
}

async function resetPassword({ sql, user, params }) {
  requireRole(user, 'admin');
  const [old] = await sql`select id from users where id = ${params.id}`;
  if (!old) throw notFound('사용자를 찾을 수 없습니다.');
  const pw = tempPassword();
  const hash = await bcrypt.hash(pw, BCRYPT_COST);
  await sql`update users set password_hash = ${hash}, must_change_password = true, failed_attempts = 0,
              locked_until = null, updated_at = now() where id = ${old.id}`;
  await sql`delete from sessions where user_id = ${old.id}`;
  await audit(sql, user.id, 'password_reset', 'user', old.id);
  return { temp_password: pw };
}

export const routes = [
  ['GET', '/users/options', options],
  ['GET', '/users', list],
  ['POST', '/users', create],
  ['PATCH', '/users/:id', update],
  ['POST', '/users/:id/reset-password', resetPassword],
];
