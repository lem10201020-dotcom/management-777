// 앱 초기화: 글자 크기 적용 → 로그인 확인 → 셸·라우터 시작
import { h, clear, icon, $$ } from './dom.js';
import { api, get, post, setUnauthenticatedHandler, isDemo, setDemo } from './api.js';
import { state, getFontScale, applyFontScale, FONT_SCALES } from './state.js';
import { route, startRouter, visibleNav, render } from './router.js';
import { openModal } from './components/modal.js';
import { field, formValues, showErrors, formSummary, busy } from './components/form.js';
import { toast } from './components/toast.js';

applyFontScale(getFontScale());

route('/', { load: () => import('./views/dashboard.js') });
route('/calendar', { load: () => import('./views/calendar.js') });
route('/usage-logs', { load: () => import('./views/usage-logs.js') });
route('/usage-logs/new', { load: () => import('./views/usage-log-form.js') });
route('/usage-logs/:id', { load: () => import('./views/usage-log-form.js') });
route('/ledgers', { roles: ['manager', 'approver', 'admin'], load: () => import('./views/ledgers.js') });
route('/approvals', { roles: ['approver'], load: () => import('./views/approvals.js') });
route('/print/ledger', { roles: ['manager', 'approver', 'admin'], load: () => import('./views/print-ledger.js') });
route('/vehicles', { roles: ['manager', 'admin'], load: () => import('./views/vehicles.js') });
route('/users', { roles: ['admin'], load: () => import('./views/users.js') });
route('/settings', { load: () => import('./views/settings.js') });
route('/more', { load: () => import('./views/more.js') });

const app = document.getElementById('app');

// 서버가 아직 DB 없이 배포된 경우 → 자동으로 체험 모드 (서버 오류 코드: api/index.js)
const NOT_CONFIGURED = ['DB_NOT_CONFIGURED', 'SERVER_NOT_CONFIGURED'];

async function boot() {
  if (new URLSearchParams(location.search).has('demo')) setDemo(true);
  try {
    const me = await get('/auth/me');
    if (!me.user) return showLogin();
    Object.assign(state, me);
    if (state.user.must_change_password) return showPasswordChange();
    showShell();
  } catch (err) {
    if (!isDemo() && (NOT_CONFIGURED.includes(err.code) || err.status === 404)) { setDemo(true); return boot(); }
    showServerError(err);
  }
}

function showServerError(err) {
  const tryDemo = h('button', { class: 'btn btn-primary btn-block', onclick: () => { setDemo(true); boot(); } }, '체험 모드로 바로 사용하기');
  const retry = h('button', { class: 'btn btn-block', onclick: boot }, '다시 시도');
  clear(app).append(h('main', { class: 'auth-wrap', id: 'main' }, h('div', { class: 'card auth-card stack' },
    h('div', { class: 'auth-brand' }, h('p', { class: 'brand-org' }, '서구종합사회복지관'), h('h1', {}, '차량예약관리대장')),
    h('div', { class: 'alert alert-error', role: 'alert' }, h('span', { class: 'alert-icon', 'aria-hidden': 'true' }, '⚠'),
      h('div', { class: 'alert-body' }, h('strong', {}, '서버 DB에 연결하지 못했습니다.'), h('p', {}, err.message),
        err.code ? h('p', { class: 'small' }, `오류 코드: ${err.code}`) : null)),
    h('p', { class: 'small muted' }, '체험 모드는 서버 없이 이 브라우저 안에서 가상 데이터로 모든 기능을 써 볼 수 있습니다. 실제 개인정보는 입력하지 마세요.'),
    tryDemo, retry)));
  tryDemo.focus();
  document.title = '연결 오류 | 차량예약관리대장';
}

function demoBanner() {
  return h('div', { class: 'alert alert-warning' }, h('span', { class: 'alert-icon', 'aria-hidden': 'true' }, '!'),
    h('div', { class: 'alert-body' }, h('strong', {}, '체험 모드 (서버 없이 동작)'),
      h('p', {}, '데이터는 이 브라우저에만 저장되고 다른 사람과 공유되지 않습니다. 가상 데이터만 입력하세요.')));
}

