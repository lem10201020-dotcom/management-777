// 가상 샘플 데이터 입력 (실제 개인정보 금지). 개발·시연용 DB에서만 실행한다.
// 모든 샘플 계정 비밀번호: Sample1234
import { existsSync } from 'node:fs';
import bcrypt from 'bcryptjs';
for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);
const { getSql, closeSql } = await import('../api/_lib/db.js');
const { todayYmd, addDays, addMonths, currentYm } = await import('../js/utils/format.js');

const url = process.env.DATABASE_URL || '';
if (!/localhost|127\.0\.0\.1/.test(url) && process.env.ALLOW_SAMPLE_SEED !== '1') {
  console.error('로컬 DB가 아닙니다. 운영 DB에 가상 데이터가 들어가지 않도록 중단합니다.\n시연용 DB가 맞다면 ALLOW_SAMPLE_SEED=1 을 붙여 실행하세요.');
  process.exit(1);
}
const sql = getSql();
const [{ n }] = await sql`select count(*)::int as n from users`;
if (n > 0 && !process.argv.includes('--reset')) {
  console.error('이미 데이터가 있습니다. 모두 지우고 다시 넣으려면 --reset 을 붙이세요.');
  await closeSql(); process.exit(1);
}
if (process.argv.includes('--reset')) {
  await sql`truncate audit_logs, approvals, monthly_ledgers, usage_logs, reservations, sessions, vehicles, users, settings restart identity cascade`;
}
const hash = await bcrypt.hash('Sample1234', Number(process.env.BCRYPT_COST || 10));
const users = [
  ['staff01', '홍길동', '사례관리팀', ['staff'], null],
  ['staff02', '김가상', '지역조직팀', ['staff'], null],
  ['mgr01', '이담당', '행정지원팀', ['staff', 'manager'], null],
  ['apv01', '박팀장', '사례관리팀', ['staff', 'approver'], 1],
  ['apv02', '최관장', '관장실', ['approver'], 2],
  ['admin01', '관리자', '행정지원팀', ['admin'], null],
];
const ids = {};
for (const [login, name, team, roles, step] of users) {
  const [u] = await sql`insert into users (login_id, name, team, roles, approver_step, password_hash, must_change_password)
    values (${login}, ${name}, ${team}, ${roles}, ${step}, ${hash}, false) returning id`;
  ids[login] = u.id;
}
await sql`insert into users (login_id, name, team, roles, password_hash, must_change_password, is_active)
  values ('old01', '정퇴사', '지역조직팀', '{staff}', ${hash}, false, false)`;
await sql`insert into settings (key, value) values ('teams', ${sql.json(['사례관리팀', '지역조직팀', '서비스제공팀', '행정지원팀', '관장실'])})`;

const vehicles = [
  ['12가3456', '스타리아 11인승', 11, '경유', 10000, 'available', '#1B2A4A'],
  ['34나5678', '레이', 4, '휘발유', 5000, 'available', '#0E6E6E'],
  ['56다7890', '카니발 9인승', 9, '경유', 30000, 'maintenance', '#7A2E5C'],
];
const vid = [];
for (const [plate, model, seats, fuel, odo, status, color] of vehicles) {
  const [v] = await sql`insert into vehicles (plate_no, model, seats, fuel_type, initial_odometer, status, color)
    values (${plate}, ${model}, ${seats}, ${fuel}, ${odo}, ${status}, ${color}) returning id`;
  vid.push(v.id);
}
// 서명 샘플: 1x1 투명 PNG가 아닌, 작은 선 이미지 대신 '대체 서명' 텍스트 사용
const sig = (name) => `전자 확인: ${name} (샘플)`;
const at = (ymd, hm) => new Date(`${ymd}T${hm}:00+09:00`);

// 지난달 운행 3건 (제출) → 월별 대장 결재요청 가능 상태
const lastYm = addMonths(currentYm(), -1);
let odo = 10000;
const lastMonthTrips = [
  ['05', '09:30', '12:00', 42, '○○동 행정복지센터', '사례관리 방문', 1, 'staff01'],
  ['12', '13:00', '17:30', 68, '△△구 복지관 연합회', '회의·교육', 2, 'apv01'],
  ['20', '10:00', '11:30', 15, '□□마트', '물품 운반', 0, 'staff02'],
];
for (const [d, dep, ret, dist, dest, purpose, pax, who] of lastMonthTrips) {
  const ymd = `${lastYm}-${d}`;
  const [r] = await sql`insert into reservations (vehicle_id, user_id, start_at, end_at, destination, purpose_category,
      passenger_count, status, created_by)
    values (${vid[0]}, ${ids[who]}, ${at(ymd, dep)}, ${at(ymd, ret)}, ${dest}, ${purpose}, ${pax}, 'completed', ${ids[who]}) returning id`;
  const name = users.find((u) => u[0] === who)[1];
  await sql`insert into usage_logs (reservation_id, vehicle_id, driver_id, drive_date, depart_at, return_at,
      odometer_start, odometer_end, destination, purpose_category, passenger_count, fuel_liters, fuel_cost,
      driver_signature, signature_type, signed_at, status, created_by)
    values (${r.id}, ${vid[0]}, ${ids[who]}, ${ymd}, ${at(ymd, dep)}, ${at(ymd, ret)}, ${odo}, ${odo + dist},
      ${dest}, ${purpose}, ${pax}, ${d === '12' ? 30.5 : null}, ${d === '12' ? 52000 : null},
      ${sig(name)}, 'typed', now(), 'submitted', ${ids[who]})`;
  odo += dist;
}

// 오늘·이번 주 예약
const today = todayYmd();
await sql`insert into reservations (vehicle_id, user_id, start_at, end_at, destination, purpose_category, passenger_count, status, created_by)
  values (${vid[0]}, ${ids.staff01}, ${at(today, '14:00')}, ${at(today, '16:00')}, '○○동 주민센터', '사례관리 방문', 1, 'confirmed', ${ids.staff01}),
         (${vid[1]}, ${ids.staff02}, ${at(addDays(today, 1), '10:00')}, ${at(addDays(today, 1), '12:00')}, '△△초등학교', '프로그램 운영', 2, 'confirmed', ${ids.staff02}),
         (${vid[0]}, ${ids.apv01}, ${at(addDays(today, 2), '09:00')}, ${at(addDays(today, 2), '18:00')}, '◇◇시 연수원', '회의·교육', 3, 'confirmed', ${ids.apv01}),
         (${vid[1]}, ${ids.staff01}, ${at(addDays(today, -1), '13:00')}, ${at(addDays(today, -1), '15:00')}, '□□동 경로당', '프로그램 운영', 0, 'confirmed', ${ids.staff01})`;
console.log('가상 샘플 데이터 입력 완료 — 계정: staff01, staff02, mgr01, apv01, apv02, admin01 / 비밀번호: Sample1234');
await closeSql();
