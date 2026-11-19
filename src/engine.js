// Stockfish (WASM, in Web Workers) and game-review math.
import { Chess } from 'chess.js';

class Engine {
  constructor() {
    this.worker = new Worker('engine/stockfish.js');
    this.listeners = [];
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const l of [...this.listeners]) l(line);
    };
    this.ready = this.cmd(['uci', 'setoption name Hash value 32', 'isready'], (l) => l === 'readyok');
  }
  cmd(lines, until) {
    return new Promise((resolve) => {
      const fn = (l) => {
        if (until(l)) {
          this.listeners = this.listeners.filter((x) => x !== fn);
          resolve(l);
        }
      };
      this.listeners.push(fn);
      for (const c of lines) this.worker.postMessage(c);
    });
  }
  // Returns { cp, mate, best, pv } from the side to move's point of view.
  async analyze(fen, depth) {
    await this.ready;
    let last = null;
    const tap = (l) => { if (l.startsWith('info') && l.includes(' pv ') && l.includes(' score ')) last = l; };
    this.listeners.push(tap);
    const done = await this.cmd([`position fen ${fen}`, `go depth ${depth}`], (l) => l.startsWith('bestmove'));
    this.listeners = this.listeners.filter((x) => x !== tap);
    const best = done.split(' ')[1];
    const r = { cp: 0, mate: null, best: best === '(none)' ? null : best, pv: [] };
    if (last) {
      const m = last.match(/score (cp|mate) (-?\d+)/);
      if (m) m[1] === 'cp' ? (r.cp = +m[2]) : (r.mate = +m[2]);
      r.pv = (last.split(' pv ')[1] || '').split(' ').slice(0, 8);
    }
    return r;
  }
  newGame() { this.worker.postMessage('ucinewgame'); }
}

// ---------- live multi-line analysis (analysis board) ----------
// One dedicated engine; a new position stops the old search first.
export class LiveEngine {
  constructor() {
    this.e = new Engine();
    this.searching = false;
    this.req = null;
    this.cur = null;
    this.e.listeners.push((l) => this.onLine(l));
  }
  analyze(fen, multipv, depth, cb) {
    this.req = { fen, multipv, depth, cb };
    if (this.searching) this.e.worker.postMessage('stop');
    else this.e.ready.then(() => { if (!this.searching) this.launch(); });
  }
  stop() {
    this.req = null;
    if (this.searching) this.e.worker.postMessage('stop');
    this.cur = null;
  }
  launch() {
    const r = this.req;
    this.req = null;
    if (!r) return;
    this.cur = { ...r, lines: [], white: r.fen.split(' ')[1] === 'w', last: 0 };
    this.searching = true;
    const p = (c) => this.e.worker.postMessage(c);
    p(`setoption name MultiPV value ${r.multipv}`);
    p(`position fen ${r.fen}`);
    p(`go depth ${r.depth}`);
  }
  onLine(l) {
    if (l.startsWith('bestmove')) {
      this.searching = false;
      const cur = this.cur;
      if (this.req) this.launch();
      else if (cur) cur.cb(cur.lines.filter(Boolean), true);
      return;
    }
    const cur = this.cur;
    if (!cur || this.req || !l.startsWith('info') || !l.includes(' pv ')) return;
    const m = l.match(/ depth (\d+).* multipv (\d+).* score (cp|mate) (-?\d+).* pv (.+)$/);
    if (!m) return;
    const sign = cur.white ? 1 : -1;
    const raw = m[3] === 'cp' ? { cp: +m[4], mate: null } : { cp: 0, mate: +m[4] };
    cur.lines[+m[2] - 1] = { depth: +m[1], w: sign * toCp(raw), mate: raw.mate != null ? sign * raw.mate : null, pv: m[5].trim().split(' ') };
    const now = performance.now();
    if (now - cur.last > 120 && +m[2] === cur.multipv) { cur.last = now; cur.cb(cur.lines.filter(Boolean), false); }
  }
}

// Converts a UCI principal variation to SAN moves (stops at the first illegal one).
export function pvToSan(fen, pv, max = 14) {
  const c = new Chess(fen);
  const out = [];
  for (const u of pv.slice(0, max)) {
    try {
      const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push({ san: mv.san, uci: u, ply: out.length });
    } catch { break; }
  }
  return out;
}

// ---------- pool ----------
const pool = [];
const waiting = [];
const free = [];
export function poolSize() {
  return Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
}
function acquire() {
  if (free.length) return Promise.resolve(free.pop());
  if (pool.length < poolSize()) {
    const e = new Engine();
    pool.push(e);
    return Promise.resolve(e);
  }
  return new Promise((r) => waiting.push(r));
}
function release(e) {
  const w = waiting.shift();
  w ? w(e) : free.push(e);
}
export async function withEngine(fn) {
  const e = await acquire();
  try { return await fn(e); } finally { release(e); }
}

