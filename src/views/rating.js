// Rating-over-time chart: series toggles, per-game/daily, zoom & pan, stats, fullscreen.
import { siteName, fmtDate } from '../data.js';
import { h, chart, C, SERIES, openFullscreen } from '../ui.js';

const ui = { gran: 'game', hidden: new Set(), smooth: 1 };
const SMOOTH_DAYS = [0, 2.5, 7]; // Gaussian sigma in days for Raw / Smooth / Smoother
const fmtD = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate(); };

function seriesFrom(combos) {
  return combos.map(([k, gs], i) => {
    const [site, speed] = k.split('|');
    let pts = gs.map((g) => ({ x: g.ts, y: g.myElo, g }));
    if (ui.gran === 'day') {
      const byDay = new Map();
      for (const p of pts) byDay.set(dayKey(p.x), p); // last game of the day wins
      pts = [...byDay.values()].map((p) => {
        const d = new Date(p.x); d.setHours(12, 0, 0, 0);
        return { ...p, x: d.getTime() };
      });
    }
    const peakIdx = pts.reduce((b, p, j) => (p.y > pts[b].y ? j : b), 0);
    pts = smooth(pts, SMOOTH_DAYS[ui.smooth] * 864e5);
    const ys = gs.map((g) => g.myElo);
    return {
      key: k, label: `${siteName(site)} ${speed}`, color: SERIES[i], pts, peakIdx,
      current: ys[ys.length - 1], change: ys[ys.length - 1] - ys[0], peak: Math.max(...ys), low: Math.min(...ys),
      peakTs: gs[ys.indexOf(Math.max(...ys))].ts, n: gs.length,
    };
  });
}

// Gaussian smoothing over *time* (not game index): games come in bursts, so averaging
// neighbouring games leaves a staircase, while a few-day window gives a clean trend.
// The real rating stays in `r` for tooltips.
function smooth(pts, sigma) {
  const out = pts.map((p) => ({ ...p, r: p.y }));
  if (!sigma || pts.length < 3) return out;
  const reach = sigma * 3;
  let lo = 0, hi = 0;
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i].x;
    while (pts[lo].x < x - reach) lo++;
    while (hi + 1 < pts.length && pts[hi + 1].x <= x + reach) hi++;
    let sum = 0, tw = 0;
    for (let j = lo; j <= hi; j++) {
      const d = (pts[j].x - x) / sigma;
      const wt = Math.exp(-0.5 * d * d);
      sum += pts[j].y * wt; tw += wt;
    }
    out[i].y = sum / tw;
  }
  // Ease the tail toward the current rating by *time* distance from the last game, so the
  // line ends where you are now without a vertical hook (games minutes apart get the same weight).
  const last = out[out.length - 1];
  for (const p of out) {
    const w = Math.exp(-0.5 * ((last.x - p.x) / (sigma * 0.6)) ** 2);
    p.y = p.y * (1 - w) + last.r * w;
  }
  return out;
}

// Vertical hover line.
const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(c) {
    const a = c.tooltip?.getActiveElements?.();
    if (!a?.length) return;
    const x = a[0].element.x;
    const { top, bottom } = c.chartArea;
    c.ctx.save();
    c.ctx.strokeStyle = 'rgba(195,194,183,0.35)';
    c.ctx.lineWidth = 1;
    c.ctx.setLineDash([4, 4]);
    c.ctx.beginPath(); c.ctx.moveTo(x, top); c.ctx.lineTo(x, bottom); c.ctx.stroke();
    c.ctx.restore();
  },
};

function buildChart(cv, series, onZoom) {
  const visible = series.filter((s) => !ui.hidden.has(s.key));
  return chart(cv, {
    type: 'line',
    data: {
      datasets: visible.map((s) => ({
        label: s.label, data: s.pts, borderColor: s.color, borderWidth: 2,
        cubicInterpolationMode: 'monotone', borderJoinStyle: 'round', borderCapStyle: 'round',
        pointRadius: (ctx) => (ctx.dataIndex === s.peakIdx ? 4.5 : 0),
        pointBackgroundColor: s.color, pointBorderColor: C.surface, pointBorderWidth: 2, pointHoverRadius: 5,
        fill: visible.length === 1 ? 'origin' : false,
        backgroundColor: (ctx) => {
          const { chartArea, ctx: g } = ctx.chart;
          if (!chartArea) return 'transparent';
          const grad = g.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          grad.addColorStop(0, s.color + '40'); grad.addColorStop(1, s.color + '00');
          return grad;
        },
      })),
    },
    options: {
      maintainAspectRatio: false, normalized: true,
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      scales: {
        x: { type: 'linear', ticks: { callback: (v) => fmtD(v), maxTicksLimit: 9, maxRotation: 0 }, grid: { display: false } },
        y: { grid: { color: C.grid }, grace: '4%', beginAtZero: false, ticks: { precision: 0 } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'nearest', intersect: false,
          callbacks: {
            title: (items) => (ui.gran === 'day' ? fmtDate(items[0].parsed.x) : new Date(items[0].parsed.x).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })),
            label: (it) => {
              const prev = it.dataset.data[it.dataIndex - 1];
              const d = prev ? it.raw.r - prev.r : 0;
              return ` ${it.dataset.label}: ${it.raw.r}${prev ? `  (${d >= 0 ? '+' : ''}${d})` : ''}`;
            },
            afterLabel: (it) => {
              if (ui.gran === 'day') return '';
              const g = it.raw.g;
              return g ? `   ${g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Drew'} vs ${g.opp}${g.oppElo ? ` (${g.oppElo})` : ''}` : '';
            },
          },
        },
        zoom: {
          limits: { x: { min: 'original', max: 'original', minRange: 864e5 * 2 } },
          pan: { enabled: true, mode: 'x', onPanComplete: onZoom },
          zoom: { wheel: { enabled: true, speed: 0.12 }, pinch: { enabled: true }, mode: 'x', onZoomComplete: onZoom },
        },
      },
      onClick: (_e, els, c) => {
        const el = els[0];
        const g = el && c.data.datasets[el.datasetIndex].data[el.index].g;
        if (g && ui.gran === 'game') window.go('review', { reviewId: g.id });
      },
    },
    plugins: [crosshair],
  });
}

