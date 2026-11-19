// F-05 월별 차량대장 / F-06 결재
import { h, icon } from '../dom.js';
import { get, post, qs } from '../api.js';
import { state, hasRole } from '../state.js';
import { badge, vehicleDot } from '../components/badges.js';
import { openModal } from '../components/modal.js';
import { field, formValues, showErrors, formSummary, busy } from '../components/form.js';
import { signaturePad, signatureView } from '../components/signature-pad.js';
import { toast } from '../components/toast.js';
import { navigate, render as rerender } from '../router.js';
import { currentYm, addMonths, monthLabel, fmtKm, fmtWon, fmtLiters, fmtNum, kst, fmtDateTime } from '../utils/format.js';
import { YM_RE } from '../utils/validate.js';
import { pageHead, card, empty, alertBox } from './common.js';

export async function render(root, { query }) {
  const ym = YM_RE.test(query.get('ym') || '') ? query.get('ym') : addMonths(currentYm(), -1);
  const vehicleId = Number(query.get('vehicle_id') || 0);
  const go = (params) => navigate(`/ledgers${qs({ ym, vehicle_id: vehicleId || '', ...params })}`);

  root.append(pageHead('월별 차량대장', { desc: '제출된 운행일지가 차량·월 단위로 자동 집계됩니다. 결재가 끝나면 그달 운행일지는 잠깁니다.' }));
  const prev = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '이전 달' }, icon('left'));
  const next = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '다음 달', disabled: ym >= currentYm() }, icon('right'));
  prev.addEventListener('click', () => go({ ym: addMonths(ym, -1) }));
  next.addEventListener('click', () => go({ ym: addMonths(ym, 1) }));
  const printAll = h('a', { class: 'btn', href: `#/print/ledger${qs({ ym, vehicle_id: 'all' })}` }, icon('print'), '이 달 전체 차량 인쇄');
  const lineLink = h('a', { class: 'btn btn-text', href: '#/approval-line' }, `결재라인: ${state.settings.approval_steps.map((s) => s.name).join(' → ')}${hasRole('admin') ? ' (편집)' : ''}`);
  root.append(h('div', { class: 'toolbar' }, h('div', { class: 'cal-nav' }, prev, h('h2', { class: 'cal-title' }, monthLabel(ym)), next),
    h('div', { class: 'row', style: { 'margin-left': 'auto' } }, lineLink, printAll)));

  const { vehicles } = await get(`/ledgers/overview${qs({ ym })}`);
  root.append(h('ul', { class: 'list grid grid-3', style: { 'margin-bottom': '1.5rem' }, 'aria-label': '차량 선택' }, vehicles.map((v) => h('li', {},
    h('a', { class: 'list-item', href: `#/ledgers${qs({ ym, vehicle_id: v.vehicle_id })}`, 'aria-current': v.vehicle_id === vehicleId ? 'true' : null,
      style: v.vehicle_id === vehicleId ? { 'border-color': 'var(--color-navy-700)', 'box-shadow': 'inset 4px 0 0 var(--color-gold-400)' } : {} },
    vehicleDot(v.color),
    h('span', { class: 'grow' }, h('span', { class: 'title' }, `${v.model} ${v.plate_no}`),
      h('span', { class: 'small muted' }, `${v.log_count}건 · ${fmtKm(v.total_distance)}${v.draft_count ? ` · 작성중 ${v.draft_count}` : ''}`)),
    badge('ledger', v.status))))));
  if (!vehicles.length) { root.append(card(null, empty('차량이 없습니다.'))); return; }
  if (!vehicleId) { root.append(alertBox('info', '차량을 선택하면 대장 내용을 볼 수 있습니다.')); return; }

  const L = await get(`/ledgers${qs({ ym, vehicle_id: vehicleId })}`);
  const s = L.summary;
  const actions = [h('a', { class: 'btn', href: `#/print/ledger${qs({ ym, vehicle_id: vehicleId })}` }, icon('print'), '인쇄/PDF')];
  if (L.can_recall) {
    const b = h('button', { type: 'button', class: 'btn' }, '회수');
    b.addEventListener('click', () => recallModal(L));
    actions.unshift(b);
  }
  if (hasRole('manager') && ['open', 'rejected'].includes(L.status)) {
    const b = h('button', { type: 'button', class: 'btn btn-primary', 'aria-disabled': String(!L.can_submit) }, '결재요청');
    b.addEventListener('click', () => { if (L.can_submit) submitModal(L); else document.getElementById('ledger-checks')?.focus(); });
    actions.unshift(b);
  }

  const stat = (label, value, unit) => h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value, unit ? h('small', {}, unit) : null));
  root.append(h('section', { class: 'card', 'aria-labelledby': 'ledger-title' },
    h('div', { class: 'card-head', style: { 'flex-wrap': 'wrap' } },
      h('h2', { class: 'card-title', id: 'ledger-title' }, `${L.vehicle.model} ${L.vehicle.plate_no} · ${monthLabel(ym)}`),
      badge('ledger', L.status),
      h('div', { class: 'row', style: { 'margin-left': 'auto' } }, actions)),
    h('div', { class: 'stack' },
      h('div', { class: 'stats' }, stat('운행 횟수', fmtNum(s.log_count), '회'), stat('총 운행거리', fmtNum(s.total_distance), 'km'),
        stat('주유량', Number(s.total_fuel_liters).toFixed(1), 'L'), stat('주유비', fmtNum(s.total_fuel_cost), '원')),
      h('p', { class: 'small muted num' }, `월초 계기판 ${fmtKm(s.odometer_first)} → 월말 계기판 ${fmtKm(s.odometer_last)}`),
      ['submitted', 'approved'].includes(L.status) ? h('p', { class: 'help' }, `결재요청 시점(${fmtDateTime(L.ledger.submitted_at)})의 합계입니다.`) : null,
      L.status === 'rejected' && L.last_rejection ? alertBox('error', `반려됨 — ${L.last_rejection.step_name} ${L.last_rejection.approver_name}`, `사유: ${L.last_rejection.comment}. 운행일지를 확인·수정한 뒤 다시 결재요청하세요.`) : null,
      L.ledger?.recall_reason && L.status === 'open' ? alertBox('warning', '회수된 대장입니다.', `사유: ${L.ledger.recall_reason}`) : null,
      stepsView(L),
      ['open', 'rejected'].includes(L.status) ? checksView(L, ym) : null,
      L.can_decide ? decidePanel(L) : null,
    )));

  root.append(h('div', { style: { height: '1rem' } }), card(`운행 내역 (${L.logs.length}건)`, L.logs.length ? logsTable(L.logs) : empty('이 달은 운행 기록이 없습니다.')));
}

