# CLAUDE.md — AI 개발 지침

> 이 문서는 Claude Code 등 AI 개발 도구와 사람 개발자가 **차량예약관리대장** 프로젝트를 작업할 때 반드시 따르는 기준이다.
> 다른 문서(README.md, FEATURES.md, UI_UX.md, SECURITY.md, TEST_PLAN.md)와 내용이 다르면 **작업을 멈추고 충돌을 먼저 보고**한다.

---

## 1. 프로젝트 목적

| 항목 | 내용 |
|---|---|
| 기관 | 서구종합사회복지관 (종합사회복지관) |
| 프로젝트명 | 차량예약관리대장 |
| 개발 목적 | 직원·일정·행정 관리 — 기관 차량의 예약, 운행 기록, 월별 대장 결재를 하나의 흐름으로 관리 |
| 현장 문제 | 차량 예약 → 차량사용대장 기재 → 월별 차량대장 정리가 각각 따로 이루어져 중복 입력·누락·집계 오류가 생김 |
| 사용자 | 사회복지사 등 직원 약 20명 (PC + 모바일) |

### 1-1. 핵심 업무 흐름 (이 프로젝트의 뼈대)

```
① 차량예약  →  ② 차량사용  →  ③ 차량사용내역 입력(운행일지)  →  ④ 월별 차량대장 정리·출력·결재
 (예약 등록)     (실제 운행)      (예약을 운행기록으로 전환)          (자동 집계 → PDF → 서명)
```

- **한 번 입력한 정보는 다음 단계로 자동 이어진다.** 예약의 차량·일시·목적은 운행일지 초안으로, 운행일지는 월별 차량대장으로 자동 집계된다.
- 모든 기능은 이 흐름을 돕는 방향으로만 추가한다. 흐름과 무관한 기능은 넣지 않는다.

### 1-2. 선택 기능의 기관 맞춤 재해석

요청된 공통 기능을 이 프로젝트에서는 다음과 같이 해석한다. (FEATURES.md와 동일해야 함)

| 요청 기능 | 이 프로젝트에서의 의미 |
|---|---|
| 대시보드·통계 | 오늘/이번 주 예약 현황, 차량별 상태, 운행일지 미입력 건, 월간 운행거리·주유 통계, 결재 대기 |
| 이용자 등록·수정·검색 | **시스템 사용자(직원)와 차량** 등록·수정·검색. 복지관 서비스 이용자(대상자) 정보는 **수집하지 않음** |
| PDF 출력 | 월별 차량대장·차량사용대장(운행일지)을 A4로 출력 (브라우저 인쇄 → PDF 저장) |
| 서명 입력 | 운행일지 운전자 확인 서명, 월별 차량대장 결재 서명 |
| 일정·캘린더 | 차량 예약 캘린더(월/주/일), 차량별 예약 겹침 방지 |
| 백업·복원 | 관리자가 서버 DB 데이터를 JSON으로 내보내기·검증 후 복원 |
| 글자 크기 조절 | 3단계(기본/크게/아주 크게), 기기별 설정 유지 |

---

## 2. 작업 원칙

1. **문서 우선**: 기능 구현 전 FEATURES.md의 해당 기능 명세와 완료 기준을 확인한다. 명세에 없는 기능은 만들지 않고 먼저 문서에 제안한다.
2. **[입력 필요]/TODO 항목은 임의로 채우지 않는다.** 결재선, 고유 서식, 예외 승인 절차 등은 기관 확인 전까지 설정값(config)으로 분리하거나 TODO로 남긴다.
3. **확인되지 않은 법령·평가지표·보존기간은 사실처럼 쓰지 않는다.** 코드 주석·화면 문구·문서에 `확인 필요`로 표기한다.
4. **가상 데이터만 사용**: 샘플·테스트·스크린샷에는 `홍길동` 같은 명백한 가상 이름, `12가3456` 같은 가상 차량번호만 쓴다. 실제 직원·이용자 정보 금지.
5. **최소 수집**: 운행 목적·동승자는 업무 구분과 **인원수**로만 기록한다. 서비스 이용자(대상자) 이름·주소·연락처·건강정보는 어떤 필드에도 받지 않는다.
6. **작게, 검증 가능하게**: 한 번에 한 기능 단위로 작업하고 TEST_PLAN.md의 해당 시나리오를 통과시킨 뒤 다음으로 넘어간다.
7. **모바일과 PC 모두 1급 시민**: 모든 화면은 360px 모바일과 1280px PC에서 확인한다(UI_UX.md 7장).
8. 사용자 존엄성·자기결정권·접근성: 직원도, 기록 속 대상자도 존중하는 문구를 쓰고, 키보드·스크린리더·큰 글씨 사용자가 모든 기능을 쓸 수 있게 한다.

