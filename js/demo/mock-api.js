// 체험(데모) 모드 — 서버·DB 없이 브라우저 안에서 API를 흉내 낸다.
// ⚠ 프로토타입 체험 전용: 데이터는 이 브라우저(localStorage)에만 저장되며 가상 데이터만 사용한다.
//   운영에서는 서버 API(api/)가 기준이며, 업무 규칙이 바뀌면 이 파일도 함께 맞춘다. (CLAUDE.md 7장 예외)
import {
  validateLogin, validateVehicle, validateUser, validateReservation, validateUsageLog, passwordError,
  hasErrors, computeTrip, isValidYmd, YM_RE, DEFAULT_SETTINGS, validateApprovalLine,
} from '../utils/validate.js';
import { todayYmd, addDays, addMonths, currentYm, rangeLabel } from '../utils/format.js';

const KEY = 'vl.demo.db';
const VERSION = 1;
const PAGE_SIZE = 20;
const ACTIVE = ['requested', 'confirmed', 'completed'];
let db = null;

// ───────── 공통 ─────────
function E(status, message, extra = {}) { const e = new Error(message); e.status = status; e.extra = extra; return e; }
const bad = (message, fields, extra = {}) => E(400, message, { fields, ...extra });
const forbidden = (m = '이 작업을 할 권한이 없습니다.') => E(403, m);
const notFound = (m = '대상을 찾을 수 없습니다.') => E(404, m);
const conflict = (m, extra = {}) => E(409, m, extra);
const iso = (ymd, hm) => new Date(`${ymd}T${hm}:00+09:00`).toISOString();
const ms = (x) => Date.parse(x);
const nowIso = () => new Date().toISOString();
const nextId = (t) => { db.seq[t] = (db.seq[t] || 0) + 1; return db.seq[t]; };
const userById = (id) => db.users.find((u) => u.id === id);
const vehById = (id) => db.vehicles.find((v) => v.id === id);
const hasRole = (u, ...r) => !!u && r.some((x) => u.roles.includes(x));
const requireRole = (u, ...r) => { if (!hasRole(u, ...r)) throw forbidden(); };
const num = (x) => Number(x);

async function hashPw(pw) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`vl-demo:${pw}`));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return `plain:${pw}`; }
}
function tempPassword() {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'a2';
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function persist() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* 저장소 차단: 메모리에서만 동작 */ } }
async function ensure() {
  if (db) return;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db || db.version !== VERSION) { db = await seed(); persist(); }
}
export async function resetDemo() { db = await seed(); persist(); }
export function clearDemoData() { db = null; try { localStorage.removeItem(KEY); } catch { /* 무시 */ } }

// ───────── 가상 샘플 데이터 ─────────
async function seed() {
  const pw = await hashPw('Sample1234');
  const d = { version: VERSION, seq: {}, session: null, users: [], vehicles: [], reservations: [], logs: [], ledgers: [], approvals: [], settings: { ...structuredClone(DEFAULT_SETTINGS), teams: ['사례관리팀', '지역조직팀', '서비스제공팀', '행정지원팀', '관장실'] } };
  db = d;
  const mkUser = (login_id, name, team, roles, approver_step = null, is_active = true) => {
    const u = { id: nextId('users'), login_id, name, team, roles, approver_step, phone_ext: null, can_drive: true, is_active, password_hash: pw, must_change_password: false, created_at: nowIso() };
    d.users.push(u); return u;
  };
  const s1 = mkUser('staff01', '홍길동', '사례관리팀', ['staff']);
  const s2 = mkUser('staff02', '김가상', '지역조직팀', ['staff']);
  mkUser('mgr01', '이담당', '행정지원팀', ['staff', 'manager']);
  const a1 = mkUser('apv01', '박팀장', '사례관리팀', ['staff', 'approver'], 1);
  mkUser('apv02', '최관장', '관장실', ['approver'], 2);
  mkUser('admin01', '관리자', '행정지원팀', ['admin']);
  mkUser('old01', '정퇴사', '지역조직팀', ['staff'], null, false);
  const mkVeh = (plate_no, model, seats, fuel_type, initial_odometer, status, color) => {
    const v = { id: nextId('vehicles'), plate_no, model, seats, fuel_type, initial_odometer, status, color, note: '' };
    d.vehicles.push(v); return v;
  };
  const v1 = mkVeh('12가3456', '스타리아 11인승', 11, '경유', 10000, 'available', '#1B2A4A');
  const v2 = mkVeh('34나5678', '레이', 4, '휘발유', 5000, 'available', '#0E6E6E');
  mkVeh('56다7890', '카니발 9인승', 9, '경유', 30000, 'maintenance', '#7A2E5C');
  const mkRes = (v, u, ymd, s, e, destination, purpose, pax, status) => {
    const r = { id: nextId('reservations'), vehicle_id: v.id, user_id: u.id, start_at: iso(ymd, s), end_at: iso(ymd, e), destination, purpose_category: purpose, purpose_note: '', passenger_count: pax, status, cancel_reason: '', created_by: u.id };
    d.reservations.push(r); return r;
  };
  const lastYm = addMonths(currentYm(), -1);
  let odo = 10000;
  for (const [dd, dep, ret, dist, dest, purpose, pax, u, fuel] of [
    ['05', '09:30', '12:00', 42, '○○동 행정복지센터', '사례관리 방문', 1, s1, null],
    ['12', '13:00', '17:30', 68, '△△구 복지관 연합회', '회의·교육', 2, a1, [30.5, 52000]],
    ['20', '10:00', '11:30', 15, '□□마트', '물품 운반', 0, s2, null],
  ]) {
    const ymd = `${lastYm}-${dd}`;
    const r = mkRes(v1, u, ymd, dep, ret, dest, purpose, pax, 'completed');
    d.logs.push({ id: nextId('logs'), reservation_id: r.id, vehicle_id: v1.id, driver_id: u.id, drive_date: ymd, depart_at: iso(ymd, dep), return_at: iso(ymd, ret), odometer_start: odo, odometer_end: odo + dist, distance_km: dist, destination: dest, purpose_category: purpose, passenger_count: pax, fuel_liters: fuel ? fuel[0] : null, fuel_cost: fuel ? fuel[1] : null, note: '', mismatch_reason: '', driver_signature: `전자 확인: ${u.name} (샘플)`, signature_type: 'typed', signed_at: nowIso(), status: 'submitted', created_by: u.id });
    odo += dist;
  }
  const t = todayYmd();
  mkRes(v1, s1, t, '14:00', '16:00', '○○동 주민센터', '사례관리 방문', 1, 'confirmed');
  mkRes(v2, s2, addDays(t, 1), '10:00', '12:00', '△△초등학교', '프로그램 운영', 2, 'confirmed');
  mkRes(v1, a1, addDays(t, 2), '09:00', '18:00', '◇◇시 연수원', '회의·교육', 3, 'confirmed');
  mkRes(v2, s1, addDays(t, -1), '13:00', '15:00', '□□동 경로당', '프로그램 운영', 0, 'confirmed');
  return d;
}

