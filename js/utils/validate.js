// 입력 검증 규칙 — 브라우저(UX)와 서버(신뢰 기준)가 같은 규칙을 사용한다. (CLAUDE.md 6장)
// 각 함수는 { value, errors } 를 반환한다. errors 는 { 필드명: '안내 문구' }.

export const PLATE_RE = /^\d{2,3}[가-힣]\d{4}$/;
export const LOGIN_ID_RE = /^[a-z0-9]{4,20}$/;
const YMD_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DT_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;
export const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const FUEL_TYPES = ['휘발유', '경유', 'LPG', '전기', '하이브리드'];
export const VEHICLE_STATUS = { available: '사용가능', maintenance: '점검중', retired: '운행종료' };
export const VEHICLE_COLORS = ['#1B2A4A', '#0E6E6E', '#7A2E5C', '#7A4B12', '#2F6B2F', '#4A5568'];
export const ROLES = { staff: '직원', manager: '차량담당자', approver: '결재자', admin: '관리자' };
export const RESERVATION_STATUS = {
  requested: '신청', confirmed: '확정', completed: '운행완료', cancelled: '취소', no_show: '미사용',
};
export const LOG_STATUS = { draft: '작성중', submitted: '제출', locked: '잠김' };
export const LEDGER_STATUS = { open: '작성중', submitted: '결재요청', approved: '결재완료', rejected: '반려' };
export const MISMATCH_REASONS = ['다른 운행 미기록', '계기판 오기 정정', '정비·세차 등 업무 외 이동', '기타'];

export const DEFAULT_SETTINGS = {
  approval_mode: 'auto', // TODO-02: 'auto' | 'manual'
  reservation_max_hours: 24, // TODO-02
  missing_alert_hours: 24,
  distance_warn_km: 500,
  purpose_categories: ['사례관리 방문', '프로그램 운영', '행정업무', '물품 운반', '회의·교육', '기타'], // TODO-04
  approval_steps: [{ order: 1, name: '팀장' }, { order: 2, name: '관장' }], // TODO-03 (예시)
  teams: [],
};

const s = (v) => (typeof v === 'string' ? v.trim() : '');
const toInt = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return NaN;
};
const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const lenBetween = (v, min, max) => v.length >= min && v.length <= max;