function stepsView(L) {
  const curRound = L.approvals.filter((a) => a.round === L.round);
  return h('div', {}, h('h3', { class: 'small', style: { 'margin-bottom': '.5rem' } }, '결재 진행'),
    h('ol', { class: 'steps' }, L.approval_steps.map((st) => {
      const a = curRound.find((x) => x.step_order === st.order);
      const cls = a ? (a.decision === 'approved' ? 'done' : 'rejected') : (L.current_step === st.order ? 'current' : '');
      const text = a ? `${st.name} ${a.approver_name} · ${a.decision === 'approved' ? '결재' : '반려'} ${kst(a.decided_at).m}/${kst(a.decided_at).d}` : `${st.name}${L.current_step === st.order ? ' · 결재 차례' : ' · 대기'}`;
      return h('li', { class: `step ${cls}` }, h('span', { 'aria-hidden': 'true' }, a ? (a.decision === 'approved' ? '✓' : '↩') : '○'), text);
    })));
}

function checksView(L, ym) {
  const items = [];
  const drafts = L.blockers.find((b) => b.code === 'DRAFTS');
  const missing = L.blockers.find((b) => b.code === 'MISSING');
  items.push(drafts
    ? h('li', {}, h('span', { class: 'no' }, '✗'), h('span', {}, drafts.message, ' ', drafts.ids.map((id) => h('a', { href: `#/usage-logs/${id}`, style: { 'margin-right': '.5rem' } }, `#${id} 열기`))))
    : h('li', {}, h('span', { class: 'ok' }, '✓'), '작성중인 운행일지 없음'));
  items.push(missing
    ? h('li', {}, h('span', { class: 'no' }, '✗'), h('span', {}, missing.message, ' ', L.missing_reservations.map((r) => h('span', { class: 'small muted', style: { 'margin-right': '.5rem' } }, `(${kst(r.start_at).m}/${kst(r.start_at).d} ${r.user_name})`)), ' 대시보드에서 입력을 요청하거나 미사용 처리하세요.'))
    : h('li', {}, h('span', { class: 'ok' }, '✓'), '미입력 예약 없음'));
  items.push(L.mismatch_count
    ? h('li', {}, h('span', { class: 'ok' }, '!'), `계기판 불일치 ${L.mismatch_count}건 — 모두 사유가 입력되어 있습니다.`)
    : h('li', {}, h('span', { class: 'ok' }, '✓'), '계기판 연속성 이상 없음'));
  const future = L.blockers.find((b) => b.code === 'FUTURE');
  if (future) items.push(h('li', {}, h('span', { class: 'no' }, '✗'), future.message));
  if (!L.logs.length) items.push(h('li', {}, h('span', { class: 'ok' }, 'i'), '운행 기록이 없는 달입니다. (운행 없음 대장의 결재 필요 여부는 기관 확인 필요 — TODO-01)'));
  return h('div', { id: 'ledger-checks', tabindex: '-1' }, h('h3', { class: 'small', style: { 'margin-bottom': '.5rem' } }, '결재요청 점검'), h('ul', { class: 'checklist' }, items));
}

