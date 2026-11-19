// F-03 예약 등록·수정 폼과 상세 (모달 / 모바일 하단 시트)
import { h, clear } from '../dom.js';
import { get, post, patch, qs } from '../api.js';
import { state, hasRole } from '../state.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { field, formValues, showErrors, clearErrors, formSummary, busy } from '../components/form.js';
import { toast } from '../components/toast.js';
import { badge, vehicleDot } from '../components/badges.js';
import { kst, todayYmd, rangeLabel, dateLabel } from '../utils/format.js';
import { validateReservation, hasErrors } from '../utils/validate.js';

const TL_START = 6; const TL_END = 22; // 미니 타임라인 06~22시

function defaultTimes() {
  const now = new Date();
  const k = kst(new Date(now.getTime() + 60 * 60_000));
  const hh = String(Math.min(Number(k.hh), 21)).padStart(2, '0');
  return { date: k.ymd, start: `${hh}:00`, end: `${String(Number(hh) + 2).padStart(2, '0')}:00` };
}

export async function openReservationForm({ date, time, vehicleId, reservation, onSaved } = {}) {
  const [{ vehicles }, usersRes] = await Promise.all([
    get('/vehicles?status=available'),
    hasRole('manager') ? get('/users/options') : Promise.resolve({ users: [] }),
  ]);
  const isEdit = !!reservation;
  const def = defaultTimes();
  const startK = reservation ? kst(reservation.start_at) : null;
  const endK = reservation ? kst(reservation.end_at) : null;
  const startDate = startK?.ymd || date || def.date;
  const startTime = startK?.hm || time || def.start;
  const endTime = endK?.hm || (time ? `${String(Math.min(Number(time.slice(0, 2)) + 2, 23)).padStart(2, '0')}:${time.slice(3)}` : def.end);
  const purposes = state.settings.purpose_categories;

  const vehicleOptions = vehicles.map((v) => ({ value: String(v.id), label: `${v.model} (${v.plate_no}, ${v.seats}인승)` }));
  const timeline = h('div', { class: 'stack', 'aria-live': 'polite' });
  const form = h('form', { class: 'form', novalidate: true },
    formSummary(),
    h('div', { class: 'form-grid cols-2' },
      field({ name: 'vehicle_id', label: '차량', type: 'select', required: true, options: vehicleOptions, value: String(reservation?.vehicle_id || vehicleId || ''), full: true }),
      h('div', { class: 'full' }, timeline),
      hasRole('manager') ? field({ name: 'user_id', label: '예약자', type: 'select', required: true, full: true,
        options: usersRes.users.map((u) => ({ value: String(u.id), label: `${u.name}${u.team ? ` (${u.team})` : ''}` })),
        value: String(reservation?.user_id || state.user.id) }) : null,
      field({ name: 'start_date', label: '시작 날짜', type: 'date', required: true, value: startDate }),
      field({ name: 'start_time', label: '시작 시각', type: 'time', required: true, value: startTime, attrs: { step: 600 }, help: '10분 단위' }),
      field({ name: 'end_date', label: '종료 날짜', type: 'date', required: true, value: endK?.ymd || startDate }),
      field({ name: 'end_time', label: '종료 시각', type: 'time', required: true, value: endTime, attrs: { step: 600 } }),
      field({ name: 'destination', label: '목적지', required: true, full: true, value: reservation?.destination,
        help: '동·기관명 수준까지만 적어 주세요. 이용자 이름·상세주소·건강정보는 적지 마세요.', attrs: { maxlength: 100, autocomplete: 'off' } }),
      field({ name: 'purpose_category', label: '운행 목적', type: 'select', required: true, options: purposes, value: reservation?.purpose_category }),
      field({ name: 'passenger_count', label: '동승 인원', type: 'number', required: true, value: reservation?.passenger_count ?? 0,
        suffix: '명', help: '운전자 제외, 인원수만 적습니다.', attrs: { min: 0, max: 44, inputmode: 'numeric' } }),
      field({ name: 'purpose_note', label: '목적 메모', type: 'textarea', full: true, value: reservation?.purpose_note || '',
        help: '선택 입력(200자 이내). 본인과 차량담당자만 볼 수 있습니다. 이용자 실명·건강정보는 적지 마세요.', attrs: { maxlength: 200 } }),
    ));

  const vehicleSel = form.elements.vehicle_id;
  const startDateEl = form.elements.start_date;
  const endDateEl = form.elements.end_date;
  startDateEl.addEventListener('change', () => { if (!endDateEl.value || endDateEl.value < startDateEl.value) endDateEl.value = startDateEl.value; refreshTimeline(); });
  vehicleSel.addEventListener('change', refreshTimeline);

  async function refreshTimeline() {
    clear(timeline);
    const vid = vehicleSel.value; const day = startDateEl.value;
    if (!vid || !day) return;
    try {
      const { reservations } = await get(`/reservations${qs({ from: day, to: day, vehicle_id: vid })}`);
      const others = reservations.filter((r) => r.id !== reservation?.id);
      const span = (TL_END - TL_START) * 60;
      const dayStart = new Date(`${day}T${String(TL_START).padStart(2, '0')}:00:00+09:00`).getTime();
      timeline.append(
        h('p', { class: 'small' }, h('strong', {}, `${dateLabel(day)} 이 차량 예약: `), others.length ? others.map((r) => `${rangeLabel(r.start_at, r.end_at)} ${r.user_name}`).join(', ') : '없음'),
        h('div', { class: 'timeline', 'aria-hidden': 'true' }, others.map((r) => {
          const s = Math.max(0, (new Date(r.start_at).getTime() - dayStart) / 60000);
          const e = Math.min(span, (new Date(r.end_at).getTime() - dayStart) / 60000);
          if (e <= 0 || s >= span) return null;
          return h('span', { class: 'timeline-block', style: { left: `${(s / span) * 100}%`, width: `${((e - s) / span) * 100}%` } });
        })),
        h('div', { class: 'timeline-labels', 'aria-hidden': 'true' }, ['06', '10', '14', '18', '22'].map((t) => h('span', {}, `${t}시`))));
    } catch { /* 타임라인은 참고용 */ }
  }
  refreshTimeline();

  const cancelBtn = h('button', { type: 'button', class: 'btn' }, '취소');
  const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? '변경 저장' : '예약 저장');
  saveBtn.setAttribute('form', 'resv-form');
  form.id = 'resv-form';
  const m = openModal({ title: isEdit ? '예약 수정' : '차량예약', body: form, footer: [cancelBtn, saveBtn] });
  cancelBtn.addEventListener('click', () => m.close());

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = formValues(form);
    const payload = {
      vehicle_id: v.vehicle_id, user_id: v.user_id || undefined,
      start_at: `${v.start_date}T${v.start_time}`, end_at: `${v.end_date}T${v.end_time}`,
      destination: v.destination, purpose_category: v.purpose_category, passenger_count: v.passenger_count, purpose_note: v.purpose_note,
    };
    const { errors } = validateReservation(payload, state.settings);
    if (hasErrors(errors)) return showErrors(form, mapErrors(errors));
    busy(saveBtn, '저장 중…', async () => {
      try {
        if (isEdit) await patch(`/reservations/${reservation.id}`, payload); else await post('/reservations', payload);
        m.close();
        toast(isEdit ? '예약을 변경했습니다.' : '예약을 저장했습니다.');
        onSaved?.();
      } catch (err) {
        showErrors(form, mapErrors(err.fields), err.message);
        if (err.code === 'RESERVATION_OVERLAP') showSuggestions(form, err.extra.suggestions || [], vehicleSel, refreshTimeline);
      }
    });
  });
}

