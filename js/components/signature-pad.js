// 서명 입력 (FEATURES.md F-07): 마우스·터치·펜(Pointer Events) + 키보드용 대체 서명
import { h } from '../dom.js';

const MAX_DATA_URL = 66000; // 약 50KB PNG

export function signaturePad({ name = 'signature', userName, label = '서명' }) {
  let mode = 'draw';
  const strokes = []; // 정규화 좌표(0~1) 배열 — 화면 회전·크기 변경 시 다시 그림
  let current = null;

  const canvas = h('canvas', { class: 'sig-canvas', role: 'img', 'aria-label': '서명 입력 영역. 손가락이나 마우스로 서명하세요. 키보드 사용자는 대체 서명을 사용하세요.' });
  const placeholder = h('div', { class: 'sig-placeholder', 'aria-hidden': 'true' }, '여기에 서명하세요');
  const clearBtn = h('button', { type: 'button', class: 'btn btn-sm' }, '지우기');
  const typedName = h('input', { class: 'input', type: 'text', autocomplete: 'off', id: `${name}-typed-name`, placeholder: userName });
  const typedPw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', id: `${name}-typed-pw` });
  const toggleBtn = h('button', { type: 'button', class: 'btn btn-sm btn-text' });
  const errorEl = h('p', { class: 'field-error', id: `${name}-err`, hidden: true });

  const drawArea = h('div', { class: 'sig' },
    h('div', { class: 'sig-canvas-wrap' }, canvas, placeholder),
    h('div', { class: 'row' }, clearBtn, h('span', { class: 'help' }, '서명 중에는 화면이 움직이지 않습니다.')));
  const typedArea = h('div', { class: 'form-grid cols-2', hidden: true },
    h('div', { class: 'field' }, h('label', { for: typedName.id }, `본인 이름 (${userName})`), typedName),
    h('div', { class: 'field' }, h('label', { for: typedPw.id }, '비밀번호 재확인'), typedPw),
    h('p', { class: 'help full' }, '"전자 확인: 이름 (일시)" 형식으로 기록되며 출력물에 그대로 표시됩니다.'));

  const el = h('div', { class: 'field', dataset: { field: name } },
    h('div', { class: 'row' }, h('span', { class: 'label' }, label, h('span', { class: 'req' }, '(필수)')), toggleBtn),
    drawArea, typedArea, errorEl);

  function setMode(m) {
    mode = m;
    drawArea.hidden = m !== 'draw';
    typedArea.hidden = m !== 'typed';
    toggleBtn.textContent = m === 'draw' ? '대체 서명 사용 (키보드)' : '손글씨 서명 사용';
    if (m === 'draw') requestAnimationFrame(resize); else typedName.focus();
  }
  toggleBtn.addEventListener('click', () => setMode(mode === 'draw' ? 'typed' : 'draw'));

  function ctx() {
    const c = canvas.getContext('2d');
    c.lineWidth = 2.4; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#0F1B33';
    return c;
  }
  function redraw() {
    const c = ctx();
    const w = canvas.width; const hgt = canvas.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, hgt);
    const dpr = window.devicePixelRatio || 1;
    c.scale(dpr, dpr);
    for (const s of strokes) {
      c.beginPath();
      s.forEach(([x, y], i) => { const px = x * (w / dpr); const py = y * (hgt / dpr); if (i) c.lineTo(px, py); else c.moveTo(px, py); });
      if (s.length === 1) c.lineTo(s[0][0] * (w / dpr) + 0.1, s[0][1] * (hgt / dpr));
      c.stroke();
    }
    placeholder.hidden = strokes.length > 0;
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1; // 고해상도 화면에서 선이 흐리지 않도록
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    redraw();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const point = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    current = [point(e)];
    strokes.push(current);
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    e.preventDefault();
    current.push(point(e));
    redraw();
  });
  const end = () => { current = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  clearBtn.addEventListener('click', () => { strokes.length = 0; redraw(); });

  function strokeLength() {
    let len = 0;
    for (const s of strokes) for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
    return len;
  }
  function exportPng() {
    const rect = canvas.getBoundingClientRect();
    const ratio = (rect.height || 160) / (rect.width || 480);
    for (const width of [480, 360, 240]) {
      const out = document.createElement('canvas');
      out.width = width; out.height = Math.round(width * ratio);
      const c = out.getContext('2d');
      c.lineWidth = Math.max(2, width / 180); c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#0F1B33';
      for (const s of strokes) {
        c.beginPath();
        s.forEach(([x, y], i) => (i ? c.lineTo(x * out.width, y * out.height) : c.moveTo(x * out.width, y * out.height)));
        c.stroke();
      }
      const url = out.toDataURL('image/png');
      if (url.length <= MAX_DATA_URL) return url;
    }
    return null;
  }

  return {
    el,
    /** 서명 값 또는 null(입력 없음). 오류 문구는 { error } */
    getValue() {
      if (mode === 'typed') {
        if (!typedName.value.trim() || !typedPw.value) return { error: '대체 서명은 본인 이름과 비밀번호를 모두 입력해 주세요.' };
        return { type: 'typed', name: typedName.value.trim(), password: typedPw.value };
      }
      if (!strokes.length || strokeLength() < 0.15) return { error: '서명을 입력해 주세요.' };
      const data = exportPng();
      if (!data) return { error: '서명이 너무 복잡합니다. 지우고 다시 입력해 주세요.' };
      return { type: 'image', data };
    },
    reset() { strokes.length = 0; typedName.value = ''; typedPw.value = ''; redraw(); },
    focus() { (mode === 'draw' ? toggleBtn : typedName).focus(); },
    destroy() { ro.disconnect(); },
    init() { setMode('draw'); if (!window.PointerEvent || !canvas.getContext) setMode('typed'); },
  };
}

/** 저장된 서명 표시 */
export function signatureView(signature, type, cls = 'sig-preview') {
  if (!signature) return h('span', { class: 'muted' }, '서명 없음');
  if (type === 'image') return h('div', { class: cls }, h('img', { src: signature, alt: '서명 이미지' }));
  return h('div', { class: cls }, h('span', { class: 'sig-typed' }, signature));
}
