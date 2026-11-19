// F-10 월별 차량대장 A4 출력 (브라우저 인쇄 → PDF 저장)
// - vehicle_id=all 이면 그달 모든 차량 대장을 차량마다 한 쪽씩 출력
// - 결재란은 결재라인(F-14)대로: [담당] + 단계들. 결재요청 이후에는 요청 시점 결재라인을 사용
// 서식 항목·칸 순서·결재란 모양은 TODO-01(기관 고유 서식) 확정 후 맞춘다.
import { h } from '../dom.js';
import { get, qs } from '../api.js';
import { state } from '../state.js';
import { monthLabel, fmtNum, fmtKm, kst, fmtDateTime, lastDayOfMonth } from '../utils/format.js';
import { YM_RE } from '../utils/validate.js';
import { alertBox } from './common.js';

export async function render(root, { query }) {
  const ym = query.get('ym');
  const vehicleParam = query.get('vehicle_id') || '';
  const all = vehicleParam === 'all';
  if (!YM_RE.test(ym || '') || (!all && !Number(vehicleParam))) { root.append(alertBox('error', '출력할 대장을 선택해 주세요.')); return; }

  let ledgers;
  if (all) {
    const { vehicles } = await get(`/ledgers/overview${qs({ ym })}`);
    ledgers = await Promise.all(vehicles.map((v) => get(`/ledgers${qs({ ym, vehicle_id: v.vehicle_id, print: 1 })}`)));
  } else {
    ledgers = [await get(`/ledgers${qs({ ym, vehicle_id: vehicleParam, print: 1 })}`)];
  }

  const printBtn = h('button', { type: 'button', class: 'btn btn-primary' }, '인쇄 / PDF 저장');
  printBtn.addEventListener('click', () => window.print());
  const back = h('a', { class: 'btn', href: `#/ledgers${qs({ ym, vehicle_id: all ? '' : vehicleParam })}` }, '닫기');
  const notApproved = ledgers.filter((L) => L.status !== 'approved').length;
  root.append(
    h('h1', { class: 'sr-only' }, `${monthLabel(ym)} 차량운행대장 인쇄`),
    h('div', { class: 'print-bar no-print' },
      h('span', { class: 'note' }, `${all ? `차량 ${ledgers.length}대 · 차량마다 한 쪽씩 · ` : ''}A4 가로. PC의 Chrome·Edge에서 "PDF로 저장"을 선택하면 파일로 보관할 수 있습니다.${notApproved ? ` 결재 전 대장 ${notApproved}건은 "결재 전(초안)"으로 표시됩니다.` : ''}`),
      back, printBtn),
    ...(ledgers.length ? ledgers.map((L) => paper(L, ym)) : [alertBox('info', '출력할 차량이 없습니다.')]));
}

function sigCell(signature, type) {
  if (!signature) return '';
  return type === 'image' ? h('img', { class: 'doc-sig', src: signature, alt: '서명' }) : h('span', { class: 'doc-sig-typed' }, signature);
}

/** 결재란: [담당] + 결재라인 단계 */
function approvalBox(L) {
  const curRound = L.approvals.filter((a) => a.round === L.round && a.decision === 'approved');
  const showDrafter = L.show_drafter !== false;
  const submitted = ['submitted', 'approved'].includes(L.status) && L.ledger?.submitted_at;
  const heads = [...(showDrafter ? ['담당'] : []), ...L.approval_steps.map((st) => st.name)];
  const cells = [];
  if (showDrafter) {
    cells.push(h('td', {}, submitted
      ? [h('span', { class: 'doc-sig-typed' }, L.ledger.submitted_by_name || ''), h('span', { class: 'when' }, `${kst(L.ledger.submitted_at).m}/${kst(L.ledger.submitted_at).d}`)]
      : ''));
  }
  for (const st of L.approval_steps) {
    const a = curRound.find((x) => x.step_order === st.order);
    cells.push(h('td', {}, a ? [sigCell(a.signature, a.signature_type), h('span', { class: 'when' }, `${a.approver_name} ${kst(a.decided_at).m}/${kst(a.decided_at).d}`)] : ''));
  }
  return h('table', { class: 'approval-box', 'aria-label': '결재란' },
    h('tr', {}, h('th', { rowspan: 2, scope: 'row', class: 'approval-label' }, '결', h('br'), '재'), heads.map((t) => h('th', { scope: 'col' }, t))),
    h('tr', {}, cells));
}

function paper(L, ym) {
  const rows = L.logs.filter((l) => l.status !== 'draft');
  const s = L.summary;
  return h('article', { class: 'paper', 'aria-label': `${L.vehicle.model} ${L.vehicle.plate_no} 월별 차량대장` },
    h('div', { class: 'doc-head' },
      h('h2', { class: 'doc-title' }, '차량운행대장'),
      approvalBox(L)),
    h('div', { class: 'doc-meta' },
      h('div', {},
        h('div', {}, '기관명: 서구종합사회복지관'),
        h('div', {}, `차량: ${L.vehicle.model} (${L.vehicle.plate_no}) · ${L.vehicle.fuel_type}`),
        h('div', {}, `기간: ${monthLabel(ym)} (${ym}-01 ~ ${ym}-${lastDayOfMonth(ym)})`)),
      L.status !== 'approved' ? h('span', { class: 'watermark' }, '결재 전(초안)') : null),
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
    L.ledger?.manager_comment ? h('p', { class: 'doc-note' }, `담당자 의견: ${L.ledger.manager_comment}`) : null,
    h('div', { class: 'doc-foot' }, h('span', {}, `출력: ${fmtDateTime(new Date())} · ${state.user.name}`), h('span', {}, `총 운행거리 ${fmtKm(s.total_distance)}`)));
}
