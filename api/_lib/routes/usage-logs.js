// F-04 운행일지(차량사용대장)
import { validateUsageLog, hasErrors, computeTrip, isValidYmd } from '../../../js/utils/validate.js';
import { todayYmd } from '../../../js/utils/format.js';
import { badRequest, conflict, forbidden, notFound } from '../http.js';
import { requireUser, hasRole } from '../session.js';
import { audit } from '../audit.js';
import { getSettings } from '../settings.js';
import { verifySignature } from '../signature.js';

const PAGE_SIZE = 20;

/** 같은 차량 직전 운행의 도착 계기판 (없으면 차량 최초 계기판) — F-04 규칙 2 */
export async function expectedOdometer(sql, vehicleId, departAt, excludeId = 0) {
  const [prev] = await sql`
    select odometer_end from usage_logs
    where vehicle_id = ${vehicleId} and depart_at < ${departAt} and id <> ${excludeId}
    order by depart_at desc limit 1`;
  if (prev) return prev.odometer_end;
  const [v] = await sql`select initial_odometer from vehicles where id = ${vehicleId}`;
  return v ? v.initial_odometer : 0;
}

/** 해당 차량·월 대장이 결재요청/결재완료 상태이면 운행일지 변경 불가 — F-05 규칙 4 */
export async function assertLedgerEditable(sql, vehicleId, ym) {
  const [l] = await sql`select status from monthly_ledgers where vehicle_id = ${vehicleId} and year_month = ${ym}`;
  if (l && l.status === 'submitted') throw conflict('이 달 차량대장이 결재 진행 중이라 수정할 수 없습니다. 차량담당자에게 회수를 요청하세요.');
  if (l && l.status === 'approved') throw conflict('결재가 끝난 달의 기록이라 수정할 수 없습니다.');
}

/** 목록 공통: 전체 운행 기준 직전 도착 km(prev_end)를 함께 계산 */
export function logsQuery(sql, where, { withSignature = false } = {}) {
  return sql`
    select x.* from (
      select l.id, l.reservation_id, l.vehicle_id, l.driver_id, l.drive_date, l.depart_at, l.return_at,
             l.odometer_start, l.odometer_end, l.distance_km, l.destination, l.purpose_category,
             l.passenger_count, l.fuel_liters::float8 as fuel_liters, l.fuel_cost, l.note, l.mismatch_reason,
             l.signature_type, l.signed_at, l.status, l.created_by, l.created_at, l.updated_at,
             ${withSignature ? sql`l.driver_signature` : sql`null::text as driver_signature`},
             v.plate_no, v.model, v.color, u.name as driver_name,
             coalesce(lag(l.odometer_end) over (partition by l.vehicle_id order by l.depart_at), v.initial_odometer) as prev_end
      from usage_logs l
      join vehicles v on v.id = l.vehicle_id
      join users u on u.id = l.driver_id
    ) x
    where ${where}`;
}

export function shapeLog(l, user) {
  const mine = l.created_by === user.id || l.driver_id === user.id;
  return {
    ...l,
    mismatch: l.prev_end !== null && l.prev_end !== l.odometer_start,
    can_edit: l.status !== 'locked' && (mine || hasRole(user, 'manager')),
  };
}