---

## 3. 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 프론트엔드 | HTML + CSS + JavaScript (ES Modules), **프레임워크·번들러 없음** | 해시 라우팅(`#/reservations`) SPA |
| 백엔드 | Vercel Serverless Function **1개**(`api/index.js`)가 모든 `/api/*`를 처리 (`vercel.json` rewrite) | 프론트에서 DB에 직접 접속 금지. 함수 개수 제한 회피 |
| DB | **Supabase (PostgreSQL) — 확정** | 서버에서 `postgres` 드라이버로 접속(Transaction pooler 6543, `prepare: false`). Supabase REST/anon 키는 사용하지 않으며 모든 테이블 RLS 활성화·권한 회수 |
| 인증 | **자체 구현 — 확정**: 아이디+비밀번호(bcrypt cost 12), `sessions` 테이블, HttpOnly 쿠키 | Supabase Auth는 이메일 기반이라 사용하지 않음 |
| PDF | 인쇄 전용 CSS(`print.css`) + `window.print()` | 외부 PDF 라이브러리는 서식 확정 후 필요 시에만 검토 |
| 서명 | `<canvas>` + Pointer Events, PNG(Data URL)로 저장 | 키보드 대체 수단 제공(FEATURES.md F-07) |
| 배포 | Vercel (GitHub 연동, Preview/Production 분리) | 환경변수로 DB 접속정보 관리 |
| 테스트 | 유틸 함수: `node --test` / 화면: Playwright | TEST_PLAN.md 참고 |

> 서버 DB를 사용하므로 데이터는 기관 직원 간 공유·동기화된다. 단, **글자 크기 등 개인 화면 설정만** 브라우저 `localStorage`에 저장하며, 업무 데이터는 절대 브라우저 저장소에 보관하지 않는다(SECURITY.md 6장).

---

## 4. 파일 구조 (목표)

```
/
├─ index.html                 # 앱 셸(헤더·내비게이션·main 영역)
├─ css/
│  ├─ tokens.css              # 색상·간격·글자 크기 디자인 토큰 (UI_UX.md 2장과 일치)
│  ├─ base.css                # 리셋·타이포그래피·포커스 스타일
│  ├─ layout.css              # 반응형 레이아웃(사이드바/하단탭)
│  ├─ components.css          # 버튼·폼·카드·표·모달·토스트
│  └─ print.css               # A4 출력 전용
├─ js/
│  ├─ app.js                  # 초기화, 인증 상태 확인
│  ├─ router.js               # 해시 라우터, 권한 가드
│  ├─ api.js                  # fetch 래퍼(오류 처리·세션 만료 처리)
│  ├─ state.js                # 화면 상태(로그인 사용자, 설정)
│  ├─ views/                  # 화면 단위 모듈
│  │  ├─ dashboard.js
│  │  ├─ calendar.js          # 예약 캘린더
│  │  ├─ reservation-form.js
│  │  ├─ usage-logs.js        # 차량사용대장(운행일지) 목록·입력
│  │  ├─ monthly-ledger.js    # 월별 차량대장·결재
│  │  ├─ vehicles.js          # 차량 관리
│  │  ├─ users.js             # 사용자(직원) 관리
│  │  ├─ backup.js
│  │  └─ settings.js
│  ├─ components/             # 재사용 UI (modal, toast, signature-pad, data-table 등)
│  └─ utils/
│     ├─ validate.js          # 입력 검증 규칙(서버와 동일 규칙 공유)
│     ├─ format.js            # 날짜·숫자·거리 포맷
│     └─ escape.js            # HTML 이스케이프
├─ api/
│  ├─ index.js                # 유일한 Vercel 함수: 라우팅·CSRF(Origin) 검사·세션·오류 형식
│  └─ _lib/                   # db 연결, http, session, audit, settings, signature
│     └─ routes/              # auth, vehicles, users, reservations, usage-logs, ledgers(결재 포함), dashboard
├─ db/
│  ├─ schema.sql              # 테이블 정의 (여러 번 실행해도 안전)
│  └─ migrations/             # 스키마 변경 이력 (배포 후 변경부터 사용)
├─ scripts/
│  ├─ db-setup.js             # schema.sql 적용
│  ├─ db-seed.js              # 가상 샘플 데이터 (로컬 DB 외에는 거부)
│  └─ create-admin.js         # 운영 최초 관리자 생성
├─ server/dev.js              # 로컬 개발 서버 (정적 파일 + /api, Vercel CLI 불필요)
├─ tests/
│  ├─ unit/                   # node --test (검증·날짜 규칙)
│  ├─ api/                    # node --test + 테스트 DB (권한·상태 전이·업무 흐름)
│  └─ e2e/ui-flow.cjs         # Playwright 화면 흐름
├─ vercel.json                # rewrite, 보안 헤더(CSP 등)
├─ .vercelignore              # db/tests/scripts/server/문서는 배포하지 않음
└─ *.md                       # 프로젝트 문서
```

