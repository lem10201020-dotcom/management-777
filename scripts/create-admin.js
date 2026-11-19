// 운영 최초 관리자 계정 생성: node scripts/create-admin.js <아이디> <이름>
// 임시 비밀번호가 화면에 한 번만 표시되며, 첫 로그인 시 변경해야 한다.
import { existsSync } from 'node:fs';
import bcrypt from 'bcryptjs';
for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);
const { getSql, closeSql } = await import('../api/_lib/db.js');
const { tempPassword } = await import('../api/_lib/routes/users.js');
const [loginId, name] = process.argv.slice(2);
if (!/^[a-z0-9]{4,20}$/.test(loginId || '') || !name || name.length < 2) {
  console.error('사용법: node scripts/create-admin.js <아이디(영문 소문자·숫자 4~20자)> <이름>');
  process.exit(1);
}
const sql = getSql();
const pw = tempPassword();
await sql`insert into users (login_id, name, roles, password_hash) values (${loginId}, ${name}, '{admin}', ${await bcrypt.hash(pw, 12)})`;
console.log(`관리자 계정을 만들었습니다. 아이디: ${loginId} / 임시 비밀번호: ${pw}`);
await closeSql();
