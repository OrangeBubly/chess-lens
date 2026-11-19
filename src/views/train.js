import { Chess } from 'chess.js';
import { S, save, gameById } from '../state.js';
import { fmtDate } from '../data.js';
import { withEngine, toCp, winPct } from '../engine.js';
import { h, card, board, empty } from '../ui.js';

const ui = { idx: 0, kind: 'all' };

function puzzles() {
  const list = [];
  for (const [id, s] of Object.entries(S.summaries)) {
    const g = gameById(id);
    if (!g) continue;
    for (const m of s.moves) {
      if (!m.fen || !m.best) continue;
      if (ui.kind !== 'all' && m.cls !== ui.kind) continue;
      list.push({ key: `${id}:${m.ply}`, g, m });
    }
  }
  // Newest games first; solved ones are skipped by "Next".
  list.sort((a, b) => b.g.ts - a.g.ts || a.m.ply - b.m.ply);
  return list;
}

export function train() {
  const list = puzzles();
  if (!list.length) {
    return empty(Object.keys(S.summaries).length
      ? 'No mistakes found in your analyzed games. Nice.'
      : 'Training positions come from mistakes in your analyzed games. Analyze some games first.',
    h('button.btn', { onclick: () => window.go('patterns') }, 'Go to Patterns'));
  }
  if (ui.idx >= list.length) ui.idx = 0;
  const { key, g, m } = list[ui.idx];
  const chess = new Chess(m.fen);
  const turn = chess.turn() === 'w' ? 'white' : 'black';
  const solvedCount = list.filter((p) => S.trained[p.key] === 'solved').length;

  const feedback = h('div.feedback', h('p', h('b', 'Find a better move.'), h('span.muted', ` In the game you played ${m.san}, ${m.cls === 'blunder' ? 'a blunder' : 'a mistake'} that dropped ${m.loss.toFixed(0)}% win chance.`)));
  const cgEl = h('div.cg');
  let cg;

  const dests = () => {
    const d = new Map();
    for (const mv of chess.moves({ verbose: true })) {
      if (!d.has(mv.from)) d.set(mv.from, []);
      d.get(mv.from).push(mv.to);
    }
    return d;
  };
  const reset = () => {
    chess.load(m.fen);
    cg.set({ fen: m.fen, turnColor: turn, lastMove: undefined, movable: { color: turn, dests: dests() } });
    cg.setAutoShapes([]);
  };
  const mark = (state) => {
    if (S.trained[key] !== 'solved') S.trained[key] = state;
    save('trained');
  };
  const showSolution = () => {
    reset();
    cg.set({ movable: { color: undefined } });
    cg.setAutoShapes([{ orig: m.best.slice(0, 2), dest: m.best.slice(2, 4), brush: 'green' }]);
    feedback.replaceChildren(h('p', 'The engine move was ', h('b.best', m.bestSan || m.best), '.'));
    mark('seen');
  };
  const onMove = async (orig, dest) => {
    const piece = chess.get(orig);
    const promo = piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : undefined;
    const mv = chess.move({ from: orig, to: dest, promotion: promo });
    cg.set({ fen: chess.fen(), movable: { color: undefined } });
    const uci = orig + dest + (promo || '');
    if (uci === m.best) {
      feedback.replaceChildren(h('p.ok', '✓ Correct! ', h('b', mv.san), ' is the engine move.'));
      cg.setAutoShapes([{ orig, dest, brush: 'green' }]);
      mark('solved');
      return;
    }
    feedback.replaceChildren(h('p.muted', `Checking ${mv.san}…`));
    const r = await withEngine((e) => e.analyze(chess.fen(), 12));
    const mine = winPct(-toCp(r)); // opponent to move, flip sign
    const loss = m.before - mine;
    if (loss < 5) {
      feedback.replaceChildren(h('p.ok', '✓ Good move! ', h('b', mv.san), ` keeps your chances (engine top choice was ${m.bestSan}).`));
      cg.setAutoShapes([{ orig, dest, brush: 'green' }]);
      mark('solved');
    } else {
      cg.setAutoShapes([{ orig, dest, brush: 'red' }]);
      feedback.replaceChildren(h('p.bad', `✗ ${mv.san} isn't it (−${Math.max(0, loss).toFixed(0)}% win chance). Try again.`));
      setTimeout(() => { if (cg) reset(); }, 900);
    }
  };

  const status = S.trained[key];
  const nav = h('div.btn-row',
    h('button.btn.ghost', { onclick: () => { ui.idx = (ui.idx - 1 + list.length) % list.length; window.go('train'); } }, '← Previous'),
    h('button.btn.ghost', { onclick: showSolution }, 'Show solution'),
    h('button.btn', { onclick: () => {
      let i = ui.idx;
      for (let k = 0; k < list.length; k++) { i = (i + 1) % list.length; if (S.trained[list[i].key] !== 'solved') break; }
      ui.idx = i;
      window.go('train');
    } }, 'Next →'));

  const kindSeg = h('div.seg.small', [['all', 'All'], ['blunder', 'Blunders'], ['mistake', 'Mistakes']].map(([k, l]) =>
    h('button' + (ui.kind === k ? '.on' : ''), { onclick: () => { ui.kind = k; ui.idx = 0; window.go('train'); } }, l)));

  const side = h('div.train-side',
    card(`Position ${ui.idx + 1} of ${list.length}`, `${solvedCount} solved`,
      kindSeg,
      h('div.progress', h('div', { style: { width: (solvedCount / list.length) * 100 + '%' } })),
      h('p', h('span.sd.' + turn), ` You are ${turn}, move ${Math.ceil(m.ply / 2)}.`),
      h('p.muted', `vs ${g.opp} · ${fmtDate(g.ts)} · `, h('a.link', { href: '#', onclick: (e) => { e.preventDefault(); window.go('review', { reviewId: g.id }); } }, 'review game')),
      status === 'solved' ? h('p.ok.small', 'You solved this one before.') : null,
      feedback, nav));

  queueMicrotask(() => {
    cg = board(cgEl, {
      fen: m.fen, orientation: turn, turnColor: turn,
      movable: { free: false, color: turn, dests: dests(), showDests: true, events: { after: onMove } },
      draggable: { enabled: true }, premovable: { enabled: false },
    });
  });
  return h('div.train', h('div.board-wrap.lg', cgEl), side);
}