function currentUser() {
  const u = db.session ? userById(db.session) : null;
  return u && u.is_active ? u : null;
}
const publicUser = (u) => ({ id: u.id, login_id: u.login_id, name: u.name, team: u.team, roles: u.roles, approver_step: u.approver_step, can_drive: u.can_drive, must_change_password: u.must_change_password });
const settings = () => db.settings;

async function verifySignature(user, input) {
  const fail = (m) => bad(m, { signature: m });
  if (!input || typeof input !== 'object') throw fail('서명을 입력해 주세요.');
  if (input.type === 'image') {
    if (typeof input.data !== 'string' || !input.data.startsWith('data:image/png;base64,') || input.data.length > 70000) throw fail('서명을 다시 입력해 주세요.');
    return { signature: input.data, signature_type: 'image' };
  }
  if (input.type === 'typed') {
    if ((input.name || '').trim() !== user.name) throw fail(`본인 이름(${user.name})을 정확히 입력해 주세요.`);
    if ((await hashPw(input.password || '')) !== user.password_hash) throw fail('비밀번호를 다시 확인해 주세요.');
    const at = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
    return { signature: `전자 확인: ${user.name} (${at})`, signature_type: 'typed' };
  }
  throw fail('서명을 입력해 주세요.');
}

// ───────── 인증 ─────────
async function login({ body }) {
  const { value, errors } = validateLogin(body);
  if (hasErrors(errors)) throw bad('입력값을 확인해 주세요.', errors);
  const u = db.users.find((x) => x.login_id === value.login_id);
  if (!u || (await hashPw(value.password)) !== u.password_hash) throw E(401, '아이디 또는 비밀번호가 맞지 않습니다.', { code: 'INVALID_CREDENTIALS' });
  if (!u.is_active) throw E(403, '사용이 중지된 계정입니다. 관리자에게 문의하세요.', { code: 'INACTIVE' });
  db.session = u.id;
  return { user: publicUser(u), settings: settings() };
}
const logout = () => { db.session = null; return { ok: true }; };
const me = ({ user }) => (user ? { user: publicUser(user), settings: settings() } : { user: null });
async function changePassword({ user, body }) {
  const f = {};
  if (!body.current_password) f.current_password = '현재 비밀번호를 입력해 주세요.';
  const pe = passwordError(body.new_password);
  if (pe) f.new_password = pe; else if (body.new_password === body.current_password) f.new_password = '현재 비밀번호와 다른 비밀번호를 입력해 주세요.';
  if (hasErrors(f)) throw bad('입력값을 확인해 주세요.', f);
  if ((await hashPw(body.current_password)) !== user.password_hash) throw bad('현재 비밀번호가 맞지 않습니다.', { current_password: '현재 비밀번호가 맞지 않습니다.' });
  user.password_hash = await hashPw(body.new_password);
  user.must_change_password = false;
  return { ok: true };
}
function updateMe({ user, body }) {
  const v = (body.phone_ext || '').trim();
  if (v && !/^\d{2,6}$/.test(v)) throw bad('입력값을 확인해 주세요.', { phone_ext: '내선번호는 숫자 2~6자리로 입력해 주세요.' });
  user.phone_ext = v || null;
  return { ok: true };
}

// ───────── 차량 ─────────
function vehicleList({ query }) {
  const q = (query.get('q') || '').trim().toLowerCase();
  const status = query.get('status') || '';
  const ym = currentYm();
  const rows = db.vehicles
    .filter((v) => (!q || v.plate_no.includes(q) || v.model.toLowerCase().includes(q)) && (!status || v.status === status))
    .map((v) => {
      const logs = db.logs.filter((l) => l.vehicle_id === v.id);
      return {
        ...v,
        current_odometer: logs.length ? Math.max(...logs.map((l) => l.odometer_end)) : v.initial_odometer,
        month_distance: logs.filter((l) => l.status !== 'draft' && l.drive_date.startsWith(ym)).reduce((s, l) => s + l.distance_km, 0),
        has_logs: logs.length > 0,
      };
    })
    .sort((a, b) => (a.status === 'retired') - (b.status === 'retired') || a.plate_no.localeCompare(b.plate_no));
  return { vehicles: rows };
}
function vehicleCreate({ user, body }) {
  requireRole(user, 'manager', 'admin');
  const { value, errors } = validateVehicle(body);
  if (hasErrors(errors)) throw bad('입력값을 확인해 주세요.', errors);
  if (db.vehicles.some((v) => v.plate_no === value.plate_no)) throw bad('이미 등록된 차량번호입니다.', { plate_no: '이미 등록된 차량번호입니다.' });
  const v = { id: nextId('vehicles'), ...value };
  db.vehicles.push(v);
  return { vehicle: v };
}
function vehicleUpdate({ user, params, body }) {
  requireRole(user, 'manager', 'admin');
  const v = vehById(params.id);
  if (!v) throw notFound('차량을 찾을 수 없습니다.');
  const { value, errors } = validateVehicle(body);
  if (hasErrors(errors)) throw bad('입력값을 확인해 주세요.', errors);
  if (db.vehicles.some((x) => x.id !== v.id && x.plate_no === value.plate_no)) throw bad('이미 등록된 차량번호입니다.', { plate_no: '이미 등록된 차량번호입니다.' });
  if (value.initial_odometer !== v.initial_odometer && db.logs.some((l) => l.vehicle_id === v.id)) throw bad('운행일지가 있는 차량은 최초 계기판 값을 바꿀 수 없습니다.', { initial_odometer: '운행일지가 입력된 뒤에는 바꿀 수 없습니다.' });
  Object.assign(v, value);
  const affected = v.status !== 'available'
    ? db.reservations.filter((r) => r.vehicle_id === v.id && ['requested', 'confirmed'].includes(r.status) && ms(r.end_at) > Date.now())
      .map((r) => ({ id: r.id, start_at: r.start_at, end_at: r.end_at, user_name: userById(r.user_id).name }))
    : [];
  return { vehicle: v, affected_reservations: affected };
}

