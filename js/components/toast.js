import { h } from '../dom.js';

export function toast(message) {
  const region = document.getElementById('toasts');
  const el = h('div', { class: 'toast' }, message);
  region.append(el);
  setTimeout(() => el.remove(), 5000);
}
