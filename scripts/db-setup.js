// DB 테이블 생성: DATABASE_URL 대상에 db/schema.sql 실행 (여러 번 실행해도 안전)
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);
const { getSql, closeSql } = await import('../api/_lib/db.js');
const sql = getSql();
const ddl = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
await sql.unsafe(ddl);
console.log('스키마 적용 완료');
await closeSql();