// ───────── 사용자 ─────────
const userCols = ({ password_hash: _p, ...u }) => u;
const userOptions = () => ({ users: db.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.name, team: u.team, can_drive: u.can_drive })).sort((a, b) => a.name.localeCompare(b.name)) });
function userList({ user, query }) {
  requireRole(user, 'admin');
  const q = (query.get('q') || '').trim().toLowerCase();
  const active = query.get('active') || 'active';
  return { users: db.users.filter((u) => (!q || [u.name, u.login_id, u.team].some((x) => x.toLowerCase().includes(q))) && (active === 'all' || u.is_active === (active === 'active'))).map(userCols) };
}
async function userCreate({ user, body }) {
  requireRole(user, 'admin');
  const { value, errors } = validateUser(body, { isCreate: true });
  if (hasErrors(errors)) throw bad('입력값을 확인해 주세요.', errors);
  if (db.users.some((u) => u.login_id === value.login_id)) throw bad('이미 사용 중인 아이디입니다.', { login_id: '이미 사용 중인 아이디입니다.' });
  const pw = tempPassword();
  const u = { id: nextId('users'), ...value, password_hash: await hashPw(pw), must_change_password: true };
  db.users.push(u);
  return { user: userCols(u), temp_password: pw };
}
function userUpdate({ user, params, body }) {
  requireRole(user, 'admin');
  const u = userById(params.id);
  if (!u) throw notFound('사용자를 찾을 수 없습니다.');
  const { value, errors } = validateUser(body);
  if (hasErrors(errors)) throw bad('입력값을 확인해 주세요.', errors);
  const losing = u.is_active && u.roles.includes('admin') && (!value.is_active || !value.roles.includes('admin'));
  if (losing && !db.users.some((x) => x.id !== u.id && x.is_active && x.roles.includes('admin'))) throw conflict('마지막 관리자는 비활성화하거나 관리자 역할을 해제할 수 없습니다.');
  const { login_id: _l, ...rest } = value;
  Object.assign(u, rest);
  return { user: userCols(u) };
}
async function userReset({ user, params }) {
  requireRole(user, 'admin');
  const u = userById(params.id);
  if (!u) throw notFound('사용자를 찾을 수 없습니다.');
  const pw = tempPassword();
  u.password_hash = await hashPw(pw);
  u.must_change_password = true;
  return { temp_password: pw };
}

// ───────── 예약 ─────────
const logForRes = (id) => db.logs.find((l) => l.reservation_id === id);
function shapeRes(r, user) {
  const v = vehById(r.vehicle_id); const l = logForRes(r.id);
  const isOwner = r.user_id === user.id; const isManager = hasRole(user, 'manager');
  const startPassed = ms(r.start_at) <= Date.now();
  const open = ['requested', 'confirmed'].includes(r.status) && !l;
  return {
    id: r.id, vehicle_id: r.vehicle_id, user_id: r.user_id, user_name: userById(r.user_id).name,
    vehicle: { plate_no: v.plate_no, model: v.model, color: v.color, seats: v.seats },
    start_at: r.start_at, end_at: r.end_at, destination: r.destination, purpose_category: r.purpose_category,
    purpose_note: isOwner || isManager ? r.purpose_note : null, passenger_count: r.passenger_count, status: r.status, cancel_reason: r.cancel_reason,
    usage_log_id: l?.id ?? null, usage_log_status: l?.status ?? null,
    can_edit: open && (isManager || (isOwner && !startPassed)),
    can_cancel: open && (isManager || (isOwner && !startPassed)),
    can_write_log: r.status === 'confirmed' && !l && (isOwner || isManager),
  };
}
const byStart = (a, b) => ms(a.start_at) - ms(b.start_at);
function resList({ user, query }) {
  const from = query.get('from') || todayYmd();
  const to = query.get('to') || addDays(from, 1);
  if (!isValidYmd(from) || !isValidYmd(to)) throw bad('기간 형식이 올바르지 않습니다.');
  const f = ms(`${from}T00:00:00+09:00`); const t = ms(`${addDays(to, 1)}T00:00:00+09:00`);
  const vid = num(query.get('vehicle_id') || 0);
  const inc = query.get('include_cancelled') === '1';
  return { reservations: db.reservations.filter((r) => ms(r.start_at) < t && ms(r.end_at) > f && (!vid || r.vehicle_id === vid) && (inc || r.status !== 'cancelled')).sort(byStart).map((r) => shapeRes(r, user)) };
}
function resGet({ user, params }) {
  const r = db.reservations.find((x) => x.id === params.id);
  if (!r) throw notFound('예약을 찾을 수 없습니다.');
  return { reservation: shapeRes(r, user) };
}
const overlapping = (vid, s, e, ex = 0) => db.reservations.filter((r) => r.vehicle_id === vid && r.id !== ex && ACTIVE.includes(r.status) && ms(r.start_at) < e && ms(r.end_at) > s).sort(byStart);
function overlapError(value, ex = 0) {
  const c = overlapping(value.vehicle_id, value.start_ms, value.end_ms, ex)[0];
  const msg = `${userById(c.user_id).name}님이 ${rangeLabel(c.start_at, c.end_at)}에 이미 예약했습니다.`;
  const suggestions = db.vehicles.filter((v) => v.status === 'available' && v.seats >= value.passenger_count + 1 && !overlapping(v.id, value.start_ms, value.end_ms, ex).length).map((v) => ({ id: v.id, plate_no: v.plate_no, model: v.model }));
  return conflict(msg, { code: 'RESERVATION_OVERLAP', fields: { start_at: msg }, suggestions });
}
function resCheck(user, value) {
  const v = vehById(value.vehicle_id);
  if (!v || v.status !== 'available') throw bad('입력값을 확인해 주세요.', { vehicle_id: '사용 가능한 차량을 선택해 주세요.' });
  if (value.passenger_count > v.seats - 1) throw bad('입력값을 확인해 주세요.', { passenger_count: `이 차량의 동승 가능 인원은 최대 ${v.seats - 1}명입니다.` });
  const isManager = hasRole(user, 'manager');
  if (!isManager && value.start_ms < Date.now() - 5 * 60_000) throw bad('입력값을 확인해 주세요.', { start_at: '지난 시각으로는 예약할 수 없습니다.' });
  if (value.user_id && value.user_id !== user.id) {
    if (!isManager) throw forbidden('다른 직원 이름으로 예약할 권한이 없습니다.');
    if (!userById(value.user_id)?.is_active) throw bad('입력값을 확인해 주세요.', { user_id: '예약자를 다시 선택해 주세요.' });
    return value.user_id;
  }
  return user.id;
}
function resCreate({ user, body }) {
  const { value, errors } = validateReservation(body, settings());
  if (hasErrors(errors)) throw bad('입력값을 확인해 주세요.', errors);
  const ownerId = resCheck(user, value);
  if (overlapping(value.vehicle_id, value.start_ms, value.end_ms).length) throw overlapError(value);
  const r = {
    id: nextId('reservations'), vehicle_id: value.vehicle_id, user_id: ownerId, start_at: new Date(value.start_ms).toISOString(), end_at: new Date(value.end_ms).toISOString(),
    destination: value.destination, purpose_category: value.purpose_category, purpose_note: value.purpose_note, passenger_count: value.passenger_count,
    status: settings().approval_mode === 'manual' ? 'requested' : 'confirmed', cancel_reason: '', created_by: user.id,
  };
  db.reservations.push(r);
  return { reservation: shapeRes(r, user) };
}
function loadEditable(user, id) {
  const r = db.reservations.find((x) => x.id === id);
  if (!r) throw notFound('예약을 찾을 수 없습니다.');
  if (r.user_id !== user.id && !hasRole(user, 'manager')) throw forbidden('본인 예약만 바꿀 수 있습니다.');
  return [r, shapeRes(r, user)];
}
function resUpdate({ user, params, body }) {
  const [r, s] = loadEditable(user, params.id);
  if (!s.can_edit) throw conflict('이 예약은 더 이상 수정할 수 없습니다. (시작 시각이 지났거나 취소·운행완료된 예약)');
  const { value, errors } = validateReservation({ ...body, user_id: body.user_id ?? r.user_id }, settings());
  if (hasErrors(errors)) throw bad('입력값을 확인해 주세요.', errors);
  const ownerId = resCheck(user, value);
  if (overlapping(value.vehicle_id, value.start_ms, value.end_ms, r.id).length) throw overlapError(value, r.id);
  Object.assign(r, { vehicle_id: value.vehicle_id, user_id: ownerId, start_at: new Date(value.start_ms).toISOString(), end_at: new Date(value.end_ms).toISOString(), destination: value.destination, purpose_category: value.purpose_category, purpose_note: value.purpose_note, passenger_count: value.passenger_count });
  return { reservation: shapeRes(r, user) };
}
function resCancel({ user, params, body }) {
  const [r, s] = loadEditable(user, params.id);
  if (!s.can_cancel) throw conflict('이 예약은 취소할 수 없습니다. (시작 시각이 지났거나 이미 처리된 예약)');
  r.status = 'cancelled'; r.cancel_reason = (body.reason || '').trim().slice(0, 100);
  return { reservation: shapeRes(r, user) };
}
function resConfirm({ user, params }) {
  requireRole(user, 'manager');
  const r = db.reservations.find((x) => x.id === params.id);
  if (!r) throw notFound('예약을 찾을 수 없습니다.');
  if (r.status !== 'requested') throw conflict('신청 상태인 예약만 확정할 수 있습니다.');
  r.status = 'confirmed';
  return { reservation: shapeRes(r, user) };
}
function resNoShow({ user, params }) {
  requireRole(user, 'manager');
  const r = db.reservations.find((x) => x.id === params.id);
  if (!r) throw notFound('예약을 찾을 수 없습니다.');
  if (r.status !== 'confirmed' || logForRes(r.id) || ms(r.end_at) > Date.now()) throw conflict('종료 시각이 지났고 운행일지가 없는 확정 예약만 미사용 처리할 수 있습니다.');
  r.status = 'no_show';
  return { reservation: shapeRes(r, user) };
}

