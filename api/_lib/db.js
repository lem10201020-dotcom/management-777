// DB 연결 (Supabase PostgreSQL). 프론트엔드는 DB에 직접 접속하지 않는다. (CLAUDE.md 3장)
import postgres from 'postgres';

let sql;

export function getSql() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
  const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)|host=\/|^postgres(ql)?:\/\/\/?[^@]*$/.test(url);
  sql = postgres(url, {
    ssl: isLocal ? false : 'require',
    prepare: false, // Supabase Transaction pooler(6543) 호환
    max: isLocal ? 10 : 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // date 타입은 'YYYY-MM-DD' 문자열 그대로 사용 (시간대 변환 방지)
    types: { date: { to: 1082, from: [1082], serialize: (x) => x, parse: (x) => x } },
    onnotice: () => {},
  });
  return sql;
}

/** 테스트용: 연결 종료 */
export async function closeSql() {
  if (sql) { await sql.end({ timeout: 2 }); sql = undefined; }
}