const DEMO_ACCOUNTS = [
  ['staff01', '직원 · 홍길동'], ['mgr01', '차량담당자 · 이담당'], ['apv01', '1단계 결재 · 박팀장'],
  ['apv02', '2단계 결재 · 최관장'], ['admin01', '관리자'],
];
function demoQuickLogin() {
  return h('div', { class: 'stack' },
    h('p', { class: 'small', style: { 'font-weight': '700' } }, '역할을 골라 바로 시작하기'),
    h('div', { class: 'grid', style: { gap: '.5rem' } }, DEMO_ACCOUNTS.map(([id, label]) => {
      const b = h('button', { type: 'button', class: 'btn btn-block' }, label);
      b.addEventListener('click', () => busy(b, '접속 중…', async () => {
        const data = await api('POST', '/auth/login', { login_id: id, password: 'Sample1234' }, { retryAuth: false });
        Object.assign(state, data);
        showShell();
      }));
      return b;
    })),
    h('p', { class: 'help' }, '직접 로그인할 때 비밀번호는 모두 Sample1234 입니다.'));
}

function loginForm(onSuccess, { compact = false } = {}) {
  const pwField = field({ name: 'password', label: '비밀번호', type: 'password', required: true, attrs: { autocomplete: 'current-password' } });
  const pwInput = pwField.querySelector('input');
  const toggle = h('button', { type: 'button', class: 'btn btn-sm btn-text', 'aria-pressed': 'false' }, '비밀번호 보기');
  toggle.addEventListener('click', () => {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.textContent = show ? '비밀번호 숨기기' : '비밀번호 보기';
  });
  pwField.append(h('div', {}, toggle));
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, '로그인');
  const form = h('form', { class: 'form', novalidate: true },
    formSummary(),
    field({ name: 'login_id', label: '아이디', required: true, attrs: { autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' } }),
    pwField, submit,
    compact ? null : h('p', { class: 'help' }, '비밀번호를 잊었다면 관리자에게 문의하세요.'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(submit, '확인 중…', async () => {
      try {
        const data = await api('POST', '/auth/login', formValues(form), { retryAuth: false });
        Object.assign(state, data);
        onSuccess();
      } catch (err) { showErrors(form, err.fields, err.message); }
    });
  });
  return form;
}

function showLogin() {
  const demo = isDemo();
  clear(app).append(h('main', { class: 'auth-wrap', id: 'main' }, h('div', { class: 'card auth-card stack' },
    h('div', { class: 'auth-brand' }, h('p', { class: 'brand-org' }, '서구종합사회복지관'), h('h1', {}, '차량예약관리대장')),
    demo ? demoBanner() : null,
    demo ? demoQuickLogin() : null,
    demo ? h('hr', { style: { border: 0, 'border-top': '1px solid var(--color-border)', width: '100%' } }) : null,
    loginForm(() => (state.user.must_change_password ? showPasswordChange() : showShell())))));
  (app.querySelector('.auth-card .btn') || app.querySelector('input'))?.focus();
  document.title = '로그인 | 차량예약관리대장';
}

export function passwordForm(onDone) {
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, '비밀번호 변경');
  const form = h('form', { class: 'form', novalidate: true },
    formSummary(),
    field({ name: 'current_password', label: '현재(임시) 비밀번호', type: 'password', required: true, attrs: { autocomplete: 'current-password' } }),
    field({ name: 'new_password', label: '새 비밀번호', type: 'password', required: true, help: '8자 이상, 영문과 숫자를 모두 포함해 주세요.', attrs: { autocomplete: 'new-password' } }),
    field({ name: 'new_password2', label: '새 비밀번호 확인', type: 'password', required: true, attrs: { autocomplete: 'new-password' } }),
    h('div', { class: 'form-actions' }, submit));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formValues(form);
    if (v.new_password !== v.new_password2) return showErrors(form, { new_password2: '새 비밀번호가 서로 다릅니다.' });
    busy(submit, '변경 중…', async () => {
      try {
        await post('/auth/password', { current_password: v.current_password, new_password: v.new_password });
        state.user.must_change_password = false;
        toast('비밀번호를 변경했습니다.');
        onDone();
      } catch (err) { showErrors(form, err.fields, err.message); }
    });
  });
  return form;
}

