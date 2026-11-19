// F-05 월별 차량대장, F-06 결재
import { YM_RE } from '../../../js/utils/validate.js';
import { addMonths, currentYm } from '../../../js/utils/format.js';
import { badRequest, conflict, forbidden, notFound } from '../http.js';
import { requireRole, hasRole } from '../session.js';
import { audit } from '../audit.js';
import { getSettings } from '../settings.js';
import { verifySignature } from '../signature.js';
import { logsQuery, shapeLog } from './usage-logs.js';

const monthRange = (ym) => ({
  startTs: `${ym}-01T00:00:00+09:00`,
  endTs: `${addMonths(ym, 1)}-01T00:00:00+09:00`,
  firstDay: `${ym}-01`,
  nextFirstDay: `${addMonths(ym, 1)}-01`,
});

function parseYm(v) {
  if (!YM_RE.test(v || '')) throw badRequest('연월 형식이 올바르지 않습니다. (예: 2026-10)');
  return v;
}

/** 현재 회차에서 다음 결재 단계 번호 */
function currentStep(approvals, round) {
  const approved = approvals.filter((a) => a.round === round && a.decision === 'approved');
  return approved.length + 1;
}

/** 대장 화면 데이터 계산 */
export async function computeLedger(sql, user, vehicleId, ym, { withSignature = false } = {}) {
  const [vehicle] = await sql`select id, plate_no, model, seats, fuel_type, color, status from vehicles where id = ${vehicleId}`;
  if (!vehicle) throw notFound('차량을 찾을 수 없습니다.');
  const { startTs, endTs, firstDay, nextFirstDay } = monthRange(ym);
  const settings = await getSettings(sql);

  const logs = (await sql`
    select * from (${logsQuery(sql, sql`x.vehicle_id = ${vehicleId} and x.drive_date >= ${firstDay}::date and x.drive_date < ${nextFirstDay}::date`, { withSignature })}) y
    order by y.depart_at`).map((l) => shapeLog(l, user));

  const counted = logs.filter((l) => l.status !== 'draft');
  const live = {
    log_count: counted.length,
    total_distance: counted.reduce((s, l) => s + l.distance_km, 0),
    total_fuel_liters: Math.round(counted.reduce((s, l) => s + (l.fuel_liters || 0), 0) * 10) / 10,
    total_fuel_cost: counted.reduce((s, l) => s + (l.fuel_cost || 0), 0),
    odometer_first: counted.length ? counted[0].odometer_start : null,
    odometer_last: counted.length ? counted[counted.length - 1].odometer_end : null,
  };
  const byPurpose = {};
  for (const l of counted) byPurpose[l.purpose_category] = (byPurpose[l.purpose_category] || 0) + 1;

  const missing = await sql`
    select r.id, r.start_at, r.end_at, u.name as user_name from reservations r
    join users u on u.id = r.user_id
    left join usage_logs l on l.reservation_id = r.id
    where r.vehicle_id = ${vehicleId} and r.status = 'confirmed' and l.id is null
      and r.end_at >= ${startTs} and r.end_at < ${endTs} and r.end_at < now()
    order by r.start_at`;

  const [ledger] = await sql`select * from monthly_ledgers where vehicle_id = ${vehicleId} and year_month = ${ym}`;
  const approvals = ledger
    ? await sql`
        select a.id, a.round, a.step_order, a.step_name, a.approver_id, u.name as approver_name, a.decision,
               ${withSignature ? sql`a.signature` : sql`null::text as signature`}, a.signature_type, a.comment, a.decided_at
        from approvals a join users u on u.id = a.approver_id
        where a.ledger_id = ${ledger.id} order by a.round, a.step_order`
    : [];
  const status = ledger?.status ?? 'open';
  const round = ledger?.round ?? 0;
  const snapshot = ['submitted', 'approved'].includes(status);
  const summary = snapshot
    ? {
      log_count: ledger.log_count, total_distance: ledger.total_distance,
      total_fuel_liters: Number(ledger.total_fuel_liters), total_fuel_cost: ledger.total_fuel_cost,
      odometer_first: ledger.odometer_first, odometer_last: ledger.odometer_last,
    }
    : live;

  const drafts = logs.filter((l) => l.status === 'draft');
  const mismatches = logs.filter((l) => l.mismatch);
  const blockers = [];
  if (drafts.length) blockers.push({ code: 'DRAFTS', message: `작성중인 운행일지 ${drafts.length}건이 있습니다.`, ids: drafts.map((l) => l.id) });
  if (missing.length) blockers.push({ code: 'MISSING', message: `운행일지가 입력되지 않은 예약 ${missing.length}건이 있습니다.`, ids: missing.map((r) => r.id) });
  if (ym > currentYm()) blockers.push({ code: 'FUTURE', message: '아직 오지 않은 달은 결재를 요청할 수 없습니다.' });

  const step = currentStep(approvals, round);
  // 결재요청 이후에는 요청 시점의 결재라인 스냅숏을 쓴다 (F-14)
  const steps = (snapshot && ledger.approval_steps) || settings.approval_steps;
  const stepInfo = steps.find((s) => s.order === step) || null;
  const [submitter] = ledger?.submitted_by ? await sql`select name from users where id = ${ledger.submitted_by}` : [];
  return {
    vehicle, year_month: ym, status, round,
    ledger: ledger ? {
      id: ledger.id, manager_comment: ledger.manager_comment, recall_reason: ledger.recall_reason,
      submitted_at: ledger.submitted_at, submitted_by: ledger.submitted_by, submitted_by_name: submitter?.name ?? null,
    } : null,
    summary, live_summary: live, by_purpose: byPurpose, logs, missing_reservations: missing,
    mismatch_count: mismatches.length, blockers,
    approval_steps: steps,
    show_drafter: settings.approval_show_drafter,
    approvals, current_step: status === 'submitted' ? step : null, current_step_name: status === 'submitted' ? stepInfo?.name ?? null : null,
    last_rejection: approvals.filter((a) => a.decision === 'rejected').at(-1) ?? null,
    can_submit: hasRole(user, 'manager') && ['open', 'rejected'].includes(status) && blockers.length === 0,
    can_recall: hasRole(user, 'manager') && status === 'submitted',
    can_decide: status === 'submitted' && hasRole(user, 'approver') && user.approver_step === step,
  };
}

