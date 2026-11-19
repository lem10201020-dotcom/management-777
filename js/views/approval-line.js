// F-14 결재라인 설정 — 단계 추가·이름 변경·순서 변경·삭제, 단계별 결재자 지정, 결재란 미리보기
import { h, clear, icon } from '../dom.js';
import { get, api } from '../api.js';
import { state, hasRole } from '../state.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';
import { showErrors, clearErrors, formSummary, busy } from '../components/form.js';
import { validateApprovalLine, hasErrors, APPROVAL_MAX_STEPS } from '../utils/validate.js';
import { pageHead, card, alertBox } from './common.js';

export async function render(root) {
  const data = await get('/approval-line');
  const canEdit = hasRole('admin');
  root.append(pageHead('결재라인 설정', {
    desc: '월별 차량대장의 결재 단계와 단계별 결재자를 정합니다. 출력물의 결재란도 이 순서대로 만들어집니다. (실제 결재선은 기관 확인 필요 — TODO-03)',
  }));
  if (!canEdit) {
    root.append(alertBox('info', '결재라인은 관리자만 바꿀 수 있습니다.'), h('div', { style: { height: '1rem' } }),
      card('현재 결재라인', h('ol', { class: 'steps' }, data.steps.map((st) => h('li', { class: 'step' },
        `${st.order}. ${st.name} — ${st.approvers.map((a) => a.name).join(', ') || '결재자 없음'}`)))));
    return;
  }

  // 편집 상태
  const steps = data.steps.map((st) => ({ name: st.name, approver_ids: st.approvers.map((a) => a.id) }));
  let showDrafter = data.show_drafter !== false;
  const people = new Map(data.candidates.map((u) => [u.id, u]));
  const locked = data.in_progress > 0;

  const form = h('form', { class: 'form', novalidate: true });
  const list = h('div', { class: 'stack' });
  const preview = h('div', { class: 'table-wrap approval-preview', style: { padding: '1rem 0', border: 0 } });
  const addBtn = h('button', { type: 'button', class: 'btn' }, icon('plus'), '결재 단계 추가');
  const drafter = h('input', { type: 'checkbox', checked: showDrafter });
  const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary', disabled: locked }, '결재라인 저장');
  const resetBtn = h('button', { type: 'button', class: 'btn btn-text' }, '변경 취소');

  if (locked) {
    root.append(alertBox('warning', `결재 진행 중인 대장이 ${data.in_progress}건 있어 지금은 결재라인을 저장할 수 없습니다.`,
      '진행 중인 결재를 마치거나 월별 차량대장에서 회수한 뒤 다시 시도하세요.'), h('div', { style: { height: '1rem' } }));
  }
  form.append(formSummary(), list,
    h('div', { class: 'row' }, addBtn, h('span', { class: 'help' }, `최대 ${APPROVAL_MAX_STEPS}단계. 한 사람은 한 단계에만 지정할 수 있습니다. 결재라인에서 빠진 사람은 결재자 역할이 해제됩니다.`)),
    h('label', { class: 'check', style: { 'justify-self': 'start' } }, drafter, '결재란 맨 앞에 "담당"(결재요청한 차량담당자) 칸 표시'),
    h('div', { class: 'form-actions sticky' }, resetBtn, saveBtn));

  root.append(h('div', { class: 'grid grid-12' },
    h('section', { class: 'card span-7' }, h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, '결재 단계')), form),
    h('section', { class: 'card span-5', 'aria-labelledby': 'al-preview' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'al-preview' }, '출력 결재란 미리보기')),
      preview,
      h('p', { class: 'help' }, '저장한 뒤 새로 결재요청하는 대장부터 적용됩니다. 이미 결재요청·결재완료된 대장은 그때의 결재라인이 그대로 유지됩니다.'))));

  const assigned = (exceptIndex) => new Set(steps.flatMap((st, i) => (i === exceptIndex ? [] : st.approver_ids)));

  function draw(focusSel) {
    clear(list);
    steps.forEach((st, i) => {
      const nameId = `al-name-${i}`;
      const nameInput = h('input', { class: 'input', id: nameId, value: st.name, maxlength: 10, required: true, 'aria-describedby': `al-name-${i}-err` });
      nameInput.addEventListener('input', () => { st.name = nameInput.value; drawPreview(); });
      const taken = assigned(i);
      const options = data.candidates.filter((u) => !st.approver_ids.includes(u.id) && !taken.has(u.id));
      const pick = h('select', { class: 'select', id: `al-pick-${i}`, 'aria-label': `${i + 1}단계 결재자 선택` },
        h('option', { value: '' }, options.length ? '직원 선택' : '추가할 수 있는 직원이 없습니다'),
        options.map((u) => h('option', { value: String(u.id) }, `${u.name}${u.team ? ` (${u.team})` : ''}`)));
      const add = h('button', { type: 'button', class: 'btn btn-sm', id: `al-add-${i}` }, '추가');
      add.addEventListener('click', () => {
        if (!pick.value) { pick.focus(); return; }
        st.approver_ids.push(Number(pick.value));
        draw(`#al-pick-${i}`);
      });
      const chips = st.approver_ids.map((id) => {
        const u = people.get(id);
        const rm = h('button', { type: 'button', class: 'btn btn-sm btn-text', 'aria-label': `${u?.name || id} 결재자에서 빼기` }, '✕');
        rm.addEventListener('click', () => { st.approver_ids = st.approver_ids.filter((x) => x !== id); draw(`#al-pick-${i}`); });
        return h('span', { class: 'chip', style: { cursor: 'default' } }, u ? u.name : `#${id}`, rm);
      });
      const up = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${i + 1}단계를 위로`, disabled: i === 0, id: `al-up-${i}` }, '▲');
      const down = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${i + 1}단계를 아래로`, disabled: i === steps.length - 1, id: `al-down-${i}` }, '▼');
      const del = h('button', { type: 'button', class: 'btn btn-sm btn-danger', disabled: steps.length === 1 }, '삭제');
      up.addEventListener('click', () => { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; draw(`#al-up-${i - 1}`); });
      down.addEventListener('click', () => { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; draw(`#al-down-${i + 1}`); });
      del.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: '결재 단계 삭제', message: `${i + 1}단계 "${st.name || '이름 없음'}"을(를) 삭제할까요? 저장해야 반영됩니다.`, confirmText: '삭제', danger: true }))) return;
        steps.splice(i, 1);
        draw('#al-add-step');
      });
      list.append(h('fieldset', { class: 'card', style: { 'box-shadow': 'none', padding: '1rem' } },
        h('legend', { class: 'sr-only' }, `${i + 1}단계`),
        h('div', { class: 'row', style: { 'margin-bottom': '.75rem' } },
          h('span', { class: 'badge badge-gold' }, `${i + 1}단계`), h('span', { style: { 'margin-left': 'auto' } }), up, down, del),
        h('div', { class: 'form-grid cols-2' },
          h('div', { class: 'field', dataset: { field: `step_${i}_name` } },
            h('label', { for: nameId }, '단계 이름', h('span', { class: 'req' }, '(필수)')), nameInput,
            h('p', { class: 'help' }, '예: 팀장, 사무국장, 관장 (10자 이내)'),
            h('p', { class: 'field-error', id: `al-name-${i}-err`, hidden: true })),
          h('div', { class: 'field', dataset: { field: `step_${i}_approvers` } },
            h('label', { for: `al-pick-${i}` }, '결재자', h('span', { class: 'req' }, '(필수)')),
            h('div', { class: 'row' }, h('div', { style: { flex: 1, 'min-width': '9rem' } }, pick), add),
            chips.length ? h('div', { class: 'row', 'aria-label': `${i + 1}단계 결재자` }, chips) : h('p', { class: 'help' }, '아직 지정된 결재자가 없습니다.'),
            h('p', { class: 'help' }, '여러 명을 지정하면 그중 한 명이 결재하면 됩니다(대결).'),
            h('p', { class: 'field-error', id: `al-pick-${i}-err`, hidden: true })))));
    });
    addBtn.id = 'al-add-step';
    addBtn.disabled = steps.length >= APPROVAL_MAX_STEPS;
    drawPreview();
    if (focusSel) form.querySelector(focusSel)?.focus();
  }

  function drawPreview() {
    const cols = [...(showDrafter ? ['담당'] : []), ...steps.map((st) => st.name || '(이름 없음)')];
    clear(preview).append(h('table', { class: 'approval-box', 'aria-label': '결재란 미리보기' },
      h('tr', {}, h('th', { rowspan: 2, scope: 'row' }, '결', h('br'), '재'), cols.map((c) => h('th', { scope: 'col' }, c))),
      h('tr', {}, cols.map(() => h('td', {}, '')))));
  }

  addBtn.addEventListener('click', () => {
    steps.push({ name: '', approver_ids: [] });
    draw(`#al-name-${steps.length - 1}`);
  });
  drafter.addEventListener('change', () => { showDrafter = drafter.checked; drawPreview(); });
  resetBtn.addEventListener('click', () => { location.reload(); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearErrors(form);
    const payload = { steps: steps.map((st) => ({ name: st.name, approver_ids: st.approver_ids })), show_drafter: showDrafter };
    const { errors } = validateApprovalLine(payload);
    if (hasErrors(errors)) return showErrors(form, errors, errors.steps);
    busy(saveBtn, '저장 중…', async () => {
      try {
        const saved = await api('PUT', '/approval-line', payload);
        state.settings.approval_steps = saved.steps.map(({ order, name }) => ({ order, name }));
        state.settings.approval_show_drafter = saved.show_drafter;
        // 내 결재자 지정이 바뀌었을 수 있으므로 로그인 정보 갱신
        const me = await get('/auth/me');
        if (me.user) Object.assign(state.user, me.user);
        toast('결재라인을 저장했습니다.');
      } catch (err) { showErrors(form, err.fields, err.message); }
    });
  });

  draw();
}
