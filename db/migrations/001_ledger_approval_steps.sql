-- 001: 결재라인 편집 기능 (2026-11-19)
-- 결재요청 시점의 결재라인을 대장에 저장해, 결재라인을 바꿔도 진행 중·완료된 대장의 결재란이 바뀌지 않게 한다.
-- 기존 배포 DB에 적용: Supabase SQL Editor에서 실행하거나 npm run db:setup (schema.sql 에도 포함됨)
alter table monthly_ledgers add column if not exists approval_steps jsonb;
