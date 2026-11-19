// 화면 상태: 로그인 사용자와 설정. 업무 데이터는 저장하지 않는다.
export const state = { user: null, settings: null };
export const hasRole = (...roles) => !!state.user && roles.some((r) => state.user.roles.includes(r));

// 글자 크기 — 기기별 설정(localStorage, 업무 데이터 아님). F-12
const KEY = 'vl.fontScale';
export const FONT_SCALES = [['md', '기본'], ['lg', '크게'], ['xl', '아주 크게']];
export function getFontScale() {
  try { return localStorage.getItem(KEY) || 'md'; } catch { return 'md'; }
}
export function applyFontScale(v) {
  document.documentElement.dataset.fontScale = v;
  try { localStorage.setItem(KEY, v); } catch { /* 저장소 차단: 이번 접속에만 적용 */ }
}
