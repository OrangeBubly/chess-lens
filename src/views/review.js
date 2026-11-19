// Analysis board: game review, live multi-line engine, variations and comments.
import { Chess } from 'chess.js';
import { S, gameById, storeAnalysis, save } from '../state.js';
import { fmtDate, cap, siteName } from '../data.js';
import { analyzeGame, review, winPct, LiveEngine, pvToSan } from '../engine.js';
import { h, chart, board, empty, fmtClock, C, toast, pickPromotion, isPromotion } from '../ui.js';

const SYM = { inaccuracy: '?!', mistake: '?', blunder: '??' };
const START = new Chess().fen();
let live = null;            // shared LiveEngine, created on first use
let current = null;         // handlers for the open review (keyboard, resize)
const running = new Map();  // gameId -> full-game analysis progress 0..1
const lastNode = new Map(); // gameId -> node key, restores position after re-render

document.addEventListener('keydown', (e) => {
  if (S.view !== 'review' || !current || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const k = { ArrowLeft: 'back', ArrowRight: 'fwd', ArrowUp: 'start', Home: 'start', ArrowDown: 'end', End: 'end' }[e.key];
  if (k) { e.preventDefault(); current.nav(k); }
  if (e.key === 'f') current.flip();
});
window.addEventListener('resize', () => current?.redraw());

function evalText(w, mate) {
  if (mate != null) return mate === 0 ? '#' : (mate > 0 ? '#' : '#-') + Math.abs(mate);
  const v = w / 100;
  return (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 10 ? 0 : 1);
}
const moveNum = (ply) => `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'}`;

// ---------- move tree ----------
function makeNode(parent, mv, chess, main) {
  return {
    key: parent.key ? parent.key + ' ' + mv.san : mv.san, san: mv.san, uci: mv.from + mv.to + (mv.promotion || ''),
    from: mv.from, to: mv.to, fen: chess.fen(), check: chess.inCheck(), ply: parent.ply + 1, parent, children: [], main,
  };
}
function addChild(parent, move) {
  const chess = new Chess(parent.fen);
  let mv;
  try { mv = chess.move(move); } catch { return null; }
  const found = parent.children.find((c) => c.san === mv.san);
  if (found) return found;
  const n = makeNode(parent, mv, chess, false);
  parent.children.push(n);
  return n;
}
function buildTree(game, notes) {
  const root = { key: '', san: null, fen: START, ply: 0, parent: null, children: [], main: true };
  const chess = new Chess();
  let node = root;
  const mainline = [root];
  for (const san of game.moves) {
    let mv;
    try { mv = chess.move(san); } catch { break; }
    const n = makeNode(node, mv, chess, true);
    node.children.push(n);
    node = n;
    mainline.push(n);
  }
  for (const path of notes.v || []) {
    let n = root;
    for (const san of path.split(' ')) { n = addChild(n, san); if (!n) break; }
  }
  return { root, mainline };
}
function findKey(root, key) {
  if (!key) return key === '' ? root : null;
  let n = root;
  for (const san of key.split(' ')) { n = n.children.find((c) => c.san === san); if (!n) return null; }
  return n;
}
function leafKeys(root) {
  const out = [];
  const walk = (n) => {
    if (!n.children.length) { if (!n.main) out.push(n.key); return; }
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

// ---------- view ----------
export function reviewView() {
  const game = gameById(S.reviewId);
  if (!game) return empty('Game not found.');
  const notes = (S.notes[game.id] ||= { c: {}, v: [] });
  const analysis = S.analysis[game.id];
  const rv = analysis ? review(game, analysis) : null;
  const { root, mainline } = buildTree(game, notes);
  const last = mainline.length - 1;
  let node = findKey(root, lastNode.get(game.id)) || mainline[last];
  let orientation = current?.game === game.id ? current.orientation : game.color;
  let liveLines = [];
  let liveDone = false;
  const set = S.settings;
  const persist = () => { notes.v = leafKeys(root); save('notes'); };

  // ----- board column -----
  const evalFill = h('div.evalbar-fill');
  const evalLabel = h('div.evalbar-label');
  const evalBar = h('div.evalbar' + (set.showEval ? '' : '.hidden'), evalFill, evalLabel);
  const cgEl = h('div.cg');
  const topPlayer = h('div.player');
  const botPlayer = h('div.player');
  const clockOf = (color) => {
    if (!game.clocks || !node.main) return null;
    let k = node.ply;
    while (k > 0 && (k % 2 === 1) !== (color === 'white')) k--;
    return k === 0 ? game.initial : game.clocks[k - 1] ?? null;
  };
  const playerRow = (el, color) => {
    const isMe = color === game.color;
    el.replaceChildren(
      h('span.sd.' + color),
      h('span.pname', isMe ? game.me : game.opp),
      h('span.elo', (isMe ? game.myElo : game.oppElo) ?? ''),
      rv && rv.accuracy[color] != null ? h('span.acc-badge', rv.accuracy[color].toFixed(1)) : null,
      h('span.clock', fmtClock(clockOf(color))));
  };
  const boardCol = h('div.review-board', topPlayer, h('div.board-row', evalBar, h('div.board-wrap.rv', cgEl)), botPlayer);

  // ----- side column -----
  const head = h('div.rv-head',
    h('div.rv-title', h('span.res.' + game.result, game.result === 'win' ? 'Won' : game.result === 'loss' ? 'Lost' : 'Draw'),
      h('b', `${game.me} vs ${game.opp}`), h('span.muted', `${cap(game.speed)} ${game.tc} · ${fmtDate(game.ts)}`)),
    h('div.rv-sub', game.eco ? h('span.eco', game.eco) : null, h('span.ellip', { title: game.opening }, game.opening),
      h('a.link', { href: '#', onclick: (e) => { e.preventDefault(); window.api.openExternal(game.url); } }, `${siteName(game.site)} ↗`)));

  let summary;
  if (rv) {
    const stat = (color) => {
      const c = rv.counts[color];
      return h('div.acc-pill', { title: `${color === game.color ? 'Your' : game.opp + "'s"} accuracy` }, h('span.sd.' + color), h('b', rv.accuracy[color]?.toFixed(1) ?? '–'),
        h('span.cnt.blunder', `${c.blunder}??`), h('span.cnt.mistake', `${c.mistake}?`), h('span.cnt.inaccuracy', `${c.inaccuracy}?!`));
    };
    const cv = h('canvas');
    summary = h('div.rv-summary',
      h('div.acc-strip', stat(game.color), stat(game.color === 'white' ? 'black' : 'white'), h('span.spacer'),
        h('button.link.small', { title: 'Re-run the full-game review deeper', onclick: () => startAnalysis(Math.max(set.depth, analysis.depth + 4)) }, `depth ${analysis.depth} · go deeper`)),
      h('div.evalgraph', cv));
    queueMicrotask(() => drawGraph(cv));
  } else {
    const p = running.get(game.id);
    summary = h('div.rv-summary.analyzing', p != null
      ? [h('span.muted', 'Reviewing every move…'), h('div.progress', h('div', { style: { width: p * 100 + '%' } }))]
      : [h('span.muted', 'No full-game review yet.'), h('button.btn.small', { onclick: () => startAnalysis(set.depth) }, `Review game (depth ${set.depth})`)]);
  }

  const switchEl = (label, key, onToggle) => {
    const el = h('button.switch' + (set[key] ? '.on' : ''), { onclick: () => {
      set[key] = !set[key];
      el.classList.toggle('on', set[key]);
      save('settings');
      onToggle();
    } }, h('span.knob'), label);
    return el;
  };
  const depthEl = h('span.depth');
  const linesEl = h('div.lines');
  const mpvSeg = h('div.seg.tiny', { title: 'Number of engine lines' }, [1, 2, 3, 5].map((n) => h('button' + (set.multipv === n ? '.on' : ''), { onclick: (e) => {
    set.multipv = n; save('settings');
    mpvSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
    runLive();
  } }, String(n))));
  const enginePanel = h('div.rv-engine' + (set.showEngine ? '' : '.collapsed'),
    h('div.rv-engine-head',
      switchEl('Engine lines', 'showEngine', () => { enginePanel.classList.toggle('collapsed', !set.showEngine); runLive(); drawArrows(); }),
      switchEl('Eval bar', 'showEval', () => { evalBar.classList.toggle('hidden', !set.showEval); runLive(); setTimeout(redraw, 260); }),
      h('span.spacer'), depthEl, mpvSeg),
    h('div.lines-wrap', linesEl));

  const moveList = h('div.movelist');
  const nodeEls = new Map();
  const info = h('div.rv-info');
  const commentBox = h('textarea.input.comment-input', { rows: 2, placeholder: 'Add a comment to this move…' });
  commentBox.addEventListener('input', () => {
    if (!node.key) return;
    if (commentBox.value.trim()) notes.c[node.key] = commentBox.value; else delete notes.c[node.key];
    save('notes');
    clearTimeout(commentBox._t);
    commentBox._t = setTimeout(renderMoves, 500);
  });
  const controls = h('div.controls',
    h('button.icon-btn', { onclick: () => nav('start'), title: 'Start (↑)' }, '⏮'),
    h('button.icon-btn', { onclick: () => nav('back'), title: 'Back (←)' }, '◀'),
    h('button.icon-btn', { onclick: () => nav('fwd'), title: 'Forward (→)' }, '▶'),
    h('button.icon-btn', { onclick: () => nav('end'), title: 'End of line (↓)' }, '⏭'),
    h('button.icon-btn', { onclick: () => flip(), title: 'Flip board (f)' }, '⇅'));
  const side = h('div.review-side', head, summary, enginePanel,
    h('div.rv-moves', moveList), h('div.rv-note', info, commentBox), controls);
  const view = h('div.review', boardCol, side);

  // ----- move list -----
  function moveBtn(n, withNum) {
    const mvInfo = n.main && rv ? rv.moves[n.ply - 1] : null;
    const el = h('button.mv' + (mvInfo?.cls ? '.' + mvInfo.cls : '') + (n.main ? '' : '.var'),
      { onclick: () => setNode(n), oncontextmenu: (e) => { e.preventDefault(); if (!n.main) deleteFrom(n); },
        title: n.main ? null : 'Right-click to delete this line' },
      withNum ? h('span.vnum', moveNum(n.ply) + ' ') : null, n.san, mvInfo?.cls ? h('sup', SYM[mvInfo.cls]) : null,
      notes.c[n.key] && n.main ? h('span.has-cmt') : null);
    nodeEls.set(n.key, el);
    return el;
  }
  const paren = (alt) => { const sub = []; renderLine(alt, sub); return h('span.paren', ...sub); };
  // Inline rendering of a side line: "12… Nf6 13. e5 (13. d4 …) 13… Nd5"
  function renderLine(start, out) {
    let n = start;
    out.push(moveBtn(n, true));
    let needNum = false;
    if (notes.c[n.key]) { out.push(h('span.cmt', notes.c[n.key])); needNum = true; }
    while (n.children[0]) {
      const next = n.children[0];
      out.push(moveBtn(next, needNum || next.ply % 2 === 1));
      needNum = false;
      if (notes.c[next.key]) { out.push(h('span.cmt', notes.c[next.key])); needNum = true; }
      for (const alt of n.children.slice(1)) { out.push(paren(alt)); needNum = true; }
      n = next;
    }
  }
  function renderMoves() {
    nodeEls.clear();
    const out = [];
    const varBlock = (alts, cmt) => h('div.interrupt',
      cmt ? h('div.cmt-block', cmt) : null,
      alts.map((a) => { const line = []; renderLine(a, line); return h('div.var-line', ...line); }));
    let needBlackNum = false;
    for (let i = 1; i <= last; i++) {
      const n = mainline[i];
      const white = n.ply % 2 === 1;
      if (white) out.push(h('span.mn', `${(n.ply + 1) / 2}.`), moveBtn(n, false));
      else {
        if (needBlackNum) out.push(h('span.mn', `${n.ply / 2}.`), h('span.mv.filler', '…'));
        out.push(moveBtn(n, false));
      }
      needBlackNum = false;
      // Lines that replace this move are shown right after it.
      const alts = n.parent.children.filter((c) => !c.main);
      const cmt = notes.c[n.key];
      if (alts.length || cmt) {
        if (white) out.push(h('span.mv.filler', ''));
        out.push(varBlock(alts, cmt));
        if (white) needBlackNum = true;
      }
    }
    // Lines continuing past the final move of the game.
    const tail = mainline[last].children.filter((c) => !c.main);
    if (tail.length) out.push(varBlock(tail));
    if (last === 0 && !tail.length) out.push(h('div.interrupt', h('span.muted', 'No moves.')));
    moveList.replaceChildren(...out);
    highlight(false);
  }
  function highlight(smooth = true) {
    moveList.querySelectorAll('.mv.active').forEach((e) => e.classList.remove('active'));
    const el = nodeEls.get(node.key);
    if (!el) return;
    el.classList.add('active');
    const top = el.offsetTop, bottom = top + el.offsetHeight;
    if (top < moveList.scrollTop + 8 || bottom > moveList.scrollTop + moveList.clientHeight - 8) {
      moveList.scrollTo({ top: top - moveList.clientHeight / 2, behavior: smooth ? 'smooth' : 'auto' });
    }
  }

  // ----- engine lines -----
  function renderLines() {
    if (!set.showEngine) return;
    const chess = new Chess(node.fen);
    if (chess.isGameOver()) { linesEl.replaceChildren(h('div.line.muted', chess.isCheckmate() ? 'Checkmate' : 'Draw')); depthEl.textContent = ''; return; }
    if (!liveLines.length) {
      if (!linesEl.querySelector('.line')) linesEl.replaceChildren(h('div.line.muted', 'Thinking…'));
      linesEl.classList.add('stale');
      return;
    }
    linesEl.classList.remove('stale');
    depthEl.textContent = `depth ${liveLines[0].depth}${liveDone ? '' : '…'}`;
    linesEl.replaceChildren(...liveLines.map((l) => {
      const sans = pvToSan(node.fen, l.pv, 12);
      return h('div.line',
        h('span.ev' + (l.w >= 0 ? '.w' : '.b'), evalText(l.w, l.mate)),
        h('span.pv', sans.map((m, i) => h('button.pvm', { onclick: () => playPv(l.pv, i), title: 'Play this line on the board' },
          (i === 0 || (node.ply + i) % 2 === 0) ? h('span.vnum', moveNum(node.ply + i + 1) + ' ') : null, m.san))));
    }));
  }
  function playPv(pv, upto) {
    let n = node;
    for (let i = 0; i <= upto; i++) {
      const u = pv[i];
      const c = addChild(n, { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      if (!c) break;
      n = c;
    }
    persist();
    renderMoves();
    setNode(n);
  }
  let liveTimer;
  function runLive() {
    clearTimeout(liveTimer);
    liveLines = [];
    liveDone = false;
    if (!set.showEngine && !set.showEval) { live?.stop(); return; }
    renderLines();
    const fen = node.fen;
    liveTimer = setTimeout(() => {
      if (current !== me) return;
      live ||= new LiveEngine();
      live.analyze(fen, set.showEngine ? set.multipv : 1, set.liveDepth, (lines, done) => {
        if (fen !== node.fen || current !== me) return;
        liveLines = lines;
        liveDone = done;
        renderLines();
        updateEval();
        drawArrows();
      });
    }, 80);
  }

  // ----- board state -----
  let cg, graph, me;
  const destsFor = (fen) => {
    const d = new Map();
    for (const mv of new Chess(fen).moves({ verbose: true })) {
      if (!d.has(mv.from)) d.set(mv.from, []);
      d.get(mv.from).push(mv.to);
    }
    return d;
  };
  function drawArrows() {
    if (!cg) return;
    const shapes = [];
    if (set.showEngine) {
      liveLines.slice(0, 3).forEach((l, i) => {
        const u = l.pv[0];
        if (u) shapes.push({ orig: u.slice(0, 2), dest: u.slice(2, 4), brush: i === 0 ? 'blue' : 'paleBlue' });
      });
    }
    const mvInfo = node.main && rv ? rv.moves[node.ply - 1] : null;
    if (set.showEngine && mvInfo?.cls && mvInfo.bestUci) {
      // Show what should have been played instead of the move that led here.
      shapes.push({ orig: mvInfo.bestUci.slice(0, 2), dest: mvInfo.bestUci.slice(2, 4), brush: 'green' });
    }
    cg.setAutoShapes(shapes);
  }
  function updateEval() {
    let src = null;
    if (liveLines[0] && (liveDone || liveLines[0].depth >= 10)) src = liveLines[0];
    else if (node.main && analysis?.evals[node.ply]) src = analysis.evals[node.ply];
    else if (liveLines[0]) src = liveLines[0];
    if (!src) return;
    evalFill.style.height = winPct(src.w) + '%';
    evalLabel.textContent = evalText(src.w, src.mate);
    evalLabel.className = 'evalbar-label ' + (src.w >= 0 ? 'w' : 'b');
  }
  function updateInfo() {
    const mvInfo = node.main && rv ? rv.moves[node.ply - 1] : null;
    if (document.activeElement !== commentBox) commentBox.value = notes.c[node.key] || '';
    commentBox.disabled = !node.key;
    commentBox.placeholder = node.key ? `Comment on ${moveNum(node.ply)} ${node.san}…` : 'Select a move to comment on it';
    if (!node.key) { info.replaceChildren(h('span.muted', 'Start position. Drag pieces to explore your own lines.')); return; }
    const label = h('b', `${moveNum(node.ply)} ${node.san}`);
    if (!node.main) {
      info.replaceChildren(label, h('span.muted', ' Your line · '), h('button.link.small', { onclick: () => deleteFrom(node) }, 'delete from here'));
    } else if (mvInfo?.cls) {
      const who = mvInfo.mover === game.color ? 'You' : game.opp;
      info.replaceChildren(h('span.tag.' + mvInfo.cls, cap(mvInfo.cls)), ' ', label, h('span.muted', ` by ${who}, −${mvInfo.loss.toFixed(0)}% win chance.`),
        mvInfo.bestSan ? [' Best was ', h('b.best', mvInfo.bestSan), '.'] : null,
        mvInfo.clock != null ? h('span.muted', ` ${fmtClock(mvInfo.clock)} left`) : null);
    } else {
      info.replaceChildren(label, mvInfo ? h('span.muted', mvInfo.bestSan ? ` Fine. Engine preferred ${mvInfo.bestSan}.` : ' Best move.') : null,
        mvInfo?.clock != null ? h('span.muted', ` ${fmtClock(mvInfo.clock)} left`) : null);
    }
  }
  function setNode(n) {
    const changed = n !== node;
    node = n;
    lastNode.set(game.id, n.key);
    const turn = n.ply % 2 === 0 ? 'white' : 'black';
    cg?.set({
      fen: n.fen, turnColor: turn, check: n.check, lastMove: n.from ? [n.from, n.to] : undefined,
      movable: { color: turn, dests: destsFor(n.fen) },
    });
    playerRow(topPlayer, orientation === 'white' ? 'black' : 'white');
    playerRow(botPlayer, orientation);
    evalBar.classList.toggle('flipped', orientation === 'black');
    if (changed || !liveLines.length) { liveLines = []; updateEval(); }
    drawArrows();
    highlight();
    updateInfo();
    runLive();
    graph?.update('none');
  }
  async function onUserMove(orig, dest, promo) {
    const from = node;
    const piece = new Chess(from.fen).get(orig);
    let promotion;
    if (isPromotion(piece, dest)) {
      promotion = promo || await pickPromotion(cgEl, dest, piece.color === 'w' ? 'white' : 'black', orientation);
      if (!promotion || node !== from) { setNode(node); return; } // cancelled, or moved elsewhere meanwhile
    }
    const before = node.children.length;
    const n = addChild(node, { from: orig, to: dest, promotion });
    if (!n) { setNode(node); return; }
    if (node.children.length !== before) { persist(); renderMoves(); }
    setNode(n);
  }
  function deleteFrom(n) {
    if (n.main) return;
    const p = n.parent;
    p.children = p.children.filter((c) => c !== n);
    for (const k of Object.keys(notes.c)) if (k === n.key || k.startsWith(n.key + ' ')) delete notes.c[k];
    persist();
    let cur = node;
    while (cur && cur !== n) cur = cur.parent;
    if (cur === n) node = p;
    renderMoves();
    setNode(node);
    toast('Line deleted');
  }
  function nav(k) {
    if (k === 'back' && node.parent) setNode(node.parent);
    else if (k === 'fwd' && node.children[0]) setNode(node.children[0]);
    else if (k === 'start') setNode(root);
    else if (k === 'end') { let n = node; while (n.children[0]) n = n.children[0]; setNode(n); }
  }
  function flip() {
    orientation = orientation === 'white' ? 'black' : 'white';
    current.orientation = orientation;
    cg.set({ orientation });
    setNode(node);
  }
  function redraw() { cg?.redrawAll(); }
  async function startAnalysis(depth) {
    if (running.has(game.id)) return;
    running.set(game.id, 0);
    window.go('review');
    let lastDraw = 0;
    const a = await analyzeGame(game, depth, (p) => {
      running.set(game.id, p);
      if (S.view === 'review' && S.reviewId === game.id && Date.now() - lastDraw > 150) {
        lastDraw = Date.now();
        const bar = document.querySelector('.rv-summary .progress div');
        if (bar) bar.style.width = p * 100 + '%';
      }
    });
    running.delete(game.id);
    storeAnalysis(game, a);
    if (S.view === 'review' && S.reviewId === game.id) window.go('review');
    else toast('Game review finished');
  }
  function drawGraph(cv) {
    const data = analysis.evals.map((e, i) => ({ x: i, y: winPct(e.w) }));
    const marks = rv.moves.map((m) => (m.cls === 'mistake' || m.cls === 'blunder' ? C[m.cls] : null));
    const cursor = {
      id: 'cursor',
      afterDatasetsDraw(c) {
        let n = node;
        while (!n.main) n = n.parent;
        const x = c.scales.x.getPixelForValue(n.ply);
        const { top, bottom } = c.chartArea;
        c.ctx.save();
        c.ctx.strokeStyle = C.blue; c.ctx.lineWidth = 1.5;
        c.ctx.beginPath(); c.ctx.moveTo(x, top); c.ctx.lineTo(x, bottom); c.ctx.stroke();
        c.ctx.restore();
      },
    };
    graph = chart(cv, {
      type: 'line',
      data: { datasets: [{
        data, fill: { target: { value: 50 }, above: 'rgba(240,239,236,0.55)', below: 'rgba(0,0,0,0)' },
        borderColor: C.ink2, borderWidth: 1.2, tension: 0.1,
        pointRadius: (ctx) => (marks[ctx.dataIndex - 1] ? 3.5 : 0),
        pointBackgroundColor: (ctx) => marks[ctx.dataIndex - 1] || C.ink2, pointBorderWidth: 0,
      }] },
      options: {
        maintainAspectRatio: false, animation: false,
        layout: { padding: { top: 3, bottom: 3 } },
        scales: { x: { type: 'linear', display: false, min: 0, max: Math.max(1, last) }, y: { display: false, min: 0, max: 100 } },
        interaction: { mode: 'nearest', intersect: false, axis: 'x' },
        onClick: (_e, els) => { if (els[0]) setNode(mainline[els[0].index]); },
        plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: {
          title: (it) => { const i = it[0].dataIndex; return i === 0 ? 'Start' : `${moveNum(i)} ${mainline[i].san}`; },
          label: (it) => `Eval ${evalText(analysis.evals[it.dataIndex].w, analysis.evals[it.dataIndex].mate)}`,
        } } },
      },
      plugins: [cursor],
    });
  }

  current = {
    game: game.id, orientation, nav, flip: () => flip(), redraw,
    // Hooks for the automated self-test.
    test: {
      play: (uci) => onUserMove(uci.slice(0, 2), uci.slice(2, 4), uci[4]),
      comment: (t) => { commentBox.value = t; commentBox.dispatchEvent(new Event('input')); },
      del: () => deleteFrom(node),
      state: () => ({ key: node.key, main: node.main, nextMain: node.children[0]?.uci ?? null, lines: liveLines.map((l) => l.pv[0]), depth: liveLines[0]?.depth ?? 0,
        varLines: moveList.querySelectorAll('.var-line').length, cmts: moveList.querySelectorAll('.cmt-block,.cmt').length,
        evalHidden: evalBar.classList.contains('hidden'), engineCollapsed: enginePanel.classList.contains('collapsed') }),
    },
  };
  me = current;
  window.__review = current;
  queueMicrotask(() => {
    renderMoves();
    cg = board(cgEl, {
      fen: node.fen, orientation,
      movable: { free: false, color: node.ply % 2 === 0 ? 'white' : 'black', dests: destsFor(node.fen), showDests: true, events: { after: (o, d) => onUserMove(o, d) } },
      premovable: { enabled: false },
    });
    setNode(node);
  });
  return view;
}

// Stops the live engine when leaving the review screen.
export function leaveReview() { live?.stop(); current = null; }
