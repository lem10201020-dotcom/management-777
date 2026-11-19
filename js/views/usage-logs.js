// F-04 운행일지(차량사용대장) 목록 — PC 표 / 모바일 카드
import { h, clear, icon } from '../dom.js';
import { get, qs } from '../api.js';
import { hasRole } from '../state.js';
import { badge, vehicleDot } from '../components/badges.js';
import { fmtKm, dateLabel, kst } from '../utils/format.js';
import { LOG_STATUS } from '../utils/validate.js';
import { pageHead, empty, alertBox } from './common.js';
import { field } from '../components/form.js';

const filters = { vehicle_id: '', status: '', from: '', to: '', q: '', mine: '', page: 1 };

export async function render(root) {
  const { vehicles } = await get('/vehicles');
  const actions = [];
  if (hasRole('manager')) actions.push(h('a', { class: 'btn', href: '#/usage-logs/new' }, icon('plus'), '예약 없이 작성'));
  root.append(pageHead('운행일지', { desc: '차량사용대장입니다. 예약을 마친 뒤 대시보드나 예약 상세에서 운행일지를 입력하세요.', actions }));

  const form = h('form', { class: 'card', role: 'search', 'aria-label': '운행일지 검색' },
    h('div', { class: 'form-grid cols-2', style: { 'grid-template-columns': 'repeat(auto-fit, minmax(10rem, 1fr))' } },
      field({ name: 'vehicle_id', label: '차량', type: 'select', value: filters.vehicle_id, options: vehicles.map((v) => ({ value: String(v.id), label: `${v.model} ${v.plate_no}` })) }),
      field({ name: 'status', label: '상태', type: 'select', value: filters.status, options: Object.entries(LOG_STATUS).map(([value, label]) => ({ value, label })) }),
      field({ name: 'from', label: '시작일', type: 'date', value: filters.from }),
      field({ name: 'to', label: '종료일', type: 'date', value: filters.to }),
      field({ name: 'q', label: '목적지 검색', type: 'search', value: filters.q })),
    h('div', { class: 'row', style: { 'margin-top': '1rem' } },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'mine', checked: filters.mine === '1' }), '내 기록만'),
      h('span', { style: { 'margin-left': 'auto' } }),
      h('button', { type: 'button', class: 'btn btn-text', onclick: () => { Object.assign(filters, { vehicle_id: '', status: '', from: '', to: '', q: '', mine: '', page: 1 }); for (const el of form.elements) { if (el.type === 'checkbox') el.checked = false; else if (el.name) el.value = ''; } load(); } }, '초기화'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, '검색')));
  form.querySelector('select[name=vehicle_id] option').textContent = '전체 차량';
  form.querySelector('select[name=status] option').textContent = '전체 상태';
  const results = h('div', { style: { 'margin-top': '1rem' }, 'aria-live': 'polite' });
  root.append(form, results);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    for (const k of ['vehicle_id', 'status', 'from', 'to', 'q']) filters[k] = form.elements[k].value;
    filters.mine = form.elements.mine.checked ? '1' : '';
    filters.page = 1;
    load();
  });

  async function load() {
    let data;
    try { data = await get(`/usage-logs${qs(filters)}`); } catch (err) { clear(results).append(alertBox('error', '운행일지를 불러오지 못했습니다.', err.message)); return; }
    clear(results);
    if (!data.logs.length) { results.append(h('div', { class: 'card' }, empty(Object.values(filters).some((v) => v && v !== 1) ? '검색 결과가 없습니다. 검색어를 바꾸거나 필터를 해제해 보세요.' : '작성된 운행일지가 없습니다. 운행을 마치면 여기에 표시됩니다.'))); return; }
    const rows = data.logs;
    results.append(
      h('p', { class: 'small muted', style: { 'margin-bottom': '.5rem' } }, `총 ${data.total}건`),
      h('div', { class: 'only-desktop' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('caption', { class: 'sr-only' }, '운행일지 목록'),
        h('thead', {}, h('tr', {}, ['운행일', '차량', '운전자', '목적지', '목적', '거리', '상태', ''].map((t, i) => h('th', { scope: 'col', class: i === 5 ? 'right' : '' }, t)))),
        h('tbody', {}, rows.map((l) => h('tr', {},
          h('td', { class: 'num' }, `${dateLabel(l.drive_date)} ${kst(l.depart_at).hm}`),
          h('td', {}, h('span', { class: 'row' }, vehicleDot(l.color), l.model)),
          h('td', {}, l.driver_name),
          h('td', {}, l.destination),
          h('td', {}, l.purpose_category),
          h('td', { class: 'num' }, fmtKm(l.distance_km), l.mismatch ? h('span', { class: 'badge badge-warning', title: `직전 기록과 다름: ${l.mismatch_reason}` }, ' ! 불일치') : null),
          h('td', {}, badge('log', l.status)),
          h('td', {}, h('a', { href: `#/usage-logs/${l.id}` }, l.can_edit ? '보기·수정' : '보기')))))))),
      h('ul', { class: 'list only-mobile' }, rows.map((l) => h('li', {}, h('a', { class: 'list-item', href: `#/usage-logs/${l.id}` },
        vehicleDot(l.color),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, `${dateLabel(l.drive_date)} · ${l.model}`),
          h('span', { class: 'small muted' }, `${l.driver_name} · ${l.destination} · ${fmtKm(l.distance_km)}${l.mismatch ? ' · 계기판 불일치' : ''}`)),
        badge('log', l.status))))),
      pager(data));
  }

  function pager(data) {
    const pages = Math.ceil(data.total / data.page_size);
    if (pages <= 1) return null;
    const go = (p) => { filters.page = p; load(); results.scrollIntoView({ block: 'start' }); };
    return h('nav', { class: 'pager', 'aria-label': '페이지' },
      h('button', { type: 'button', class: 'btn btn-sm', disabled: data.page <= 1, onclick: () => go(data.page - 1) }, '이전'),
      h('span', { class: 'small' }, `${data.page} / ${pages}`),
      h('button', { type: 'button', class: 'btn btn-sm', disabled: data.page >= pages, onclick: () => go(data.page + 1) }, '다음'));
  }
  await load();
}
