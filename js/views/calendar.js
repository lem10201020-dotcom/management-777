// F-03 예약 캘린더 — PC: 월 보기 기본 / 모바일: 주간 스트립 + 일별 목록 기본 (UI_UX.md 4-3)
import { h, clear, icon } from '../dom.js';
import { get, qs } from '../api.js';
import { badge, vehicleDot } from '../components/badges.js';
import { todayYmd, addDays, dayOfWeek, kst, rangeLabel, dateLabel } from '../utils/format.js';
import { pageHead, empty, alertBox } from './common.js';
import { openReservationForm, openReservationDetail } from './reservation-form.js';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const ui = { view: null, date: todayYmd(), hidden: new Set() };

export async function render(root, { query }) {
  if (!ui.view) ui.view = window.matchMedia('(min-width: 768px)').matches ? 'month' : 'day';
  if (query.get('date')) ui.date = query.get('date');
  const { vehicles } = await get('/vehicles');
  const activeVehicles = vehicles.filter((v) => v.status !== 'retired');

  const addBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('plus'), '차량예약');
  addBtn.addEventListener('click', () => openReservationForm({ date: ui.date >= todayYmd() ? ui.date : todayYmd(), onSaved: draw }));
  root.append(pageHead('예약 캘린더', { actions: [addBtn] }));

  const title = h('h2', { class: 'cal-title', 'aria-live': 'polite' });
  const prev = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '이전' }, icon('left'));
  const next = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '다음' }, icon('right'));
  const todayBtn = h('button', { type: 'button', class: 'btn btn-sm' }, '오늘');
  const views = [['month', '월'], ['week', '주'], ['day', '일·목록']];
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '보기 방식' }, views.map(([v, label]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(ui.view === v) }, label);
    b.addEventListener('click', () => { ui.view = v; for (const x of seg.children) x.setAttribute('aria-pressed', String(x === b)); draw(); });
    return b;
  }));
  const filters = h('div', { class: 'row', role: 'group', 'aria-label': '차량 필터' }, activeVehicles.map((v) => {
    const input = h('input', { type: 'checkbox', checked: !ui.hidden.has(v.id) });
    input.addEventListener('change', () => { if (input.checked) ui.hidden.delete(v.id); else ui.hidden.add(v.id); draw(); });
    return h('label', { class: 'chip' }, input, vehicleDot(v.color), v.model);
  }));
  const body = h('div', {});
  root.append(
    h('div', { class: 'toolbar' }, h('div', { class: 'cal-nav' }, prev, title, next, todayBtn), h('div', { style: { 'margin-left': 'auto' } }, seg)),
    activeVehicles.length > 1 ? h('div', { class: 'toolbar' }, filters) : null,
    body);

  const step = (dir) => {
    if (ui.view === 'month') { const [y, m] = ui.date.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + dir, 1)); ui.date = t.toISOString().slice(0, 10); } else ui.date = addDays(ui.date, ui.view === 'week' ? 7 * dir : dir);
    draw();
  };
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  todayBtn.addEventListener('click', () => { ui.date = todayYmd(); draw(); });

  async function draw() {
    const { from, to } = range();
    title.textContent = titleText();
    let list;
    try {
      ({ reservations: list } = await get(`/reservations${qs({ from, to })}`));
    } catch (err) {
      clear(body).append(alertBox('error', '예약을 불러오지 못했습니다.', err.message));
      return;
    }
    list = list.filter((r) => !ui.hidden.has(r.vehicle_id));
    clear(body);
    if (ui.view === 'month') body.append(monthView(list, from));
    else if (ui.view === 'week') body.append(weekView(list, from));
    else body.append(dayView(list));
  }

  function range() {
    if (ui.view === 'month') {
      const first = `${ui.date.slice(0, 7)}-01`;
      const start = addDays(first, -dayOfWeek(first));
      return { from: start, to: addDays(start, 41) };
    }
    const start = addDays(ui.date, -dayOfWeek(ui.date));
    return { from: start, to: addDays(start, 6) };
  }
  function titleText() {
    const [y, m] = ui.date.split('-').map(Number);
    if (ui.view === 'month') return `${y}년 ${m}월`;
    if (ui.view === 'week') { const s = range().from; const e = addDays(s, 6); return `${Number(s.slice(5, 7))}/${Number(s.slice(8))} ~ ${Number(e.slice(5, 7))}/${Number(e.slice(8))}`; }
    return dateLabel(ui.date, true);
  }
  const onDay = (list, ymd) => list.filter((r) => kst(r.start_at).ymd <= ymd && kst(new Date(new Date(r.end_at).getTime() - 1)).ymd >= ymd);

  function resvCard(r) {
    const b = h('button', { type: 'button', class: 'resv-card', style: { 'border-left-color': r.vehicle.color } },
      h('span', { class: 't' }, rangeLabel(r.start_at, r.end_at)),
      h('span', { class: 'small' }, `${r.vehicle.model} · ${r.user_name}`),
      h('span', { class: 'small muted' }, r.purpose_category),
      h('span', {}, badge('reservation', r.status)));
    b.addEventListener('click', () => openReservationDetail(r.id, { onChanged: draw }));
    return b;
  }
  function addFor(ymd, label = '이 날 예약하기') {
    const b = h('button', { type: 'button', class: 'btn btn-sm' }, icon('plus'), label);
    b.addEventListener('click', () => openReservationForm({ date: ymd, onSaved: draw }));
    return ymd >= todayYmd() ? b : null;
  }

  function monthView(list, start) {
    const month = ui.date.slice(0, 7);
    const today = todayYmd();
    const panel = h('div', { class: 'card', style: { 'margin-top': '1rem' } });
    const grid = h('div', { class: 'cal-month', role: 'grid', 'aria-label': titleText() });
    grid.append(...DOW.map((d, i) => h('div', { class: `cal-dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`, role: 'columnheader' }, d)));
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const ymd = addDays(start, i);
      const items = onDay(list, ymd);
      const dow = i % 7;
      const cell = h('button', {
        type: 'button', role: 'gridcell', tabindex: ymd === ui.date ? '0' : '-1',
        class: `cal-day${ymd.slice(0, 7) !== month ? ' other' : ''}${ymd === today ? ' today' : ''}${ymd === ui.date ? ' selected' : ''}${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}`,
        'aria-label': `${dateLabel(ymd)}, 예약 ${items.length}건`, 'aria-selected': String(ymd === ui.date),
      }, h('span', { class: 'cal-date', 'aria-hidden': 'true' }, String(Number(ymd.slice(8)))),
      items.slice(0, 3).map((r) => h('span', { class: `cal-chip ${r.status === 'cancelled' ? 'cancelled' : ''}`, style: { background: r.vehicle.color }, 'aria-hidden': 'true' }, `${r.vehicle.model} ${kst(r.start_at).hm}`)),
      items.length > 3 ? h('span', { class: 'cal-more', 'aria-hidden': 'true' }, `+${items.length - 3} 더보기`) : null);
      cell.addEventListener('click', () => select(ymd));
      cells.push(cell);
    }
    grid.append(...cells);
    // 방향키로 날짜 이동 (UI_UX.md 6장)
    grid.addEventListener('keydown', (e) => {
      const idx = cells.indexOf(document.activeElement);
      if (idx < 0) return;
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (delta === undefined) return;
      e.preventDefault();
      const ni = Math.min(41, Math.max(0, idx + delta));
      cells[idx].tabIndex = -1; cells[ni].tabIndex = 0; cells[ni].focus();
    });
    function select(ymd) {
      ui.date = ymd;
      for (const c of cells) { const on = c === cells[(Date.parse(ymd) - Date.parse(start)) / 86400000]; c.classList.toggle('selected', on); c.setAttribute('aria-selected', String(on)); }
      fillPanel(ymd);
    }
    function fillPanel(ymd) {
      const items = onDay(list, ymd);
      clear(panel).append(
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, dateLabel(ymd)), h('span', { style: { 'margin-left': 'auto' } }, addFor(ymd))),
        items.length ? h('div', { class: 'grid grid-2' }, items.map(resvCard)) : empty('이 날은 예약이 없습니다.'));
    }
    fillPanel(ui.date);
    return h('div', {}, h('div', { class: 'table-wrap', style: { border: 0 } }, grid), panel);
  }

  function weekView(list, start) {
    const today = todayYmd();
    return h('div', { class: 'week-cols' }, Array.from({ length: 7 }, (_, i) => {
      const ymd = addDays(start, i);
      const items = onDay(list, ymd);
      return h('section', { class: `week-col${ymd === today ? ' today' : ''}`, 'aria-label': dateLabel(ymd) },
        h('h3', {}, `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8))} (${DOW[i]})`),
        items.map(resvCard),
        items.length ? null : h('p', { class: 'small muted' }, '예약 없음'),
        addFor(ymd, '예약'));
    }));
  }

  function dayView(list) {
    const start = addDays(ui.date, -dayOfWeek(ui.date));
    const strip = h('div', { class: 'week-strip', role: 'group', 'aria-label': '날짜 선택' }, Array.from({ length: 7 }, (_, i) => {
      const ymd = addDays(start, i);
      const has = onDay(list, ymd).length > 0;
      const b = h('button', { type: 'button', 'aria-pressed': String(ymd === ui.date), class: has ? 'has' : '', 'aria-label': `${dateLabel(ymd)}${has ? ', 예약 있음' : ''}` },
        h('span', { class: 'dow', 'aria-hidden': 'true' }, DOW[i]), h('span', { class: 'd', 'aria-hidden': 'true' }, String(Number(ymd.slice(8)))));
      b.addEventListener('click', () => { ui.date = ymd; draw(); });
      return b;
    }));
    const items = onDay(list, ui.date);
    return h('div', {}, strip,
      h('div', { class: 'row', style: { 'margin-bottom': '.75rem' } }, h('h2', { class: 'card-title' }, dateLabel(ui.date)), h('span', { style: { 'margin-left': 'auto' } }, addFor(ui.date))),
      items.length ? h('div', { class: 'stack' }, items.map(resvCard)) : h('div', { class: 'card' }, empty('이 날은 예약이 없습니다.')));
  }

  await draw();
}
