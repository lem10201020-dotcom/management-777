// 모바일 "더보기" 메뉴
import { h, icon } from '../dom.js';
import { visibleNav } from '../router.js';
import { state } from '../state.js';
import { logout } from '../app.js';
import { pageHead } from './common.js';

export async function render(root) {
  root.append(pageHead('더보기', { desc: `${state.user.name}님으로 로그인했습니다.` }));
  const out = h('button', { type: 'button', class: 'btn btn-block' }, icon('logout'), '로그아웃');
  out.addEventListener('click', logout);
  root.append(h('nav', { class: 'card', 'aria-label': '전체 메뉴' },
    h('div', { class: 'more-menu' }, visibleNav().map((n) => h('a', { href: `#${n.path}` }, icon(n.icon), n.label))),
    h('div', { style: { height: '1rem' } }), out));
}
