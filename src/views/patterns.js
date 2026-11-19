import { S, filtered, runBatch } from '../state.js';
import { wdl, pct, groupBy, fmtDate, cap, familyKey } from '../data.js';
import { h, card, canvasBox, chart, tile, empty, C } from '../ui.js';

const PHASES = ['opening', 'middlegame', 'endgame'];
const ERR = ['inaccuracy', 'mistake', 'blunder'];

function analyzeBox(games, label) {
  const todo = games.filter((g) => !S.summaries[g.id] && g.moves.length >= 10);
  if (!todo.length) return null;
  const sizes = [25, 50, 100, 250].filter((_n, i, a) => i === 0 || a[i - 1] < todo.length);
  return h('div.analyze-box',
    h('div', h('b', label || `${todo.length} games in this view are not analyzed yet.`),
      h('p.muted', `Batch analysis runs Stockfish at depth ${S.settings.batchDepth} on your most recent games, about 3–8 seconds per game, in the background.`)),
    h('div.btn-row', S.batch.running
      ? h('span.muted', `Analyzing… ${S.batch.done}/${S.batch.total}`)
      : sizes.map((n, i) => h('button.btn' + (i ? '.ghost' : ''), { onclick: () => runBatch(todo.slice(0, n)) }, `Analyze ${Math.min(n, todo.length)}`))));
}