// ───────── 운행일지 ─────────
function prevEnd(l) {
  const prev = db.logs.filter((x) => x.vehicle_id === l.vehicle_id && ms(x.depart_at) < ms(l.depart_at)).sort((a, b) => ms(b.depart_at) - ms(a.depart_at))[0];
  return prev ? prev.odometer_end : vehById(l.vehicle_id).initial_odometer;
}
function expectedOdometer(vid, departIso, ex = 0) {
  const prev = db.logs.filter((x) => x.vehicle_id === vid && x.id !== ex && ms(x.depart_at) < ms(departIso)).sort((a, b) => ms(b.depart_at) - ms(a.depart_at))[0];
  return prev ? prev.odometer_end : vehById(vid)?.initial_odometer ?? 0;
}
function shapeLog(l, user, withSig = true) {
  const v = vehById(l.vehicle_id); const pe = prevEnd(l);
  const mine = l.created_by === user.id || l.driver_id === user.id;
  return {
    ...l, driver_signature: withSig ? l.driver_signature : null, plate_no: v.plate_no, model: v.model, color: v.color, driver_name: userById(l.driver_id).name,
    prev_end: pe, mismatch: pe !== l.odometer_start, can_edit: l.status !== 'locked' && (mine || hasRole(user, 'manager')),
  };
}
const ledgerOf = (vid, ym) => db.ledgers.find((x) => x.vehicle_id === vid && x.year_month === ym);
function assertLedgerEditable(vid, ym) {
  const l = ledgerOf(vid, ym);
  if (l?.status === 'submitted') throw conflict('이 달 차량대장이 결재 진행 중이라 수정할 수 없습니다. 차량담당자에게 회수를 요청하세요.');
  if (l?.status === 'approved') throw conflict('결재가 끝난 달의 기록이라 수정할 수 없습니다.');
}
function logList({ user, query }) {
  const vid = num(query.get('vehicle_id') || 0);
  const did = query.get('mine') === '1' ? user.id : num(query.get('driver_id') || 0);
  const status = query.get('status') || ''; const from = query.get('from') || ''; const to = query.get('to') || '';
  const q = (query.get('q') || '').trim();
  const page = Math.max(1, num(query.get('page') || 1));
  const rows = db.logs.filter((l) => (!vid || l.vehicle_id === vid) && (!did || l.driver_id === did || l.created_by === did) && (!status || l.status === status)
    && (!from || l.drive_date >= from) && (!to || l.drive_date <= to) && (!q || l.destination.includes(q))).sort((a, b) => ms(b.depart_at) - ms(a.depart_at));
  return { logs: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((l) => shapeLog(l, user, false)), page, page_size: PAGE_SIZE, total: rows.length };
}
function logGet({ user, params }) {
  const l = db.logs.find((x) => x.id === params.id);
  if (!l) throw notFound('운행일지를 찾을 수 없습니다.');
  return { log: shapeLog(l, user) };
}
function logPrefill({ user, query }) {
  const rid = num(query.get('reservation_id') || 0);
  if (rid) {
    const r = db.reservations.find((x) => x.id === rid);
    if (!r) throw notFound('예약을 찾을 수 없습니다.');
    if (r.user_id !== user.id && !hasRole(user, 'manager')) throw forbidden('본인 예약의 운행일지만 작성할 수 있습니다.');
    const l = logForRes(r.id);
    if (l) throw conflict('이미 운행일지가 작성된 예약입니다.', { usage_log_id: l.id });
    const v = vehById(r.vehicle_id);
    return {
      reservation: { id: r.id, start_at: r.start_at, end_at: r.end_at, status: r.status },
      vehicle: { id: v.id, plate_no: v.plate_no, model: v.model, seats: v.seats },
      draft: { reservation_id: r.id, vehicle_id: r.vehicle_id, driver_id: r.user_id, destination: r.destination, purpose_category: r.purpose_category, passenger_count: r.passenger_count, start_at: r.start_at, end_at: r.end_at },
      expected_odometer_start: expectedOdometer(r.vehicle_id, r.start_at),
    };
  }
  // 예약 없이 운행한 경우: 모든 직원이 작성 가능 (F-04)
  const vid = num(query.get('vehicle_id') || 0);
  if (!vid) return { reservation: null, vehicle: null, draft: null, expected_odometer_start: null };
  const v = vehById(vid);
  if (!v) throw notFound('차량을 찾을 수 없습니다.');
  return { reservation: null, vehicle: { id: v.id, plate_no: v.plate_no, model: v.model, seats: v.seats }, draft: { vehicle_id: v.id }, expected_odometer_start: expectedOdometer(v.id, nowIso()) };
}
function logPrepare(user, input, existing) {
  const merged = existing ? { ...input, reservation_id: existing.reservation_id, vehicle_id: existing.reservation_id ? existing.vehicle_id : input.vehicle_id } : input;
  const { value, errors } = validateUsageLog(merged, settings());
  if (hasErrors(errors)) throw bad('입력값을 확인해 주세요.', errors);
  const isManager = hasRole(user, 'manager');
  if (!existing) {
    if (value.reservation_id) {
      const r = db.reservations.find((x) => x.id === value.reservation_id);
      if (!r) throw bad('연결할 예약을 찾을 수 없습니다.');
      if (r.user_id !== user.id && !isManager) throw forbidden('본인 예약의 운행일지만 작성할 수 있습니다.');
      if (logForRes(r.id)) throw conflict('이미 운행일지가 작성된 예약입니다.');
      if (r.status !== 'confirmed') throw conflict('확정된 예약만 운행일지를 작성할 수 있습니다.');
      value.vehicle_id = r.vehicle_id;
    }
  }
  const v = vehById(value.vehicle_id);
  if (!v) throw bad('입력값을 확인해 주세요.', { vehicle_id: '차량을 다시 선택해 주세요.' });
  if (!existing && !value.reservation_id) {
    if (v.status === 'retired') throw bad('입력값을 확인해 주세요.', { vehicle_id: '운행이 종료된 차량입니다. 다른 차량을 선택해 주세요.' });
    if (v.status === 'maintenance' && !isManager) throw bad('입력값을 확인해 주세요.', { vehicle_id: '점검중인 차량입니다. 차량담당자에게 확인해 주세요.' });
  }
  if (value.passenger_count > v.seats - 1) throw bad('입력값을 확인해 주세요.', { passenger_count: `이 차량의 동승 가능 인원은 최대 ${v.seats - 1}명입니다.` });
  const d = userById(value.driver_id);
  if (!(d && d.is_active && d.can_drive) && !(existing && existing.driver_id === value.driver_id)) throw bad('입력값을 확인해 주세요.', { driver_id: '운전 가능한 직원을 선택해 주세요.' });
  if (value.drive_date > todayYmd()) throw bad('입력값을 확인해 주세요.', { drive_date: '운행일은 오늘 이후로 입력할 수 없습니다.' });
  const trip = computeTrip(value.drive_date, value.depart_time, value.return_time);
  const clash = db.logs.filter((l) => l.vehicle_id === value.vehicle_id && l.id !== (existing?.id ?? 0)
    && ms(l.depart_at) < trip.return_at.getTime() && ms(l.return_at) > trip.depart_at.getTime()).sort((a, b) => ms(a.depart_at) - ms(b.depart_at))[0];
  if (clash) {
    const msg = `같은 차량의 ${userById(clash.driver_id).name}님 운행 기록(${rangeLabel(clash.depart_at, clash.return_at)})과 시간이 겹칩니다. 출발·도착 시각을 확인해 주세요.`;
    throw conflict(msg, { code: 'LOG_OVERLAP', fields: { depart_time: msg } });
  }
  assertLedgerEditable(value.vehicle_id, value.drive_date.slice(0, 7));
  if (existing) assertLedgerEditable(existing.vehicle_id, existing.drive_date.slice(0, 7));
  const expected = expectedOdometer(value.vehicle_id, trip.depart_at.toISOString(), existing?.id ?? 0);
  if (value.odometer_start !== expected) {
    if (!value.mismatch_reason) {
      const msg = `직전 운행의 도착 계기판(${expected.toLocaleString('ko-KR')}km)과 다릅니다. 사유를 선택해 주세요.`;
      throw bad(msg, { mismatch_reason: msg }, { code: 'ODOMETER_MISMATCH', expected });
    }
  } else value.mismatch_reason = '';
  return { value, trip };
}
const logFields = (value, trip, sig, submit) => ({
  vehicle_id: value.vehicle_id, driver_id: value.driver_id, drive_date: value.drive_date, depart_at: trip.depart_at.toISOString(), return_at: trip.return_at.toISOString(),
  odometer_start: value.odometer_start, odometer_end: value.odometer_end, distance_km: value.odometer_end - value.odometer_start,
  destination: value.destination, purpose_category: value.purpose_category, passenger_count: value.passenger_count,
  fuel_liters: value.fuel_liters, fuel_cost: value.fuel_cost, note: value.note, mismatch_reason: value.mismatch_reason,
  driver_signature: sig?.signature ?? null, signature_type: sig?.signature_type ?? null, signed_at: sig ? nowIso() : null, status: submit ? 'submitted' : 'draft',
});
async function logCreate({ user, body }) {
  const { value, trip } = logPrepare(user, body, null);
  const submit = body.submit === true;
  const sig = submit ? await verifySignature(user, body.signature) : null;
  const l = { id: nextId('logs'), reservation_id: value.reservation_id, created_by: user.id, ...logFields(value, trip, sig, submit) };
  db.logs.push(l);
  if (submit && l.reservation_id) db.reservations.find((r) => r.id === l.reservation_id).status = 'completed';
  return { log: shapeLog(l, user) };
}
async function logUpdate({ user, params, body }) {
  const l = db.logs.find((x) => x.id === params.id);
  if (!l) throw notFound('운행일지를 찾을 수 없습니다.');
  if (l.created_by !== user.id && l.driver_id !== user.id && !hasRole(user, 'manager')) throw forbidden('본인 운행일지만 수정할 수 있습니다.');
  if (l.status === 'locked') throw conflict('결재가 끝난 기록이라 수정할 수 없습니다.');
  const { value, trip } = logPrepare(user, body, l);
  const submit = body.submit === true || l.status === 'submitted';
  const sig = submit ? await verifySignature(user, body.signature) : null;
  Object.assign(l, logFields(value, trip, sig, submit));
  if (submit && l.reservation_id) db.reservations.find((r) => r.id === l.reservation_id).status = 'completed';
  return { log: shapeLog(l, user) };
}