// Returns the card. `big` is used by the fullscreen view.
export function ratingCard(combos, big = false) {
  if (!combos.length) return h('section.card', h('header.card-head', h('h3', 'Rating over time')), h('p.muted', 'No rated games in this view.'));
  const series = seriesFrom(combos);
  const cv = h('canvas');
  const box = h('div.chart.rating-chart' + (big ? '.big' : ''), cv);
  const resetBtn = h('button.btn.ghost.small.reset-zoom', { onclick: () => { c.resetZoom(); resetBtn.classList.remove('show'); } }, 'Reset zoom');
  let c;
  const rebuild = () => { c?.destroy(); c = buildChart(cv, series, () => resetBtn.classList.add('show')); resetBtn.classList.remove('show'); };

  const chips = h('div.series-chips', series.map((s) => {
    const el = h('button.series-chip' + (ui.hidden.has(s.key) ? '.off' : ''), { onclick: () => {
      if (!ui.hidden.has(s.key) && series.filter((x) => !ui.hidden.has(x.key)).length === 1) return; // keep at least one
      ui.hidden.has(s.key) ? ui.hidden.delete(s.key) : ui.hidden.add(s.key);
      el.classList.toggle('off');
      rebuild();
      stats.replaceChildren(...statCells());
    } }, h('span.swatch', { style: { background: s.color } }), s.label);
    return el;
  }));
  const gran = h('div.seg.small', [['game', 'Per game'], ['day', 'Daily']].map(([v, l]) => h('button' + (ui.gran === v ? '.on' : ''), { onclick: (e) => {
    ui.gran = v;
    gran.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
    const fresh = seriesFrom(combos);
    series.splice(0, series.length, ...fresh);
    rebuild();
  } }, l)));
  const smoothSeg = h('div.seg.small', { title: 'Line smoothing (hover still shows your exact rating)' }, [[0, 'Raw'], [1, 'Smooth'], [2, 'Smoother']].map(([v, l]) => h('button' + (ui.smooth === v ? '.on' : ''), { onclick: (e) => {
    ui.smooth = v;
    smoothSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
    series.splice(0, series.length, ...seriesFrom(combos));
    rebuild();
  } }, l)));
  const fsBtn = big ? null : h('button.icon-btn.fs-btn', { title: 'Fullscreen', onclick: () => openFullscreen('Rating over time', () => ratingCard(combos, true)) },
    h('span', { html: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>' }));

  const statCells = () => series.filter((s) => !ui.hidden.has(s.key)).map((s) => h('div.rstat',
    h('div.rstat-head', h('span.swatch', { style: { background: s.color } }), s.label),
    h('div.rstat-row',
      h('div', h('small', 'Now'), h('b', s.current)),
      h('div', h('small', 'Change'), h('b.' + (s.change > 0 ? 'up' : s.change < 0 ? 'down' : ''), (s.change > 0 ? '+' : '') + s.change)),
      h('div', { title: fmtDate(s.peakTs) }, h('small', 'Peak'), h('b', s.peak)),
      h('div', h('small', 'Low'), h('b', s.low)),
      h('div', h('small', 'Games'), h('b', s.n)))));
  const stats = h('div.rstats', ...statCells());

  const el = h('section.card.rating-card' + (big ? '.big' : ''),
    h('header.card-head.rating-head', h('h3', 'Rating over time'), chips, h('span.spacer'), resetBtn, smoothSeg, gran, fsBtn),
    box,
    h('div.chart-hint', ui.gran === 'game' ? 'Scroll to zoom · drag to pan · click a point to open the game' : 'Scroll to zoom · drag to pan'),
    stats);
  queueMicrotask(rebuild);
  return el;
}