export function patterns() {
  const games = filtered();
  if (!games.length) return empty('No games match these filters.');
  const done = games.filter((g) => S.summaries[g.id]);
  if (done.length < 3) {
    return h('div.stack', card('Mistake patterns', null,
      h('p', 'Patterns need engine analysis of a batch of games. Analyze some, then come back here.'),
      analyzeBox(games, 'Start by analyzing your recent games.') || h('p.muted', 'All games are analyzed.')),
      nonEngine(games));
  }
  const sums = done.map((g) => ({ g, s: S.summaries[g.id] }));
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const myMoves = sums.flatMap(({ g, s }) => s.moves.map((m) => ({ ...m, g })));
  const per = (k) => sums.reduce((t, { s }) => t + s.counts[k], 0) / sums.length;

  // ---- phase rates (per 100 of your moves)
  const phase = PHASES.map((p) => {
    const ms = myMoves.filter((m) => m.phase === p);
    const r = { phase: p, n: ms.length };
    for (const k of ERR) r[k] = ms.length ? (ms.filter((m) => m.cls === k).length / ms.length) * 100 : 0;
    r.acc = ms.length ? mean(ms.map((m) => 103.1668 * Math.exp(-0.04354 * m.loss) - 3.1669).map((x) => Math.max(0, Math.min(100, x)))) : null;
    return r;
  });

  // ---- clock buckets
  const clockMoves = myMoves.filter((m) => m.clock != null && m.g.initial > 0 && m.g.speed !== 'daily');
  const cb = [[0.5, 2, '> 50%'], [0.25, 0.5, '25–50%'], [0.1, 0.25, '10–25%'], [0, 0.1, '< 10%']].map(([lo, hi, label]) => {
    const ms = clockMoves.filter((m) => { const f = m.clock / m.g.initial; return f >= lo && f < hi; });
    return { label, n: ms.length, rate: ms.length ? (ms.filter((m) => m.cls === 'mistake' || m.cls === 'blunder').length / ms.length) * 100 : null };
  });

  // ---- thrown / saved
  const thrown = sums.filter(({ g, s }) => s.peak >= 85 && g.result !== 'win');
  const saved = sums.filter(({ g, s }) => s.low <= 15 && g.result !== 'loss');

  // ---- insights
  const insights = [];
  const worstPhase = [...phase].filter((p) => p.n >= 30).sort((a, b) => (b.mistake + b.blunder) - (a.mistake + a.blunder))[0];
  const bestPhase = [...phase].filter((p) => p.n >= 30).sort((a, b) => (a.mistake + a.blunder) - (b.mistake + b.blunder))[0];
  if (worstPhase && bestPhase && worstPhase !== bestPhase) {
    const ratio = (worstPhase.mistake + worstPhase.blunder) / Math.max(0.1, bestPhase.mistake + bestPhase.blunder);
    insights.push(['phase', `Your ${worstPhase.phase} is the weak spot: you make ${ratio.toFixed(1)}× as many mistakes and blunders per move there as in the ${bestPhase.phase}.`]);
  }
  const calm = cb[0].rate, panic = cb[3].rate;
  if (cb[3].n >= 20 && calm != null && panic != null && panic > calm * 1.3) {
    insights.push(['clock', `Time pressure costs you: with under 10% of your clock left, ${panic.toFixed(1)}% of your moves are mistakes or blunders, against ${calm.toFixed(1)}% with a comfortable clock.`]);
  }
  if (thrown.length) insights.push(['thrown', `You let ${thrown.length} winning position${thrown.length > 1 ? 's' : ''} slip (${pct(thrown.length / sums.length)} of analyzed games): you were at 85%+ win chance and didn't win.`]);
  const accW = mean(sums.filter(({ g }) => g.color === 'white').map(({ s }) => s.acc ?? 0));
  const accB = mean(sums.filter(({ g }) => g.color === 'black').map(({ s }) => s.acc ?? 0));
  if (Math.abs(accW - accB) >= 3) insights.push(['color', `You play more accurately as ${accW > accB ? 'White' : 'Black'} (${Math.max(accW, accB).toFixed(1)} vs ${Math.min(accW, accB).toFixed(1)}).`]);
  const timeLosses = games.filter((g) => g.result === 'loss' && g.how === 'time').length;
  const losses = games.filter((g) => g.result === 'loss').length;
  if (losses >= 10 && timeLosses / losses >= 0.2) insights.push(['clock', `${pct(timeLosses / losses)} of your losses are on time. Moving faster in the opening could free up clock for the critical moments.`]);
  const blunderLosses = sums.filter(({ g, s }) => g.result === 'loss' && s.counts.blunder > 0).length;
  const analyzedLosses = sums.filter(({ g }) => g.result === 'loss').length;
  if (analyzedLosses >= 5) insights.push(['blunder', `${pct(blunderLosses / analyzedLosses)} of your analyzed losses contain at least one blunder.`]);

  // ---- tiles
  const tiles = h('div.tiles',
    tile('Your accuracy', mean(sums.map(({ s }) => s.acc ?? 0)).toFixed(1), `Opponents ${mean(sums.map(({ s }) => s.oppAcc ?? 0)).toFixed(1)} · ${sums.length} games analyzed`),
    tile('Blunders / game', per('blunder').toFixed(2), `${per('mistake').toFixed(2)} mistakes · ${per('inaccuracy').toFixed(2)} inaccuracies`),
    tile('Thrown wins', String(thrown.length), 'Had 85%+ win chance, did not win', thrown.length ? 'bad' : ''),
    tile('Saves', String(saved.length), 'Was below 15%, still drew or won', saved.length ? 'good' : ''));

  const insightCard = card('What stands out', null, insights.length
    ? h('ul.insights', insights.map(([k, t]) => h('li.i-' + k, t)))
    : h('p.muted', 'Analyze more games to surface patterns.'));

  const tc = canvasBox(220);
  const trendCard = card('Accuracy trend', 'Each dot is a game, line is the 10-game average', tc.el);
  const pc = canvasBox(220);
  const phaseCard = card('Errors by game phase', 'Per 100 of your moves', pc.el,
    h('div.phase-acc', phase.map((p) => h('div', h('span.muted', cap(p.phase)), h('b', p.acc != null ? p.acc.toFixed(1) : '–'), h('small', ' accuracy')))));
  const cc = canvasBox(220);
  const clockCard = card('Clock pressure', 'Share of your moves that are mistakes or blunders, by clock left', clockMoves.length ? cc.el : h('p.muted', 'No clock data in analyzed games.'));

  // accuracy by opening family
  const fams = [...groupBy(sums, ({ g }) => familyKey(g.family))].filter(([, l]) => l.length >= 3)
    .map(([, l]) => ({ name: l[0].g.family, n: l.length, acc: mean(l.map(({ s }) => s.acc ?? 0)), r: wdl(l.map(({ g }) => g)) }))
    .sort((a, b) => a.acc - b.acc).slice(0, 8);
  const famCard = card('Accuracy by opening', 'Lowest first, 3+ analyzed games', fams.length
    ? h('table.table', h('thead', h('tr', h('th', 'Opening'), h('th.num', 'Games'), h('th.num', 'Accuracy'), h('th.num', 'Score'))),
      h('tbody', fams.map((f) => h('tr', h('td', f.name), h('td.num', f.n), h('td.num', f.acc.toFixed(1)), h('td.num', pct(f.r.score))))))
    : h('p.muted', 'Not enough analyzed games per opening yet.'));

  const gameRow = ({ g, s }, extra) => h('div.game-row.click', { onclick: () => window.go('review', { reviewId: g.id }) },
    h('span.sd.' + g.color), h('span.opp', g.opp), h('span.muted', ` ${fmtDate(g.ts)}`), h('span.spacer'), h('span.muted', extra), h('span.res.' + g.result, g.result === 'draw' ? 'Draw' : g.result === 'win' ? 'Won' : 'Lost'));
  const thrownCard = card('Games you let slip', null, thrown.length
    ? h('div.rows', thrown.sort((a, b) => b.g.ts - a.g.ts).slice(0, 8).map((x) => gameRow(x, `peak ${x.s.peak.toFixed(0)}%`)))
    : h('p.muted', 'None. You convert your winning positions.'));
  const bigBlunders = myMoves.filter((m) => m.cls === 'blunder').sort((a, b) => b.loss - a.loss).slice(0, 8);
  const blunderCard = card('Costliest blunders', null, bigBlunders.length
    ? h('div.rows', bigBlunders.map((m) => h('div.game-row.click', { onclick: () => window.go('review', { reviewId: m.g.id }) },
      h('span.mono', `${Math.ceil(m.ply / 2)}${m.ply % 2 ? '.' : '…'} ${m.san}`), h('span.muted', ` vs ${m.g.opp}`), h('span.spacer'),
      h('span.muted', m.bestSan ? `best ${m.bestSan} · ` : ''), h('span.lossv', `−${m.loss.toFixed(0)}%`))))
    : h('p.muted', 'No blunders found.'),
    bigBlunders.length ? h('button.btn.ghost.small', { onclick: () => window.go('train') }, 'Train on your mistakes →') : null);

  const root = h('div.grid',
    analyzeBox(games) ? h('div.span-2', analyzeBox(games)) : null,
    tiles, h('div.span-2', insightCard),
    h('div.span-2', trendCard),
    phaseCard, clockCard, thrownCard, blunderCard, famCard,
    nonEngine(games));

  queueMicrotask(() => {
    const chron = [...sums].sort((a, b) => a.g.ts - b.g.ts);
    const pts = chron.map(({ g, s }, i) => ({ x: i + 1, y: s.acc ?? null, g }));
    const roll = pts.map((p, i) => { const w = pts.slice(Math.max(0, i - 9), i + 1).filter((q) => q.y != null); return { x: p.x, y: mean(w.map((q) => q.y)) }; });
    chart(tc.cv, {
      type: 'line',
      data: { datasets: [
        { label: 'Game accuracy', data: pts, showLine: false, backgroundColor: C.ink2, borderColor: C.ink2, pointRadius: 3, pointBackgroundColor: pts.map((p) => (p.g.result === 'win' ? C.win : p.g.result === 'loss' ? C.loss : C.draw)), pointBorderWidth: 0 },
        { label: '10-game average', data: roll, borderColor: C.blue, borderWidth: 2, cubicInterpolationMode: 'monotone', borderJoinStyle: 'round' },
      ] },
      options: {
        maintainAspectRatio: false,
        scales: { x: { type: 'linear', title: { display: true, text: 'Analyzed games, oldest → newest', color: C.muted }, grid: { display: false }, ticks: { precision: 0 } }, y: { suggestedMin: 50, max: 100 } },
        plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: {
          title: (it) => { const p = pts[it[0].dataIndex]; return `vs ${p.g.opp} · ${fmtDate(p.g.ts)}`; },
          label: (it) => ` ${it.dataset.label}: ${it.parsed.y.toFixed(1)}`,
        } } },
        onClick: (_e, els) => { const el = els.find((e) => e.datasetIndex === 0); if (el) window.go('review', { reviewId: pts[el.index].g.id }); },
      },
    });
    chart(pc.cv, {
      type: 'bar',
      data: {
        labels: PHASES.map(cap),
        datasets: ERR.map((k) => ({ label: cap(k === 'inaccuracy' ? 'inaccuracies' : k + 's'), data: phase.map((p) => p[k]), backgroundColor: C[k], borderColor: C.surface, borderWidth: { top: 2 }, borderSkipped: 'bottom', maxBarThickness: 56 })),
      },
      options: {
        maintainAspectRatio: false,
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true } },
        plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: (it) => ` ${it.dataset.label}: ${it.parsed.y.toFixed(1)} per 100 moves` } } },
      },
    });
    if (clockMoves.length) chart(cc.cv, {
      type: 'bar',
      data: { labels: cb.map((b) => b.label + ' left'), datasets: [{ label: 'Error rate', data: cb.map((b) => b.rate), backgroundColor: [C.aqua, C.aqua, C.yellow, C.loss], maxBarThickness: 56 }] },
      options: {
        maintainAspectRatio: false,
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: (v) => v + '%' } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (it) => ` ${it.parsed.y?.toFixed(1)}% of ${cb[it.dataIndex].n} moves` } } },
      },
    });
  });
  return root;
}

// Patterns that need no engine: game length, time usage.
function nonEngine(games) {
  const lenB = [[0, 20, '≤ 20'], [20, 30, '21–30'], [30, 40, '31–40'], [40, 60, '41–60'], [60, 999, '60+']].map(([lo, hi, label]) => {
    const gs = games.filter((g) => { const m = Math.ceil(g.moves.length / 2); return m > lo && m <= hi; });
    return { label, r: wdl(gs) };
  }).filter((b) => b.r.n);
  const rows = lenB.map((b) => h('div.row-stat', h('div.row-label', `${b.label} moves`), h('div.row-bar', h('div.wdl',
    b.r.win ? h('span.win', { style: { flexGrow: b.r.win } }) : null, b.r.draw ? h('span.draw', { style: { flexGrow: b.r.draw } }) : null, b.r.loss ? h('span.loss', { style: { flexGrow: b.r.loss } }) : null)),
  h('div.row-num', pct(b.r.score), h('small', `${b.r.n} games`))));
  return card('Score by game length', 'Full moves, all games in view', h('div.rows', rows));
}