// ───────── 월별 차량대장·결재 ─────────
function curStep(ledger) { return db.approvals.filter((a) => a.ledger_id === ledger?.id && a.round === ledger?.round && a.decision === 'approved').length + 1; }
function computeLedger(user, vid, ym, withSig = false) {
  const vehicle = vehById(vid);
  if (!vehicle) throw notFound('차량을 찾을 수 없습니다.');
  const logs = db.logs.filter((l) => l.vehicle_id === vid && l.drive_date.startsWith(ym)).sort((a, b) => ms(a.depart_at) - ms(b.depart_at)).map((l) => shapeLog(l, user, withSig));
  const counted = logs.filter((l) => l.status !== 'draft');
  const live = {
    log_count: counted.length, total_distance: counted.reduce((s, l) => s + l.distance_km, 0),
    total_fuel_liters: Math.round(counted.reduce((s, l) => s + (l.fuel_liters || 0), 0) * 10) / 10,
    total_fuel_cost: counted.reduce((s, l) => s + (l.fuel_cost || 0), 0),
    odometer_first: counted[0]?.odometer_start ?? null, odometer_last: counted.at(-1)?.odometer_end ?? null,
  };
  const byPurpose = {};
  for (const l of counted) byPurpose[l.purpose_category] = (byPurpose[l.purpose_category] || 0) + 1;
  const mStart = ms(`${ym}-01T00:00:00+09:00`); const mEnd = ms(`${addMonths(ym, 1)}-01T00:00:00+09:00`);
  const missing = db.reservations.filter((r) => r.vehicle_id === vid && r.status === 'confirmed' && !logForRes(r.id) && ms(r.end_at) >= mStart && ms(r.end_at) < mEnd && ms(r.end_at) < Date.now())
    .sort(byStart).map((r) => ({ id: r.id, start_at: r.start_at, end_at: r.end_at, user_name: userById(r.user_id).name }));
  const ledger = ledgerOf(vid, ym);
  const approvals = ledger ? db.approvals.filter((a) => a.ledger_id === ledger.id).map((a) => ({ ...a, approver_name: userById(a.approver_id).name, signature: withSig ? a.signature : null })) : [];
  const status = ledger?.status ?? 'open';
  const round = ledger?.round ?? 0;
  const summary = ['submitted', 'approved'].includes(status) ? ledger.snapshot : live;
  const drafts = logs.filter((l) => l.status === 'draft');
  const blockers = [];
  if (drafts.length) blockers.push({ code: 'DRAFTS', message: `작성중인 운행일지 ${drafts.length}건이 있습니다.`, ids: drafts.map((l) => l.id) });
  if (missing.length) blockers.push({ code: 'MISSING', message: `운행일지가 입력되지 않은 예약 ${missing.length}건이 있습니다.`, ids: missing.map((r) => r.id) });
  if (ym > currentYm()) blockers.push({ code: 'FUTURE', message: '아직 오지 않은 달은 결재를 요청할 수 없습니다.' });
  const step = curStep(ledger);
  const steps = (['submitted', 'approved'].includes(status) && ledger.approval_steps) || settings().approval_steps; // F-14 스냅숏
  return {
    vehicle, year_month: ym, status, round,
    ledger: ledger ? { id: ledger.id, manager_comment: ledger.manager_comment, recall_reason: ledger.recall_reason, submitted_at: ledger.submitted_at, submitted_by: ledger.submitted_by, submitted_by_name: userById(ledger.submitted_by)?.name ?? null } : null,
    summary, live_summary: live, by_purpose: byPurpose, logs, missing_reservations: missing, mismatch_count: logs.filter((l) => l.mismatch).length, blockers,
    approval_steps: steps, show_drafter: settings().approval_show_drafter, approvals,
    current_step: status === 'submitted' ? step : null,
    current_step_name: status === 'submitted' ? steps.find((s) => s.order === step)?.name ?? null : null,
    last_rejection: approvals.filter((a) => a.decision === 'rejected').at(-1) ?? null,
    can_submit: hasRole(user, 'manager') && ['open', 'rejected'].includes(status) && !blockers.length,
    can_recall: hasRole(user, 'manager') && status === 'submitted',
    can_decide: status === 'submitted' && hasRole(user, 'approver') && user.approver_step === step,
  };
}
const parseYm = (v) => { if (!YM_RE.test(v || '')) throw bad('연월 형식이 올바르지 않습니다. (예: 2026-10)'); return v; };
function ledgerGet({ user, query }) {
  requireRole(user, 'manager', 'approver', 'admin');
  const vid = num(query.get('vehicle_id') || 0);
  if (!vid) throw bad('차량을 선택해 주세요.');
  return computeLedger(user, vid, parseYm(query.get('ym')), query.get('print') === '1');
}
function ledgerOverview({ user, query }) {
  requireRole(user, 'manager', 'approver', 'admin');
  const ym = parseYm(query.get('ym'));
  const rows = db.vehicles.map((v) => {
    const logs = db.logs.filter((l) => l.vehicle_id === v.id && l.drive_date.startsWith(ym));
    const done = logs.filter((l) => l.status !== 'draft');
    const m = ledgerOf(v.id, ym);
    return { vehicle_id: v.id, plate_no: v.plate_no, model: v.model, color: v.color, vehicle_status: v.status, status: m?.status ?? 'open', log_count: done.length, draft_count: logs.length - done.length, total_distance: done.reduce((s, l) => s + l.distance_km, 0), _keep: v.status !== 'retired' || logs.length || m };
  }).filter((r) => r._keep).map(({ _keep, ...r }) => r).sort((a, b) => a.plate_no.localeCompare(b.plate_no));
  return { year_month: ym, vehicles: rows };
}
function ledgerSubmit({ user, body }) {
  requireRole(user, 'manager');
  const ym = parseYm(body.year_month);
  const vid = num(body.vehicle_id || 0);
  const comment = (body.comment || '').trim();
  if (comment.length > 300) throw bad('입력값을 확인해 주세요.', { comment: '의견은 300자 이하로 입력해 주세요.' });
  const data = computeLedger(user, vid, ym);
  if (!['open', 'rejected'].includes(data.status)) throw conflict('이미 결재요청했거나 결재가 끝난 대장입니다.');
  if (data.blockers.length) throw conflict(data.blockers.map((b) => b.message).join(' '), { code: 'LEDGER_BLOCKED', blockers: data.blockers });
  let l = ledgerOf(vid, ym);
  if (!l) { l = { id: nextId('ledgers'), vehicle_id: vid, year_month: ym, round: 0, recall_reason: '' }; db.ledgers.push(l); }
  Object.assign(l, { status: 'submitted', round: l.round + 1, snapshot: data.live_summary, approval_steps: structuredClone(settings().approval_steps), manager_comment: comment, recall_reason: '', submitted_by: user.id, submitted_at: nowIso() });
  return computeLedger(user, vid, ym);
}
function ledgerRecall({ user, params, body }) {
  requireRole(user, 'manager');
  const why = (body.reason || '').trim();
  if (why.length < 2 || why.length > 200) throw bad('입력값을 확인해 주세요.', { reason: '회수 사유를 2~200자로 입력해 주세요.' });
  const l = db.ledgers.find((x) => x.id === params.id && x.status === 'submitted');
  if (!l) throw conflict('결재 진행 중인 대장만 회수할 수 있습니다.');
  l.status = 'open'; l.recall_reason = why;
  return computeLedger(user, l.vehicle_id, l.year_month);
}
async function ledgerDecide({ user, params, body }) {
  requireRole(user, 'approver');
  const decision = body.decision;
  if (!['approved', 'rejected'].includes(decision)) throw bad('결재 또는 반려를 선택해 주세요.');
  const comment = (body.comment || '').trim();
  if (decision === 'rejected' && (comment.length < 5 || comment.length > 300)) throw bad('입력값을 확인해 주세요.', { comment: '반려 사유를 5자 이상 입력해 주세요.' });
  const l = db.ledgers.find((x) => x.id === params.id);
  if (!l) throw notFound('대장을 찾을 수 없습니다.');
  if (l.status !== 'submitted') throw conflict('결재 진행 중인 대장이 아닙니다.');
  const steps = l.approval_steps || settings().approval_steps;
  const step = curStep(l);
  const info = steps.find((s) => s.order === step);
  if (!info) throw conflict('결재 단계 설정을 확인해 주세요.');
  if (user.approver_step !== step) throw forbidden(user.approver_step > step ? '이전 단계 결재가 끝나지 않았습니다.' : `현재는 ${info.name} 결재 단계입니다.`);
  const sig = decision === 'approved' ? await verifySignature(user, body.signature) : null;
  db.approvals.push({ id: nextId('approvals'), ledger_id: l.id, round: l.round, step_order: step, step_name: info.name, approver_id: user.id, decision, signature: sig?.signature ?? null, signature_type: sig?.signature_type ?? null, comment, decided_at: nowIso() });
  if (decision === 'rejected') l.status = 'rejected';
  else if (step === Math.max(...steps.map((s) => s.order))) {
    l.status = 'approved';
    for (const x of db.logs) if (x.vehicle_id === l.vehicle_id && x.drive_date.startsWith(l.year_month) && x.status === 'submitted') x.status = 'locked';
  }
  return computeLedger(user, l.vehicle_id, l.year_month);
}
function pendingFor(user) {
  if (!hasRole(user, 'approver') || !user.approver_step) return [];
  return db.ledgers.filter((l) => l.status === 'submitted' && curStep(l) === user.approver_step).map((l) => {
    const v = vehById(l.vehicle_id);
    return { id: l.id, vehicle_id: l.vehicle_id, year_month: l.year_month, round: l.round, total_distance: l.snapshot.total_distance, log_count: l.snapshot.log_count, submitted_at: l.submitted_at, plate_no: v.plate_no, model: v.model, step: curStep(l) };
  });
}