function showPasswordChange() {
  clear(app).append(h('main', { class: 'auth-wrap', id: 'main' }, h('div', { class: 'card auth-card' },
    h('div', { class: 'auth-brand' }, h('p', { class: 'brand-org' }, '서구종합사회복지관'), h('h1', {}, '비밀번호 변경')),
    h('div', { class: 'alert alert-info' }, h('div', { class: 'alert-body' }, '처음 로그인했거나 비밀번호가 초기화되었습니다. 사용할 비밀번호로 변경해 주세요.')),
    h('div', { style: { height: '1rem' } }),
    passwordForm(showShell))));
  app.querySelector('input')?.focus();
}

// 세션 만료 시: 입력 내용을 유지한 채 재로그인 모달 (UI_UX.md 5-2)
setUnauthenticatedHandler(() => new Promise((resolve) => {
  if (!state.user) { resolve(false); return; }
  let ok = false;
  const m = openModal({
    title: '다시 로그인해 주세요',
    body: [h('p', { class: 'muted small' }, '오랫동안 사용하지 않아 로그아웃되었습니다. 다시 로그인하면 작성 중인 내용을 이어서 저장할 수 있습니다.'),
      loginForm(() => { ok = true; m.close(); }, { compact: true })],
    onClose: () => resolve(ok),
  });
}));

function fontScaleButton() {
  const btn = h('button', { type: 'button', class: 'icon-btn', 'aria-haspopup': 'true', 'aria-label': '글자 크기 조절' }, '가');
  btn.addEventListener('click', () => {
    const cur = getFontScale();
    const body = h('div', { class: 'stack', role: 'radiogroup', 'aria-label': '글자 크기' }, FONT_SCALES.map(([v, label]) => {
      const b = h('button', { type: 'button', class: `btn ${v === cur ? 'btn-primary' : ''}`, role: 'radio', 'aria-checked': String(v === cur) }, label);
      b.addEventListener('click', () => { applyFontScale(v); m.close(); toast(`글자 크기: ${label}`); });
      return b;
    }), h('p', { class: 'help' }, '이 설정은 지금 사용하는 기기에만 저장됩니다.'));
    const m = openModal({ title: '글자 크기', body });
  });
  return btn;
}

let shellNav;
function showShell() {
  const nav = visibleNav();
  const sideLinks = [];
  let lastGroup = null;
  for (const n of nav) {
    if (n.group && n.group !== lastGroup) { sideLinks.push(h('li', { class: 'nav-group', 'aria-hidden': 'true' }, n.group)); lastGroup = n.group; }
    sideLinks.push(h('li', {}, h('a', { href: `#${n.path}`, dataset: { path: n.path } }, icon(n.icon), n.label)));
  }
  const tabs = nav.filter((n) => n.tab).slice(0, 4);
  const tabLinks = [...tabs.map((n) => h('a', { href: `#${n.path}`, dataset: { path: n.path } }, icon(n.icon), n.label.replace('월별 ', '').replace('예약 ', '')))];
  while (tabLinks.length < 4) tabLinks.push(h('span', { 'aria-hidden': 'true' }));
  tabLinks.push(h('a', { href: '#/more', dataset: { path: '/more' } }, icon('more'), '더보기'));

  const logoutBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '로그아웃', title: '로그아웃' }, icon('logout'));
  logoutBtn.addEventListener('click', logout);
  const main = h('main', { class: 'main', id: 'main' });
  clear(app).append(
    h('header', { class: 'app-header' },
      h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-org' }, '서구종합사회복지관'), h('span', { class: 'brand-name' }, '차량예약관리대장')),
      h('div', { class: 'header-actions' },
        isDemo() ? h('a', { class: 'badge badge-warning', href: '#/settings', title: '체험 모드 설정' }, '체험 모드') : null,
        h('span', { class: 'header-user' }, `${state.user.name}님`),
        fontScaleButton(), logoutBtn)),
    h('div', { class: 'app-body' },
      h('nav', { class: 'sidebar', 'aria-label': '주 메뉴' }, h('ul', {}, sideLinks)),
      main),
    h('nav', { class: 'tabbar', 'aria-label': '하단 메뉴' }, tabLinks),
  );
  shellNav = app;
  startRouter(main, markCurrent);
}

function markCurrent(path) {
  const base = `/${path.split('/')[1] || ''}`;
  const key = base === '/print' ? '/ledgers' : base;
  for (const a of $$('a[data-path]', shellNav)) {
    if (a.dataset.path === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

export async function logout() {
  try { await post('/auth/logout'); } catch { /* 무시 */ }
  state.user = null;
  location.hash = '';
  showLogin();
}

export { render };
boot();
