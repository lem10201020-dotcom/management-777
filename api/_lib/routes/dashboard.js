// F-02 대시보드·통계
import { todayYmd, addDays, currentYm, addMonths } from '../../../js/utils/format.js';
import { requireUser, hasRole } from '../session.js';
import { selectReservations, shape } from './reservations.js';
import { pendingFor } from './ledgers.js';

async function dashboard({ sql, user }) {
  requireUser(user);
  const today = todayYmd();
  const dayStart = `${today}T00:00:00+09:00`;
  const dayEnd = `${addDays(today, 1)}T00:00:00+09:00`;
  const ym = currentYm();
  const isManager = hasRole(user, 'manager');

  const todays = await selectReservations(sql, sql`
    r.start_at < ${dayEnd} and r.end_at > ${dayStart} and r.status in ('requested','confirmed','completed')`);

  const vehicles = await sql`
    select v.id, v.plate_no, v.model, v.color, v.status,
      exists (select 1 from reservations r where r.vehicle_id = v.id and r.status in ('confirmed','completed')
              and r.start_at <= now() and r.end_at > now()) as in_use
    from vehicles v where v.status <> 'retired' order by v.plate_no`;

  const upcoming = await selectReservations(sql, sql`
    r.user_id = ${user.id} and r.status in ('requested','confirmed') and r.end_at > now()`);

  const missingWhere = isManager ? sql`true` : sql`r.user_id = ${user.id}`;
  const missing = await selectReservations(sql, sql`
    ${missingWhere} and r.status = 'confirmed' and l.id is null and r.end_at < now()`);

  const drafts = await sql`
    select l.id, l.drive_date, v.plate_no, v.model from usage_logs l join vehicles v on v.id = l.vehicle_id
    where l.status = 'draft' and (l.created_by = ${user.id} or l.driver_id = ${user.id})
    order by l.drive_date desc`;

  const result = {
    today,
    today_reservations: todays.map((r) => shape(r, user)),
    vehicles: vehicles.map((v) => ({
      ...v,
      state: v.status === 'maintenance' ? 'maintenance' : v.in_use ? 'in_use' : 'available',
      today: todays.filter((r) => r.vehicle_id === v.id).map((r) => ({ start_at: r.start_at, end_at: r.end_at, user_name: r.user_name })),
    })),
    my_upcoming: upcoming.slice(0, 5).map((r) => shape(r, user)),
    missing_logs: missing.filter((r) => r.user_id === user.id).map((r) => shape(r, user)),
    my_drafts: drafts,
  };

  if (isManager) {
    const firstDay = `${ym}-01`;
    const nextFirstDay = `${addMonths(ym, 1)}-01`;
    result.month = ym;
    result.month_stats = await sql`
      select v.id as vehicle_id, v.plate_no, v.model, v.color,
        count(l.id)::int as log_count,
        coalesce(sum(l.distance_km), 0)::int as total_distance,
        coalesce(sum(l.fuel_liters), 0)::float8 as total_fuel_liters,
        coalesce(sum(l.fuel_cost), 0)::int as total_fuel_cost
      from vehicles v
      left join usage_logs l on l.vehicle_id = v.id and l.status <> 'draft'
        and l.drive_date >= ${firstDay}::date and l.drive_date < ${nextFirstDay}::date
      where v.status <> 'retired' or l.id is not null
      group by v.id order by v.plate_no`;
    const [mm] = await sql`
      select count(*)::int as n from (
        select l.odometer_start, l.drive_date,
          coalesce(lag(l.odometer_end) over (partition by l.vehicle_id order by l.depart_at), v.initial_odometer) as prev_end
        from usage_logs l join vehicles v on v.id = l.vehicle_id) x
      where x.prev_end <> x.odometer_start and x.drive_date >= ${firstDay}::date`;
    result.mismatch_count = mm.n;
    result.all_missing_logs = missing.map((r) => shape(r, user));
    const lastYm = addMonths(ym, -1);
    result.last_month = lastYm;
    result.last_month_ledgers = await sql`
      select v.id as vehicle_id, v.plate_no, v.model, coalesce(m.status, 'open') as status
      from vehicles v left join monthly_ledgers m on m.vehicle_id = v.id and m.year_month = ${lastYm}
      where v.status <> 'retired' order by v.plate_no`;
    result.requested_reservations = (await selectReservations(sql, sql`r.status = 'requested' and r.end_at > now()`))
      .map((r) => shape(r, user));
  }
  if (hasRole(user, 'approver')) result.pending_approvals = await pendingFor(sql, user);
  return result;
}

async function settings({ sql }) {
  const { getSettings } = await import('../settings.js');
  return { settings: await getSettings(sql) };
}

export const routes = [
  ['GET', '/dashboard', dashboard],
  ['GET', '/settings', settings],
];