function mapErrors(fields = {}) {
  const out = { ...fields };
  if (out.start_at) { out.start_time = out.start_at; delete out.start_at; }
  if (out.end_at) { out.end_time = out.end_at; delete out.end_at; }
  return out;
}

// 겹침 안내 옆(시작 시각 필드)에 빈 차량 제안을 붙인다 — 모바일에서 상단 요약이 화면 밖에 있어도 보이도록
function showSuggestions(form, suggestions, vehicleSel, refresh) {
  form.querySelector('.suggestions')?.remove();
  const target = form.querySelector('[data-field="start_time"]');
  if (!target) return;
  const box = h('div', { class: 'suggestions alert alert-info' }, h('div', { class: 'alert-body' },
    suggestions.length
      ? [h('p', {}, '같은 시간에 예약할 수 있는 차량:'), h('div', { class: 'row' }, suggestions.map((v) => {
        const b = h('button', { type: 'button', class: 'btn btn-sm' }, `${v.model} (${v.plate_no})로 바꾸기`);
        b.addEventListener('click', () => { vehicleSel.value = String(v.id); clearErrors(form); box.remove(); refresh(); vehicleSel.focus(); });
        return b;
      }))]
      : h('p', {}, '같은 시간에 비어 있는 다른 차량이 없습니다. 시간을 바꿔 주세요.')));
  target.append(box);
}

