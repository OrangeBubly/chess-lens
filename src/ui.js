// Small DOM, chart and board helpers.
import { Chart, registerables } from 'chart.js';
import { Chessground } from 'chessground';

Chart.register(...registerables);

export const C = {
  surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', muted: '#8d8c84', grid: '#2c2c2a',
  blue: '#3987e5', orange: '#d95926', aqua: '#199e70', yellow: '#c98500', violet: '#9085e9',
  win: '#0ca30c', draw: '#7a7a74', loss: '#d03b3b',
  inaccuracy: '#c98500', mistake: '#ec835a', blunder: '#d03b3b',
};
export const SERIES = [C.blue, C.orange, C.aqua, C.yellow, '#d55181', '#0ca30c', C.violet, '#e66767'];

Chart.defaults.color = C.ink2;
Chart.defaults.font.family = 'Inter, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
Chart.defaults.font.size = 12;
Chart.defaults.borderColor = C.grid;
Chart.defaults.animation.duration = 450;
Chart.defaults.animation.easing = 'easeOutQuart';
Chart.defaults.transitions.active.animation.duration = 150;

// Runs a re-render with chart animations off (in-place refreshes shouldn't replay the intro).
export function quiet(fn) {
  const d = Chart.defaults.animation.duration;
  Chart.defaults.animation.duration = 0;
  try { fn(); } finally { setTimeout(() => { Chart.defaults.animation.duration = d; }, 0); }
}
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.plugins.legend.labels.boxHeight = 10;
Chart.defaults.plugins.legend.labels.useBorderRadius = true;
Chart.defaults.plugins.legend.labels.borderRadius = 2;
Object.assign(Chart.defaults.plugins.tooltip, {
  backgroundColor: '#262624', borderColor: '#3a3a37', borderWidth: 1, padding: 10,
  titleColor: C.ink, bodyColor: C.ink2, cornerRadius: 8, boxPadding: 4, usePointStyle: true,
});
Chart.defaults.elements.bar.borderRadius = 4;
Chart.defaults.elements.line.borderWidth = 2;
Chart.defaults.elements.point.radius = 0;
Chart.defaults.elements.point.hoverRadius = 5;

const charts = new Set();
export function chart(canvas, config) {
  const c = new Chart(canvas, config);
  charts.add(c);
  return c;
}
const boards = new Set();
export function destroyCharts() {
  for (const c of charts) c.destroy();
  charts.clear();
  for (const b of boards) b.destroy();
  boards.clear();
}

// h('div.card', {onclick}, children...)
export function h(tag, attrs, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

export function card(title, sub, ...body) {
  return h('section.card', h('header.card-head', h('h3', title), sub ? h('span.sub', sub) : null), ...body);
}
export function canvasBox(height = 240) {
  const cv = h('canvas');
  return { el: h('div.chart', { style: { height: Math.round(height * 0.82) + 'px' } }, cv), cv };
}
export function tile(label, value, foot, tone) {
  return h('div.tile' + (tone ? '.' + tone : ''), h('div.tile-label', label), h('div.tile-value', value), foot ? h('div.tile-foot', foot) : null);
}
export function wdlBar(r, showLabels = true) {
  const seg = (k) => r[k] ? h('span.' + k, { style: { flexGrow: r[k] }, title: `${r[k]} ${k}${r[k] === 1 ? '' : k === 'loss' ? 'es' : 's'}` }, showLabels && r[k] / r.n > 0.12 ? Math.round((r[k] / r.n) * 100) + '%' : '') : null;
  return h('div.wdl', seg('win'), seg('draw'), seg('loss'));
}
export function empty(msg, action) {
  return h('div.empty', h('div.empty-icon', '♞'), h('p', msg), action || null);
}
export function toast(msg, tone = '') {
  const t = h('div.toast' + (tone ? '.' + tone : ''), msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

export function board(el, cfg) {
  const b = makeBoard(el, cfg);
  boards.add(b);
  return b;
}
function makeBoard(el, cfg) {
  return Chessground(el, {
    coordinates: true, animation: { duration: 220 },
    highlight: { lastMove: true, check: true },
    drawable: { enabled: true, visible: true, brushes: {
      green: { key: 'g', color: '#3fb950', opacity: 0.85, lineWidth: 10 },
      red: { key: 'r', color: '#e5534b', opacity: 0.85, lineWidth: 10 },
      blue: { key: 'b', color: '#3987e5', opacity: 0.85, lineWidth: 10 },
      yellow: { key: 'y', color: '#e0a526', opacity: 0.85, lineWidth: 10 },
      paleBlue: { key: 'pb', color: '#3987e5', opacity: 0.4, lineWidth: 15 },
      paleGreen: { key: 'pg', color: '#3fb950', opacity: 0.4, lineWidth: 15 },
      paleRed: { key: 'pr', color: '#e5534b', opacity: 0.4, lineWidth: 15 },
      paleGrey: { key: 'pgr', color: '#4a4a4a', opacity: 0.35, lineWidth: 15 },
    } },
    ...cfg,
  });
}

export function fmtClock(s) {
  if (s == null) return '';
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  if (s < 20) return s.toFixed(1);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
