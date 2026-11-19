// F-10 월별 차량대장 A4 출력 (브라우저 인쇄 → PDF 저장)
// 서식 항목·칸 순서·결재란 모양은 TODO-01(기관 고유 서식) 확정 후 맞춘다.
import { h } from '../dom.js';
import { get, qs } from '../api.js';
import { state } from '../state.js';
import { monthLabel, fmtNum, fmtKm, kst, fmtDateTime, lastDayOfMonth } from '../utils/format.js';
import { YM_RE } from '../utils/validate.js';
import { alertBox } from './common.js';

export async function render(root, { query }) {
  const ym = query.get('ym');
  const vehicleId = Number(query.get('vehicle_id') || 0);
  if (!YM_RE.test(ym || '') || !vehicleId) { root.append(alertBox('error', '출력할 대장을 선택해 주세요.')); return; }
  const L = await get(`/ledgers${qs({ ym, vehicle_id: vehicleId, print: 1 })}`);
  const rows = L.logs.filter((l) => l.status !== 'draft');
  const s = L.summary;
  const curRound = L.approvals.filter((a) => a.round === L.round && a.decision === 'approved');

  const printBtn = h('button', { type: 'button', class: 'btn btn-primary' }, '인쇄 / PDF 저장');
  printBtn.addEventListener('click', () => window.print());
  const sigCell = (signature, type) => (signature
    ? (type === 'image' ? h('img', { class: 'doc-sig', src: signature, alt: '서명' }) : h('span', { class: 'doc-sig-typed' }, signature))
    : '');

  root.append(
    h('div', { class: 'print-bar no-print' },
      h('span', { class: 'note' }, 'PC의 Chrome·Edge에서 "PDF로 저장"을 선택하면 파일로 보관할 수 있습니다. 용지: A4 가로'),
      h('a', { class: 'btn', href: `#/ledgers${qs({ ym, vehicle_id: vehicleId })}` }, '닫기'), printBtn),
    h('article', { class: 'paper', 'aria-label': '월별 차량대장 인쇄 미리보기' },
      h('h1', { class: 'doc-title' }, '차량운행대장'),
      h('div', { class: 'doc-meta' },
        h('div', {},
          h('div', {}, `기관명: 서구종합사회복지관`),
          h('div', {}, `차량: ${L.vehicle.model} (${L.vehicle.plate_no}) · ${L.vehicle.fuel_type}`),
          h('div', {}, `기간: ${monthLabel(ym)} (${ym}-01 ~ ${ym}-${lastDayOfMonth(ym)})`),
          L.status !== 'approved' ? h('div', { style: { 'margin-top': '4px' } }, h('span', { class: 'watermark' }, '결재 전(초안)')) : null),
        h('table', { class: 'approval-box', 'aria-label': '결재란' },
          h('tr', {}, h('th', { rowspan: 2, scope: 'row' }, '결', h('br'), '재'), L.approval_steps.map((st) => h('th', { scope: 'col' }, st.name))),
          h('tr', {}, L.approval_steps.map((st) => {
            const a = curRound.find((x) => x.step_order === st.order);
            return h('td', {}, a ? [sigCell(a.signature, a.signature_type), h('span', { class: 'when' }, `${a.approver_name} ${kst(a.decided_at).m}/${kst(a.decided_at).d}`)] : '');
          })))),
      h('table', { class: 'doc-table' },
        h('thead', {}, h('tr', {}, ['번호', '일자', '운전자', '출발', '도착', '목적지', '운행 목적', '인원', '출발 km', '도착 km', '거리(km)', '주유(L)', '주유비(원)', '비고', '확인'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows.length
          ? rows.map((l, i) => h('tr', {},
            h('td', {}, String(i + 1)),
            h('td', {}, `${Number(l.drive_date.slice(5, 7))}/${Number(l.drive_date.slice(8))}`),
            h('td', {}, l.driver_name),
            h('td', {}, kst(l.depart_at).hm), h('td', {}, kst(l.return_at).hm),
            h('td', { class: 'l' }, l.destination), h('td', { class: 'l' }, l.purpose_category),
            h('td', {}, String(l.passenger_count)),
            h('td', { class: 'r' }, fmtNum(l.odometer_start)), h('td', { class: 'r' }, fmtNum(l.odometer_end)),
            h('td', { class: 'r' }, fmtNum(l.distance_km)),
            h('td', { class: 'r' }, l.fuel_liters ? Number(l.fuel_liters).toFixed(1) : ''),
            h('td', { class: 'r' }, l.fuel_cost ? fmtNum(l.fuel_cost) : ''),
            h('td', { class: 'l' }, [l.mismatch ? `계기판 불일치: ${l.mismatch_reason}` : '', l.note].filter(Boolean).join(' / ')),
            h('td', {}, sigCell(l.driver_signature, l.signature_type))))
          : h('tr', {}, h('td', { colspan: 15 }, '운행 기록 없음'))),
        h('tfoot', {}, h('tr', {},
          h('td', { colspan: 8 }, `합계 (${s.log_count}회)`),
          h('td', { class: 'r' }, fmtNum(s.odometer_first)), h('td', { class: 'r' }, fmtNum(s.odometer_last)),
          h('td', { class: 'r' }, fmtNum(s.total_distance)),
          h('td', { class: 'r' }, Number(s.total_fuel_liters).toFixed(1)), h('td', { class: 'r' }, fmtNum(s.total_fuel_cost)),
          h('td', { colspan: 2 }, '')))),
      L.ledger?.manager_comment ? h('p', { style: { 'margin-top': '8px', 'font-size': '9pt' } }, `담당자 의견: ${L.ledger.manager_comment}`) : null,
      h('div', { class: 'doc-foot' }, h('span', {}, `출력: ${fmtDateTime(new Date())} · ${state.user.name}`), h('span', {}, `총 운행거리 ${fmtKm(s.total_distance)}`))));
}
