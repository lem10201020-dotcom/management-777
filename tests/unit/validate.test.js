// 단위 테스트: 입력 검증·계산 규칙 (TEST_PLAN.md 1장 ①)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateVehicle, validateReservation, validateUsageLog, validateUser, passwordError,
  computeTrip, overlaps, parseLocalDateTime, isValidYmd, DEFAULT_SETTINGS,
} from '../../js/utils/validate.js';
import { addDays, addMonths, lastDayOfMonth, kst, rangeLabel, fmtKm } from '../../js/utils/format.js';

test('차량번호 형식 (T-08-3, T-08-4)', () => {
  const base = { model: '레이', seats: 4, fuel_type: '휘발유', initial_odometer: 0 };
  assert.deepEqual(validateVehicle({ ...base, plate_no: '12가3456' }).errors, {});
  assert.deepEqual(validateVehicle({ ...base, plate_no: '123가4567' }).errors, {});
  assert.ok(validateVehicle({ ...base, plate_no: 'ABC123' }).errors.plate_no);
  assert.ok(validateVehicle({ ...base, plate_no: '12가345' }).errors.plate_no);
  assert.ok(validateVehicle({ ...base, plate_no: '12가3456', seats: 0 }).errors.seats);
});

test('예약: 종료 < 시작, 10분 단위, 최대 시간 (T-03-5)', () => {
  const ok = { vehicle_id: 1, start_at: '2030-01-02T14:00', end_at: '2030-01-02T16:00', destination: '○○동', purpose_category: '행정업무', passenger_count: 0 };
  assert.deepEqual(validateReservation(ok).errors, {});
  assert.match(validateReservation({ ...ok, end_at: '2030-01-02T13:00' }).errors.end_at, /늦어야/);
  assert.match(validateReservation({ ...ok, start_at: '2030-01-02T14:05' }).errors.start_at, /10분/);
  assert.match(validateReservation({ ...ok, end_at: '2030-01-04T14:00' }).errors.end_at, /최대 24시간/);
  assert.ok(validateReservation({ ...ok, purpose_category: '없는 목적' }).errors.purpose_category);
});

test('예약: 목적지 길이 경계 (T-03-8)', () => {
  const ok = { vehicle_id: 1, start_at: '2030-01-02T14:00', end_at: '2030-01-02T16:00', purpose_category: '행정업무' };
  assert.ok(validateReservation({ ...ok, destination: '가' }).errors.destination);
  assert.equal(validateReservation({ ...ok, destination: '가'.repeat(100) }).errors.destination, undefined);
  assert.ok(validateReservation({ ...ok, destination: '가'.repeat(101) }).errors.destination);
});

test('운행일지: 계기판·주유 규칙 (T-04-3, T-04-4, T-04-9)', () => {
  const ok = { vehicle_id: 1, driver_id: 1, drive_date: '2026-10-05', depart_time: '09:00', return_time: '11:00', odometer_start: 100, odometer_end: 142, destination: '○○동', purpose_category: '행정업무' };
  assert.deepEqual(validateUsageLog(ok).errors, {});
  assert.match(validateUsageLog({ ...ok, odometer_end: 90 }).errors.odometer_end, /작을 수 없습니다/);
  assert.deepEqual(validateUsageLog({ ...ok, odometer_end: 100 }).errors, {}); // 0km 허용
  assert.match(validateUsageLog({ ...ok, fuel_liters: '30' }).errors.fuel_cost, /주유 금액/);
  assert.equal(validateUsageLog({ ...ok, fuel_liters: '30.26', fuel_cost: '50000' }).value.fuel_liters, 30.3);
});

test('자정 넘김 운행 계산 (T-04-8)', () => {
  const t = computeTrip('2026-10-05', '23:00', '01:00');
  assert.equal(t.return_at - t.depart_at, 2 * 3600_000);
  assert.equal(t.overnight, true);
});

test('겹침 판정은 반열린 구간 (T-03-3)', () => {
  assert.equal(overlaps(14, 16, 15, 17), true);
  assert.equal(overlaps(14, 16, 16, 18), false);
});

test('사용자·비밀번호 규칙 (T-09-2, T-09-7)', () => {
  assert.ok(validateUser({ login_id: 'ab', name: '홍길동', roles: ['staff'] }, { isCreate: true }).errors.login_id);
  assert.ok(validateUser({ login_id: 'Staff!', name: '홍길동', roles: ['staff'] }, { isCreate: true }).errors.login_id);
  assert.ok(validateUser({ name: '홍길동', roles: ['staff'], phone_ext: '010-1234-5678' }).errors.phone_ext);
  assert.ok(validateUser({ name: '홍길동', roles: ['approver'] }).errors.approver_step);
  assert.equal(validateUser({ name: '홍길동', roles: ['staff'], approver_step: 2 }).value.approver_step, null);
  assert.ok(passwordError('short1'));
  assert.ok(passwordError('onlyletters'));
  assert.equal(passwordError('Sample1234'), null);
});

test('날짜 도우미', () => {
  assert.equal(isValidYmd('2026-02-30'), false);
  assert.ok(Number.isNaN(parseLocalDateTime('2026-13-01T10:00')));
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(lastDayOfMonth('2028-02'), 29);
  assert.equal(kst('2026-10-31T15:30:00Z').ymd, '2026-11-01'); // KST 기준 월 경계 (T-02-3)
  assert.equal(rangeLabel('2026-11-19T05:00:00Z', '2026-11-19T07:00:00Z'), '14:00~16:00');
  assert.equal(fmtKm(12340), '12,340km');
  assert.ok(DEFAULT_SETTINGS.purpose_categories.length > 0);
});

test('결재라인 검증 (F-14)', async () => {
  const { validateApprovalLine } = await import('../../js/utils/validate.js');
  const ok = { steps: [{ name: '팀장', approver_ids: [1] }, { name: '관장', approver_ids: ['2', 3] }] };
  const r = validateApprovalLine(ok);
  assert.deepEqual(r.errors, {});
  assert.deepEqual(r.value.steps.map((s) => s.order), [1, 2]);
  assert.deepEqual(r.value.steps[1].approver_ids, [2, 3]);
  assert.equal(r.value.show_drafter, true);
  assert.ok(validateApprovalLine({ steps: [] }).errors.steps);
  assert.ok(validateApprovalLine({ steps: Array.from({ length: 6 }, (_, i) => ({ name: `단계${i}`, approver_ids: [i + 1] })) }).errors.steps);
  assert.ok(validateApprovalLine({ steps: [{ name: '', approver_ids: [1] }] }).errors.step_0_name);
  assert.ok(validateApprovalLine({ steps: [{ name: '열한글자이름입니다요오', approver_ids: [1] }] }).errors.step_0_name);
  assert.ok(validateApprovalLine({ steps: [{ name: '팀장', approver_ids: [] }] }).errors.step_0_approvers);
  assert.match(validateApprovalLine({ steps: [{ name: '팀장', approver_ids: [1] }, { name: '팀장', approver_ids: [2] }] }).errors.step_1_name, /이미 있습니다/);
  assert.match(validateApprovalLine({ steps: [{ name: '팀장', approver_ids: [1] }, { name: '관장', approver_ids: [1] }] }).errors.step_1_approvers, /한 단계에만/);
});
