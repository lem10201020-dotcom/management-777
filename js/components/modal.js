// 모달/하단 시트: 네이티브 <dialog> (포커스 가두기·Esc 닫기), 닫으면 연 버튼으로 포커스 복귀
import { h, icon } from '../dom.js';

let seq = 0;
export function openModal({ title, body, footer, onClose, wide = false }) {
  const opener = document.activeElement;
  const id = `modal-title-${++seq}`;
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기' }, icon('close'));
  const dlg = h('dialog', { class: 'modal', 'aria-labelledby': id, ...(wide ? { style: { width: 'min(96vw, 56rem)' } } : {}) },
    h('div', { class: 'modal-inner' },
      h('div', { class: 'modal-head' }, h('h2', { id }, title), closeBtn),
      h('div', { class: 'modal-body' }, body),
      footer ? h('div', { class: 'modal-foot' }, footer) : null,
    ));
  const close = (result) => { if (dlg.open) dlg.close(result); };
  closeBtn.addEventListener('click', () => close());
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.(dlg.returnValue);
    if (opener && document.contains(opener)) opener.focus();
  });
  document.body.append(dlg);
  dlg.showModal();
  const first = dlg.querySelector('.modal-body input:not([type=hidden]):not([readonly]), .modal-body select, .modal-body textarea');
  (first || closeBtn).focus();
  return { dialog: dlg, close };
}

/** 확인 대화상자 → Promise<boolean> */
export function confirmDialog({ title, message, confirmText = '확인', danger = false }) {
  return new Promise((resolve) => {
    let ok = false;
    const yes = h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, confirmText);
    const no = h('button', { type: 'button', class: 'btn' }, '닫기');
    const m = openModal({ title, body: h('p', {}, message), footer: [no, yes], onClose: () => resolve(ok) });
    yes.addEventListener('click', () => { ok = true; m.close(); });
    no.addEventListener('click', () => m.close());
    yes.focus();
  });
}