// ---------- math ----------
export const MATE_CP = 10000;
export function toCp(ev) {
  if (ev.mate != null) return ev.mate > 0 ? MATE_CP - ev.mate * 10 : ev.mate < 0 ? -MATE_CP - ev.mate * 10 : 0;
  return ev.cp;
}
// Win probability (0-100) for the side whose cp this is (Lichess model).
export const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
export const moveAccuracy = (loss) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));

export const CLASSES = { inaccuracy: 5, mistake: 10, blunder: 15 };
export function classify(loss) {
  if (loss >= CLASSES.blunder) return 'blunder';
  if (loss >= CLASSES.mistake) return 'mistake';
  if (loss >= CLASSES.inaccuracy) return 'inaccuracy';
  return null;
}

function phaseOf(chess, ply) {
  let pieces = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && 'nbrq'.includes(sq.type)) pieces++;
  if (pieces <= 6) return 'endgame';
  if (ply < 24) return 'opening';
  return 'middlegame';
}

// Replays the game, returning positions with FEN, move info and phase.
export function replay(moves) {
  const chess = new Chess();
  const positions = [{ fen: chess.fen(), move: null, phase: 'opening', check: false }];
  for (let i = 0; i < moves.length; i++) {
    let mv;
    try { mv = chess.move(moves[i]); } catch { break; }
    positions.push({ fen: chess.fen(), move: mv, phase: phaseOf(chess, i + 1), check: chess.inCheck() });
  }
  return positions;
}

export function uciToSan(fen, uci) {
  if (!uci) return null;
  try {
    const c = new Chess(fen);
    return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch { return uci; }
}

// Runs the engine over every position of a game.
export async function analyzeGame(game, depth, onProgress) {
  const positions = replay(game.moves);
  const evals = new Array(positions.length);
  await withEngine(async (engine) => {
    engine.newGame();
    for (let i = 0; i < positions.length; i++) {
      const fen = positions[i].fen;
      const c = new Chess(fen);
      if (c.isCheckmate()) {
        evals[i] = { w: i % 2 === 0 ? -MATE_CP : MATE_CP, mate: 0, best: null };
      } else if (c.isDraw() || c.isStalemate()) {
        evals[i] = { w: 0, best: null };
      } else {
        const r = await engine.analyze(fen, depth);
        const stm = i % 2 === 0 ? 1 : -1; // white to move on even plies
        evals[i] = { w: stm * toCp(r), mate: r.mate != null ? stm * r.mate : null, best: r.best, pv: r.pv.slice(0, 6) };
      }
      onProgress?.((i + 1) / positions.length);
    }
  });
  return { depth, evals, at: Date.now() };
}

// Turns raw evals into per-move review data and a compact summary.
export function review(game, analysis) {
  const positions = replay(game.moves);
  const ev = analysis.evals;
  const moves = [];
  const acc = { white: [], black: [] };
  const counts = { white: { inaccuracy: 0, mistake: 0, blunder: 0 }, black: { inaccuracy: 0, mistake: 0, blunder: 0 } };
  for (let i = 1; i < positions.length && i < ev.length; i++) {
    const mover = i % 2 === 1 ? 'white' : 'black';
    const sign = mover === 'white' ? 1 : -1;
    const before = winPct(sign * ev[i - 1].w);
    const after = winPct(sign * ev[i].w);
    const mv = positions[i].move;
    const isBest = ev[i - 1].best && ev[i - 1].best === mv.from + mv.to + (mv.promotion || '');
    const loss = isBest ? 0 : Math.max(0, before - after);
    const cls = classify(loss);
    if (cls) counts[mover][cls]++;
    acc[mover].push(moveAccuracy(loss));
    moves.push({
      ply: i, mover, san: mv.san, from: mv.from, to: mv.to, loss, cls, before, after,
      bestUci: ev[i - 1].best, bestSan: isBest ? null : uciToSan(positions[i - 1].fen, ev[i - 1].best),
      phase: positions[i].phase, fenBefore: positions[i - 1].fen,
      clock: game.clocks ? game.clocks[i - 1] ?? null : null,
    });
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { positions, moves, accuracy: { white: mean(acc.white), black: mean(acc.black) }, counts };
}

// Compact per-game summary used by the Patterns and Train views.
export function summarize(game, analysis) {
  const r = review(game, analysis);
  const mine = r.moves.filter((m) => m.mover === game.color);
  const sign = game.color === 'white' ? 1 : -1;
  const myWin = analysis.evals.map((e) => winPct(sign * e.w));
  return {
    acc: r.accuracy[game.color],
    oppAcc: r.accuracy[game.color === 'white' ? 'black' : 'white'],
    counts: r.counts[game.color],
    peak: Math.max(...myWin),
    low: Math.min(...myWin),
    moves: mine.map((m) => ({
      ply: m.ply, cls: m.cls, loss: +m.loss.toFixed(1), phase: m.phase,
      clock: m.clock, ...(m.cls === 'mistake' || m.cls === 'blunder'
        ? { fen: m.fenBefore, san: m.san, best: m.bestUci, bestSan: m.bestSan, before: +m.before.toFixed(1) }
        : {}),
    })),
  };
}
