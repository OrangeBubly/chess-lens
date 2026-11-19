// Normalizes Lichess and Chess.com games into one shape, plus stat helpers.

const SPEEDS = ['bullet', 'blitz', 'rapid', 'classical', 'daily'];
export { SPEEDS };

function speedFrom(initial, inc) {
  const est = initial + 40 * inc;
  if (est < 180) return 'bullet';
  if (est < 480) return 'blitz';
  if (est < 1500) return 'rapid';
  return 'classical';
}

export function openingFamily(name) {
  if (!name) return 'Unknown';
  if (name.includes(':')) return name.split(':')[0].trim();
  const m = name.match(/^(.*?\b(Opening|Defense|Defence|Game|Gambit(?: Declined| Accepted)?|Attack|System|Countergambit))\b/);
  return (m ? m[1] : name.split(' ').slice(0, 3).join(' ')).trim();
}
export const familyKey = (n) => n.toLowerCase().replace(/defence/g, 'defense').replace(/[^a-z]/g, '');

// ----- Lichess -----
export function fromLichess(g, user) {
  if (g.variant !== 'standard' || !g.moves) return null;
  if (['aborted', 'noStart', 'created', 'started', 'unknownFinish'].includes(g.status)) return null;
  const lu = user.toLowerCase();
  const wName = g.players.white.user?.name || 'Anonymous';
  const bName = g.players.black.user?.name || 'Anonymous';
  const color = wName.toLowerCase() === lu ? 'white' : bName.toLowerCase() === lu ? 'black' : null;
  if (!color) return null;
  const me = g.players[color], op = g.players[color === 'white' ? 'black' : 'white'];
  const result = !g.winner ? 'draw' : g.winner === color ? 'win' : 'loss';
  const how = { mate: 'checkmate', resign: 'resignation', outoftime: 'time', timeout: 'abandoned', draw: 'agreement', stalemate: 'stalemate', cheat: 'other' }[g.status] || 'other';
  const initial = g.clock?.initial ?? (g.daysPerTurn ? 86400 * g.daysPerTurn : 0);
  const inc = g.clock?.increment ?? 0;
  const speed = g.speed === 'correspondence' ? 'daily' : g.speed === 'ultraBullet' ? 'bullet' : g.speed;
  const opening = g.opening?.name || 'Unknown';
  return {
    id: 'li:' + g.id, site: 'lichess', url: `https://lichess.org/${g.id}${color === 'black' ? '/black' : ''}`,
    color, me: me.user?.name, opp: op.user?.name || 'Anonymous',
    myElo: me.rating ?? null, oppElo: op.rating ?? null, result, how, speed, rated: !!g.rated,
    ts: g.createdAt, tc: g.clock ? `${initial / 60 >= 1 ? initial / 60 : initial + 's'}+${inc}` : 'daily',
    initial, inc, eco: g.opening?.eco || '', opening, family: openingFamily(opening),
    moves: g.moves.split(' '),
    clocks: g.clocks ? g.clocks.map((c) => c / 100) : null,
  };
}

// ----- Chess.com -----
function parsePgn(pgn) {
  const headers = {};
  for (const m of pgn.matchAll(/^\[(\w+)\s+"(.*)"\]$/gm)) headers[m[1]] = m[2];
  const body = pgn.replace(/^\[.*\]$/gm, '');
  const clocks = [];
  for (const m of body.matchAll(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/g)) clocks.push(+m[1] * 3600 + +m[2] * 60 + +m[3]);
  const moves = body
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/, ' ')
    .split(/\s+/)
    .filter((t) => t && !/^\$\d+$/.test(t));
  return { headers, moves, clocks };
}

const DRAW_CODES = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);
const HOW = { checkmated: 'checkmate', resigned: 'resignation', timeout: 'time', abandoned: 'abandoned', agreed: 'agreement', repetition: 'repetition', stalemate: 'stalemate', insufficient: 'insufficient material', '50move': '50-move rule', timevsinsufficient: 'time vs insufficient' };

function nameFromEcoUrl(url) {
  if (!url) return null;
  let slug = decodeURIComponent(url.split('/openings/')[1] || '');
  slug = slug.replace(/-?\.{0,3}\d+\..*$/, '');
  const name = slug.replace(/-/g, ' ').trim();
  return name || null;
}

export function fromChesscom(g, user) {
  if (g.rules !== 'chess' || !g.pgn) return null;
  const lu = user.toLowerCase();
  const color = g.white.username.toLowerCase() === lu ? 'white' : g.black.username.toLowerCase() === lu ? 'black' : null;
  if (!color) return null;
  const me = g[color], op = g[color === 'white' ? 'black' : 'white'];
  const result = me.result === 'win' ? 'win' : DRAW_CODES.has(me.result) ? 'draw' : 'loss';
  const how = HOW[result === 'win' ? op.result : me.result] || 'other';
  const { headers, moves, clocks } = parsePgn(g.pgn);
  if (!moves.length) return null;
  let initial = 0, inc = 0;
  if (g.time_control.includes('/')) initial = +g.time_control.split('/')[1];
  else [initial, inc = 0] = g.time_control.split('+').map(Number);
  const speed = g.time_class === 'daily' ? 'daily' : SPEEDS.includes(g.time_class) ? g.time_class : speedFrom(initial, inc);
  const opening = nameFromEcoUrl(g.eco || headers.ECOUrl) || headers.Opening || 'Unknown';
  const id = g.uuid || g.url.split('/').pop();
  return {
    id: 'cc:' + id, site: 'chesscom', url: g.url, color, me: me.username, opp: op.username,
    myElo: me.rating ?? null, oppElo: op.rating ?? null, result, how, speed, rated: !!g.rated,
    ts: (g.start_time || g.end_time) * 1000,
    tc: g.time_class === 'daily' ? 'daily' : `${initial >= 60 ? initial / 60 : initial + 's'}+${inc}`,
    initial, inc, eco: headers.ECO || '', opening, family: openingFamily(opening), moves,
    clocks: clocks.length >= moves.length - 1 && speed !== 'daily' ? clocks : null,
  };
}

// ----- filters -----
export function applyFilters(games, f) {
  const now = Date.now();
  const cutoff = f.period === 'all' ? 0 : now - { '30d': 30, '90d': 90, '1y': 365 }[f.period] * 864e5;
  return games.filter((g) =>
    (f.site === 'all' || g.site === f.site) &&
    (f.speed === 'all' || g.speed === f.speed) &&
    (!f.rated || g.rated) &&
    g.ts >= cutoff);
}

// ----- stats -----
export function wdl(games) {
  const r = { win: 0, draw: 0, loss: 0, n: games.length };
  for (const g of games) r[g.result]++;
  r.score = r.n ? (r.win + r.draw / 2) / r.n : 0;
  return r;
}
export const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';

export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export const siteName = (s) => (s === 'lichess' ? 'Lichess' : 'Chess.com');
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Expected score from rating difference (Elo).
export const expected = (diff) => 1 / (1 + Math.pow(10, -diff / 400));
