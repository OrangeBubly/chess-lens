import { Chess } from 'chess.js';
import { S, filtered } from '../state.js';
import { wdl, pct, groupBy, familyKey, cap } from '../data.js';
import { h, card, wdlBar, empty, board } from '../ui.js';

const ui = { color: 'white', path: [], open: new Set(), sort: 'games' };

function scoreCell(x) {
  const cls = x.n < 5 ? '' : x.score >= 0.55 ? 'good' : x.score <= 0.45 ? 'bad' : '';
  return h('span.score.' + (cls || 'mid'), pct(x.score));
}

function repertoire(games) {
  const fams = [...groupBy(games, (g) => familyKey(g.family))].map(([, gs]) => ({ name: gs[0].family, games: gs, r: wdl(gs) }));
  fams.sort(ui.sort === 'games' ? (a, b) => b.r.n - a.r.n : ui.sort === 'best' ? (a, b) => b.r.score - a.r.score || b.r.n - a.r.n : (a, b) => a.r.score - b.r.score || b.r.n - a.r.n);
  const shown = ui.sort === 'games' ? fams : fams.filter((f) => f.r.n >= 3);
  const rows = [];
  for (const f of shown.slice(0, 40)) {
    const open = ui.open.has(f.name);
    rows.push(h('tr.fam' + (open ? '.open' : ''), { onclick: () => { open ? ui.open.delete(f.name) : ui.open.add(f.name); window.go('openings'); } },
      h('td', h('span.caret', open ? '▾' : '▸'), f.name),
      h('td.num', f.r.n), h('td.barcell', wdlBar(f.r)), h('td.num', scoreCell(f.r))));
    if (open) {
      const vars = [...groupBy(f.games, (g) => g.opening)].map(([name, gs]) => ({ name, r: wdl(gs), sample: gs[0] })).sort((a, b) => b.r.n - a.r.n);
      for (const v of vars.slice(0, 15)) {
        rows.push(h('tr.var',
          h('td', h('span.var-name', v.name.replace(f.name, '').replace(/^[:,\s]+/, '') || 'Main line'), v.sample.eco ? h('span.eco', v.sample.eco) : null),
          h('td.num', v.r.n), h('td.barcell', wdlBar(v.r)), h('td.num', scoreCell(v.r))));
      }
    }
  }
  const sortBtn = (k, label) => h('button' + (ui.sort === k ? '.on' : ''), { onclick: () => { ui.sort = k; window.go('openings'); } }, label);
  return card('Repertoire', `${fams.length} opening families`,
    h('div.seg.small', sortBtn('games', 'Most played'), sortBtn('best', 'Best'), sortBtn('worst', 'Worst')),
    h('table.table.openings', h('thead', h('tr', h('th', 'Opening'), h('th.num', 'Games'), h('th', 'Results'), h('th.num', 'Score'))), h('tbody', rows)));
}

