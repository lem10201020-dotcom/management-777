// F-03 차량예약·캘린더
import { validateReservation, hasErrors, isValidYmd } from '../../../js/utils/validate.js';
import { rangeLabel, addDays, todayYmd } from '../../../js/utils/format.js';
import { badRequest, conflict, forbidden, notFound } from '../http.js';
import { requireRole, requireUser, hasRole } from '../session.js';
import { audit } from '../audit.js';
import { getSettings } from '../settings.js';

const ACTIVE = ['requested', 'confirmed', 'completed'];

export function selectReservations(sql, where) {
  return sql`
    select r.*, v.plate_no, v.model, v.color, v.seats, u.name as user_name,
           l.id as usage_log_id, l.status as usage_log_status
    from reservations r
    join vehicles v on v.id = r.vehicle_id
    join users u on u.id = r.user_id
    left join usage_logs l on l.reservation_id = r.id
    where ${where}
    order by r.start_at`;
}

/** 목적 메모는 본인·차량담당자만 본다 (F-03 규칙 6) */
export function shape(r, user) {
  const isOwner = r.user_id === user.id;
  const isManager = hasRole(user, 'manager');
  const startPassed = new Date(r.start_at).getTime() <= Date.now();
  return {
    id: r.id, vehicle_id: r.vehicle_id, user_id: r.user_id, user_name: r.user_name,
    vehicle: { plate_no: r.plate_no, model: r.model, color: r.color, seats: r.seats },
    start_at: r.start_at, end_at: r.end_at, destination: r.destination,
    purpose_category: r.purpose_category,
    purpose_note: isOwner || isManager ? r.purpose_note : null,
    passenger_count: r.passenger_count, status: r.status, cancel_reason: r.cancel_reason,
    usage_log_id: r.usage_log_id ?? null, usage_log_status: r.usage_log_status ?? null,
    can_edit: ['requested', 'confirmed'].includes(r.status) && !r.usage_log_id && (isManager || (isOwner && !startPassed)),
    can_cancel: ['requested', 'confirmed'].includes(r.status) && !r.usage_log_id && (isManager || (isOwner && !startPassed)),
    can_write_log: r.status === 'confirmed' && !r.usage_log_id && (isOwner || isManager),
  };
}

async function list({ sql, user, query }) {
  const from = query.get('from') || todayYmd();
  const to = query.get('to') || addDays(from, 1);
  if (!isValidYmd(from) || !isValidYmd(to)) throw badRequest('기간 형식이 올바르지 않습니다.');
  const vehicleId = Number(query.get('vehicle_id') || 0);
  const includeCancelled = query.get('include_cancelled') === '1';
  const fromTs = `${from}T00:00:00+09:00`;
  const toTs = `${addDays(to, 1)}T00:00:00+09:00`; // to 날짜 포함
  const rows = await selectReservations(sql, sql`
    r.start_at < ${toTs} and r.end_at > ${fromTs}
    and (${vehicleId} = 0 or r.vehicle_id = ${vehicleId})
    and (${includeCancelled} or r.status <> 'cancelled')`);
  return { reservations: rows.map((r) => shape(r, user)) };
}

async function getOne({ sql, user, params }) {
  const [r] = await selectReservations(sql, sql`r.id = ${params.id}`);
  if (!r) throw notFound('예약을 찾을 수 없습니다.');
  return { reservation: shape(r, user) };
}

/** 같은 시간 빈 차량 제안 */
async function freeVehicles(sql, startTs, endTs, passengers, excludeId = 0) {
  return sql`
    select v.id, v.plate_no, v.model from vehicles v
    where v.status = 'available' and v.seats >= ${passengers + 1}
      and not exists (
        select 1 from reservations r where r.vehicle_id = v.id and r.id <> ${excludeId}
          and r.status = any(${ACTIVE}) and r.start_at < ${endTs} and r.end_at > ${startTs})
    order by v.plate_no`;
}