export function isValidYmd(v) {
  if (!YMD_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
export const isValidHm = (v) => HM_RE.test(v);
/** 'YYYY-MM-DDTHH:mm' (KST) → epoch ms, 형식 오류 시 NaN */
export function parseLocalDateTime(v) {
  const m = DT_RE.exec(typeof v === 'string' ? v : '');
  if (!m || !isValidYmd(m[1]) || !isValidHm(m[2])) return NaN;
  return Date.parse(`${m[1]}T${m[2]}:00+09:00`);
}

export function validateLogin(input = {}) {
  const value = { login_id: s(input.login_id).toLowerCase(), password: typeof input.password === 'string' ? input.password : '' };
  const errors = {};
  if (!value.login_id) errors.login_id = '아이디를 입력해 주세요.';
  if (!value.password) errors.password = '비밀번호를 입력해 주세요.';
  return { value, errors };
}

export function passwordError(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (pw.length > 72) return '비밀번호는 72자 이하로 입력해 주세요.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '비밀번호에 영문과 숫자를 모두 포함해 주세요.';
  return null;
}

export function validateVehicle(input = {}) {
  const value = {
    plate_no: s(input.plate_no).replace(/\s/g, ''),
    model: s(input.model),
    seats: toInt(input.seats),
    fuel_type: s(input.fuel_type),
    initial_odometer: toInt(input.initial_odometer),
    status: s(input.status) || 'available',
    color: s(input.color) || VEHICLE_COLORS[0],
    note: s(input.note),
  };
  const errors = {};
  if (!PLATE_RE.test(value.plate_no)) errors.plate_no = '차량번호를 "12가3456" 또는 "123가4567" 형식으로 입력해 주세요.';
  if (!lenBetween(value.model, 1, 30)) errors.model = '차종을 1~30자로 입력해 주세요.';
  if (!(value.seats >= 1 && value.seats <= 45)) errors.seats = '승차정원은 1~45 사이 숫자로 입력해 주세요.';
  if (!FUEL_TYPES.includes(value.fuel_type)) errors.fuel_type = '연료를 선택해 주세요.';
  if (!(value.initial_odometer >= 0 && value.initial_odometer <= 9999999)) errors.initial_odometer = '최초 계기판 값은 0 이상의 정수(km)로 입력해 주세요.';
  if (!Object.hasOwn(VEHICLE_STATUS, value.status)) errors.status = '상태를 선택해 주세요.';
  if (!VEHICLE_COLORS.includes(value.color)) errors.color = '표시 색상을 목록에서 선택해 주세요.';
  if (value.note.length > 200) errors.note = '메모는 200자 이하로 입력해 주세요.';
  return { value, errors };
}

export function validateUser(input = {}, { isCreate = false } = {}) {
  const roles = Array.isArray(input.roles) ? [...new Set(input.roles.map(String))] : [];
  const value = {
    login_id: s(input.login_id).toLowerCase(),
    name: s(input.name),
    team: s(input.team),
    roles,
    approver_step: isBlank(input.approver_step) ? null : toInt(input.approver_step),
    phone_ext: s(input.phone_ext) || null,
    can_drive: input.can_drive !== false,
    is_active: input.is_active !== false,
  };
  const errors = {};
  if (isCreate && !LOGIN_ID_RE.test(value.login_id)) errors.login_id = '아이디는 영문 소문자·숫자 4~20자로 입력해 주세요.';
  if (!lenBetween(value.name, 2, 20)) errors.name = '이름을 2~20자로 입력해 주세요.';
  if (value.team.length > 30) errors.team = '소속 팀은 30자 이하로 입력해 주세요.';
  if (!value.roles.length || value.roles.some((r) => !Object.hasOwn(ROLES, r))) errors.roles = '역할을 하나 이상 선택해 주세요.';
  if (value.roles.includes('approver')) {
    if (!(value.approver_step >= 1 && value.approver_step <= 9)) errors.approver_step = '결재자는 담당 결재 단계를 선택해 주세요.';
  } else {
    value.approver_step = null;
  }
  if (value.phone_ext && !/^\d{2,6}$/.test(value.phone_ext)) errors.phone_ext = '내선번호는 숫자 2~6자리로 입력해 주세요. 개인 휴대폰 번호는 적지 마세요.';
  return { value, errors };
}

export function validateReservation(input = {}, settings = DEFAULT_SETTINGS) {
  const value = {
    vehicle_id: toInt(input.vehicle_id),
    user_id: isBlank(input.user_id) ? null : toInt(input.user_id),
    start_at: s(input.start_at),
    end_at: s(input.end_at),
    destination: s(input.destination),
    purpose_category: s(input.purpose_category),
    purpose_note: s(input.purpose_note),
    passenger_count: isBlank(input.passenger_count) ? 0 : toInt(input.passenger_count),
  };
  const errors = {};
  if (!(value.vehicle_id > 0)) errors.vehicle_id = '차량을 선택해 주세요.';
  const st = parseLocalDateTime(value.start_at);
  const et = parseLocalDateTime(value.end_at);
  if (Number.isNaN(st)) errors.start_at = '시작 날짜와 시각을 입력해 주세요.';
  else if (Number(value.start_at.slice(-2)) % 10 !== 0) errors.start_at = '시각은 10분 단위로 입력해 주세요.';
  if (Number.isNaN(et)) errors.end_at = '종료 날짜와 시각을 입력해 주세요.';
  else if (Number(value.end_at.slice(-2)) % 10 !== 0) errors.end_at = '시각은 10분 단위로 입력해 주세요.';
  if (!errors.start_at && !errors.end_at) {
    if (et <= st) errors.end_at = '종료 시각은 시작 시각보다 늦어야 합니다.';
    else if (et - st > settings.reservation_max_hours * 3600_000) errors.end_at = `예약은 최대 ${settings.reservation_max_hours}시간까지 할 수 있습니다.`;
  }
  if (!lenBetween(value.destination, 2, 100)) errors.destination = '목적지를 2~100자로 입력해 주세요.';
  if (!settings.purpose_categories.includes(value.purpose_category)) errors.purpose_category = '운행 목적을 선택해 주세요.';
  if (value.purpose_note.length > 200) errors.purpose_note = '목적 메모는 200자 이하로 입력해 주세요.';
  if (!(value.passenger_count >= 0 && value.passenger_count <= 44)) errors.passenger_count = '동승 인원은 0 이상의 숫자로 입력해 주세요.';
  value.start_ms = st;
  value.end_ms = et;
  return { value, errors };
}

export function validateUsageLog(input = {}, settings = DEFAULT_SETTINGS) {
  const fuelBlank = isBlank(input.fuel_liters);
  const value = {
    reservation_id: isBlank(input.reservation_id) ? null : toInt(input.reservation_id),
    vehicle_id: toInt(input.vehicle_id),
    driver_id: toInt(input.driver_id),
    drive_date: s(input.drive_date),
    depart_time: s(input.depart_time),
    return_time: s(input.return_time),
    odometer_start: toInt(input.odometer_start),
    odometer_end: toInt(input.odometer_end),
    destination: s(input.destination),
    purpose_category: s(input.purpose_category),
    passenger_count: isBlank(input.passenger_count) ? 0 : toInt(input.passenger_count),
    fuel_liters: fuelBlank ? null : Number(input.fuel_liters),
    fuel_cost: isBlank(input.fuel_cost) ? null : toInt(input.fuel_cost),
    note: s(input.note),
    mismatch_reason: s(input.mismatch_reason),
  };
  const errors = {};
  if (!(value.vehicle_id > 0)) errors.vehicle_id = '차량을 선택해 주세요.';
  if (!(value.driver_id > 0)) errors.driver_id = '운전자를 선택해 주세요.';
  if (!isValidYmd(value.drive_date)) errors.drive_date = '운행일을 입력해 주세요.';
  if (!isValidHm(value.depart_time)) errors.depart_time = '출발 시각을 입력해 주세요.';
  if (!isValidHm(value.return_time)) errors.return_time = '도착 시각을 입력해 주세요.';
  else if (!errors.depart_time && value.return_time === value.depart_time) errors.return_time = '도착 시각은 출발 시각과 같을 수 없습니다.';
  if (!(value.odometer_start >= 0 && value.odometer_start <= 9999999)) errors.odometer_start = '출발 계기판 값을 0 이상의 정수(km)로 입력해 주세요.';
  if (!(value.odometer_end >= 0 && value.odometer_end <= 9999999)) errors.odometer_end = '도착 계기판 값을 0 이상의 정수(km)로 입력해 주세요.';
  else if (!errors.odometer_start && value.odometer_end < value.odometer_start) {
    errors.odometer_end = `도착 계기판 값은 출발 값(${value.odometer_start.toLocaleString('ko-KR')}km)보다 작을 수 없습니다.`;
  }
  if (!lenBetween(value.destination, 2, 100)) errors.destination = '목적지를 2~100자로 입력해 주세요.';
  if (!settings.purpose_categories.includes(value.purpose_category)) errors.purpose_category = '운행 목적을 선택해 주세요.';
  if (!(value.passenger_count >= 0 && value.passenger_count <= 44)) errors.passenger_count = '동승 인원은 0 이상의 숫자로 입력해 주세요.';
  if (value.fuel_liters !== null) {
    if (!(Number.isFinite(value.fuel_liters) && value.fuel_liters >= 0 && value.fuel_liters <= 200)) errors.fuel_liters = '주유량은 0~200 사이로 입력해 주세요.';
    else value.fuel_liters = Math.round(value.fuel_liters * 10) / 10;
  }
  if (value.fuel_cost !== null && !(value.fuel_cost >= 0 && value.fuel_cost <= 1000000)) errors.fuel_cost = '주유 금액은 0~1,000,000원 사이 정수로 입력해 주세요.';
  if (value.fuel_liters > 0 && value.fuel_cost === null) errors.fuel_cost = '주유 금액을 입력해 주세요.';
  if (value.note.length > 300) errors.note = '특이사항은 300자 이하로 입력해 주세요.';
  if (value.mismatch_reason.length > 100) errors.mismatch_reason = '사유는 100자 이하로 입력해 주세요.';
  return { value, errors };
}

/** 운행 시각 계산: 도착이 출발보다 이르면 자정을 넘긴 것으로 본다. (F-04) */
export function computeTrip(driveDate, departTime, returnTime) {
  const depart = Date.parse(`${driveDate}T${departTime}:00+09:00`);
  let ret = Date.parse(`${driveDate}T${returnTime}:00+09:00`);
  if (ret <= depart) ret += 24 * 3600_000;
  return { depart_at: new Date(depart), return_at: new Date(ret), overnight: ret - depart > 0 && returnTime < departTime };
}

/** 같은 차량 예약 겹침 판정: [s1,e1) 과 [s2,e2) */
export const overlaps = (s1, e1, s2, e2) => s1 < e2 && s2 < e1;

export const hasErrors = (errors) => Object.keys(errors).length > 0;
