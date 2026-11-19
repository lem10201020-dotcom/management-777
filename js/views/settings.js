// 설정: 글자 크기(F-12), 비밀번호 변경
import { h } from '../dom.js';
import { state, getFontScale, applyFontScale, FONT_SCALES } from '../state.js';
import { toast } from '../components/toast.js';
import { ROLES } from '../utils/validate.js';
import { pageHead, card } from './common.js';
import { passwordForm } from '../app.js';
import { isDemo, setDemo } from '../api.js';
import { confirmDialog } from '../components/modal.js';

export async function render(root) {
  root.append(pageHead('설정'));
  const cur = getFontScale();
  const group = h('div', { class: 'checks', role: 'radiogroup', 'aria-label': '글자 크기' }, FONT_SCALES.map(([v, label]) => {
    const input = h('input', { type: 'radio', name: 'font-scale', value: v, checked: v === cur });
    input.addEventListener('change', () => { applyFontScale(v); toast(`글자 크기: ${label}`); });
    return h('label', { class: 'check' }, input, label);
  }));
  root.append(h('div', { class: 'grid grid-2' },
    card('내 정보', h('dl', { class: 'dl' },
      h('dt', {}, '이름'), h('dd', {}, state.user.name),
      h('dt', {}, '아이디'), h('dd', {}, state.user.login_id),
      h('dt', {}, '소속'), h('dd', {}, state.user.team || '-'),
      h('dt', {}, '역할'), h('dd', {}, state.user.roles.map((r) => ROLES[r]).join(', ')))),
    card('글자 크기', h('div', { class: 'stack' }, group, h('p', { class: 'help' }, '이 설정은 지금 사용하는 기기(브라우저)에만 저장됩니다.'))),
    card('비밀번호 변경', passwordForm(() => {})),
    isDemo() ? demoCard() : null,
  ));
}

function demoCard() {
  const reset = h('button', { type: 'button', class: 'btn btn-danger' }, '체험 데이터 처음 상태로');
  reset.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: '체험 데이터 초기화', message: '이 브라우저의 체험 데이터를 모두 지우고 샘플 데이터로 다시 시작할까요?', confirmText: '초기화', danger: true }))) return;
    const { resetDemo } = await import('../demo/mock-api.js');
    await resetDemo();
    location.hash = '';
    location.reload();
  });
  const exit = h('button', { type: 'button', class: 'btn' }, '체험 모드 끝내기 (서버 연결)');
  exit.addEventListener('click', () => { setDemo(false); location.hash = ''; location.reload(); });
  return card('체험 모드', h('div', { class: 'stack' },
    h('p', { class: 'small' }, '서버 없이 이 브라우저 안에서만 동작하는 체험 모드입니다. 데이터는 이 기기에만 저장되며 다른 직원과 공유되지 않습니다.'),
    h('div', { class: 'row' }, reset, exit)));
}
