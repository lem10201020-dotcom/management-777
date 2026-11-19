// F-08 차량 관리
import { validateVehicle, hasErrors } from '../../../js/utils/validate.js';
import { badRequest, conflict, notFound } from '../http.js';
import { requireRole } from '../session.js';
import { audit } from '../audit.js';
import { currentYm } from '../../../js/utils/format.js';

async function list({ sql, query }) {
  const q = (query.get('q') || '').trim();
  const status = query.get('status') || '';
  const ym = currentYm();
  const rows = await sql`
    select v.*,
      coalesce((select max(odometer_end) from usage_logs l where l.vehicle_id = v.id), v.initial_odometer) as current_odometer,
      coalesce((select sum(distance_km) from usage_logs l where l.vehicle_id = v.id
                 and l.status <> 'draft' and to_char(l.drive_date, 'YYYY-MM') = ${ym}), 0)::int as month_distance,
      exists (select 1 from usage_logs l where l.vehicle_id = v.id) as has_logs
    from vehicles v
    where (${q} = '' or v.plate_no ilike ${'%' + q + '%'} or v.model ilike ${'%' + q + '%'})
      and (${status} = '' or v.status = ${status})
    order by (v.status = 'retired'), v.plate_no`;
  return { vehicles: rows };
}

async function futureReservations(sql, vehicleId) {
  return sql`
    select r.id, r.start_at, r.end_at, u.name as user_name
    from reservations r join users u on u.id = r.user_id
    where r.vehicle_id = ${vehicleId} and r.status in ('requested','confirmed') and r.end_at > now()
    order by r.start_at`;
}

async function create({ sql, user, body }) {
  requireRole(user, 'manager', 'admin');
  const { value, errors } = validateVehicle(await body());
  if (hasErrors(errors)) throw badRequest('입력값을 확인해 주세요.', errors);
  try {
    const [v] = await sql`
      insert into vehicles (plate_no, model, seats, fuel_type, initial_odometer, status, color, note)
      values (${value.plate_no}, ${value.model}, ${value.seats}, ${value.fuel_type}, ${value.initial_odometer},
              ${value.status}, ${value.color}, ${value.note})
      returning *`;
    await audit(sql, user.id, 'vehicle_create', 'vehicle', v.id, { plate_no: v.plate_no });
    return { vehicle: v };
  } catch (e) {
    if (e.code === '23505') throw badRequest('이미 등록된 차량번호입니다.', { plate_no: '이미 등록된 차량번호입니다.' });
    throw e;
  }
}

async function update({ sql, user, params, body }) {
  requireRole(user, 'manager', 'admin');
  const [old] = await sql`select * from vehicles where id = ${params.id}`;
  if (!old) throw notFound('차량을 찾을 수 없습니다.');
  const { value, errors } = validateVehicle(await body());
  if (hasErrors(errors)) throw badRequest('입력값을 확인해 주세요.', errors);
  if (value.initial_odometer !== old.initial_odometer) {
    const [{ n }] = await sql`select count(*)::int as n from usage_logs where vehicle_id = ${old.id}`;
    if (n > 0) throw badRequest('운행일지가 있는 차량은 최초 계기판 값을 바꿀 수 없습니다.', { initial_odometer: '운행일지가 입력된 뒤에는 바꿀 수 없습니다.' });
  }
  try {
    const [v] = await sql`
      update vehicles set plate_no = ${value.plate_no}, model = ${value.model}, seats = ${value.seats},
        fuel_type = ${value.fuel_type}, initial_odometer = ${value.initial_odometer}, status = ${value.status},
        color = ${value.color}, note = ${value.note}, updated_at = now()
      where id = ${old.id} returning *`;
    await audit(sql, user.id, 'vehicle_update', 'vehicle', v.id, { status: [old.status, v.status] });
    const affected = v.status !== 'available' ? await futureReservations(sql, v.id) : [];
    return { vehicle: v, affected_reservations: affected };
  } catch (e) {
    if (e.code === '23505') throw badRequest('이미 등록된 차량번호입니다.', { plate_no: '이미 등록된 차량번호입니다.' });
    throw e;
  }
}

export const routes = [
  ['GET', '/vehicles', list],
  ['POST', '/vehicles', create],
  ['PATCH', '/vehicles/:id', update],
];