function explorer(games) {
  const chess = new Chess();
  for (const m of ui.path) chess.move(m);
  const n = ui.path.length;
  const here = games.filter((g) => g.moves.length > n && ui.path.every((m, i) => g.moves[i] === m));
  const next = [...groupBy(here, (g) => g.moves[n])].map(([san, gs]) => ({ san, r: wdl(gs) })).sort((a, b) => b.r.n - a.r.n);
  const myTurn = (n % 2 === 0) === (ui.color === 'white');

  const boardEl = h('div.board-wrap.sm', h('div.cg'));
  const crumbs = h('div.crumbs',
    h('button.link', { onclick: () => { ui.path = []; window.go('openings'); } }, 'Start'),
    ui.path.map((m, i) => [h('span.sep', i % 2 === 0 ? ` ${i / 2 + 1}.` : ' '), h('button.link', { onclick: () => { ui.path = ui.path.slice(0, i + 1); window.go('openings'); } }, m)]));

  const list = h('table.table.explorer',
    h('thead', h('tr', h('th', 'Move'), h('th.num', 'Games'), h('th', 'Results'), h('th.num', 'Score'))),
    h('tbody', next.slice(0, 14).map((x) => h('tr.click', { onclick: () => { ui.path = [...ui.path, x.san]; window.go('openings'); } },
      h('td.mono', (n % 2 === 0 ? `${n / 2 + 1}. ` : `${Math.ceil(n / 2)}… `) + x.san),
      h('td.num', x.r.n), h('td.barcell', wdlBar(x.r)), h('td.num', scoreCell(x.r))))));

  const lastMove = chess.history({ verbose: true }).pop();
  queueMicrotask(() => {
    const cg = board(boardEl.firstChild, { fen: chess.fen(), orientation: ui.color, viewOnly: true, lastMove: lastMove ? [lastMove.from, lastMove.to] : undefined });
    if (next.length) {
      const total = next.reduce((s, x) => s + x.r.n, 0);
      cg.setAutoShapes(next.slice(0, 4).map((x) => {
        const c = new Chess(chess.fen());
        const mv = c.move(x.san);
        return { orig: mv.from, dest: mv.to, brush: x.r.n / total > 0.5 ? 'blue' : 'paleBlue' };
      }));
    }
  });

  return card('Opening explorer', `Your games as ${ui.color} · ${here.length} reach this position`,
    crumbs,
    h('div.explorer-grid', boardEl,
      h('div', next.length
        ? [h('p.hint', myTurn ? 'Moves you chose here:' : 'Moves your opponents played:'), list]
        : h('p.muted', 'No games continue from here.'),
        ui.path.length ? h('button.btn.ghost.small', { onclick: () => { ui.path = ui.path.slice(0, -1); window.go('openings'); } }, '← Back one move') : null)));
}

function weakSpots(games) {
  // Positions after your move where you score worst (min 6 games), up to move 8.
  const map = new Map();
  for (const g of games) {
    for (let p = 1; p <= Math.min(16, g.moves.length); p++) {
      const mine = (p % 2 === 1) === (g.color === 'white');
      if (!mine) continue;
      const key = g.moves.slice(0, p).join(' ');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(g);
    }
  }
  const spots = [...map].filter(([, gs]) => gs.length >= 6).map(([k, gs]) => ({ line: k.split(' '), r: wdl(gs) }))
    .filter((s) => s.r.score < 0.45).sort((a, b) => a.r.score - b.r.score || b.r.n - a.r.n);
  // Drop lines that are just extensions of a weaker parent line.
  const kept = [];
  for (const s of spots) if (!kept.some((k) => s.line.join(' ').startsWith(k.line.join(' ') + ' '))) kept.push(s);
  if (!kept.length) return null;
  const fmt = (line) => line.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m)).join(' ');
  return card('Problem lines', 'Lines where you score under 45% (6+ games)',
    h('div.rows', kept.slice(0, 6).map((s) => h('div.row-stat.click', { onclick: () => { ui.path = s.line; window.go('openings'); } },
      h('div.row-label.mono.wide', fmt(s.line)), h('div.row-bar', wdlBar(s.r)), h('div.row-num', pct(s.r.score), h('small', `${s.r.n} games`))))));
}

export function openings() {
  const all = filtered();
  if (!all.length) return empty('No games match these filters.');
  const games = all.filter((g) => g.color === ui.color);
  const tabs = h('div.seg.big', ['white', 'black'].map((c) => h('button' + (ui.color === c ? '.on' : ''), { onclick: () => { ui.color = c; ui.path = []; ui.open.clear(); window.go('openings'); } }, h('span.sd.' + c), `As ${cap(c)}`, h('small', ` ${all.filter((g) => g.color === c).length}`))));
  return h('div.grid', h('div.span-2.toolbar', tabs),
    h('div.span-2', explorer(games)),
    weakSpots(games),
    repertoire(games));
}