async function getLedger({ sql, user, query }) {
  requireRole(user, 'manager', 'approver', 'admin');
  const ym = parseYm(query.get('ym'));
  const vehicleId = Number(query.get('vehicle_id') || 0);
  if (!vehicleId) throw badRequest('차량을 선택해 주세요.');
  return computeLedger(sql, user, vehicleId, ym, { withSignature: query.get('print') === '1' });
}

/** 월 개요: 차량별 대장 상태와 합계 */
async function overview({ sql, user, query }) {
  requireRole(user, 'manager', 'approver', 'admin');
  const ym = parseYm(query.get('ym'));
  const { firstDay, nextFirstDay } = monthRange(ym);
  const rows = await sql`
    select v.id as vehicle_id, v.plate_no, v.model, v.color, v.status as vehicle_status,
           coalesce(m.status, 'open') as status,
           count(l.id) filter (where l.status <> 'draft')::int as log_count,
           count(l.id) filter (where l.status = 'draft')::int as draft_count,
           coalesce(sum(l.distance_km) filter (where l.status <> 'draft'), 0)::int as total_distance
    from vehicles v
    left join monthly_ledgers m on m.vehicle_id = v.id and m.year_month = ${ym}
    left join usage_logs l on l.vehicle_id = v.id and l.drive_date >= ${firstDay}::date and l.drive_date < ${nextFirstDay}::date
    group by v.id, m.status
    having v.status <> 'retired' or count(l.id) > 0 or m.status is not null
    order by v.plate_no`;
  return { year_month: ym, vehicles: rows };
}

async function submit({ sql, user, body }) {
  requireRole(user, 'manager');
  const input = await body();
  const ym = parseYm(input.year_month);
  const vehicleId = Number(input.vehicle_id || 0);
  const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (comment.length > 300) throw badRequest('입력값을 확인해 주세요.', { comment: '의견은 300자 이하로 입력해 주세요.' });
  const data = await computeLedger(sql, user, vehicleId, ym);
  if (!['open', 'rejected'].includes(data.status)) throw conflict('이미 결재요청했거나 결재가 끝난 대장입니다.');
  if (data.blockers.length) throw conflict(data.blockers.map((b) => b.message).join(' '), { code: 'LEDGER_BLOCKED', blockers: data.blockers });
  const s = data.live_summary;
  const { approval_steps: steps } = await getSettings(sql);
  const [row] = await sql`
    insert into monthly_ledgers (vehicle_id, year_month, status, round, log_count, total_distance, total_fuel_liters,
      total_fuel_cost, odometer_first, odometer_last, manager_comment, approval_steps, submitted_by, submitted_at)
    values (${vehicleId}, ${ym}, 'submitted', 1, ${s.log_count}, ${s.total_distance}, ${s.total_fuel_liters},
      ${s.total_fuel_cost}, ${s.odometer_first}, ${s.odometer_last}, ${comment}, ${sql.json(steps)}, ${user.id}, now())
    on conflict (vehicle_id, year_month) do update set
      status = 'submitted', round = monthly_ledgers.round + 1, log_count = excluded.log_count,
      total_distance = excluded.total_distance, total_fuel_liters = excluded.total_fuel_liters,
      total_fuel_cost = excluded.total_fuel_cost, odometer_first = excluded.odometer_first,
      odometer_last = excluded.odometer_last, manager_comment = excluded.manager_comment, approval_steps = excluded.approval_steps,
      recall_reason = '', submitted_by = excluded.submitted_by, submitted_at = now(), updated_at = now()
    where monthly_ledgers.status in ('open', 'rejected')
    returning id, round`;
  if (!row) throw conflict('이미 결재요청했거나 결재가 끝난 대장입니다.');
  await audit(sql, user.id, 'ledger_submit', 'monthly_ledger', row.id, { vehicle_id: vehicleId, year_month: ym, round: row.round });
  return computeLedger(sql, user, vehicleId, ym);
}