---

## 5. 데이터 구조 요약 (모든 문서 공통 용어)

> 별도 DATA_MODEL.md는 이번 범위에서 생성하지 않으므로 핵심 엔터티를 여기에 정의한다. 필드 상세는 FEATURES.md 각 기능의 "입력값"과 일치해야 한다.

| 엔터티 (테이블) | 한국어 용어 | 핵심 필드 | 관계 |
|---|---|---|---|
| `users` | 사용자(직원) | id, login_id, name, team, roles(배열), approver_step(결재자의 담당 단계), phone_ext(선택), can_drive, is_active, password_hash, must_change_password | 1:N 예약·운행일지 |
| `sessions` | 로그인 세션 | id(토큰 HMAC), user_id, last_seen_at, expires_at | N:1 사용자 |
| `settings` | 시스템 설정 | key, value(jsonb) — FEATURES.md F-13 키 | — |
| `vehicles` | 차량 | id, plate_no, model, seats, fuel_type, initial_odometer, status, note | 1:N 예약·운행일지 |
| `reservations` | 차량예약 | id, vehicle_id, user_id, start_at, end_at, destination, purpose_category, purpose_note, passenger_count, status | 1:0..1 운행일지 |
| `usage_logs` | 운행일지(차량사용대장의 한 줄) | id, reservation_id(선택), vehicle_id, driver_id, drive_date, depart_at, return_at, odometer_start, odometer_end, distance_km(자동), destination, purpose_category, passenger_count, fuel_liters, fuel_cost, note, driver_signature, status | N:1 월별 차량대장 |
| `monthly_ledgers` | 월별 차량대장 | id, vehicle_id, year_month, total_distance, total_fuel_liters, total_fuel_cost, log_count, status, submitted_by, submitted_at | 1:N 결재 서명 |
| `approvals` | 결재 서명 | id, ledger_id, step_order, step_name, approver_id, decision, signature, comment, decided_at | N:1 월별 차량대장 |
| `audit_logs` | 감사 기록 | id, user_id, action, entity, entity_id, at, summary | — |

**상태 값 (코드·화면·문서 공통)**

- 예약 `reservations.status`: `requested`(신청) → `confirmed`(확정) → `completed`(운행완료: 운행일지 입력됨) / `cancelled`(취소) / `no_show`(미사용)
  - 신청→확정이 자동인지 승인 필요인지는 **[입력 필요] 예외·승인 절차**. 기본 설정값은 `자동 확정`, 설정으로 전환 가능하게 구현.
- 운행일지 `usage_logs.status`: `draft`(작성중) → `submitted`(제출) → `locked`(월별 대장 결재완료로 잠김)
- 월별 차량대장 `monthly_ledgers.status`: `open`(작성중) → `submitted`(결재요청) → `approved`(결재완료) / `rejected`(반려 → 다시 open)

**역할 `users.role`**

| 역할 | 코드 | 권한 요약 |
|---|---|---|
| 직원 | `staff` | 예약 신청·취소(본인), 본인 운행일지 작성·제출, 조회 |
| 차량담당자 | `manager` | 차량 등록·수정, 모든 예약·운행일지 관리, 월별 대장 생성·결재요청 |
| 결재자 | `approver` | 월별 차량대장 결재·반려 서명 |
| 관리자 | `admin` | 사용자 관리, 백업·복원, 시스템 설정 |

> 한 사람이 여러 역할을 가질 수 있다(예: 팀장 = approver + staff). 실제 결재 단계(담당 → 팀장 → 관장 등)는 **[입력 필요]**이며 `approval_steps` 설정으로 관리한다.

