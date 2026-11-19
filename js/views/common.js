// 화면 공통 조각
import { h, icon } from '../dom.js';

export function pageHead(title, { desc, actions = [] } = {}) {
  return h('div', { class: 'page-head' },
    h('h1', { class: 'page-title' }, title),
    actions.length ? h('div', { class: 'actions' }, actions) : null,
    desc ? h('p', { class: 'page-desc' }, desc) : null);
}

export function card(title, body, { link, cls = '', titleTag = 'h2' } = {}) {
  return h('section', { class: `card ${cls}` },
    title ? h('div', { class: 'card-head' }, h(titleTag, { class: 'card-title' }, title), link || null) : null,
    body);
}

export function empty(message, action) {
  return h('div', { class: 'empty' }, icon('empty'), h('p', {}, message), action || null);
}

export function alertBox(kind, title, body) {
  const sym = { error: '⚠', warning: '!', info: 'i', success: '✓' }[kind];
  return h('div', { class: `alert alert-${kind}`, role: kind === 'error' ? 'alert' : null },
    h('span', { class: 'alert-icon', 'aria-hidden': 'true' }, sym),
    h('div', { class: 'alert-body' }, title ? h('strong', {}, title) : null, body || null));
}

/** 카드 단위 오류: 한 카드가 실패해도 나머지는 표시 (F-02) */
export async function safeSection(fn, label) {
  try { return await fn(); } catch (err) {
    return alertBox('error', `${label}을(를) 불러오지 못했습니다.`, err.message);
  }
}

export const plusIcon = () => icon('plus');