// ───────── 결재라인 (F-14) ─────────
function approvalLineData() {
  const s = settings();
  return {
    steps: s.approval_steps.map((st) => ({ order: st.order, name: st.name,
      approvers: db.users.filter((u) => u.is_active && u.roles.includes('approver') && u.approver_step === st.order).map((u) => ({ id: u.id, name: u.name, team: u.team })) })),
    show_drafter: s.approval_show_drafter ?? true,
    candidates: db.users.filter((u) => u.is_active).map((u) => ({ id: u.id, name: u.name, team: u.team })).sort((a, b) => a.name.localeCompare(b.name)),
    in_progress: db.ledgers.filter((l) => l.status === 'submitted').length,
  };
}
function approvalLineSave({ user, body }) {
  requireRole(user, 'admin');
  const { value, errors } = validateApprovalLine(body);
  if (hasErrors(errors)) throw bad(errors.steps || '입력값을 확인해 주세요.', errors);
  const ids = value.steps.flatMap((st) => st.approver_ids);
  if (ids.some((id) => !userById(id)?.is_active)) throw bad('사용 중지되었거나 없는 직원이 결재자로 지정되어 있습니다. 다시 선택해 주세요.');
  const n = db.ledgers.filter((l) => l.status === 'submitted').length;
  if (n) throw conflict(`결재 진행 중인 대장이 ${n}건 있어 결재라인을 바꿀 수 없습니다. 결재를 마치거나 회수한 뒤 다시 시도하세요.`, { code: 'APPROVAL_IN_PROGRESS' });
  db.settings.approval_steps = value.steps.map(({ order, name }) => ({ order, name }));
  db.settings.approval_show_drafter = value.show_drafter;
  for (const u of db.users) {
    if (ids.includes(u.id) || !(u.approver_step || u.roles.includes('approver'))) continue;
    u.approver_step = null;
    u.roles = u.roles.filter((r) => r !== 'approver');
    if (!u.roles.length) u.roles = ['staff']; // 역할이 비지 않게
  }
  for (const st of value.steps) for (const id of st.approver_ids) {
    const u = userById(id); u.approver_step = st.order;
    if (!u.roles.includes('approver')) u.roles = [...u.roles, 'approver'];
  }
  return approvalLineData();
}

