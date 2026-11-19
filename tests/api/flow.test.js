// API 통합 테스트: 권한·검증·상태 전이와 E2E-01 업무 흐름 (TEST_PLAN.md 2장·4장)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, seedUsers, client, typedSig, skip } from './helpers.js';
import { todayYmd, addDays, addMonths, currentYm } from '../../js/utils/format.js';

let srv; let ids; let veh1; let veh2;
const lastYm = addMonths(currentYm(), -1);
const tomorrow = addDays(todayYmd(), 1);

describe('차량예약관리대장 API', { skip }, () => {
  before(async () => {
    srv = await startServer();
    ids = await seedUsers(srv.sql);
  });
  after(async () => { await srv?.close(); });

  test('T-01 로그인·권한', async () => {
    const c = client(srv.base);
    assert.equal((await c.get('/dashboard')).status, 401);
    const bad = await c.login('staff01', 'wrong-pass1');
    assert.equal(bad.status, 401);
    assert.match(bad.data.error.message, /아이디 또는 비밀번호/);
    assert.equal((await c.login('old01')).status, 403); // 비활성 (T-01-4)
    assert.equal((await c.login('staff01')).status, 200);
    assert.equal((await c.get('/users')).status, 403); // T-01-5
    // CSRF: 다른 출처 거부 (T-15-3)
    assert.equal((await c.post('/vehicles', {}, { Origin: 'https://evil.example' })).status, 403);
    // DB에 비밀번호 평문 없음 (T-01-8)
    const [u] = await srv.sql`select password_hash from users where login_id = 'staff01'`;
    assert.match(u.password_hash, /^\$2[aby]\$/);
  });

  test('T-01-3 연속 5회 실패 시 잠금', async () => {
    const c = client(srv.base);
    for (let i = 0; i < 4; i++) assert.equal((await c.login('staff02', 'wrong-pass1')).status, 401);
    assert.equal((await c.login('staff02', 'wrong-pass1')).status, 423);
    assert.equal((await c.login('staff02')).status, 423);
    await srv.sql`update users set locked_until = null, failed_attempts = 0 where login_id = 'staff02'`;
  });

  test('T-08 차량 관리', async () => {
    const m = client(srv.base); await m.login('mgr01');
    const s = client(srv.base); await s.login('staff01');
    assert.equal((await s.post('/vehicles', { plate_no: '78라1234' })).status, 403);
    const r1 = await m.post('/vehicles', { plate_no: '12가3456', model: '스타리아 11인승', seats: 11, fuel_type: '경유', initial_odometer: 10000 });
    assert.equal(r1.status, 200);
    veh1 = r1.data.vehicle.id;
    const dup = await m.post('/vehicles', { plate_no: '12가3456', model: '중복', seats: 4, fuel_type: '경유', initial_odometer: 0 });
    assert.equal(dup.status, 400);
    assert.match(dup.data.error.fields.plate_no, /이미 등록/);
    const r2 = await m.post('/vehicles', { plate_no: '34나5678', model: '레이', seats: 4, fuel_type: '휘발유', initial_odometer: 5000 });
    veh2 = r2.data.vehicle.id;
    const bad = await m.post('/vehicles', { plate_no: '12가345', model: 'x', seats: 4, fuel_type: '경유', initial_odometer: 0 });
    assert.ok(bad.data.error.fields.plate_no);
  });

  test('T-03 예약: 겹침 차단·경계·권한', async () => {
    const s1 = client(srv.base); await s1.login('staff01');
    const s2 = client(srv.base); await s2.login('staff02');
    const base = { vehicle_id: veh1, destination: '○○동 주민센터', purpose_category: '사례관리 방문', passenger_count: 1, purpose_note: '비공개 메모' };
    const a = await s1.post('/reservations', { ...base, start_at: `${tomorrow}T14:00`, end_at: `${tomorrow}T16:00` });
    assert.equal(a.status, 200);
    assert.equal(a.data.reservation.status, 'confirmed');
    const overlap = await s2.post('/reservations', { ...base, start_at: `${tomorrow}T15:00`, end_at: `${tomorrow}T17:00` });
    assert.equal(overlap.status, 409);
    assert.match(overlap.data.error.message, /홍길동님이 14:00~16:00에 이미 예약/);
    assert.deepEqual(overlap.data.error.suggestions.map((v) => v.id), [veh2]);
    const touch = await s2.post('/reservations', { ...base, start_at: `${tomorrow}T16:00`, end_at: `${tomorrow}T18:00` });
    assert.equal(touch.status, 200); // 맞닿음 허용 (T-03-3)
    // 동승 인원 경계 (T-03-7): 레이 4인승 → 최대 3명
    assert.equal((await s2.post('/reservations', { ...base, vehicle_id: veh2, passenger_count: 4, start_at: `${tomorrow}T09:00`, end_at: `${tomorrow}T10:00` })).status, 400);
    // 과거 예약 불가 (T-03-6)
    const past = await s2.post('/reservations', { ...base, vehicle_id: veh2, start_at: `${addDays(todayYmd(), -1)}T09:00`, end_at: `${addDays(todayYmd(), -1)}T10:00` });
    assert.equal(past.status, 400);
    // 다른 사람 메모 비공개 (T-03-11), 수정 불가 (T-01-6)
    const seen = await s2.get(`/reservations/${a.data.reservation.id}`);
    assert.equal(seen.data.reservation.purpose_note, null);
    assert.equal((await s2.patch(`/reservations/${a.data.reservation.id}`, { ...base, start_at: `${tomorrow}T10:00`, end_at: `${tomorrow}T11:00` })).status, 403);
    // 취소 후 같은 시간 예약 가능 (T-03-10)
    assert.equal((await s1.post(`/reservations/${a.data.reservation.id}/cancel`, { reason: '일정 변경' })).data.reservation.status, 'cancelled');
    assert.equal((await s2.post('/reservations', { ...base, start_at: `${tomorrow}T14:00`, end_at: `${tomorrow}T15:00` })).status, 200);
  });

  test('T-03-4 동시 예약 요청은 1건만 성공', async () => {
    const s1 = client(srv.base); await s1.login('staff01');
    const s2 = client(srv.base); await s2.login('staff02');
    const day = addDays(todayYmd(), 3);
    const body = { vehicle_id: veh2, destination: '△△초등학교', purpose_category: '프로그램 운영', start_at: `${day}T10:00`, end_at: `${day}T12:00` };
    const res = await Promise.all([s1.post('/reservations', body), s2.post('/reservations', body)]);
    assert.deepEqual(res.map((r) => r.status).sort(), [200, 409]);
  });

  test('E2E-01 예약 → 운행일지 → 월별 대장 → 결재 → 잠금', async () => {
    const m = client(srv.base); await m.login('mgr01');
    const s1 = client(srv.base); await s1.login('staff01');
    const a1 = client(srv.base); await a1.login('apv01');
    const a2 = client(srv.base); await a2.login('apv02');

    // 지난달 예약 3건 (차량담당자는 지난 시각 대리 예약 가능)
    const mk = async (d, userId) => (await m.post('/reservations', {
      vehicle_id: veh1, user_id: userId, start_at: `${lastYm}-${d}T09:00`, end_at: `${lastYm}-${d}T12:00`,
      destination: '○○동 행정복지센터', purpose_category: '사례관리 방문', passenger_count: 1,
    })).data.reservation;
    const r1 = await mk('05', ids.staff01);
    const r2 = await mk('12', ids.staff01);
    const r3 = await mk('20', ids.staff01);

    // 운행일지 1: 예약 정보 자동 채움 + 직전 계기판 = 최초 계기판 (T-04-1, T-04-6)
    const pre = await s1.get(`/usage-logs/new?reservation_id=${r1.id}`);
    assert.equal(pre.data.expected_odometer_start, 10000);
    const log = (r, start, end, extra = {}) => ({
      reservation_id: r.id, vehicle_id: veh1, driver_id: ids.staff01, drive_date: r.start_at && `${lastYm}-${new Date(r.start_at).toISOString().slice(8, 10)}`,
      depart_time: '09:10', return_time: '11:50', odometer_start: start, odometer_end: end,
      destination: '○○동 행정복지센터', purpose_category: '사례관리 방문', passenger_count: 1, ...extra,
    });
    // 서명 없이 제출 불가 (T-04-10)
    const noSig = await s1.post('/usage-logs', { ...log(r1, 10000, 10042), submit: true });
    assert.equal(noSig.status, 400);
    assert.ok(noSig.data.error.fields.signature);
    const l1 = await s1.post('/usage-logs', { ...log(r1, 10000, 10042), submit: true, signature: typedSig('홍길동') });
    assert.equal(l1.status, 200);
    assert.equal(l1.data.log.distance_km, 42);
    assert.equal(l1.data.log.status, 'submitted');
    assert.match(l1.data.log.driver_signature, /^전자 확인: 홍길동/);
    assert.equal((await s1.get(`/reservations/${r1.id}`)).data.reservation.status, 'completed');
    // 같은 예약에 중복 작성 불가
    assert.equal((await s1.post('/usage-logs', { ...log(r1, 10042, 10050) })).status, 409);

    // 운행일지 2: km 불일치 → 사유 필요 (T-04-5)
    const mismatch = await s1.post('/usage-logs', { ...log(r2, 10050, 10100), submit: true, signature: typedSig('홍길동') });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.data.error.code, 'ODOMETER_MISMATCH');
    assert.equal(mismatch.data.error.expected, 10042);
    const l2 = await s1.post('/usage-logs', { ...log(r2, 10050, 10100, { mismatch_reason: '다른 운행 미기록', fuel_liters: 30.5, fuel_cost: 52000 }), submit: true, signature: typedSig('홍길동') });
    assert.equal(l2.status, 200);
    assert.equal(l2.data.log.mismatch, true);
    // 잘못된 대체 서명 거부
    assert.equal((await s1.post('/usage-logs', { ...log(r3, 10100, 10115), submit: true, signature: { type: 'typed', name: '홍길동', password: 'nope1234' } })).status, 400);

    // 운행일지 3: 임시저장(draft) → 결재요청 차단 (T-05-2)
    const l3 = await s1.post('/usage-logs', { ...log(r3, 10100, 10115) });
    assert.equal(l3.data.log.status, 'draft');
    let L = (await m.get(`/ledgers?ym=${lastYm}&vehicle_id=${veh1}`)).data;
    assert.equal(L.can_submit, false);
    assert.equal(L.blockers[0].code, 'DRAFTS');
    assert.equal((await m.post('/ledgers/submit', { vehicle_id: veh1, year_month: lastYm })).status, 409);
    // 다른 직원은 남의 운행일지 수정 불가
    const s2 = client(srv.base); await s2.login('staff02');
    assert.equal((await s2.patch(`/usage-logs/${l3.data.log.id}`, log(r3, 10100, 10115))).status, 403);
    // 제출
    const l3s = await s1.patch(`/usage-logs/${l3.data.log.id}`, { ...log(r3, 10100, 10115), submit: true, signature: typedSig('홍길동') });
    assert.equal(l3s.data.log.status, 'submitted');

    // 집계 확인 (T-05-1, T-02-2)
    L = (await m.get(`/ledgers?ym=${lastYm}&vehicle_id=${veh1}`)).data;
    assert.deepEqual([L.summary.log_count, L.summary.total_distance, L.summary.total_fuel_liters, L.summary.total_fuel_cost], [3, 107, 30.5, 52000]);
    assert.equal(L.mismatch_count, 1);
    assert.equal(L.can_submit, true);

    // 결재요청 → 운행일지 수정 차단 (T-05-4)
    const sub = await m.post('/ledgers/submit', { vehicle_id: veh1, year_month: lastYm, comment: '확인했습니다' });
    assert.equal(sub.data.status, 'submitted');
    const ledgerId = sub.data.ledger.id;
    assert.equal((await s1.patch(`/usage-logs/${l3.data.log.id}`, { ...log(r3, 10100, 10116), signature: typedSig('홍길동') })).status, 409);

    // 2단계가 먼저 결재 불가 (T-06-2), 직원은 결재 불가 (T-06-5)
    assert.equal((await a2.post(`/ledgers/${ledgerId}/decide`, { decision: 'approved', signature: typedSig('최관장') })).status, 403);
    assert.equal((await s1.post(`/ledgers/${ledgerId}/decide`, { decision: 'approved' })).status, 403);
    // 대기 목록
    assert.equal((await a1.get('/approvals/pending')).data.ledgers.length, 1);
    assert.equal((await a2.get('/approvals/pending')).data.ledgers.length, 0);

    // 1단계 결재 → 2단계 반려 (사유 필수) (T-06-3, T-06-4)
    assert.equal((await a1.post(`/ledgers/${ledgerId}/decide`, { decision: 'approved', signature: typedSig('박팀장') })).data.current_step, 2);
    assert.equal((await a2.post(`/ledgers/${ledgerId}/decide`, { decision: 'rejected', comment: '짧음' })).status, 400);
    const rej = await a2.post(`/ledgers/${ledgerId}/decide`, { decision: 'rejected', comment: '10월 20일 목적지 확인 필요' });
    assert.equal(rej.data.status, 'rejected');

    // 반려 후 수정 가능 → 재요청 → 2단계 모두 결재 → 잠금 (T-06-1)
    assert.equal((await s1.patch(`/usage-logs/${l3.data.log.id}`, { ...log(r3, 10100, 10116), signature: typedSig('홍길동') })).status, 200);
    const sub2 = await m.post('/ledgers/submit', { vehicle_id: veh1, year_month: lastYm });
    assert.equal(sub2.data.round, 2);
    assert.equal(sub2.data.summary.total_distance, 108);
    await a1.post(`/ledgers/${ledgerId}/decide`, { decision: 'approved', signature: typedSig('박팀장') });
    const fin = await a2.post(`/ledgers/${ledgerId}/decide`, { decision: 'approved', signature: typedSig('최관장') });
    assert.equal(fin.data.status, 'approved');
    assert.ok(fin.data.logs.every((l) => l.status === 'locked'));
    // 잠긴 기록 수정 불가 (T-04-13)
    const locked = await m.patch(`/usage-logs/${l1.data.log.id}`, { ...log(r1, 10000, 10043), signature: typedSig('이담당') });
    assert.equal(locked.status, 409);
    // 이력 보존: 1회차 결재 2건(승인·반려) + 2회차 2건
    const [{ n }] = await srv.sql`select count(*)::int as n from approvals where ledger_id = ${ledgerId}`;
    assert.equal(n, 4);
    // 감사 기록에 서명·비밀번호 없음 (T-15-8)
    const audits = await srv.sql`select summary::text as s from audit_logs`;
    assert.ok(audits.every((a) => !/Sample1234|전자 확인|data:image/.test(a.s)));
  });

  test('F-14 결재라인 편집: 권한·검증·스냅숏·진행 중 잠금', async () => {
    const ad = client(srv.base); await ad.login('admin01');
    const s1 = client(srv.base); await s1.login('staff01');
    const m = client(srv.base); await m.login('mgr01');
    const a1 = client(srv.base); await a1.login('apv01');
    const a2 = client(srv.base); await a2.login('apv02');
    const line = (await s1.get('/approval-line')).data;
    assert.deepEqual(line.steps.map((st) => [st.name, st.approvers.map((a) => a.id)]), [['팀장', [ids.apv01]], ['관장', [ids.apv02]]]);
    assert.equal((await s1.patch('/approval-line', {})).status, 405);
    const body = (steps, extra = {}) => ({ steps, show_drafter: true, ...extra });
    // 권한·검증
    assert.equal((await s1.put('/approval-line', body([{ name: '팀장', approver_ids: [ids.apv01] }]))).status, 403);
    const noApprover = await ad.put('/approval-line', body([{ name: '팀장', approver_ids: [] }]));
    assert.equal(noApprover.status, 400);
    assert.ok(noApprover.data.error.fields.step_0_approvers);
    assert.equal((await ad.put('/approval-line', body([{ name: '팀장', approver_ids: [ids.apv01] }, { name: '관장', approver_ids: [ids.apv01] }]))).status, 400);
    // 3단계로 변경: 팀장 → 사무국장(이담당) → 관장
    const saved = await ad.put('/approval-line', body([
      { name: '팀장', approver_ids: [ids.apv01] }, { name: '사무국장', approver_ids: [ids.mgr01] }, { name: '관장', approver_ids: [ids.apv02] }]));
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.data.steps.map((st) => st.name), ['팀장', '사무국장', '관장']);
    const [mgr] = await srv.sql`select roles, approver_step from users where id = ${ids.mgr01}`;
    assert.deepEqual([mgr.roles.includes('approver'), mgr.approver_step], [true, 2]);
    // 이미 결재완료된 지난달 대장은 요청 당시 결재라인(2단계) 유지
    const old = (await m.get(`/ledgers?ym=${lastYm}&vehicle_id=${veh1}`)).data;
    assert.deepEqual(old.approval_steps.map((st) => st.name), ['팀장', '관장']);
    // 새 대장(운행 없는 차량)은 3단계로 진행
    const sub = await m.post('/ledgers/submit', { vehicle_id: veh2, year_month: lastYm });
    assert.equal(sub.status, 200);
    assert.deepEqual(sub.data.approval_steps.map((st) => st.name), ['팀장', '사무국장', '관장']);
    assert.equal(sub.data.ledger.submitted_by_name, '이담당');
    // 결재 진행 중에는 결재라인 변경 불가
    const blocked = await ad.put('/approval-line', body([{ name: '관장', approver_ids: [ids.apv02] }]));
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.error.code, 'APPROVAL_IN_PROGRESS');
    const id = sub.data.ledger.id;
    assert.equal((await a2.post(`/ledgers/${id}/decide`, { decision: 'approved', signature: typedSig('최관장') })).status, 403);
    await a1.post(`/ledgers/${id}/decide`, { decision: 'approved', signature: typedSig('박팀장') });
    assert.equal((await m.post(`/ledgers/${id}/decide`, { decision: 'approved', signature: typedSig('이담당') })).data.current_step, 3);
    assert.equal((await a2.post(`/ledgers/${id}/decide`, { decision: 'approved', signature: typedSig('최관장') })).data.status, 'approved');
    // 원래 2단계로 되돌림 (이후 테스트 영향 없게)
    assert.equal((await ad.put('/approval-line', body([{ name: '팀장', approver_ids: [ids.apv01] }, { name: '관장', approver_ids: [ids.apv02] }]))).status, 200);
  });

  test('T-04-16~19 예약 없이 운행일지: 모든 직원 작성, 시간 겹침·점검중 차단', async () => {
    const s2 = client(srv.base); await s2.login('staff02');
    const m = client(srv.base); await m.login('mgr01');
    const today = todayYmd();
    const pre = await s2.get(`/usage-logs/new?vehicle_id=${veh2}`);
    assert.equal(pre.status, 200);
    assert.equal(pre.data.expected_odometer_start, 5000);
    const walk = (extra = {}) => ({
      vehicle_id: veh2, driver_id: ids.staff02, drive_date: today, depart_time: '00:10', return_time: '00:40',
      odometer_start: 5000, odometer_end: 5012, destination: '△△동 주민센터', purpose_category: '행정업무', passenger_count: 0, ...extra,
    });
    const ok = await s2.post('/usage-logs', { ...walk(), submit: true, signature: typedSig('김가상') });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.log.reservation_id, null);
    assert.equal(ok.data.log.status, 'submitted');
    // 같은 차량 같은 시간 → 거부
    const clash = await s2.post('/usage-logs', walk({ depart_time: '00:20', return_time: '00:50', odometer_start: 5012, odometer_end: 5020 }));
    assert.equal(clash.status, 409);
    assert.equal(clash.data.error.code, 'LOG_OVERLAP');
    assert.match(clash.data.error.fields.depart_time, /김가상님 운행 기록/);
    // 점검중 차량: 직원 불가, 차량담당자 가능
    const mv = await m.post('/vehicles', { plate_no: '90마1234', model: '점검차', seats: 5, fuel_type: '경유', initial_odometer: 100, status: 'maintenance' });
    const body = { ...walk(), vehicle_id: mv.data.vehicle.id, odometer_start: 100, odometer_end: 110 };
    const blocked = await s2.post('/usage-logs', body);
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.error.fields.vehicle_id, /점검중/);
    assert.equal((await m.post('/usage-logs', body)).status, 200);
  });

  test('T-09 사용자 관리·마지막 관리자 보호', async () => {
    const ad = client(srv.base); await ad.login('admin01');
    const created = await ad.post('/users', { login_id: 'staff03', name: '오가상', roles: ['staff'] });
    assert.equal(created.status, 200);
    assert.match(created.data.temp_password, /^[A-Za-z0-9]{10}$/);
    const nu = client(srv.base);
    await nu.login('staff03', created.data.temp_password);
    const blocked = await nu.get('/dashboard');
    assert.equal(blocked.data.error.code, 'PASSWORD_CHANGE_REQUIRED'); // T-09-1
    assert.equal((await nu.post('/auth/password', { current_password: created.data.temp_password, new_password: 'NewPass123' })).status, 200);
    assert.equal((await nu.get('/dashboard')).status, 200);
    assert.equal((await ad.post('/users', { login_id: 'staff03', name: '중복', roles: ['staff'] })).status, 400);
    const self = (await ad.get('/users?q=admin01')).data.users[0];
    const r = await ad.patch(`/users/${self.id}`, { ...self, roles: ['staff'] });
    assert.equal(r.status, 409); // T-09-5
    // 비활성화 시 세션 무효
    const staff3 = (await ad.get('/users?q=staff03')).data.users[0];
    await ad.patch(`/users/${staff3.id}`, { ...staff3, is_active: false });
    assert.equal((await nu.get('/dashboard')).status, 401);
  });

  test('T-15 XSS 문자열은 그대로 저장되고 SQL 인젝션 검색은 무해', async () => {
    const s = client(srv.base); await s.login('staff01');
    const day = addDays(todayYmd(), 5);
    const r = await s.post('/reservations', { vehicle_id: veh2, destination: '<script>alert(1)</script>', purpose_category: '행정업무', start_at: `${day}T10:00`, end_at: `${day}T11:00` });
    assert.equal(r.data.reservation.destination, '<script>alert(1)</script>');
    const q = await s.get(`/usage-logs?q=${encodeURIComponent("' OR 1=1 --")}`);
    assert.equal(q.status, 200);
    assert.equal(q.data.total, 0);
  });
});
