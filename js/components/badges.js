// 상태 배지: 색 + 기호 + 텍스트 (색에만 의존하지 않음)
import { h } from '../dom.js';
import { RESERVATION_STATUS, LOG_STATUS, LEDGER_STATUS, VEHICLE_STATUS } from '../utils/validate.js';

const MAP = {
  reservation: {
    requested: ['badge-gold', '○'], confirmed: ['badge-neutral', '●'], completed: ['badge-success', '✓'],
    cancelled: ['badge-danger', '✕'], no_show: ['badge-outline', '–'],
  },
  log: { draft: ['badge-warning', '✎'], submitted: ['badge-neutral', '↑'], locked: ['badge-success', '🔒'] },
  ledger: { open: ['badge-outline', '✎'], submitted: ['badge-gold', '↑'], approved: ['badge-success', '✓'], rejected: ['badge-danger', '↩'] },
  vehicle: { available: ['badge-success', '●'], in_use: ['badge-gold', '▶'], maintenance: ['badge-warning', '⚙'], retired: ['badge-outline', '–'] },
};
const LABELS = {
  reservation: RESERVATION_STATUS, log: LOG_STATUS, ledger: LEDGER_STATUS,
  vehicle: { ...VEHICLE_STATUS, in_use: '운행중' },
};

export function badge(kind, status) {
  const [cls, sym] = MAP[kind]?.[status] || ['badge-outline', ''];
  return h('span', { class: `badge ${cls}` }, h('span', { 'aria-hidden': 'true' }, sym), LABELS[kind]?.[status] || status);
}
export const vehicleDot = (color) => h('span', { class: 'dot', style: { background: color }, 'aria-hidden': 'true' });
