-- 차량예약관리대장 DB 스키마 (PostgreSQL 15+ / Supabase)
-- 용어·상태값은 CLAUDE.md 5장과 일치해야 한다.
-- 이 파일은 여러 번 실행해도 안전하도록(idempotent) 작성한다.

create extension if not exists btree_gist;

-- 사용자(직원)
create table if not exists users (
  id                    integer generated always as identity primary key,
  login_id              text not null unique check (login_id ~ '^[a-z0-9]{4,20}$'),
  name                  text not null check (char_length(name) between 2 and 20),
  team                  text not null default '',
  roles                 text[] not null default '{staff}'
                        check (roles <@ array['staff','manager','approver','admin']::text[] and cardinality(roles) > 0),
  approver_step         smallint check (approver_step between 1 and 9),
  phone_ext             text check (phone_ext is null or phone_ext ~ '^[0-9]{2,6}$'),
  can_drive             boolean not null default true,
  is_active             boolean not null default true,
  password_hash         text not null,
  must_change_password  boolean not null default true,
  failed_attempts       integer not null default 0,
  locked_until          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- 로그인 세션 (토큰 원문은 저장하지 않고 HMAC 값만 저장)
create table if not exists sessions (
  id            text primary key,
  user_id       integer not null references users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index if not exists sessions_user_idx on sessions(user_id);

-- 차량
create table if not exists vehicles (
  id                integer generated always as identity primary key,
  plate_no          text not null unique check (plate_no ~ '^[0-9]{2,3}[가-힣][0-9]{4}$'),
  model             text not null check (char_length(model) between 1 and 30),
  seats             smallint not null check (seats between 1 and 45),
  fuel_type         text not null check (fuel_type in ('휘발유','경유','LPG','전기','하이브리드')),
  initial_odometer  integer not null check (initial_odometer >= 0),
  status            text not null default 'available' check (status in ('available','maintenance','retired')),
  color             text not null default '#1B2A4A',
  note              text not null default '' check (char_length(note) <= 200),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 차량예약
create table if not exists reservations (
  id                integer generated always as identity primary key,
  vehicle_id        integer not null references vehicles(id),
  user_id           integer not null references users(id),
  start_at          timestamptz not null,
  end_at            timestamptz not null,
  destination       text not null check (char_length(destination) between 2 and 100),
  purpose_category  text not null,
  purpose_note      text not null default '' check (char_length(purpose_note) <= 200),
  passenger_count   smallint not null default 0 check (passenger_count >= 0),
  status            text not null default 'requested'
                    check (status in ('requested','confirmed','completed','cancelled','no_show')),
  cancel_reason     text not null default '',
  created_by        integer not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (end_at > start_at)
);
-- 같은 차량의 시간 겹침을 DB 수준에서 차단 (FEATURES.md F-03 규칙 1)
do $$ begin
  alter table reservations add constraint reservations_no_overlap
    exclude using gist (vehicle_id with =, tstzrange(start_at, end_at, '[)') with &&)
    where (status in ('requested','confirmed','completed'));
exception when duplicate_object or duplicate_table then null; end $$;
create index if not exists reservations_time_idx on reservations(start_at, end_at);

-- 운행일지 (차량사용대장의 한 줄)
create table if not exists usage_logs (
  id                integer generated always as identity primary key,
  reservation_id    integer unique references reservations(id),
  vehicle_id        integer not null references vehicles(id),
  driver_id         integer not null references users(id),
  drive_date        date not null,
  depart_at         timestamptz not null,
  return_at         timestamptz not null,
  odometer_start    integer not null check (odometer_start >= 0),
  odometer_end      integer not null,
  distance_km       integer generated always as (odometer_end - odometer_start) stored,
  destination       text not null check (char_length(destination) between 2 and 100),
  purpose_category  text not null,
  passenger_count   smallint not null default 0 check (passenger_count >= 0),
  fuel_liters       numeric(5,1) check (fuel_liters is null or fuel_liters between 0 and 200),
  fuel_cost         integer check (fuel_cost is null or fuel_cost between 0 and 1000000),
  note              text not null default '' check (char_length(note) <= 300),
  mismatch_reason   text not null default '',
  driver_signature  text,
  signature_type    text check (signature_type in ('image','typed')),
  signed_at         timestamptz,
  status            text not null default 'draft' check (status in ('draft','submitted','locked')),
  created_by        integer not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (odometer_end >= odometer_start),
  check (return_at > depart_at),
  check (status = 'draft' or driver_signature is not null)
);
create index if not exists usage_logs_vehicle_date_idx on usage_logs(vehicle_id, drive_date);

-- 월별 차량대장
create table if not exists monthly_ledgers (
  id                 integer generated always as identity primary key,
  vehicle_id         integer not null references vehicles(id),
  year_month         text not null check (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status             text not null default 'open' check (status in ('open','submitted','approved','rejected')),
  round              integer not null default 0,
  log_count          integer not null default 0,
  total_distance     integer not null default 0,
  total_fuel_liters  numeric(7,1) not null default 0,
  total_fuel_cost    integer not null default 0,
  odometer_first     integer,
  odometer_last      integer,
  manager_comment    text not null default '' check (char_length(manager_comment) <= 300),
  recall_reason      text not null default '',
  submitted_by       integer references users(id),
  submitted_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (vehicle_id, year_month)
);

-- 결재 서명 (회차 round별 이력 보존)
create table if not exists approvals (
  id              integer generated always as identity primary key,
  ledger_id       integer not null references monthly_ledgers(id),
  round           integer not null,
  step_order      smallint not null,
  step_name       text not null,
  approver_id     integer not null references users(id),
  decision        text not null check (decision in ('approved','rejected')),
  signature       text,
  signature_type  text check (signature_type in ('image','typed')),
  comment         text not null default '' check (char_length(comment) <= 300),
  decided_at      timestamptz not null default now(),
  unique (ledger_id, round, step_order)
);

-- 감사 기록 (비밀번호·서명 이미지·세션값은 기록하지 않음)
create table if not exists audit_logs (
  id         bigint generated always as identity primary key,
  user_id    integer references users(id),
  action     text not null,
  entity     text not null,
  entity_id  text,
  summary    jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
create index if not exists audit_logs_at_idx on audit_logs(at desc);

-- 시스템 설정 (FEATURES.md F-13)
create table if not exists settings (
  key    text primary key,
  value  jsonb not null
);

-- Supabase 보안: 앱은 서버(Vercel 함수)에서 DB에 직접 접속한다.
-- Supabase REST/GraphQL(anon, authenticated 키)로는 어떤 테이블도 읽고 쓸 수 없도록
-- RLS를 켜고 정책을 만들지 않으며, 권한도 회수한다. (SECURITY.md 7장)
do $$
declare t text;
begin
  foreach t in array array['users','sessions','vehicles','reservations','usage_logs',
                           'monthly_ledgers','approvals','audit_logs','settings']
  loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t);
    end if;
  end loop;
end $$;