// ───────── 대시보드 ─────────
function dashboard({ user }) {
  const today = todayYmd();
  const dS = ms(`${today}T00:00:00+09:00`); const dE = ms(`${addDays(today, 1)}T00:00:00+09:00`);
  const now = Date.now(); const ym = currentYm();
  const isManager = hasRole(user, 'manager');
  const todays = db.reservations.filter((r) => ms(r.start_at) < dE && ms(r.end_at) > dS && ACTIVE.includes(r.status)).sort(byStart);
  const missing = db.reservations.filter((r) => (isManager || r.user_id === user.id) && r.status === 'confirmed' && !logForRes(r.id) && ms(r.end_at) < now).sort(byStart);
  const out = {
    today,
    today_reservations: todays.map((r) => shapeRes(r, user)),
    vehicles: db.vehicles.filter((v) => v.status !== 'retired').map((v) => {
      const inUse = db.reservations.some((r) => r.vehicle_id === v.id && ['confirmed', 'completed'].includes(r.status) && ms(r.start_at) <= now && ms(r.end_at) > now);
      return { ...v, in_use: inUse, state: v.status === 'maintenance' ? 'maintenance' : inUse ? 'in_use' : 'available', today: todays.filter((r) => r.vehicle_id === v.id).map((r) => ({ start_at: r.start_at, end_at: r.end_at, user_name: userById(r.user_id).name })) };
    }),
    my_upcoming: db.reservations.filter((r) => r.user_id === user.id && ['requested', 'confirmed'].includes(r.status) && ms(r.end_at) > now).sort(byStart).slice(0, 5).map((r) => shapeRes(r, user)),
    missing_logs: missing.filter((r) => r.user_id === user.id).map((r) => shapeRes(r, user)),
    my_drafts: db.logs.filter((l) => l.status === 'draft' && (l.created_by === user.id || l.driver_id === user.id)).map((l) => { const v = vehById(l.vehicle_id); return { id: l.id, drive_date: l.drive_date, plate_no: v.plate_no, model: v.model }; }),
  };
  if (isManager) {
    out.month = ym;
    out.month_stats = db.vehicles.filter((v) => v.status !== 'retired').map((v) => {
      const ls = db.logs.filter((l) => l.vehicle_id === v.id && l.status !== 'draft' && l.drive_date.startsWith(ym));
      return { vehicle_id: v.id, plate_no: v.plate_no, model: v.model, color: v.color, log_count: ls.length, total_distance: ls.reduce((s, l) => s + l.distance_km, 0), total_fuel_liters: ls.reduce((s, l) => s + (l.fuel_liters || 0), 0), total_fuel_cost: ls.reduce((s, l) => s + (l.fuel_cost || 0), 0) };
    });
    out.mismatch_count = db.logs.filter((l) => l.drive_date.startsWith(ym) && prevEnd(l) !== l.odometer_start).length;
    out.all_missing_logs = missing.map((r) => shapeRes(r, user));
    out.last_month = addMonths(ym, -1);
    out.last_month_ledgers = db.vehicles.filter((v) => v.status !== 'retired').map((v) => ({ vehicle_id: v.id, plate_no: v.plate_no, model: v.model, status: ledgerOf(v.id, out.last_month)?.status ?? 'open' }));
    out.requested_reservations = db.reservations.filter((r) => r.status === 'requested' && ms(r.end_at) > now).map((r) => shapeRes(r, user));
  }
  if (hasRole(user, 'approver')) out.pending_approvals = pendingFor(user);
  return out;
}

