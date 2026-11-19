// 폼 도우미: 라벨·도움말·오류를 aria 로 연결 (UI_UX.md 6장)
import { h, $$ } from '../dom.js';

let uid = 0;
const nextId = (name) => `f-${name}-${++uid}`;

/**
 * field({ name, label, type, required, help, value, options, attrs })
 * type: text|number|date|time|select|textarea|password
 */
export function field({ name, label, type = 'text', required = false, help, value, options = [], attrs = {}, full = false, suffix }) {
  const id = nextId(name);
  const helpId = help ? `${id}-help` : null;
  const errId = `${id}-err`;
  let control;
  const common = { id, name, required, 'aria-describedby': helpId, ...attrs };
  if (type === 'select') {
    control = h('select', { class: 'select', ...common, value: value ?? '' },
      h('option', { value: '' }, '선택해 주세요'),
      options.map((o) => (typeof o === 'string' ? h('option', { value: o }, o) : h('option', { value: o.value }, o.label))));
  } else if (type === 'textarea') {
    control = h('textarea', { class: 'textarea', ...common }, value ?? '');
  } else {
    control = h('input', { class: 'input', type, ...common, value: value ?? '' });
  }
  return h('div', { class: `field${full ? ' full' : ''}`, dataset: { field: name } },
    h('label', { for: id }, label, required ? h('span', { class: 'req' }, '(필수)') : null),
    suffix ? h('div', { class: 'input-suffix' }, control, h('span', { class: 'muted' }, suffix)) : control,
    help ? h('p', { class: 'help', id: helpId }, help) : null,
    h('p', { class: 'field-error', id: errId, hidden: true }),
  );
}

export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi) { out[el.name] ??= []; if (el.checked) out[el.name].push(el.value); } else out[el.name] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; } else out[el.name] = el.value;
  }
  return out;
}

/** 필드별 오류 표시 + 상단 요약 + 첫 오류로 포커스 */
export function showErrors(form, fields = {}, message) {
  clearErrors(form);
  const entries = Object.entries(fields || {});
  let firstControl = null;
  for (const [name, msg] of entries) {
    const wrap = form.querySelector(`[data-field="${CSS.escape(name)}"]`);
    if (!wrap) continue;
    const err = wrap.querySelector('.field-error');
    const control = wrap.querySelector('input, select, textarea, canvas');
    err.textContent = msg;
    err.hidden = false;
    if (control) {
      control.setAttribute('aria-invalid', 'true');
      const ids = new Set((control.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
      ids.add(err.id);
      control.setAttribute('aria-describedby', [...ids].join(' '));
      firstControl ??= control;
    }
  }
  const summary = form.querySelector('.form-summary');
  if (summary && (message || entries.length)) {
    summary.hidden = false;
    summary.replaceChildren(
      h('span', { class: 'alert-icon', 'aria-hidden': 'true' }, '⚠'),
      h('div', { class: 'alert-body' },
        h('strong', {}, message || '입력값을 확인해 주세요.'),
        entries.length > 1 ? h('ul', {}, entries.map(([, m]) => h('li', {}, m))) : null),
    );
  }
  if (firstControl) firstControl.focus();
  else if (summary && !summary.hidden) { summary.setAttribute('tabindex', '-1'); summary.focus(); }
}

export function clearErrors(form) {
  for (const err of $$('.field-error', form)) { err.hidden = true; err.textContent = ''; }
  for (const c of $$('[aria-invalid]', form)) c.removeAttribute('aria-invalid');
  const summary = form.querySelector('.form-summary');
  if (summary) { summary.hidden = true; summary.replaceChildren(); }
}

export const formSummary = () => h('div', { class: 'alert alert-error form-summary', role: 'alert', hidden: true });

/** 제출 버튼 처리 중 상태 (중복 제출 방지) */
export async function busy(button, text, fn) {
  const original = [...button.childNodes];
  button.disabled = true;
  button.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
  try { return await fn(); } finally { button.disabled = false; button.replaceChildren(...original); }
}

export function checkboxGroup({ name, label, options, values = [], required = false, help }) {
  const id = nextId(name);
  return h('fieldset', { class: 'field', dataset: { field: name } },
    h('legend', {}, label, required ? h('span', { class: 'req' }, '(필수)') : null),
    h('div', { class: 'checks' }, options.map(([value, text]) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', name, value, checked: values.includes(value), dataset: { multi: '1' } }), text))),
    help ? h('p', { class: 'help', id: `${id}-help` }, help) : null,
    h('p', { class: 'field-error', id: `${id}-err`, hidden: true }));
}