function decidePanel(L) {
  const sig = signaturePad({ name: 'signature', userName: state.user.name, label: '결재 서명' });
  const approve = h('button', { type: 'submit', class: 'btn btn-primary' }, '결재');
  const reject = h('button', { type: 'button', class: 'btn btn-danger' }, '반려');
  const form = h('form', { class: 'form card', style: { 'background': 'var(--color-gold-100)' }, novalidate: true },
    h('h3', { class: 'card-title' }, `${L.current_step_name} 결재`),
    formSummary(),
    field({ name: 'comment', label: '의견', type: 'textarea', help: '반려할 때는 사유를 5자 이상 입력해야 합니다.', attrs: { maxlength: 300 } }),
    sig.el,
    h('div', { class: 'form-actions' }, reject, approve));
  requestAnimationFrame(() => sig.init());
  const send = (decision, btn) => busy(btn, '처리 중…', async () => {
    const { comment } = formValues(form);
    const payload = { decision, comment };
    if (decision === 'rejected' && comment.trim().length < 5) return showErrors(form, { comment: '반려 사유를 5자 이상 입력해 주세요.' });
    if (decision === 'approved') {
      const s = sig.getValue();
      if (s.error) return showErrors(form, { signature: s.error }, '결재 서명이 필요합니다.');
      payload.signature = s;
    }
    try {
      await post(`/ledgers/${L.ledger.id}/decide`, payload);
      toast(decision === 'approved' ? '결재했습니다.' : '반려했습니다.');
      rerender();
    } catch (err) { showErrors(form, err.fields, err.message); }
    return null;
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); send('approved', approve); });
  reject.addEventListener('click', () => send('rejected', reject));
  return form;
}

