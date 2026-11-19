// 설정: 글자 크기(F-12), 비밀번호 변경
import { h } from '../dom.js';
import { state, getFontScale, applyFontScale, FONT_SCALES } from '../state.js';
import { toast } from '../components/toast.js';
import { ROLES } from '../utils/validate.js';
import { pageHead, card } from './common.js';
import { passwordForm } from '../app.js';

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
  ));
}
