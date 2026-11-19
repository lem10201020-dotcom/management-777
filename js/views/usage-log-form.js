// F-04 운행일지 입력·수정·조회 (+ F-07 서명)
import { h, clear } from '../dom.js';
import { get, post, patch, qs } from '../api.js';
import { state, hasRole } from '../state.js';
import { field, formValues, showErrors, clearErrors, formSummary, busy } from '../components/form.js';
import { signaturePad, signatureView } from '../components/signature-pad.js';
import { confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { badge } from '../components/badges.js';
import { navigate } from '../router.js';
import { kst, todayYmd, fmtKm, fmtWon, fmtLiters, dateLabel, rangeLabel, fmtDateTime } from '../utils/format.js';
import { validateUsageLog, hasErrors, MISMATCH_REASONS } from '../utils/validate.js';
import { pageHead, card, alertBox } from './common.js';

export async function render(root, { params, query }) {
  const isNew = !params.id;
  let log = null; let pre = null;
  if (isNew) {
    pre = await get(`/usage-logs/new${qs({ reservation_id: query.get('reservation_id'), vehicle_id: query.get('vehicle_id') })}`);
  } else {
    ({ log } = await get(`/usage-logs/${params.id}`));
  }
  if (log && !log.can_edit) return renderReadOnly(root, log);

  const [{ users }, { vehicles }] = await Promise.all([get('/users/options'), get('/vehicles')]);
  const drivers = users.filter((u) => u.can_drive || u.id === log?.driver_id);
  const settings = state.settings;
  const d = pre?.draft || {};
  const startK = d.start_at ? kst(d.start_at) : null;
  const endK = d.end_at ? kst(d.end_at) : null;
  const v = {
    vehicle_id: log?.vehicle_id ?? d.vehicle_id ?? '',
    driver_id: log?.driver_id ?? d.driver_id ?? state.user.id,
    drive_date: log?.drive_date ?? (startK && startK.ymd <= todayYmd() ? startK.ymd : todayYmd()),
    depart_time: log ? kst(log.depart_at).hm : startK?.hm ?? '',
    return_time: log ? kst(log.return_at).hm : endK?.hm ?? '',
    odometer_start: log?.odometer_start ?? pre?.expected_odometer_start ?? '',
    odometer_end: log?.odometer_end ?? '',
    destination: log?.destination ?? d.destination ?? '',
    purpose_category: log?.purpose_category ?? d.purpose_category ?? '',
    passenger_count: log?.passenger_count ?? d.passenger_count ?? 0,
    fuel_liters: log?.fuel_liters ?? '', fuel_cost: log?.fuel_cost ?? '', note: log?.note ?? '',
    mismatch_reason: log?.mismatch_reason ?? '',
  };
  let expected = log ? log.prev_end : pre?.expected_odometer_start ?? null;
  const reservationId = log?.reservation_id ?? d.reservation_id ?? null;
  const vehicle = vehicles.find((x) => x.id === Number(v.vehicle_id));

  root.append(pageHead(isNew ? '운행일지 입력' : '운행일지 수정', {
    desc: reservationId ? '예약 내용이 미리 채워져 있습니다. 실제 운행 시각과 계기판 값을 입력하세요.' : '예약 없이 운행한 기록을 차량담당자가 직접 입력합니다.',
    actions: log ? [badge('log', log.status)] : [],
  }));

  if (log?.status === 'submitted') root.append(alertBox('info', '제출된 운행일지입니다.', '내용을 고치면 서명이 무효가 되므로 다시 서명해야 저장됩니다.'), h('div', { style: { height: '1rem' } }));

  // 예약 요약
  if (pre?.reservation) {
    const r = pre.reservation;
    root.append(card('예약 정보', h('dl', { class: 'dl' },
      h('dt', {}, '차량'), h('dd', {}, `${pre.vehicle.model} ${pre.vehicle.plate_no}`),
      h('dt', {}, '예약 시간'), h('dd', { class: 'num' }, `${dateLabel(kst(r.start_at).ymd)} ${rangeLabel(r.start_at, r.end_at)}`))), h('div', { style: { height: '1rem' } }));
  }

  const vehicleField = reservationId || log
    ? h('div', { class: 'field' }, h('span', { class: 'label' }, '차량'), h('p', {}, vehicle ? `${vehicle.model} ${vehicle.plate_no}` : '-'), h('input', { type: 'hidden', name: 'vehicle_id', value: v.vehicle_id }))
    : field({ name: 'vehicle_id', label: '차량', type: 'select', required: true, value: String(v.vehicle_id), options: vehicles.filter((x) => x.status !== 'retired').map((x) => ({ value: String(x.id), label: `${x.model} (${x.plate_no})` })) });

  const distanceOut = h('output', { class: 'stat-value num', 'aria-live': 'polite' }, '-');
  const mismatchBox = h('div', { class: 'full', hidden: true });
  const sig = signaturePad({ name: 'signature', userName: state.user.name, label: '운전자 확인 서명' });

  const form = h('form', { class: 'card form', novalidate: true },
    formSummary(),
    h('section', { class: 'form-section' }, h('h2', {}, '운행 시각'),
      h('div', { class: 'form-grid cols-2' },
        vehicleField,
        field({ name: 'driver_id', label: '운전자', type: 'select', required: true, value: String(v.driver_id), options: drivers.map((u) => ({ value: String(u.id), label: u.name })) }),
        field({ name: 'drive_date', label: '운행일', type: 'date', required: true, value: v.drive_date, attrs: { max: todayYmd() } }),
        h('div', {}),
        field({ name: 'depart_time', label: '출발 시각', type: 'time', required: true, value: v.depart_time }),
        field({ name: 'return_time', label: '도착 시각', type: 'time', required: true, value: v.return_time, help: '자정을 넘겨 도착했다면 다음 날 시각을 그대로 입력하세요.' }))),
    h('section', { class: 'form-section' }, h('h2', {}, '계기판'),
      h('div', { class: 'form-grid cols-2' },
        field({ name: 'odometer_start', label: '출발 계기판', type: 'number', required: true, value: v.odometer_start, suffix: 'km',
          help: expected !== null ? `직전 운행의 도착 계기판: ${fmtKm(expected)}` : null, attrs: { inputmode: 'numeric', min: 0 } }),
        field({ name: 'odometer_end', label: '도착 계기판', type: 'number', required: true, value: v.odometer_end, suffix: 'km', attrs: { inputmode: 'numeric', min: 0 } }),
        h('div', { class: 'stat full' }, h('div', { class: 'stat-label' }, '운행거리 (자동 계산)'), distanceOut),
        mismatchBox)),
    h('section', { class: 'form-section' }, h('h2', {}, '운행 내용'),
      h('div', { class: 'form-grid cols-2' },
        field({ name: 'destination', label: '목적지', required: true, full: true, value: v.destination, help: '동·기관명 수준까지만 적어 주세요. 이용자 이름·상세주소는 적지 마세요.', attrs: { maxlength: 100 } }),
        field({ name: 'purpose_category', label: '운행 목적', type: 'select', required: true, value: v.purpose_category, options: settings.purpose_categories }),
        field({ name: 'passenger_count', label: '동승 인원', type: 'number', required: true, value: v.passenger_count, suffix: '명', attrs: { inputmode: 'numeric', min: 0 } }))),
    h('details', { class: 'form-section', open: !!(v.fuel_liters || v.fuel_cost) }, h('summary', {}, h('strong', {}, '주유 내역 (주유했을 때만)')),
      h('div', { class: 'form-grid cols-2', style: { 'margin-top': '1rem' } },
        field({ name: 'fuel_liters', label: '주유량', type: 'number', value: v.fuel_liters, suffix: 'L', attrs: { inputmode: 'decimal', step: '0.1', min: 0, max: 200 } }),
        field({ name: 'fuel_cost', label: '주유 금액', type: 'number', value: v.fuel_cost, suffix: '원', attrs: { inputmode: 'numeric', min: 0 } }))),
    h('section', { class: 'form-section' },
      field({ name: 'note', label: '특이사항', type: 'textarea', value: v.note, help: '차량 이상, 경고등 등 (300자 이내). 이용자 정보는 적지 마세요.', attrs: { maxlength: 300 } })),
    h('section', { class: 'form-section' }, sig.el),
  );
  const draftBtn = h('button', { type: 'button', class: 'btn' }, '임시저장');
  const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, log?.status === 'submitted' ? '다시 서명하고 저장' : '서명하고 제출');
  form.append(h('div', { class: 'form-actions sticky' }, log?.status === 'submitted' ? null : draftBtn, submitBtn));
  root.append(form);
  sig.init();

  const el = form.elements;
  function updateDistance() {
    const s = Number(el.odometer_start.value); const e = Number(el.odometer_end.value);
    distanceOut.textContent = el.odometer_start.value !== '' && el.odometer_end.value !== '' && e >= s ? fmtKm(e - s) : '-';
  }
  function updateMismatch(force = false) {
    const s = el.odometer_start.value;
    const show = force || (expected !== null && s !== '' && Number(s) !== expected);
    if (show && mismatchBox.hidden) {
      clear(mismatchBox).append(
        alertBox('warning', `직전 운행의 도착 계기판(${fmtKm(expected)})과 다릅니다.`, '저장은 할 수 있지만 사유를 선택해야 합니다. 차량담당자 확인 목록에 표시됩니다.'),
        h('div', { style: { height: '.75rem' } }),
        field({ name: 'mismatch_reason', label: '불일치 사유', type: 'select', required: true, value: v.mismatch_reason, options: MISMATCH_REASONS }));
    }
    if (!show) clear(mismatchBox);
    mismatchBox.hidden = !show;
  }
  el.odometer_start.addEventListener('input', () => { updateDistance(); updateMismatch(); });
  el.odometer_end.addEventListener('input', updateDistance);
  if (el.vehicle_id?.tagName === 'SELECT') {
    el.vehicle_id.addEventListener('change', async () => {
      if (!el.vehicle_id.value) return;
      const p = await get(`/usage-logs/new${qs({ vehicle_id: el.vehicle_id.value })}`);
      expected = p.expected_odometer_start;
      el.odometer_start.value = expected;
      const help = form.querySelector('[data-field="odometer_start"] .help');
      if (help) help.textContent = `직전 운행의 도착 계기판: ${fmtKm(expected)}`;
      updateDistance(); updateMismatch();
    });
  }
  updateDistance(); updateMismatch();

  async function save(submit) {
    clearErrors(form);
    const values = formValues(form);
    const payload = { ...values, reservation_id: reservationId, submit };
    const { errors } = validateUsageLog(payload, settings);
    if (hasErrors(errors)) return showErrors(form, errors);
    if (submit) {
      const s = sig.getValue();
      if (s.error) return showErrors(form, { signature: s.error }, '운전자 서명이 필요합니다.');
      payload.signature = s;
      const dist = Number(values.odometer_end) - Number(values.odometer_start);
      if (dist > settings.distance_warn_km && !(await confirmDialog({ title: '운행거리 확인', message: `1회 운행거리가 ${fmtKm(dist)}입니다. 계기판 값이 맞나요?`, confirmText: '맞습니다' }))) return null;
    }
    try {
      const res = isNew ? await post('/usage-logs', payload) : await patch(`/usage-logs/${log.id}`, payload);
      toast(submit ? '운행일지를 제출했습니다.' : '임시저장했습니다.');
      navigate(submit ? '/usage-logs' : `/usage-logs/${res.log.id}`);
    } catch (err) {
      if (err.code === 'ODOMETER_MISMATCH') { expected = err.extra.expected; updateMismatch(true); }
      showErrors(form, err.fields, err.message);
    }
    return null;
  }
  draftBtn.addEventListener('click', () => busy(draftBtn, '저장 중…', () => save(false)));
  form.addEventListener('submit', (e) => { e.preventDefault(); busy(submitBtn, '제출 중…', () => save(true)); });
}

