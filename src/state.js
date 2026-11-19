// App state, persistence, syncing and batch analysis.
import { fromLichess, fromChesscom, applyFilters } from './data.js';
import { analyzeGame, summarize, poolSize } from './engine.js';

export const S = {
  settings: { lichess: '', chesscom: '', range: '1y', depth: 14, batchDepth: 10, showEval: true, showEngine: true, multipv: 3, liveDepth: 20, navCollapsed: false },
  notes: {},
  games: [],
  analysis: {},
  summaries: {},
  trained: {},
  filters: { site: 'all', speed: 'all', period: 'all', rated: false },
  view: 'dashboard',
  reviewId: null,
  sync: { running: false, text: '' },
  batch: { running: false, done: 0, total: 0, cancel: false },
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const emit = (what) => listeners.forEach((fn) => fn(what));

export async function load() {
  const [settings, games, analysis, summaries, trained, filters, notes] = await Promise.all(
    ['settings', 'games', 'analysis', 'summaries', 'trained', 'filters', 'notes'].map((n) => window.api.get(n)));
  Object.assign(S.settings, settings || {});
  Object.assign(S.filters, filters || {});
  S.games = games || [];
  S.analysis = analysis || {};
  S.summaries = summaries || {};
  S.trained = trained || {};
  S.notes = notes || {};
}

const timers = {};
export function save(name, delay = 400) {
  clearTimeout(timers[name]);
  timers[name] = setTimeout(() => window.api.set(name, S[name]), delay);
}

export const filtered = () => applyFilters(S.games, S.filters);
export const gameById = (id) => S.games.find((g) => g.id === id);

// ---------- sync ----------
const RANGE_MS = { '3m': 92, '1y': 366, all: null };

export async function sync() {
  if (S.sync.running) return;
  const { lichess, chesscom, range } = S.settings;
  if (!lichess && !chesscom) return;
  S.sync = { running: true, text: 'Starting…' };
  emit('sync');
  const byId = new Map(S.games.map((g) => [g.id, g]));
  const errors = [];
  let added = 0;
  const sinceFor = (site, user) => {
    const mine = S.games.filter((g) => g.site === site && g.me?.toLowerCase() === user.toLowerCase());
    if (mine.length) return Math.max(...mine.map((g) => g.ts)) + 1;
    return RANGE_MS[range] ? Date.now() - RANGE_MS[range] * 864e5 : 0;
  };
  const jobs = [];
  if (lichess) jobs.push(['lichess', lichess, window.api.importLichess, fromLichess]);
  if (chesscom) jobs.push(['chesscom', chesscom, window.api.importChesscom, fromChesscom]);
  await Promise.all(jobs.map(async ([site, user, fetcher, norm]) => {
    try {
      const raw = await fetcher(user.trim(), sinceFor(site, user));
      for (const r of raw) {
        const g = norm(r, user.trim());
        if (g && !byId.has(g.id)) { byId.set(g.id, g); added++; }
      }
    } catch (e) {
      errors.push(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  }));
  S.games = [...byId.values()].sort((a, b) => b.ts - a.ts);
  save('games', 0);
  S.settings.lastSync = Date.now();
  save('settings', 0);
  S.sync = { running: false, text: errors.length ? errors.join(' · ') : `${added} new game${added === 1 ? '' : 's'}`, error: errors.length > 0, at: Date.now() };
  emit('games');
}

window.api.onProgress((p) => {
  if (!S.sync.running) return;
  S.sync.parts = { ...(S.sync.parts || {}), [p.site]: p.text };
  S.sync.text = Object.values(S.sync.parts).join(' · ');
  emit('sync');
});

// ---------- analysis ----------
export function storeAnalysis(game, a) {
  S.analysis[game.id] = a;
  S.summaries[game.id] = summarize(game, a);
  save('analysis', 1500);
  save('summaries', 1500);
}

export async function runBatch(games, depth = S.settings.batchDepth) {
  if (S.batch.running) return;
  const todo = games.filter((g) => !S.summaries[g.id] && g.moves.length >= 10);
  if (!todo.length) return;
  S.batch = { running: true, done: 0, total: todo.length, cancel: false };
  emit('batch');
  let i = 0;
  const worker = async () => {
    while (i < todo.length && !S.batch.cancel) {
      const g = todo[i++];
      try {
        const a = await analyzeGame(g, depth);
        storeAnalysis(g, a);
      } catch (e) { console.error('analysis failed', g.id, e); }
      S.batch.done++;
      emit('batch');
    }
  };
  await Promise.all(Array.from({ length: poolSize() }, worker));
  S.batch.running = false;
  emit('batch');
  emit('analysis');
}