async function conflictError(sql, value, startTs, endTs, excludeId = 0) {
  const [c] = await sql`
    select r.start_at, r.end_at, u.name from reservations r join users u on u.id = r.user_id
    where r.vehicle_id = ${value.vehicle_id} and r.id <> ${excludeId} and r.status = any(${ACTIVE})
      and r.start_at < ${endTs} and r.end_at > ${startTs}
    order by r.start_at limit 1`;
  const suggestions = await freeVehicles(sql, startTs, endTs, value.passenger_count, excludeId);
  const msg = c
    ? `${c.name}님이 ${rangeLabel(c.start_at, c.end_at)}에 이미 예약했습니다.`
    : '같은 시간에 이미 예약이 있습니다.';
  return conflict(msg, { code: 'RESERVATION_OVERLAP', fields: { start_at: msg }, suggestions });
}

async function checkCommon(sql, user, value, { isCreate }) {
  const [v] = await sql`select * from vehicles where id = ${value.vehicle_id}`;
  if (!v || v.status !== 'available') throw badRequest('입력값을 확인해 주세요.', { vehicle_id: '사용 가능한 차량을 선택해 주세요.' });
  if (value.passenger_count > v.seats - 1) {
    throw badRequest('입력값을 확인해 주세요.', { passenger_count: `이 차량의 동승 가능 인원은 최대 ${v.seats - 1}명입니다.` });
  }
  const isManager = hasRole(user, 'manager');
  if (!isManager && value.start_ms < Date.now() - 5 * 60_000) {
    throw badRequest('입력값을 확인해 주세요.', { start_at: '지난 시각으로는 예약할 수 없습니다.' });
  }
  let ownerId = user.id;
  if (value.user_id && value.user_id !== user.id) {
    if (!isManager) throw forbidden('다른 직원 이름으로 예약할 권한이 없습니다.');
    const [u] = await sql`select id from users where id = ${value.user_id} and is_active`;
    if (!u) throw badRequest('입력값을 확인해 주세요.', { user_id: '예약자를 다시 선택해 주세요.' });
    ownerId = u.id;
  }
  return { vehicle: v, ownerId, isCreate };
}

async function create({ sql, user, body }) {
  requireUser(user);
  const settings = await getSettings(sql);
  const { value, errors } = validateReservation(await body(), settings);
  if (hasErrors(errors)) throw badRequest('입력값을 확인해 주세요.', errors);
  const { ownerId } = await checkCommon(sql, user, value, { isCreate: true });
  const startTs = new Date(value.start_ms);
  const endTs = new Date(value.end_ms);
  const status = settings.approval_mode === 'manual' ? 'requested' : 'confirmed';
  try {
    const [r] = await sql`
      insert into reservations (vehicle_id, user_id, start_at, end_at, destination, purpose_category,
                                purpose_note, passenger_count, status, created_by)
      values (${value.vehicle_id}, ${ownerId}, ${startTs}, ${endTs}, ${value.destination}, ${value.purpose_category},
              ${value.purpose_note}, ${value.passenger_count}, ${status}, ${user.id})
      returning id`;
    await audit(sql, user.id, 'reservation_create', 'reservation', r.id, { vehicle_id: value.vehicle_id, status });
    return getOne({ sql, user, params: { id: r.id } });
  } catch (e) {
    if (e.code === '23P01') throw await conflictError(sql, value, startTs, endTs);
    throw e;
  }
}

async function loadEditable(sql, user, id) {
  const [r] = await selectReservations(sql, sql`r.id = ${id}`);
  if (!r) throw notFound('예약을 찾을 수 없습니다.');
  const s = shape(r, user);
  if (r.user_id !== user.id && !hasRole(user, 'manager')) throw forbidden('본인 예약만 바꿀 수 있습니다.');
  return { r, s };
}

