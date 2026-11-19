// 해시 라우터 + 권한 가드 (UI_UX.md 3장)
import { h, clear, icon } from './dom.js';
import { state, hasRole } from './state.js';

/** 메뉴 정의: 사이드바·하단 탭·더보기 공통 */
export const NAV = [
  { path: '/', label: '대시보드', icon: 'home', tab: true },
  { path: '/calendar', label: '예약 캘린더', icon: 'calendar', tab: true },
  { path: '/usage-logs', label: '운행일지', icon: 'log', tab: true },
  { path: '/ledgers', label: '월별 차량대장', icon: 'ledger', roles: ['manager', 'approver', 'admin'], tab: true },
  { path: '/approvals', label: '결재함', icon: 'approve', roles: ['approver'] },
  { path: '/vehicles', label: '차량 관리', icon: 'car', roles: ['manager', 'admin'], group: '관리' },
  { path: '/users', label: '사용자 관리', icon: 'users', roles: ['admin'], group: '관리' },
  { path: '/settings', label: '설정', icon: 'settings' },
];
export const visibleNav = () => NAV.filter((n) => !n.roles || hasRole(...n.roles));

const routes = [];
/** route('/usage-logs/:id', { roles, load: () => import(...) }) */
export function route(pattern, def) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ pattern, re, keys, ...def });
}

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(query) };
}
export function navigate(path) { location.hash = `#${path}`; }

let mainEl;
let onRouteChange;
export function startRouter(main, afterChange) {
  mainEl = main;
  onRouteChange = afterChange;
  window.removeEventListener('hashchange', render);
  window.addEventListener('hashchange', render);
  render();
}

let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  const { path, query } = parseHash();
  let found = null; let params = {};
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) { found = r; params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); break; }
  }
  onRouteChange?.(path);
  clear(mainEl);
  if (!found) {
    mainEl.append(messagePage('페이지를 찾을 수 없습니다', '주소를 다시 확인해 주세요.'));
    return;
  }
  if (found.roles && !hasRole(...found.roles)) {
    document.title = '권한 없음 | 차량예약관리대장';
    mainEl.append(messagePage('이 화면을 볼 권한이 없습니다', '필요하면 관리자에게 요청하세요.'));
    focusMain();
    return;
  }
  mainEl.append(h('div', { class: 'stack', 'aria-busy': 'true' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('span', { class: 'sr-only', role: 'status' }, '불러오는 중입니다')));
  try {
    const mod = await found.load();
    if (seq !== renderSeq) return;
    const container = h('div', {});
    await mod.render(container, { params, query, state });
    if (seq !== renderSeq) return;
    clear(mainEl).append(container);
    const title = container.querySelector('h1')?.textContent;
    document.title = title ? `${title} | 차량예약관리대장` : '차량예약관리대장';
    focusMain();
  } catch (err) {
    if (seq !== renderSeq) return;
    console.error(err);
    clear(mainEl).append(errorPage(err));
  }
}

function focusMain() {
  const h1 = mainEl.querySelector('h1');
  if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
}

export function messagePage(title, desc) {
  return h('div', { class: 'card empty' }, icon('empty'), h('h1', { class: 'page-title' }, title), h('p', {}, desc),
    h('a', { class: 'btn btn-primary', href: '#/' }, '대시보드로 가기'));
}
export function errorPage(err) {
  const retry = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => render() }, '다시 시도');
  return h('div', { class: 'alert alert-error', role: 'alert' },
    h('span', { class: 'alert-icon', 'aria-hidden': 'true' }, '⚠'),
    h('div', { class: 'alert-body' }, h('h1', { class: 'card-title' }, '화면을 불러오지 못했습니다'), h('p', {}, err.message || '잠시 후 다시 시도해 주세요.'), h('div', {}, retry)));
}
