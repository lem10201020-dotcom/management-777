// F-08 차량 관리
import { h, clear, icon } from '../dom.js';
import { get, post, patch, qs } from '../api.js';
import { badge, vehicleDot } from '../components/badges.js';
import { openModal } from '../components/modal.js';
import { field, formValues, showErrors, formSummary, busy } from '../components/form.js';
import { toast } from '../components/toast.js';
import { fmtKm, rangeLabel, kst } from '../utils/format.js';
import { FUEL_TYPES, VEHICLE_STATUS, VEHICLE_COLORS, validateVehicle, hasErrors } from '../utils/validate.js';
import { pageHead, card, empty, alertBox } from './common.js';

const COLOR_NAMES = ['네이비', '청록', '자주', '갈색', '녹색', '회청'];
const filters = { q: '', status: '' };

export async function render(root) {
  const add = h('button', { type: 'button', class: 'btn btn-primary' }, icon('plus'), '차량 등록');
  add.addEventListener('click', () => vehicleForm(null, load));
  root.append(pageHead('차량 관리', { actions: [add] }));
  const q = h('input', { class: 'input', type: 'search', placeholder: '차량번호 또는 차종', 'aria-label': '차량 검색', value: filters.q });
  const st = h('select', { class: 'select', 'aria-label': '상태 필터', value: filters.status },
    h('option', { value: '' }, '전체 상태'), Object.entries(VEHICLE_STATUS).map(([v, l]) => h('option', { value: v }, l)));
  st.value = filters.status;
  const search = h('form', { class: 'toolbar', role: 'search' }, h('div', { class: 'grow' }, q), h('div', {}, st), h('button', { type: 'submit', class: 'btn' }, '검색'));
  search.addEventListener('submit', (e) => { e.preventDefault(); filters.q = q.value; filters.status = st.value; load(); });
  st.addEventListener('change', () => { filters.status = st.value; load(); });
  const list = h('div', { 'aria-live': 'polite' });
  root.append(search, list);

  async function load() {
    let data;
    try { data = await get(`/vehicles${qs(filters)}`); } catch (err) { clear(list).append(alertBox('error', '차량 목록을 불러오지 못했습니다.', err.message)); return; }
    clear(list);
    if (!data.vehicles.length) { list.append(card(null, empty(filters.q || filters.status ? '검색 결과가 없습니다.' : '등록된 차량이 없습니다.', null))); return; }
    list.append(h('ul', { class: 'list grid grid-2' }, data.vehicles.map((v) => {
      const b = h('button', { type: 'button', class: 'list-item', style: v.status === 'retired' ? { opacity: '.65' } : {} }, vehicleDot(v.color),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, `${v.model} · ${v.plate_no}`),
          h('span', { class: 'small muted' }, `${v.seats}인승 · ${v.fuel_type} · 현재 ${fmtKm(v.current_odometer)} · 이번 달 ${fmtKm(v.month_distance)}`)),
        badge('vehicle', v.status));
      b.addEventListener('click', () => vehicleForm(v, load));
      return h('li', {}, b);
    })));
  }
  await load();
}

function vehicleForm(v, onSaved) {
  const isEdit = !!v;
  const colorField = h('fieldset', { class: 'field full', dataset: { field: 'color' } },
    h('legend', {}, '캘린더 표시 색상', h('span', { class: 'req' }, '(필수)')),
    h('div', { class: 'checks' }, VEHICLE_COLORS.map((c, i) => h('label', { class: 'check' },
      h('input', { type: 'radio', name: 'color', value: c, checked: (v?.color || VEHICLE_COLORS[0]) === c }), vehicleDot(c), COLOR_NAMES[i]))),
    h('p', { class: 'field-error', id: `color-err-${Date.now()}`, hidden: true }));
  const form = h('form', { class: 'form', id: 'vehicle-form', novalidate: true },
    formSummary(),
    h('div', { class: 'form-grid cols-2' },
      field({ name: 'plate_no', label: '차량번호', required: true, value: v?.plate_no, help: '예: 12가3456, 123가4567', attrs: { autocomplete: 'off' } }),
      field({ name: 'model', label: '차종', required: true, value: v?.model, help: '예: 스타리아 11인승', attrs: { maxlength: 30 } }),
      field({ name: 'seats', label: '승차정원', type: 'number', required: true, value: v?.seats, suffix: '인승', attrs: { min: 1, max: 45, inputmode: 'numeric' } }),
      field({ name: 'fuel_type', label: '연료', type: 'select', required: true, value: v?.fuel_type, options: FUEL_TYPES }),
      field({ name: 'initial_odometer', label: '최초 계기판', type: 'number', required: true, value: v?.initial_odometer, suffix: 'km',
        help: '등록 시점의 계기판 값. 첫 운행일지 입력 후에는 바꿀 수 없습니다.', attrs: { min: 0, inputmode: 'numeric', readonly: v?.has_logs || null } }),
      field({ name: 'status', label: '상태', type: 'select', required: true, value: v?.status || 'available', options: Object.entries(VEHICLE_STATUS).map(([value, label]) => ({ value, label })) }),
      colorField,
      field({ name: 'note', label: '메모', type: 'textarea', full: true, value: v?.note, help: '보험·정기점검 일정 등 (200자 이내)', attrs: { maxlength: 200 } })));
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, '저장');
  save.setAttribute('form', 'vehicle-form');
  const m = openModal({ title: isEdit ? '차량 정보 수정' : '차량 등록', body: form, footer: [h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, '닫기'), save] });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = formValues(form);
    const { errors } = validateVehicle(values);
    if (hasErrors(errors)) return showErrors(form, errors);
    busy(save, '저장 중…', async () => {
      try {
        const res = isEdit ? await patch(`/vehicles/${v.id}`, values) : await post('/vehicles', values);
        m.close();
        toast(isEdit ? '차량 정보를 저장했습니다.' : '차량을 등록했습니다.');
        onSaved();
        if (res.affected_reservations?.length) affectedModal(res.vehicle, res.affected_reservations);
      } catch (err) { showErrors(form, err.fields, err.message); }
    });
  });
}

function affectedModal(v, list) {
  openModal({
    title: '예약 확인이 필요합니다',
    body: [h('p', {}, `${v.model}(${v.plate_no})이(가) ${VEHICLE_STATUS[v.status]} 상태가 되었습니다. 아래 예약은 차량을 바꾸거나 취소해야 합니다. 예약자에게 알려 주세요.`),
      h('ul', {}, list.map((r) => h('li', { class: 'num' }, `${kst(r.start_at).m}/${kst(r.start_at).d} ${rangeLabel(r.start_at, r.end_at)} · ${r.user_name}`)))],
  });
}