async function update({ sql, user, params, body }) {
  requireUser(user);
  const { r, s } = await loadEditable(sql, user, params.id);
  if (!s.can_edit) throw conflict('이 예약은 더 이상 수정할 수 없습니다. (시작 시각이 지났거나 취소·운행완료된 예약)');
  const settings = await getSettings(sql);
  const input = await body();
  const { value, errors } = validateReservation({ ...input, user_id: input.user_id ?? r.user_id }, settings);
  if (hasErrors(errors)) throw badRequest('입력값을 확인해 주세요.', errors);
  const { ownerId } = await checkCommon(sql, user, value, { isCreate: false });
  const startTs = new Date(value.start_ms);
  const endTs = new Date(value.end_ms);
  try {
    await sql`
      update reservations set vehicle_id = ${value.vehicle_id}, user_id = ${ownerId}, start_at = ${startTs},
        end_at = ${endTs}, destination = ${value.destination}, purpose_category = ${value.purpose_category},
        purpose_note = ${value.purpose_note}, passenger_count = ${value.passenger_count}, updated_at = now()
      where id = ${r.id}`;
  } catch (e) {
    if (e.code === '23P01') throw await conflictError(sql, value, startTs, endTs, r.id);
    throw e;
  }
  await audit(sql, user.id, 'reservation_update', 'reservation', r.id, {
    start_at: [r.start_at, startTs], vehicle_id: [r.vehicle_id, value.vehicle_id],
  });
  return getOne({ sql, user, params: { id: r.id } });
}

async function cancel({ sql, user, params, body }) {
  requireUser(user);
  const { r, s } = await loadEditable(sql, user, params.id);
  if (!s.can_cancel) throw conflict('이 예약은 취소할 수 없습니다. (시작 시각이 지났거나 이미 처리된 예약)');
  const { reason } = await body();
  const why = typeof reason === 'string' ? reason.trim().slice(0, 100) : '';
  await sql`update reservations set status = 'cancelled', cancel_reason = ${why}, updated_at = now() where id = ${r.id}`;
  await audit(sql, user.id, 'reservation_cancel', 'reservation', r.id, { reason: why });
  return getOne({ sql, user, params: { id: r.id } });
}

async function confirm({ sql, user, params }) {
  requireRole(user, 'manager');
  const [r] = await sql`select * from reservations where id = ${params.id}`;
  if (!r) throw notFound('예약을 찾을 수 없습니다.');
  if (r.status !== 'requested') throw conflict('신청 상태인 예약만 확정할 수 있습니다.');
  await sql`update reservations set status = 'confirmed', updated_at = now() where id = ${r.id}`;
  await audit(sql, user.id, 'reservation_confirm', 'reservation', r.id);
  return getOne({ sql, user, params: { id: r.id } });
}

async function noShow({ sql, user, params }) {
  requireRole(user, 'manager');
  const [r] = await sql`
    select r.*, l.id as log_id from reservations r left join usage_logs l on l.reservation_id = r.id
    where r.id = ${params.id}`;
  if (!r) throw notFound('예약을 찾을 수 없습니다.');
  if (r.status !== 'confirmed' || r.log_id || r.end_at.getTime() > Date.now()) {
    throw conflict('종료 시각이 지났고 운행일지가 없는 확정 예약만 미사용 처리할 수 있습니다.');
  }
  await sql`update reservations set status = 'no_show', updated_at = now() where id = ${r.id}`;
  await audit(sql, user.id, 'reservation_no_show', 'reservation', r.id);
  return getOne({ sql, user, params: { id: r.id } });
}

export const routes = [
  ['GET', '/reservations', list],
  ['GET', '/reservations/:id', getOne],
  ['POST', '/reservations', create],
  ['PATCH', '/reservations/:id', update],
  ['POST', '/reservations/:id/cancel', cancel],
  ['POST', '/reservations/:id/confirm', confirm],
  ['POST', '/reservations/:id/no-show', noShow],
];
