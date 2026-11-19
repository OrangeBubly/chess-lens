import { S, filtered } from '../state.js';
import { wdl, pct, groupBy, siteName, cap, expected } from '../data.js';
import { h, card, canvasBox, tile, wdlBar, chart, empty, C, SERIES } from '../ui.js';

const fmtD = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });

export function dashboard() {
  const games = filtered();
  if (!games.length) return empty(S.games.length ? 'No games match these filters.' : 'No games yet. Press Sync to download your games.');
  const asc = [...games].sort((a, b) => a.ts - b.ts);
  const r = wdl(games);

  // Score vs Elo expectation
  const withElo = games.filter((g) => g.myElo && g.oppElo);
  const exp = withElo.reduce((s, g) => s + expected(g.myElo - g.oppElo), 0) / (withElo.length || 1);
  const act = wdl(withElo).score;
  const diff = act - exp;

  // Ratings per site + speed
  const combos = [...groupBy(asc.filter((g) => g.myElo), (g) => g.site + '|' + g.speed)]
    .filter(([, gs]) => gs.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4);

  const tiles = h('div.tiles',
    tile('Games', games.length.toLocaleString(), `${r.win}W · ${r.draw}D · ${r.loss}L`),
    tile('Score', pct(r.score, 1), wdlBar(r, false)),
    tile('vs rating expectation', (diff >= 0 ? '+' : '') + (diff * 100).toFixed(1) + '%', `Expected ${pct(exp, 1)} from opponent ratings`, diff >= 0.01 ? 'good' : diff <= -0.01 ? 'bad' : ''),
    ...combos.slice(0, 2).map(([k, gs]) => {
      const [site, speed] = k.split('|');
      const last = gs[gs.length - 1].myElo, first = gs[0].myElo;
      const d = last - first;
      return tile(`${siteName(site)} ${speed}`, String(last), h('span', { class: d > 0 ? 'up' : d < 0 ? 'down' : '' }, `${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${Math.abs(d)} over period · peak ${Math.max(...gs.map((g) => g.myElo))}`));
    }),
  );

  // Rating chart
  const rc = canvasBox(280);
  const ratingCard = card('Rating over time', combos.length > 1 ? 'Each line is one site and time control' : null, rc.el);

  // Color
  const byColor = ['white', 'black'].map((c) => [c, wdl(games.filter((g) => g.color === c))]);
  const colorCard = card('Results by color', null, h('div.rows',
    byColor.map(([c, x]) => h('div.row-stat',
      h('div.row-label', h('span.sd.' + c), cap(c)),
      h('div.row-bar', wdlBar(x)),
      h('div.row-num', `${pct(x.score)}`, h('small', `${x.n} games`)))),
  ), h('div.legend-inline', h('span.k.win', 'Win'), h('span.k.draw', 'Draw'), h('span.k.loss', 'Loss')));

  // Ending
  const endList = (res) => {
    const gs = games.filter((g) => g.result === res);
    const m = [...groupBy(gs, (g) => g.how)].sort((a, b) => b[1].length - a[1].length).slice(0, 5);
    return h('div.ends', h('h4', res === 'win' ? 'How you win' : 'How you lose'),
      m.map(([how, list]) => h('div.end-row',
        h('span', cap(how)),
        h('div.end-bar', h('div.' + res, { style: { width: (list.length / gs.length) * 100 + '%' } })),
        h('span.num', pct(list.length / gs.length)))));
  };
  const endCard = card('How games end', null, h('div.two', endList('win'), endList('loss')));

  // Rating difference
  const buckets = [[-Infinity, -200, '< -200'], [-200, -100, '-200…-100'], [-100, -25, '-100…-25'], [-25, 25, '±25'], [25, 100, '+25…+100'], [100, 200, '+100…+200'], [200, Infinity, '> +200']];
  const bucketData = buckets.map(([lo, hi, label]) => {
    const gs = withElo.filter((g) => { const d = g.oppElo - g.myElo; return d >= lo && d < hi; });
    const ex = gs.reduce((s, g) => s + expected(g.myElo - g.oppElo), 0) / (gs.length || 1);
    return { label, n: gs.length, score: gs.length ? wdl(gs).score * 100 : null, exp: gs.length ? ex * 100 : null };
  });
  const dc = canvasBox(240);
  const diffCard = card('Score by opponent rating', 'Opponent rating minus yours', dc.el);

  // Time of day
  const hc = canvasBox(240);
  const hours = Array.from({ length: 24 }, (_, hr) => {
    const gs = games.filter((g) => new Date(g.ts).getHours() === hr);
    return { n: gs.length, score: gs.length ? wdl(gs).score * 100 : null };
  });
  const hourCard = card('Score by time of day', 'Local time, bar height = score, faded bars have under 5 games', hc.el);

  // Tilt / session
  const sessionIdx = [];
  const afterRes = { win: [], draw: [], loss: [] };
  for (let i = 0; i < asc.length; i++) {
    const prev = asc[i - 1];
    const same = prev && asc[i].ts - prev.ts < 45 * 60e3;
    sessionIdx.push(same ? sessionIdx[i - 1] + 1 : 1);
    if (same) afterRes[prev.result].push(asc[i]);
  }
  const tiltRows = [['After a win', afterRes.win], ['After a draw', afterRes.draw], ['After a loss', afterRes.loss]]
    .filter(([, gs]) => gs.length >= 3)
    .map(([label, gs]) => { const x = wdl(gs); return h('div.row-stat', h('div.row-label', label), h('div.row-bar', wdlBar(x)), h('div.row-num', pct(x.score), h('small', `${x.n} games`))); });
  const sessBuckets = [1, 2, 3, 4, 5, 6].map((k) => {
    const gs = asc.filter((_, i) => (k === 6 ? sessionIdx[i] >= 6 : sessionIdx[i] === k));
    return { label: k === 6 ? '6+' : String(k), n: gs.length, score: gs.length ? wdl(gs).score * 100 : null };
  });
  const sc = canvasBox(180);
  const tiltCard = card('Momentum & tilt', 'Games played within 45 minutes of the previous one',
    tiltRows.length ? h('div.rows', tiltRows) : h('p.muted', 'Not enough back-to-back games yet.'),
    h('h4.mini', 'Score by game number in a session'), sc.el);

  const root = h('div.grid',
    tiles,
    h('div.span-2', ratingCard),
    colorCard, endCard, diffCard, hourCard,
    h('div.span-2', tiltCard),
  );

  queueMicrotask(() => {
    chart(rc.cv, {
      type: 'line',
      data: {
        datasets: combos.map(([k, gs], i) => {
          const [site, speed] = k.split('|');
          return { label: `${siteName(site)} ${speed}`, data: gs.map((g) => ({ x: g.ts, y: g.myElo })), borderColor: SERIES[i], backgroundColor: SERIES[i], tension: 0.15 };
        }),
      },
      options: {
        maintainAspectRatio: false, parsing: true,
        interaction: { mode: 'nearest', intersect: false, axis: 'x' },
        scales: {
          x: { type: 'linear', ticks: { callback: (v) => fmtD(v), maxTicksLimit: 8 }, grid: { display: false } },
          y: { grid: { color: C.grid } },
        },
        plugins: {
          legend: { display: combos.length > 1, position: 'top', align: 'end' },
          tooltip: { callbacks: { title: (items) => fmtD(items[0].parsed.x), label: (it) => ` ${it.dataset.label}: ${it.parsed.y}` } },
        },
      },
    });
    chart(dc.cv, {
      type: 'bar',
      data: {
        labels: bucketData.map((b) => b.label),
        datasets: [
          { type: 'bar', label: 'Your score', data: bucketData.map((b) => b.score), backgroundColor: C.blue, maxBarThickness: 44 },
          { type: 'line', label: 'Expected', data: bucketData.map((b) => b.exp), borderColor: C.ink2, borderDash: [4, 4], pointRadius: 4, pointBackgroundColor: C.ink2, borderWidth: 1.5 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } }, x: { grid: { display: false } } },
        plugins: {
          legend: { position: 'top', align: 'end' },
          tooltip: { callbacks: { label: (it) => ` ${it.dataset.label}: ${it.parsed.y?.toFixed(0)}%` + (it.datasetIndex === 0 ? ` (${bucketData[it.dataIndex].n} games)` : '') } },
        },
      },
    });
    chart(hc.cv, {
      type: 'bar',
      data: {
        labels: hours.map((_, i) => String(i).padStart(2, '0')),
        datasets: [{ label: 'Score', data: hours.map((x) => x.score), backgroundColor: hours.map((x) => (x.n >= 5 ? C.aqua : '#199e7055')), maxBarThickness: 22 }],
      },
      options: {
        maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } }, x: { grid: { display: false } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => `${it[0].label}:00–${it[0].label}:59`, label: (it) => ` Score ${it.parsed.y?.toFixed(0)}% · ${hours[it.dataIndex].n} games` } } },
      },
    });
    chart(sc.cv, {
      type: 'bar',
      data: {
        labels: sessBuckets.map((b) => 'Game ' + b.label),
        datasets: [{ label: 'Score', data: sessBuckets.map((b) => b.score), backgroundColor: C.violet, maxBarThickness: 44 }],
      },
      options: {
        maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } }, x: { grid: { display: false } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (it) => ` Score ${it.parsed.y?.toFixed(0)}% · ${sessBuckets[it.dataIndex].n} games` } } },
      },
    });
  });
  return root;
}