function renderReadOnly(root, l) {
  root.append(pageHead('운행일지', { actions: [badge('log', l.status), h('a', { class: 'btn', href: '#/usage-logs' }, '목록')] }));
  if (l.status === 'locked') root.append(alertBox('info', '🔒 결재가 끝난 기록이라 수정할 수 없습니다.'), h('div', { style: { height: '1rem' } }));
  root.append(card(null, h('div', { class: 'stack' },
    h('dl', { class: 'dl' },
      h('dt', {}, '차량'), h('dd', {}, `${l.model} ${l.plate_no}`),
      h('dt', {}, '운전자'), h('dd', {}, l.driver_name),
      h('dt', {}, '운행일'), h('dd', {}, dateLabel(l.drive_date, true)),
      h('dt', {}, '시각'), h('dd', { class: 'num' }, rangeLabel(l.depart_at, l.return_at)),
      h('dt', {}, '계기판'), h('dd', { class: 'num' }, `${fmtKm(l.odometer_start)} → ${fmtKm(l.odometer_end)}`),
      h('dt', {}, '운행거리'), h('dd', { class: 'num' }, fmtKm(l.distance_km)),
      l.mismatch ? [h('dt', {}, '불일치 사유'), h('dd', {}, l.mismatch_reason || '-')] : null,
      h('dt', {}, '목적지'), h('dd', {}, l.destination),
      h('dt', {}, '운행 목적'), h('dd', {}, l.purpose_category),
      h('dt', {}, '동승 인원'), h('dd', {}, `${l.passenger_count}명`),
      h('dt', {}, '주유'), h('dd', {}, l.fuel_liters ? `${fmtLiters(l.fuel_liters)} / ${fmtWon(l.fuel_cost)}` : '-'),
      h('dt', {}, '특이사항'), h('dd', {}, l.note || '-'),
      h('dt', {}, '서명 일시'), h('dd', {}, fmtDateTime(l.signed_at))),
    signatureView(l.driver_signature, l.signature_type))));
  if (!hasRole('manager')) return;
}