export async function openReservationDetail(id, { onChanged } = {}) {
  const { reservation: r } = await get(`/reservations/${id}`);
  const s = kst(r.start_at);
  const body = h('div', { class: 'stack' },
    h('div', { class: 'row' }, vehicleDot(r.vehicle.color), h('strong', {}, `${r.vehicle.model} ${r.vehicle.plate_no}`), badge('reservation', r.status)),
    h('dl', { class: 'dl' },
      h('dt', {}, '일시'), h('dd', { class: 'num' }, `${dateLabel(s.ymd)} ${rangeLabel(r.start_at, r.end_at)}`),
      h('dt', {}, '예약자'), h('dd', {}, r.user_name),
      h('dt', {}, '목적지'), h('dd', {}, r.destination),
      h('dt', {}, '운행 목적'), h('dd', {}, r.purpose_category),
      h('dt', {}, '동승 인원'), h('dd', {}, `${r.passenger_count}명`),
      r.purpose_note ? [h('dt', {}, '목적 메모'), h('dd', {}, r.purpose_note)] : null,
      r.cancel_reason ? [h('dt', {}, '취소 사유'), h('dd', {}, r.cancel_reason)] : null));
  const footer = [];
  let m;
  const done = (msg) => { m.close(); toast(msg); onChanged?.(); };
  if (r.can_write_log) footer.push(h('a', { class: 'btn btn-primary', href: `#/usage-logs/new?reservation_id=${r.id}`, onclick: () => m.close() }, '운행일지 입력'));
  if (r.usage_log_id) footer.push(h('a', { class: 'btn', href: `#/usage-logs/${r.usage_log_id}`, onclick: () => m.close() }, '운행일지 보기'));
  if (r.status === 'requested' && hasRole('manager')) {
    const b = h('button', { type: 'button', class: 'btn btn-primary' }, '예약 확정');
    b.addEventListener('click', () => busy(b, '처리 중…', async () => { await post(`/reservations/${r.id}/confirm`); done('예약을 확정했습니다.'); }));
    footer.push(b);
  }
  if (r.status === 'confirmed' && !r.usage_log_id && hasRole('manager') && new Date(r.end_at) < new Date()) {
    const b = h('button', { type: 'button', class: 'btn' }, '미사용 처리');
    b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: '미사용 처리', message: '이 예약을 실제로 사용하지 않은 것으로 처리할까요?', confirmText: '미사용 처리' }))) return;
      try { await post(`/reservations/${r.id}/no-show`); done('미사용으로 처리했습니다.'); } catch (err) { toast(err.message); }
    });
    footer.push(b);
  }
  if (r.can_edit) {
    const b = h('button', { type: 'button', class: 'btn' }, '수정');
    b.addEventListener('click', () => { m.close(); openReservationForm({ reservation: r, onSaved: onChanged }); });
    footer.push(b);
  }
  if (r.can_cancel) {
    const b = h('button', { type: 'button', class: 'btn btn-danger' }, '예약 취소');
    b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: '예약 취소', message: '이 예약을 취소할까요? 취소한 예약은 되돌릴 수 없습니다.', confirmText: '예약 취소', danger: true }))) return;
      try { await post(`/reservations/${r.id}/cancel`, { reason: '' }); done('예약을 취소했습니다.'); } catch (err) { toast(err.message); }
    });
    footer.push(b);
  }
  m = openModal({ title: '예약 상세', body, footer: footer.length ? footer : null });
}

export { todayYmd };
