// 결재함: 내 결재 단계 차례인 월별 차량대장
import { h } from '../dom.js';
import { get, qs } from '../api.js';
import { badge } from '../components/badges.js';
import { monthLabel, fmtKm, fmtDateTime } from '../utils/format.js';
import { pageHead, card, empty } from './common.js';

export async function render(root) {
  const { ledgers } = await get('/approvals/pending');
  root.append(pageHead('결재함', { desc: '내 결재 단계 차례인 월별 차량대장입니다.' }));
  root.append(card(null, ledgers.length
    ? h('ul', { class: 'list' }, ledgers.map((l) => h('li', {}, h('a', { class: 'list-item', href: `#/ledgers${qs({ ym: l.year_month, vehicle_id: l.vehicle_id })}` },
      h('span', { class: 'grow' }, h('span', { class: 'title' }, `${monthLabel(l.year_month)} · ${l.model} ${l.plate_no}`),
        h('span', { class: 'small muted' }, `${l.log_count}건 · ${fmtKm(l.total_distance)} · 요청 ${fmtDateTime(l.submitted_at)}`)),
      badge('ledger', 'submitted'), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')))))
    : empty('결재할 대장이 없습니다.')));
}