function submitModal(L) {
  const btn = h('button', { type: 'submit', class: 'btn btn-primary', form: 'ledger-submit' }, '결재요청');
  const form = h('form', { class: 'form', id: 'ledger-submit', novalidate: true },
    formSummary(),
    h('p', {}, `${L.vehicle.model} ${L.vehicle.plate_no} ${monthLabel(L.year_month)} 대장(${L.summary.log_count}건, ${fmtKm(L.summary.total_distance)})의 결재를 요청합니다. 요청 후에는 이 달 운행일지를 수정할 수 없습니다.`),
    field({ name: 'comment', label: '담당자 의견', type: 'textarea', attrs: { maxlength: 300 } }));
  btn.setAttribute('form', 'ledger-submit');
  const m = openModal({ title: '결재요청', body: form, footer: [h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, '닫기'), btn] });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(btn, '요청 중…', async () => {
      try {
        await post('/ledgers/submit', { vehicle_id: L.vehicle.id, year_month: L.year_month, comment: formValues(form).comment });
        m.close(); toast('결재를 요청했습니다.'); rerender();
      } catch (err) { showErrors(form, err.fields, err.message); }
    });
  });
}

function recallModal(L) {
  const btn = h('button', { type: 'submit', class: 'btn btn-primary' }, '회수');
  btn.setAttribute('form', 'ledger-recall');
  const form = h('form', { class: 'form', id: 'ledger-recall', novalidate: true },
    formSummary(),
    h('p', {}, '결재 진행 중인 대장을 회수하면 작성중 상태로 돌아가고, 다시 결재요청해야 합니다.'),
    field({ name: 'reason', label: '회수 사유', type: 'textarea', required: true, attrs: { maxlength: 200 } }));
  const m = openModal({ title: '대장 회수', body: form, footer: [h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, '닫기'), btn] });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(btn, '처리 중…', async () => {
      try { await post(`/ledgers/${L.ledger.id}/recall`, formValues(form)); m.close(); toast('대장을 회수했습니다.'); rerender(); } catch (err) { showErrors(form, err.fields, err.message); }
    });
  });
}

function logsTable(logs) {
  return h('div', {},
    h('div', { class: 'only-desktop' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('caption', { class: 'sr-only' }, '월별 운행 내역'),
      h('thead', {}, h('tr', {}, ['일자', '운전자', '시각', '목적지', '목적', '출발', '도착', '거리', '주유', '상태'].map((t, i) => h('th', { scope: 'col', class: i >= 5 && i <= 8 ? 'right' : '' }, t)))),
      h('tbody', {}, logs.map((l) => h('tr', {},
        h('td', { class: 'num' }, h('a', { href: `#/usage-logs/${l.id}` }, `${Number(l.drive_date.slice(5, 7))}/${Number(l.drive_date.slice(8))}`)),
        h('td', {}, l.driver_name),
        h('td', { class: 'num' }, `${kst(l.depart_at).hm}~${kst(l.return_at).hm}`),
        h('td', {}, l.destination), h('td', {}, l.purpose_category),
        h('td', { class: 'num' }, fmtNum(l.odometer_start), l.mismatch ? h('span', { class: 'badge badge-warning', title: l.mismatch_reason }, '!') : null),
        h('td', { class: 'num' }, fmtNum(l.odometer_end)),
        h('td', { class: 'num' }, fmtKm(l.distance_km)),
        h('td', { class: 'num' }, l.fuel_liters ? `${fmtLiters(l.fuel_liters)} ${fmtWon(l.fuel_cost)}` : '-'),
        h('td', {}, badge('log', l.status)))))))),
    h('ul', { class: 'list only-mobile' }, logs.map((l) => h('li', {}, h('a', { class: 'list-item', href: `#/usage-logs/${l.id}` },
      h('span', { class: 'grow' }, h('span', { class: 'title num' }, `${Number(l.drive_date.slice(5, 7))}/${Number(l.drive_date.slice(8))} · ${fmtKm(l.distance_km)}`),
        h('span', { class: 'small muted' }, `${l.driver_name} · ${l.destination}${l.mismatch ? ' · 계기판 불일치' : ''}`)),
      badge('log', l.status))))));
}

export { signatureView };