// ───────── 라우팅 ─────────
const table = [
  ['POST', '/auth/login', login, { public: true }], ['POST', '/auth/logout', logout, { public: true }], ['GET', '/auth/me', me, { public: true }],
  ['POST', '/auth/password', changePassword, { allowPw: true }], ['PATCH', '/auth/me', updateMe],
  ['GET', '/vehicles', vehicleList], ['POST', '/vehicles', vehicleCreate], ['PATCH', '/vehicles/:id', vehicleUpdate],
  ['GET', '/users/options', userOptions], ['GET', '/users', userList], ['POST', '/users', userCreate], ['PATCH', '/users/:id', userUpdate], ['POST', '/users/:id/reset-password', userReset],
  ['GET', '/reservations', resList], ['GET', '/reservations/:id', resGet], ['POST', '/reservations', resCreate], ['PATCH', '/reservations/:id', resUpdate],
  ['POST', '/reservations/:id/cancel', resCancel], ['POST', '/reservations/:id/confirm', resConfirm], ['POST', '/reservations/:id/no-show', resNoShow],
  ['GET', '/usage-logs', logList], ['GET', '/usage-logs/new', logPrefill], ['GET', '/usage-logs/:id', logGet], ['POST', '/usage-logs', logCreate], ['PATCH', '/usage-logs/:id', logUpdate],
  ['GET', '/ledgers', ledgerGet], ['GET', '/ledgers/overview', ledgerOverview], ['POST', '/ledgers/submit', ledgerSubmit],
  ['POST', '/ledgers/:id/recall', ledgerRecall], ['POST', '/ledgers/:id/decide', ledgerDecide], ['GET', '/approvals/pending', ({ user }) => { requireRole(user, 'approver'); return { ledgers: pendingFor(user) }; }],
  ['GET', '/approval-line', () => approvalLineData()], ['PUT', '/approval-line', approvalLineSave],
  ['GET', '/dashboard', dashboard], ['GET', '/settings', () => ({ settings: settings() })],
].map(([method, pattern, fn, opts = {}]) => ({ method, re: new RegExp(`^${pattern.replace(':id', '(\\d+)')}$`), fn, opts }));

/** api.js 와 같은 형식으로 응답하거나 { status, message, extra } 오류를 던진다 */
export async function demoRequest(method, fullPath, body) {
  await ensure();
  const [path, qstr = ''] = fullPath.split('?');
  const query = new URLSearchParams(qstr);
  for (const r of table) {
    const m = r.re.exec(path);
    if (!m || r.method !== method) continue;
    const user = currentUser();
    if (!r.opts.public) {
      if (!user) throw E(401, '로그인이 필요합니다.', { code: 'UNAUTHENTICATED' });
      if (user.must_change_password && !r.opts.allowPw) throw E(403, '처음 로그인했거나 비밀번호가 초기화되었습니다. 비밀번호를 먼저 변경해 주세요.', { code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    const out = await r.fn({ user, params: m[1] ? { id: num(m[1]) } : {}, query, body: body || {} });
    persist();
    return structuredClone(out);
  }
  throw E(404, '요청한 기능을 찾을 수 없습니다.');
}