async function list({ sql, user, query }) {
  const vehicleId = Number(query.get('vehicle_id') || 0);
  const driverId = query.get('mine') === '1' ? user.id : Number(query.get('driver_id') || 0);
  const status = query.get('status') || '';
  const from = query.get('from') || '';
  const to = query.get('to') || '';
  const q = (query.get('q') || '').trim();
  const page = Math.max(1, Number(query.get('page') || 1));
  if ((from && !isValidYmd(from)) || (to && !isValidYmd(to))) throw badRequest('기간 형식이 올바르지 않습니다.');
  const where = sql`
    (${vehicleId} = 0 or x.vehicle_id = ${vehicleId})
    and (${driverId} = 0 or x.driver_id = ${driverId} or x.created_by = ${driverId})
    and (${status} = '' or x.status = ${status})
    and (${from} = '' or x.drive_date >= ${from || '1900-01-01'}::date)
    and (${to} = '' or x.drive_date <= ${to || '2999-12-31'}::date)
    and (${q} = '' or x.destination ilike ${'%' + q + '%'})`;
  const rows = await sql`
    select y.*, count(*) over () as total from (${logsQuery(sql, where)}) y
    order by y.depart_at desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
  const total = rows.length ? Number(rows[0].total) : 0;
  return {
    logs: rows.map(({ total: _t, ...l }) => shapeLog(l, user)),
    page, page_size: PAGE_SIZE, total,
  };
}

async function getOne({ sql, user, params }) {
  const [l] = await logsQuery(sql, sql`x.id = ${params.id}`, { withSignature: true });
  if (!l) throw notFound('운행일지를 찾을 수 없습니다.');
  return { log: shapeLog(l, user) };
}

/** 새 운행일지 초안: 예약 정보 + 직전 계기판 */
async function prefill({ sql, user, query }) {
  requireUser(user);
  const reservationId = Number(query.get('reservation_id') || 0);
  if (reservationId) {
    const [r] = await sql`
      select r.*, v.plate_no, v.model, v.seats, l.id as log_id from reservations r
      join vehicles v on v.id = r.vehicle_id
      left join usage_logs l on l.reservation_id = r.id
      where r.id = ${reservationId}`;
    if (!r) throw notFound('예약을 찾을 수 없습니다.');
    if (r.user_id !== user.id && !hasRole(user, 'manager')) throw forbidden('본인 예약의 운행일지만 작성할 수 있습니다.');
    if (r.log_id) throw conflict('이미 운행일지가 작성된 예약입니다.', { usage_log_id: r.log_id });
    return {
      reservation: { id: r.id, start_at: r.start_at, end_at: r.end_at, status: r.status },
      vehicle: { id: r.vehicle_id, plate_no: r.plate_no, model: r.model, seats: r.seats },
      draft: {
        reservation_id: r.id, vehicle_id: r.vehicle_id, driver_id: r.user_id,
        destination: r.destination, purpose_category: r.purpose_category, passenger_count: r.passenger_count,
        start_at: r.start_at, end_at: r.end_at,
      },
      expected_odometer_start: await expectedOdometer(sql, r.vehicle_id, r.start_at),
    };
  }
  if (!hasRole(user, 'manager')) throw forbidden('예약 없이 운행일지를 만들 권한은 차량담당자에게만 있습니다.');
  const vehicleId = Number(query.get('vehicle_id') || 0);
  if (!vehicleId) return { reservation: null, vehicle: null, draft: null, expected_odometer_start: null };
  const [v] = await sql`select id, plate_no, model, seats from vehicles where id = ${vehicleId}`;
  if (!v) throw notFound('차량을 찾을 수 없습니다.');
  return { reservation: null, vehicle: v, draft: { vehicle_id: v.id }, expected_odometer_start: await expectedOdometer(sql, v.id, new Date()) };
}

/** 생성·수정 공통 검증. 반환: 저장할 값 */
async function prepare(sql, user, input, existing) {
  const settings = await getSettings(sql);
  const merged = existing
    ? { ...input, reservation_id: existing.reservation_id, vehicle_id: existing.reservation_id ? existing.vehicle_id : input.vehicle_id }
    : input;
  const { value, errors } = validateUsageLog(merged, settings);
  if (hasErrors(errors)) throw badRequest('입력값을 확인해 주세요.', errors);
  const isManager = hasRole(user, 'manager');

  if (!existing) {
    if (value.reservation_id) {
      const [r] = await sql`
        select r.*, l.id as log_id from reservations r left join usage_logs l on l.reservation_id = r.id
        where r.id = ${value.reservation_id}`;
      if (!r) throw badRequest('연결할 예약을 찾을 수 없습니다.');
      if (r.user_id !== user.id && !isManager) throw forbidden('본인 예약의 운행일지만 작성할 수 있습니다.');
      if (r.log_id) throw conflict('이미 운행일지가 작성된 예약입니다.', { usage_log_id: r.log_id });
      if (r.status !== 'confirmed') throw conflict('확정된 예약만 운행일지를 작성할 수 있습니다.');
      value.vehicle_id = r.vehicle_id;
    } else if (!isManager) {
      throw forbidden('예약 없이 운행일지를 만들 권한은 차량담당자에게만 있습니다.');
    }
  }

  const [v] = await sql`select * from vehicles where id = ${value.vehicle_id}`;
  if (!v) throw badRequest('입력값을 확인해 주세요.', { vehicle_id: '차량을 다시 선택해 주세요.' });
  if (value.passenger_count > v.seats - 1) {
    throw badRequest('입력값을 확인해 주세요.', { passenger_count: `이 차량의 동승 가능 인원은 최대 ${v.seats - 1}명입니다.` });
  }
  const [d] = await sql`select id from users where id = ${value.driver_id} and is_active and can_drive`;
  if (!d && !(existing && existing.driver_id === value.driver_id)) {
    throw badRequest('입력값을 확인해 주세요.', { driver_id: '운전 가능한 직원을 선택해 주세요.' });
  }
  if (value.drive_date > todayYmd()) throw badRequest('입력값을 확인해 주세요.', { drive_date: '운행일은 오늘 이후로 입력할 수 없습니다.' });

  const trip = computeTrip(value.drive_date, value.depart_time, value.return_time);
  await assertLedgerEditable(sql, value.vehicle_id, value.drive_date.slice(0, 7));
  if (existing) await assertLedgerEditable(sql, existing.vehicle_id, existing.drive_date.slice(0, 7));

  const expected = await expectedOdometer(sql, value.vehicle_id, trip.depart_at, existing?.id ?? 0);
  if (value.odometer_start !== expected) {
    if (!value.mismatch_reason) {
      const msg = `직전 운행의 도착 계기판(${expected.toLocaleString('ko-KR')}km)과 다릅니다. 사유를 선택해 주세요.`;
      throw badRequest(msg, { mismatch_reason: msg }, { code: 'ODOMETER_MISMATCH', expected });
    }
  } else {
    value.mismatch_reason = '';
  }
  return { value, trip, expected };
}

async function create({ sql, user, body }) {
  requireUser(user);
  const input = await body();
  const { value, trip } = await prepare(sql, user, input, null);
  const submit = input.submit === true;
  const sig = submit ? await verifySignature(sql, user, input.signature) : null;
  const id = await sql.begin(async (tx) => {
    const [row] = await tx`
      insert into usage_logs (reservation_id, vehicle_id, driver_id, drive_date, depart_at, return_at,
        odometer_start, odometer_end, destination, purpose_category, passenger_count, fuel_liters, fuel_cost,
        note, mismatch_reason, driver_signature, signature_type, signed_at, status, created_by)
      values (${value.reservation_id}, ${value.vehicle_id}, ${value.driver_id}, ${value.drive_date},
        ${trip.depart_at}, ${trip.return_at}, ${value.odometer_start}, ${value.odometer_end}, ${value.destination},
        ${value.purpose_category}, ${value.passenger_count}, ${value.fuel_liters}, ${value.fuel_cost}, ${value.note},
        ${value.mismatch_reason}, ${sig?.signature ?? null}, ${sig?.signature_type ?? null},
        ${sig ? new Date() : null}, ${submit ? 'submitted' : 'draft'}, ${user.id})
      returning id`;
    if (submit && value.reservation_id) {
      await tx`update reservations set status = 'completed', updated_at = now() where id = ${value.reservation_id}`;
    }
    return row.id;
  });
  await audit(sql, user.id, submit ? 'usage_log_submit' : 'usage_log_draft', 'usage_log', id, {
    vehicle_id: value.vehicle_id, distance: value.odometer_end - value.odometer_start, mismatch: !!value.mismatch_reason,
  });
  return getOne({ sql, user, params: { id } });
}

async function update({ sql, user, params, body }) {
  requireUser(user);
  const [old] = await sql`select * from usage_logs where id = ${params.id}`;
  if (!old) throw notFound('운행일지를 찾을 수 없습니다.');
  const mine = old.created_by === user.id || old.driver_id === user.id;
  if (!mine && !hasRole(user, 'manager')) throw forbidden('본인 운행일지만 수정할 수 있습니다.');
  if (old.status === 'locked') throw conflict('결재가 끝난 기록이라 수정할 수 없습니다.');
  const input = await body();
  const { value, trip } = await prepare(sql, user, input, old);
  // 제출된 기록을 고치면 서명이 무효가 되므로 다시 서명해야 한다 (F-07 규칙 5)
  const submit = input.submit === true || old.status === 'submitted';
  const sig = submit ? await verifySignature(sql, user, input.signature) : null;
  await sql.begin(async (tx) => {
    await tx`
      update usage_logs set driver_id = ${value.driver_id}, drive_date = ${value.drive_date},
        depart_at = ${trip.depart_at}, return_at = ${trip.return_at}, odometer_start = ${value.odometer_start},
        odometer_end = ${value.odometer_end}, destination = ${value.destination},
        purpose_category = ${value.purpose_category}, passenger_count = ${value.passenger_count},
        fuel_liters = ${value.fuel_liters}, fuel_cost = ${value.fuel_cost}, note = ${value.note},
        mismatch_reason = ${value.mismatch_reason},
        driver_signature = ${sig?.signature ?? null}, signature_type = ${sig?.signature_type ?? null},
        signed_at = ${sig ? new Date() : null},
        status = ${submit ? 'submitted' : 'draft'}, updated_at = now()
      where id = ${old.id}`;
    if (submit && old.reservation_id) {
      await tx`update reservations set status = 'completed', updated_at = now() where id = ${old.reservation_id}`;
    }
  });
  await audit(sql, user.id, 'usage_log_update', 'usage_log', old.id, {
    status: [old.status, submit ? 'submitted' : 'draft'],
    odometer_start: [old.odometer_start, value.odometer_start],
    odometer_end: [old.odometer_end, value.odometer_end],
    drive_date: [old.drive_date, value.drive_date],
  });
  return getOne({ sql, user, params: { id: old.id } });
}

export const routes = [
  ['GET', '/usage-logs', list],
  ['GET', '/usage-logs/new', prefill],
  ['GET', '/usage-logs/:id', getOne],
  ['POST', '/usage-logs', create],
  ['PATCH', '/usage-logs/:id', update],
];
