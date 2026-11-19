// F-14 결재라인 설정: 결재 단계(이름·순서)와 단계별 결재자 지정
import { validateApprovalLine, hasErrors } from '../../../js/utils/validate.js';
import { badRequest, conflict } from '../http.js';
import { requireUser, requireRole } from '../session.js';
import { audit } from '../audit.js';
import { getSettings } from '../settings.js';

async function load(sql) {
  const settings = await getSettings(sql);
  const approvers = await sql`
    select id, name, team, approver_step from users
    where is_active and 'approver' = any(roles) and approver_step is not null order by name`;
  const candidates = await sql`select id, name, team from users where is_active order by name`;
  const [{ n }] = await sql`select count(*)::int as n from monthly_ledgers where status = 'submitted'`;
  return {
    steps: settings.approval_steps.map((st) => ({
      order: st.order, name: st.name,
      approvers: approvers.filter((u) => u.approver_step === st.order).map(({ approver_step: _s, ...u }) => u),
    })),
    show_drafter: settings.approval_show_drafter,
    candidates,
    in_progress: n,
  };
}

async function get({ sql, user }) {
  requireUser(user);
  return load(sql);
}

async function save({ sql, user, body }) {
  requireRole(user, 'admin');
  const { value, errors } = validateApprovalLine(await body());
  if (hasErrors(errors)) throw badRequest(errors.steps || '입력값을 확인해 주세요.', errors);
  const ids = value.steps.flatMap((st) => st.approver_ids);
  const active = await sql`select id from users where is_active and id = any(${ids})`;
  if (active.length !== ids.length) throw badRequest('사용 중지되었거나 없는 직원이 결재자로 지정되어 있습니다. 다시 선택해 주세요.');
  // 결재 진행 중인 대장이 있으면 결재자 지정이 꼬이므로 막는다
  const [{ n }] = await sql`select count(*)::int as n from monthly_ledgers where status = 'submitted'`;
  if (n > 0) throw conflict(`결재 진행 중인 대장이 ${n}건 있어 결재라인을 바꿀 수 없습니다. 결재를 마치거나 회수한 뒤 다시 시도하세요.`, { code: 'APPROVAL_IN_PROGRESS' });

  const before = await getSettings(sql);
  const steps = value.steps.map(({ order, name }) => ({ order, name }));
  await sql.begin(async (tx) => {
    for (const [key, val] of [['approval_steps', steps], ['approval_show_drafter', value.show_drafter]]) {
      await tx`insert into settings (key, value) values (${key}, ${tx.json(val)})
               on conflict (key) do update set value = excluded.value`;
    }
    // 결재라인에서 빠진 사람은 결재자 역할 해제 (결재자 역할만 있던 사람은 '직원'으로 — 역할이 비면 안 됨)
    await tx`update users set approver_step = null,
               roles = case when roles = array['approver']::text[] then array['staff']::text[] else array_remove(roles, 'approver') end,
               updated_at = now()
             where (approver_step is not null or 'approver' = any(roles)) and not (id = any(${ids}))`;
    for (const st of value.steps) {
      await tx`update users set approver_step = ${st.order},
                 roles = case when 'approver' = any(roles) then roles else array_append(roles, 'approver') end, updated_at = now()
               where id = any(${st.approver_ids})`;
    }
  });
  await audit(sql, user.id, 'approval_line_update', 'settings', 'approval_steps', {
    before: before.approval_steps.map((s) => s.name), after: steps.map((s) => s.name),
    approvers: value.steps.map((s) => s.approver_ids), show_drafter: value.show_drafter,
  });
  return load(sql);
}

export const routes = [
  ['GET', '/approval-line', get],
  ['PUT', '/approval-line', save],
];
