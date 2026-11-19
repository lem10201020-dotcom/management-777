// F-02 대시보드·통계
import { h, icon } from '../dom.js';
import { get } from '../api.js';
import { hasRole, state } from '../state.js';
import { badge, vehicleDot } from '../components/badges.js';
import { rangeLabel, kst, dateLabel, monthLabel, fmtKm, fmtWon, fmtLiters, fmtNum } from '../utils/format.js';
import { pageHead, card, empty, alertBox } from './common.js';
import { openReservationForm, openReservationDetail } from './reservation-form.js';
import { render as rerender } from '../router.js';

export async function render(root) {
  let d;
  try {
    d = await get('/dashboard');
  } catch (err) {
    root.append(pageHead('대시보드'), alertBox('error', '대시보드를 불러오지 못했습니다.', err.message));
    return;
  }
  const newBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('plus'), '차량예약');
  newBtn.addEventListener('click', () => openReservationForm({ onSaved: rerender }));
  root.append(pageHead('대시보드', { desc: `${state.user.name}님, ${dateLabel(d.today, true)} 차량 현황입니다.`, actions: [newBtn] }));

  const grid = h('div', { class: 'grid grid-12' });
  root.append(grid);

  // 1. 할 일
  const todos = [];
  for (const r of d.missing_logs) {
    todos.push(h('li', {}, h('a', { class: 'list-item', href: `#/usage-logs/new?reservation_id=${r.id}` },
      vehicleDot(r.vehicle.color),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, '운행일지를 입력해 주세요'),
        h('span', { class: 'small muted' }, `${r.vehicle.model} ${r.vehicle.plate_no} · ${kst(r.start_at).m}/${kst(r.start_at).d} ${rangeLabel(r.start_at, r.end_at)} · ${r.destination}`)),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))));
  }
  for (const l of d.my_drafts) {
    todos.push(h('li', {}, h('a', { class: 'list-item', href: `#/usage-logs/${l.id}` },
      badge('log', 'draft'),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, '작성중인 운행일지를 제출해 주세요'),
        h('span', { class: 'small muted' }, `${l.model} ${l.plate_no} · ${dateLabel(l.drive_date)}`)),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))));
  }
  for (const p of d.pending_approvals || []) {
    todos.push(h('li', {}, h('a', { class: 'list-item', href: `#/ledgers?vehicle_id=${p.vehicle_id}&ym=${p.year_month}` },
      badge('ledger', 'submitted'),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, `결재 대기: ${monthLabel(p.year_month)} 차량대장`),
        h('span', { class: 'small muted' }, `${p.model} ${p.plate_no} · ${p.log_count}건 · ${fmtKm(p.total_distance)}`)),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))));
  }
  const todoCount = todos.length;
  grid.append(card(todoCount ? `할 일 ${todoCount}건` : '할 일',
    todoCount ? h('ul', { class: 'list' }, todos) : h('p', { class: 'muted' }, '처리할 일이 없습니다 ✓'),
    { cls: `span-12 ${todoCount ? 'card-todo' : ''}` }));

  // 2. 오늘의 차량
  grid.append(card('오늘의 차량', d.vehicles.length
    ? h('div', { class: 'vehicle-cards' }, d.vehicles.map((v) => h('div', { class: 'vehicle-card', style: { 'border-top-color': v.color } },
      h('div', { class: 'row' }, h('strong', {}, v.model), badge('vehicle', v.state)),
      h('span', { class: 'small muted num' }, v.plate_no),
      v.today.length
        ? h('ul', { class: 'small', style: { margin: 0, 'padding-left': '1.1rem' } }, v.today.map((t) => h('li', { class: 'num' }, `${rangeLabel(t.start_at, t.end_at)} ${t.user_name}`)))
        : h('span', { class: 'small muted' }, '오늘 예약 없음'))))
    : empty('등록된 차량이 없습니다.'),
  { cls: 'span-7', link: h('a', { class: 'link', href: '#/calendar' }, '캘린더 보기') }));

  // 3. 내 다가오는 예약
  grid.append(card('내 다가오는 예약', d.my_upcoming.length
    ? h('ul', { class: 'list' }, d.my_upcoming.map((r) => {
      const b = h('button', { type: 'button', class: 'list-item' }, vehicleDot(r.vehicle.color),
        h('span', { class: 'grow' }, h('span', { class: 'title num' }, `${dateLabel(kst(r.start_at).ymd)} ${rangeLabel(r.start_at, r.end_at)}`),
          h('span', { class: 'small muted' }, `${r.vehicle.model} · ${r.destination}`)), badge('reservation', r.status));
      b.addEventListener('click', () => openReservationDetail(r.id, { onChanged: rerender }));
      return h('li', {}, b);
    }))
    : empty('다가오는 예약이 없습니다.', newBtn.cloneNode(true)),
  { cls: 'span-5' }));
  grid.lastChild.querySelector('.empty .btn')?.addEventListener('click', () => openReservationForm({ onSaved: rerender }));

  // 4. 차량담당자: 통계·확인 필요
  if (hasRole('manager') && d.month_stats) {
    const s = d.month_stats;
    const tot = s.reduce((a, x) => ({
      dist: a.dist + x.total_distance, cnt: a.cnt + x.log_count, l: a.l + x.total_fuel_liters, won: a.won + x.total_fuel_cost,
    }), { dist: 0, cnt: 0, l: 0, won: 0 });
    const max = Math.max(1, ...s.map((x) => x.total_distance));
    const stat = (label, value, unit) => h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value, h('small', {}, unit)));
    const table = h('details', {}, h('summary', { class: 'small' }, '수치를 표로 보기'),
      h('div', { class: 'table-wrap', style: { 'margin-top': '.5rem' } }, h('table', { class: 'table' },
        h('caption', { class: 'sr-only' }, `${monthLabel(d.month)} 차량별 운행 통계`),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '차량'), h('th', { scope: 'col', class: 'right' }, '운행'), h('th', { scope: 'col', class: 'right' }, '거리'), h('th', { scope: 'col', class: 'right' }, '주유량'), h('th', { scope: 'col', class: 'right' }, '주유비'))),
        h('tbody', {}, s.map((x) => h('tr', {}, h('th', { scope: 'row' }, `${x.model} ${x.plate_no}`), h('td', { class: 'num' }, `${x.log_count}회`), h('td', { class: 'num' }, fmtKm(x.total_distance)), h('td', { class: 'num' }, fmtLiters(x.total_fuel_liters)), h('td', { class: 'num' }, fmtWon(x.total_fuel_cost))))))));
    grid.append(card(`${monthLabel(d.month)} 운행 통계`, h('div', { class: 'stack' },
      h('div', { class: 'stats' }, stat('총 운행거리', fmtNum(tot.dist), 'km'), stat('운행 횟수', fmtNum(tot.cnt), '회'),
        stat('주유량', tot.l.toFixed(1), 'L'), stat('주유비', fmtNum(tot.won), '원')),
      h('ul', { class: 'bars', role: 'img', 'aria-label': `차량별 운행거리: ${s.map((x) => `${x.model} ${x.total_distance}km`).join(', ')}` },
        s.map((x) => h('li', { class: 'bar-row', 'aria-hidden': 'true' }, h('span', {}, x.model),
          h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { width: `${(x.total_distance / max) * 100}%`, background: x.color } })),
          h('span', { class: 'num' }, fmtKm(x.total_distance))))),
      h('p', { class: 'help' }, '제출된 운행일지 기준입니다. 작성중인 기록은 포함하지 않습니다.'),
      table), { cls: 'span-7' }));

    const checks = [];
    if (d.all_missing_logs.length) checks.push(h('li', {}, h('span', { class: 'no' }, '✗'), `운행일지 미입력 예약 ${d.all_missing_logs.length}건`));
    if (d.mismatch_count) checks.push(h('li', {}, h('span', { class: 'no' }, '!'), `이번 달 계기판 불일치 ${d.mismatch_count}건 (사유 입력됨)`));
    if (d.requested_reservations.length) checks.push(h('li', {}, h('span', { class: 'no' }, '○'), `승인 대기 예약 ${d.requested_reservations.length}건`));
    const ledgerRows = d.last_month_ledgers.map((l) => h('li', {}, h('a', { class: 'list-item', href: `#/ledgers?vehicle_id=${l.vehicle_id}&ym=${d.last_month}` },
      h('span', { class: 'grow' }, h('span', { class: 'title' }, `${l.model} ${l.plate_no}`)), badge('ledger', l.status))));
    grid.append(card('확인 필요', h('div', { class: 'stack' },
      checks.length ? h('ul', { class: 'checklist' }, checks) : h('p', { class: 'muted' }, '확인할 항목이 없습니다 ✓'),
      h('h3', { class: 'small' }, `${monthLabel(d.last_month)} 차량대장`),
      ledgerRows.length ? h('ul', { class: 'list' }, ledgerRows) : h('p', { class: 'muted small' }, '차량이 없습니다.')), { cls: 'span-5' }));
  }

  // 5. 오늘 전체 예약
  grid.append(card('오늘 예약', d.today_reservations.length
    ? h('ul', { class: 'list' }, d.today_reservations.map((r) => {
      const b = h('button', { type: 'button', class: 'list-item' }, vehicleDot(r.vehicle.color),
        h('span', { class: 'grow' }, h('span', { class: 'title num' }, `${rangeLabel(r.start_at, r.end_at)} · ${r.vehicle.model}`),
          h('span', { class: 'small muted' }, `${r.user_name} · ${r.purpose_category}`)), badge('reservation', r.status));
      b.addEventListener('click', () => openReservationDetail(r.id, { onChanged: rerender }));
      return h('li', {}, b);
    }))
    : empty('오늘은 예약이 없습니다.'),
  { cls: 'span-12' }));
}
