import { S, filtered, runBatch } from '../state.js';
import { fmtDate, cap } from '../data.js';
import { h, empty } from '../ui.js';

const ui = { q: '', limit: 100, result: 'all', color: 'all' };

export function gamesView() {
  let games = filtered();
  if (!games.length) return empty('No games match these filters.');
  const q = ui.q.trim().toLowerCase();
  if (q) games = games.filter((g) => g.opp.toLowerCase().includes(q) || g.opening.toLowerCase().includes(q) || g.eco.toLowerCase() === q);
  if (ui.result !== 'all') games = games.filter((g) => g.result === ui.result);
  if (ui.color !== 'all') games = games.filter((g) => g.color === ui.color);

  const unanalyzed = games.filter((g) => !S.summaries[g.id] && g.moves.length >= 10);
  const search = h('input.input', { placeholder: 'Search opponent, opening or ECO…', value: ui.q });
  search.addEventListener('input', () => {
    ui.q = search.value;
    clearTimeout(search._t);
    search._t = setTimeout(() => { window.go('games'); const s = document.querySelector('.games-toolbar input'); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); }, 250);
  });
  const pick = (key, opts) => h('div.seg.small', opts.map(([v, l]) => h('button' + (ui[key] === v ? '.on' : ''), { onclick: () => { ui[key] = v; window.go('games'); } }, l)));

  const n = Math.min(25, unanalyzed.length);
  const toolbar = h('div.games-toolbar', search,
    pick('result', [['all', 'All'], ['win', 'Wins'], ['draw', 'Draws'], ['loss', 'Losses']]),
    pick('color', [['all', 'Both'], ['white', 'White'], ['black', 'Black']]),
    h('div.spacer'),
    n ? h('button.btn', { disabled: S.batch.running, onclick: () => runBatch(unanalyzed.slice(0, 25)) }, `Analyze ${n} recent`) : null);

  const rows = games.slice(0, ui.limit).map((g) => {
    const s = S.summaries[g.id];
    return h('tr.click', { onclick: () => window.go('review', { reviewId: g.id }) },
      h('td.muted', fmtDate(g.ts)),
      h('td', h('span.site.' + g.site, g.site === 'lichess' ? 'LI' : 'CC')),
      h('td', h('span.sd.' + g.color), h('span.opp', g.opp), g.oppElo ? h('span.elo', ` ${g.oppElo}`) : null),
      h('td', h('span.res.' + g.result, g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Draw'), h('span.how', g.how)),
      h('td.opening-cell', { title: g.opening }, g.opening),
      h('td.muted', `${cap(g.speed)} ${g.tc}`),
      h('td.num.muted', Math.ceil(g.moves.length / 2)),
      h('td.num', s ? h('span.acc', s.acc?.toFixed(0)) : h('span.muted', '–')));
  });

  return h('div.stack', toolbar,
    h('section.card.flush', h('table.table.games',
      h('thead', h('tr', h('th', 'Date'), h('th', 'Site'), h('th', 'Opponent'), h('th', 'Result'), h('th', 'Opening'), h('th', 'Time'), h('th.num', 'Moves'), h('th.num', 'Accuracy'))),
      h('tbody', rows))),
    games.length > ui.limit ? h('button.btn.ghost.center', { onclick: () => { ui.limit += 200; window.go('games'); } }, `Show more (${games.length - ui.limit} left)`) : null);
}
