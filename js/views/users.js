// F-09 사용자(직원) 관리 — 관리자 전용
import { h, clear, icon } from '../dom.js';
import { get, post, patch, qs } from '../api.js';
import { state } from '../state.js';
import { badge } from '../components/badges.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { field, formValues, showErrors, formSummary, busy, checkboxGroup } from '../components/form.js';
import { toast } from '../components/toast.js';
import { ROLES, validateUser, hasErrors } from '../utils/validate.js';
import { pageHead, card, empty, alertBox } from './common.js';

const filters = { q: '', active: 'active' };

export async function render(root) {
  const add = h('button', { type: 'button', class: 'btn btn-primary' }, icon('plus'), '사용자 등록');
  add.addEventListener('click', () => userForm(null, load));
  root.append(pageHead('사용자 관리', { desc: '직원 계정을 관리합니다. 퇴사·휴직 시 삭제하지 않고 "사용 중지"로 바꿉니다.', actions: [add] }));
  const q = h('input', { class: 'input', type: 'search', placeholder: '이름·아이디·팀', 'aria-label': '사용자 검색', value: filters.q });
  const act = h('select', { class: 'select', 'aria-label': '사용 여부' },
    h('option', { value: 'active' }, '사용 중'), h('option', { value: 'inactive' }, '사용 중지'), h('option', { value: 'all' }, '전체'));
  act.value = filters.active;
  const search = h('form', { class: 'toolbar', role: 'search' }, h('div', { class: 'grow' }, q), act, h('button', { type: 'submit', class: 'btn' }, '검색'));
  search.addEventListener('submit', (e) => { e.preventDefault(); filters.q = q.value; filters.active = act.value; load(); });
  act.addEventListener('change', () => { filters.active = act.value; load(); });
  const list = h('div', { 'aria-live': 'polite' });
  root.append(search, list);

  async function load() {
    let data;
    try { data = await get(`/users${qs(filters)}`); } catch (err) { clear(list).append(alertBox('error', '사용자 목록을 불러오지 못했습니다.', err.message)); return; }
    clear(list);
    if (!data.users.length) { list.append(card(null, empty('검색 결과가 없습니다. 검색어를 바꾸거나 필터를 해제해 보세요.'))); return; }
    list.append(h('ul', { class: 'list grid grid-2' }, data.users.map((u) => {
      const b = h('button', { type: 'button', class: 'list-item', style: u.is_active ? {} : { opacity: '.65' } },
        h('span', { class: 'grow' }, h('span', { class: 'title' }, `${u.name} (${u.login_id})`),
          h('span', { class: 'small muted' }, `${u.team || '팀 미지정'} · ${u.roles.map((r) => ROLES[r]).join(', ')}${u.approver_step ? ` · 결재 ${u.approver_step}단계` : ''}`)),
        u.is_active ? null : h('span', { class: 'badge badge-outline' }, '사용 중지'));
      b.addEventListener('click', () => userForm(u, load));
      return h('li', {}, b);
    })));
  }
  await load();
}

function userForm(u, onSaved) {
  const isEdit = !!u;
  const steps = state.settings.approval_steps;
  const teams = state.settings.teams || [];
  const form = h('form', { class: 'form', id: 'user-form', novalidate: true },
    formSummary(),
    h('div', { class: 'form-grid cols-2' },
      isEdit
        ? h('div', { class: 'field' }, h('span', { class: 'label' }, '아이디'), h('p', {}, u.login_id), h('p', { class: 'help' }, '아이디는 바꿀 수 없습니다.'))
        : field({ name: 'login_id', label: '아이디', required: true, help: '영문 소문자·숫자 4~20자', attrs: { autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false' } }),
      field({ name: 'name', label: '이름', required: true, value: u?.name, attrs: { maxlength: 20 } }),
      teams.length
        ? field({ name: 'team', label: '소속 팀', type: 'select', value: u?.team, options: teams })
        : field({ name: 'team', label: '소속 팀', value: u?.team, help: '팀 목록은 기관 확인 후 설정합니다.', attrs: { maxlength: 30 } }),
      field({ name: 'phone_ext', label: '내선번호', value: u?.phone_ext, help: '숫자 2~6자리. 개인 휴대폰 번호는 받지 않습니다.', attrs: { inputmode: 'numeric', maxlength: 6 } }),
      h('div', { class: 'full' }, checkboxGroup({ name: 'roles', label: '역할', required: true, options: Object.entries(ROLES), values: u?.roles || ['staff'] })),
      field({ name: 'approver_step', label: '담당 결재 단계', type: 'select', value: u?.approver_step ? String(u.approver_step) : '',
        options: steps.map((s) => ({ value: String(s.order), label: `${s.order}단계: ${s.name}` })), help: '결재자 역할일 때만 사용합니다. (결재선은 기관 확인 필요 — TODO-03)' }),
      h('div', { class: 'field' }, h('span', { class: 'label' }, '운전·사용'),
        h('div', { class: 'checks' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'can_drive', checked: u ? u.can_drive : true }), '운전 가능'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'is_active', checked: u ? u.is_active : true }), '사용 중'))),
    ));
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, '저장');
  save.setAttribute('form', 'user-form');
  const footer = [h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, '닫기'), save];
  if (isEdit) {
    const reset = h('button', { type: 'button', class: 'btn btn-danger' }, '비밀번호 초기화');
    reset.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: '비밀번호 초기화', message: `${u.name}님의 비밀번호를 임시 비밀번호로 바꿉니다. 로그인 중인 기기에서는 모두 로그아웃됩니다.`, confirmText: '초기화', danger: true }))) return;
      try { const r = await post(`/users/${u.id}/reset-password`); tempPasswordModal(u.name, r.temp_password); } catch (err) { toast(err.message); }
    });
    footer.unshift(reset);
  }
  const m = openModal({ title: isEdit ? '사용자 정보 수정' : '사용자 등록', body: form, footer });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = formValues(form);
    const { errors } = validateUser(values, { isCreate: !isEdit });
    if (hasErrors(errors)) return showErrors(form, errors);
    busy(save, '저장 중…', async () => {
      try {
        const res = isEdit ? await patch(`/users/${u.id}`, values) : await post('/users', values);
        m.close();
        toast(isEdit ? '사용자 정보를 저장했습니다.' : '사용자를 등록했습니다.');
        onSaved();
        if (res.temp_password) tempPasswordModal(res.user.name, res.temp_password);
      } catch (err) { showErrors(form, err.fields, err.message); }
    });
  });
}

function tempPasswordModal(name, pw) {
  openModal({
    title: '임시 비밀번호',
    body: [h('p', {}, `${name}님의 임시 비밀번호입니다. 이 화면을 닫으면 다시 볼 수 없습니다. 본인에게 직접 전달하고, 메신저 단체방 등에 올리지 마세요.`),
      h('p', { class: 'stat-value num', style: { 'letter-spacing': '.1em', 'user-select': 'all' } }, pw),
      h('p', { class: 'help' }, '첫 로그인 때 새 비밀번호로 바꾸도록 안내됩니다.')],
  });
}
