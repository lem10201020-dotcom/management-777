// 날짜·숫자 포맷 (브라우저와 서버 공용). 모든 표시는 Asia/Seoul 기준. (CLAUDE.md 6장)
export const TZ = 'Asia/Seoul';
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
});

/** Date|string → KST 기준 { y, m, d, hh, mm, ymd, hm } */
export function kst(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  const ymd = `${p.year}-${p.month}-${p.day}`;
  return { y: +p.year, m: +p.month, d: +p.day, hh: p.hour, mm: p.minute, ymd, hm: `${p.hour}:${p.minute}` };
}

export const todayYmd = () => kst(new Date()).ymd;
export const currentYm = () => todayYmd().slice(0, 7);

/** 'YYYY-MM-DD' + 'HH:mm' (KST) → Date */
export function kstToDate(ymd, hm = '00:00') {
  return new Date(`${ymd}T${hm}:00+09:00`);
}

/** 'YYYY-MM-DD' 날짜 계산 (시간대 영향 없음) */
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function dayOfWeek(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export const dowLabel = (ymd) => DOW[dayOfWeek(ymd)];

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}
export function lastDayOfMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export const monthLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;

/** 2026-11-19 → "11월 19일 (목)" */
export function dateLabel(ymd, withYear = false) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${withYear ? `${y}년 ` : ''}${m}월 ${d}일 (${dowLabel(ymd)})`;
}

/** 예약 시간 범위 표시: 같은 날이면 "14:00~16:00", 다르면 날짜 포함 */
export function rangeLabel(start, end) {
  const s = kst(start); const e = kst(end);
  if (s.ymd === e.ymd) return `${s.hm}~${e.hm}`;
  return `${s.m}/${s.d} ${s.hm}~${e.m}/${e.d} ${e.hm}`;
}

const nf = new Intl.NumberFormat('ko-KR');
export const fmtNum = (n) => (n === null || n === undefined || n === '' ? '-' : nf.format(Number(n)));
export const fmtKm = (n) => (n === null || n === undefined ? '-' : `${nf.format(Number(n))}km`);
export const fmtWon = (n) => (n === null || n === undefined ? '-' : `${nf.format(Number(n))}원`);
export const fmtLiters = (n) => (n === null || n === undefined || n === '' ? '-' : `${Number(n).toFixed(1)}L`);

export function fmtDateTime(dateLike) {
  if (!dateLike) return '-';
  const k = kst(dateLike);
  return `${k.ymd} ${k.hm}`;
}