---

## 6. 코딩 규칙

- **JavaScript**: ES2020+, `type="module"`, 전역 변수 금지, `const` 기본·`let` 최소, `var` 금지.
- **DOM 출력**: 사용자 입력값은 `textContent` 또는 `escape.js`를 거쳐 출력. `innerHTML`에 미검증 문자열 삽입 금지.
- **검증**: 모든 입력은 클라이언트(UX용)와 **서버(신뢰 기준)** 양쪽에서 검증. 규칙은 `utils/validate.js`에 정의하고 서버에서 재사용.
- **SQL**: 매개변수 바인딩(파라미터화 쿼리)만 사용. 문자열 연결로 쿼리 작성 금지.
- **권한**: 모든 `/api` 핸들러는 첫 줄에서 세션·역할 확인. 프론트의 메뉴 숨김은 보안 수단이 아님.
- **날짜·시간**: DB에는 `timestamptz`(UTC), 화면은 `Asia/Seoul`로 표시. 월 경계 집계는 KST 기준.
- **숫자**: 계기판 km는 정수, 주유량은 소수 1자리, 금액은 원 단위 정수.
- **CSS**: 색·간격·글자 크기는 `tokens.css` 변수만 사용(하드코딩 금지). 크기는 `rem` 기준 → 글자 크기 조절이 전체에 반영되어야 함. 모바일 우선(min-width 미디어쿼리).
- **접근성**: 의미 있는 HTML 요소 우선(`button`, `label`, `table`, `nav`, `main`), 모든 입력에 `<label>`, 오류는 `aria-describedby`로 연결.
- **이름 규칙**: 파일 `kebab-case.js`, 함수·변수 `camelCase`, DB 컬럼 `snake_case`, 화면 문구는 한국어.
- **문구**: 오류 메시지는 "무엇이 문제인지 + 어떻게 고치는지"를 함께 쓴다(UI_UX.md 5장).
- **주석**: 업무 규칙이 들어간 코드에는 근거 문서(예: `// FEATURES.md F-04 규칙 3`)를 단다.

---

## 7. 금지사항

- ❌ 실제 직원·이용자 개인정보, 실제 차량번호를 코드·샘플·테스트·커밋에 포함
- ❌ 서비스 이용자(대상자)의 이름·주민번호·주소·연락처·건강정보 수집 필드 추가
- ❌ 업무 데이터를 `localStorage`/`sessionStorage`/IndexedDB에 저장 (화면 설정 제외)
- ❌ DB 접속정보·비밀키를 프론트엔드 코드나 저장소에 커밋 (Vercel 환경변수 사용)
- ❌ 프레임워크(React, Vue 등)·빌드 도구 도입 (문서 개정 없이)
- ❌ 결재완료(`approved`)된 월별 대장과 잠긴(`locked`) 운행일지를 일반 수정 경로로 변경
- ❌ 물리 삭제로 기록 제거 (운행일지·결재는 취소/반려 상태로 남김. 사용자·차량은 `is_active=false`)
- ❌ 확인되지 않은 법령 조항·평가지표·보존기간을 확정된 사실처럼 표기
- ❌ 외부 CDN 스크립트 무분별 추가 (필요 시 버전 고정 + SECURITY.md 갱신)

---

## 8. 완료 기준 (Definition of Done)

기능 하나를 "완료"라고 하려면 아래를 모두 만족해야 한다.

- [ ] FEATURES.md의 해당 기능 **완료 기준** 전 항목 충족
- [ ] TEST_PLAN.md의 해당 시나리오(정상·오류·경계값) 통과, 결과 기록
- [ ] 서버 측 검증·권한 검사 구현
- [ ] 360px(모바일)·768px(태블릿)·1280px(PC)에서 레이아웃 깨짐 없음
- [ ] 키보드만으로 조작 가능, 포커스 표시 보임
- [ ] 글자 크기 '아주 크게'에서 잘림·겹침 없음
- [ ] 빈 상태·로딩·오류 상태 화면 구현(UI_UX.md 5장)
- [ ] 가상 데이터만 사용
- [ ] 관련 문서 갱신 (아래 9장)

---

## 9. 변경 시 문서 갱신 규칙