async function recall({ sql, user, params, body }) {
  requireRole(user, 'manager');
  const { reason } = await body();
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (why.length < 2 || why.length > 200) throw badRequest('입력값을 확인해 주세요.', { reason: '회수 사유를 2~200자로 입력해 주세요.' });
  const [l] = await sql`
    update monthly_ledgers set status = 'open', recall_reason = ${why}, updated_at = now()
    where id = ${params.id} and status = 'submitted' returning *`;
  if (!l) throw conflict('결재 진행 중인 대장만 회수할 수 있습니다.');
  await audit(sql, user.id, 'ledger_recall', 'monthly_ledger', l.id, { reason: why });
  return computeLedger(sql, user, l.vehicle_id, l.year_month);
}

async function decide({ sql, user, params, body }) {
  requireRole(user, 'approver');
  const input = await body();
  const decision = input.decision;
  if (!['approved', 'rejected'].includes(decision)) throw badRequest('결재 또는 반려를 선택해 주세요.');
  const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (decision === 'rejected' && (comment.length < 5 || comment.length > 300)) {
    throw badRequest('입력값을 확인해 주세요.', { comment: '반려 사유를 5자 이상 입력해 주세요.' });
  }
  if (comment.length > 300) throw badRequest('입력값을 확인해 주세요.', { comment: '의견은 300자 이하로 입력해 주세요.' });
  const [ledger] = await sql`select * from monthly_ledgers where id = ${params.id}`;
  if (!ledger) throw notFound('대장을 찾을 수 없습니다.');
  if (ledger.status !== 'submitted') throw conflict('결재 진행 중인 대장이 아닙니다.');
  const settings = await getSettings(sql);
  const steps = ledger.approval_steps || settings.approval_steps; // 요청 시점 스냅숏 (F-14)
  const approvals = await sql`select round, step_order, decision from approvals where ledger_id = ${ledger.id}`;
  const step = currentStep(approvals, ledger.round);
  const stepInfo = steps.find((s) => s.order === step);
  if (!stepInfo) throw conflict('결재 단계 설정을 확인해 주세요.');
  if (user.approver_step !== step) {
    const mineIsLater = user.approver_step > step;
    throw forbidden(mineIsLater ? '이전 단계 결재가 끝나지 않았습니다.' : `현재는 ${stepInfo.name} 결재 단계입니다.`);
  }
  const sig = decision === 'approved' ? await verifySignature(sql, user, input.signature) : null;
  const isLast = step === Math.max(...steps.map((s) => s.order));
  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into approvals (ledger_id, round, step_order, step_name, approver_id, decision, signature, signature_type, comment)
        values (${ledger.id}, ${ledger.round}, ${step}, ${stepInfo.name}, ${user.id}, ${decision},
                ${sig?.signature ?? null}, ${sig?.signature_type ?? null}, ${comment})`;
      if (decision === 'rejected') {
        await tx`update monthly_ledgers set status = 'rejected', updated_at = now() where id = ${ledger.id}`;
      } else if (isLast) {
        await tx`update monthly_ledgers set status = 'approved', updated_at = now() where id = ${ledger.id}`;
        const { firstDay, nextFirstDay } = monthRange(ledger.year_month);
        await tx`
          update usage_logs set status = 'locked', updated_at = now()
          where vehicle_id = ${ledger.vehicle_id} and drive_date >= ${firstDay}::date
            and drive_date < ${nextFirstDay}::date and status = 'submitted'`;
      }
    });
  } catch (e) {
    if (e.code === '23505') throw conflict('이미 처리된 결재 단계입니다. 화면을 새로고침해 주세요.');
    throw e;
  }
  await audit(sql, user.id, decision === 'approved' ? 'ledger_approve' : 'ledger_reject', 'monthly_ledger', ledger.id, {
    step, round: ledger.round,
  });
  return computeLedger(sql, user, ledger.vehicle_id, ledger.year_month);
}

/** 결재 대기 목록 (내 단계 차례인 대장) */
export async function pendingFor(sql, user) {
  if (!hasRole(user, 'approver') || !user.approver_step) return [];
  const rows = await sql`
    select m.id, m.vehicle_id, m.year_month, m.round, m.total_distance, m.log_count, m.submitted_at,
           v.plate_no, v.model,
           (select count(*)::int from approvals a where a.ledger_id = m.id and a.round = m.round and a.decision = 'approved') + 1 as step
    from monthly_ledgers m join vehicles v on v.id = m.vehicle_id
    where m.status = 'submitted'
    order by m.submitted_at`;
  return rows.filter((r) => r.step === user.approver_step);
}

async function pending({ sql, user }) {
  requireRole(user, 'approver');
  return { ledgers: await pendingFor(sql, user) };
}

export const routes = [
  ['GET', '/ledgers', getLedger],
  ['GET', '/ledgers/overview', overview],
  ['POST', '/ledgers/submit', submit],
  ['POST', '/ledgers/:id/recall', recall],
  ['POST', '/ledgers/:id/decide', decide],
  ['GET', '/approvals/pending', pending],
];