| 변경 내용 | 반드시 갱신할 문서 |
|---|---|
| 기능 추가·변경·삭제 | FEATURES.md, TEST_PLAN.md, (사용법이 바뀌면) README.md |
| DB 필드·상태값·역할 변경 | CLAUDE.md 5장, FEATURES.md 입력값, `db/migrations/`, SECURITY.md(개인정보 항목이면) |
| 화면·메뉴·디자인 토큰 변경 | UI_UX.md, `css/tokens.css` |
| 인증·권한·저장 방식·외부 의존성 변경 | SECURITY.md, CLAUDE.md 3장 |
| 배포·환경변수 변경 | README.md |
| [입력 필요] 항목이 기관 확인으로 확정됨 | 해당 TODO가 있는 모든 문서에서 TODO 제거 후 확정 내용 반영 |

문서끼리 용어가 달라지면 이 문서(CLAUDE.md 5장)의 용어를 기준으로 맞춘다.

---

## 10. 미확정 사항 (TODO — 임의로 채우지 말 것)

| ID | 항목 | 영향 범위 | 현재 처리 |
|---|---|---|---|
| TODO-01 | **[입력 필요] 고유 서식**: 기관이 쓰는 차량사용대장·월별 차량대장 양식(항목, 칸 순서, 결재란 모양) | F-04, F-05, F-10(출력) | 일반적인 항목으로 임시 설계, 양식 받은 후 `print.css`·필드 조정 |
| TODO-02 | **[입력 필요] 예외·승인 절차**: 예약 승인 필요 여부, 당일·긴급 예약, 장거리·야간·주말 운행, 사고·고장 처리, 개인 차량 사용 여부 | F-03 상태 전환 | 기본 `자동 확정`, 설정으로 승인제 전환 가능 |
| TODO-03 | 결재선(담당→팀장→부장→관장 등 단계 수와 명칭) | F-06 | `approval_steps` 설정값, 기본 예시 2단계 |
| TODO-04 | 운행 목적 분류 목록(예: 사례관리 방문, 프로그램 운영, 행정업무, 물품 운반, 기타) | F-03, F-04 통계 | 예시값으로 시작, 관리자가 수정 가능 |
| TODO-05 | 기록 보존기간·폐기 기준 | 백업·삭제 정책 | **확인 필요** — 기관 규정·관련 법령 확인 전까지 자동 삭제 기능 없음 |
| ~~TODO-06~~ | DB 공급자와 인증 방식 | 인프라 | **확정 (2026-11-19)**: Supabase(PostgreSQL) + 자체 세션 인증 |
| TODO-07 | 주유·정비·보험 등 차량 관리 항목 범위 | F-04, F-08 | MVP는 주유만, 정비는 제안 항목 |
| TODO-08 | 전자서명의 내부 결재 효력 인정 여부 | F-07 | **확인 필요** — 인정 전까지 출력물 자필 서명 병행 가능하도록 설계 |

---

## 11. 구현 현황 (2026-11-19 기준)

| 기능 | 상태 | 비고 |
|---|---|---|
| F-01 로그인·권한 | ✅ 구현 | 5회 실패 잠금, 첫 로그인 비밀번호 변경 강제, 세션 만료 시 재로그인 모달 |
| F-02 대시보드·통계 | ✅ 구현 | 차트는 CSS 막대 + 동일 수치 표 |
| F-03 차량예약·캘린더 | ✅ 구현 | 월/주/일·목록 보기. 주 보기는 시간축 대신 요일별 카드(MVP) |
| F-04 운행일지 | ✅ 구현 | km 연속성 경고·사유, 자정 넘김, 임시저장 |
| F-05 월별 차량대장 | ✅ 구현 | 결재요청 점검, 스냅숏, 회수 |
| F-06 결재 | ✅ 구현 | 단계 순서 강제, 반려 이력 보존, 결재완료 시 잠금 |
| F-07 서명 | ✅ 구현 | 캔버스 + 키보드 대체 서명 |
| F-08 차량 관리 / F-09 사용자 관리 | ✅ 구현 | |
| F-10 PDF 출력 | ✅ 월별 대장 | 운행일지 1건·기간별 차량사용대장 출력은 미구현 |
| F-11 백업·복원 | ⏳ 미구현(2차) | 그 전까지 Supabase 자동 백업 사용 |
| F-12 글자 크기 | ✅ 구현 | |
| F-13 시스템 설정 화면 | ⏳ 미구현(2차) | 설정값은 `settings` 테이블에 SQL로 입력, 없으면 기본값 |
