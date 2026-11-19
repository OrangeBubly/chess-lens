import { S, load, save, sync, onChange, emit } from './state.js';
import { h, destroyCharts, toast, quiet } from './ui.js';
import { SPEEDS, cap } from './data.js';
import { dashboard } from './views/dashboard.js';
import { openings } from './views/openings.js';
import { gamesView } from './views/games.js';
import { reviewView, leaveReview } from './views/review.js';
import { patterns } from './views/patterns.js';
import { train } from './views/train.js';
import { settingsView, onboarding } from './views/settings.js';

const NAV = [
  ['dashboard', 'Dashboard', 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z'],
  ['openings', 'Openings', 'M4 6h16M4 12h10M4 18h6'],
  ['games', 'Games', 'M4 5h16v14H4zM4 10h16M9 5v14'],
  ['patterns', 'Patterns', 'M3 17l5-5 4 4 8-8M15 8h5v5'],
  ['train', 'Train', 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5'],
  ['settings', 'Settings', 'M12 8a4 4 0 100 8 4 4 0 000-8zM4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6l1.4 1.4M6.3 17.7l1.4-1.4m8.6-8.6l1.4-1.4'],
];
const icon = (d) => {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
};

const VIEWS = { dashboard, openings, games: gamesView, review: reviewView, patterns, train, settings: settingsView };
const FILTERED = new Set(['dashboard', 'openings', 'games', 'patterns']);

// Navigates; re-showing the same screen refreshes it in place without the enter animation.
export function go(view, extra = {}) {
  const same = view === S.view && (extra.reviewId === undefined || extra.reviewId === S.reviewId);
  Object.assign(S, extra);
  S.view = view;
  if (same) quiet(refreshKeepScroll); else render();
}
window.go = go;

let main, topbar, nav;

function seg(key, options) {
  return h('div.seg', options.map(([v, label]) =>
    h('button' + (S.filters[key] === v ? '.on' : ''), { onclick: () => { S.filters[key] = v; save('filters'); render(); } }, label)));
}

function renderTopbar() {
  topbar.replaceChildren();
  const title = { review: 'Game review' }[S.view] || NAV.find((n) => n[0] === S.view)?.[1] || '';
  topbar.append(h('div.top-title', title));
  if (FILTERED.has(S.view) && S.games.length) {
    const sites = [['all', 'All sites']];
    if (S.games.some((g) => g.site === 'lichess')) sites.push(['lichess', 'Lichess']);
    if (S.games.some((g) => g.site === 'chesscom')) sites.push(['chesscom', 'Chess.com']);
    const present = new Set(S.games.map((g) => g.speed));
    topbar.append(h('div.filters',
      sites.length > 2 ? seg('site', sites) : null,
      seg('speed', [['all', 'All'], ...SPEEDS.filter((s) => present.has(s)).map((s) => [s, cap(s)])]),
      seg('period', [['30d', '30d'], ['90d', '90d'], ['1y', '1y'], ['all', 'All']]),
      h('button.chip' + (S.filters.rated ? '.on' : ''), { onclick: () => { S.filters.rated = !S.filters.rated; save('filters'); render(); } }, 'Rated only'),
    ));
  }
  const status = h('div.sync-status' + (S.sync.error ? '.err' : ''), S.sync.running || S.sync.error ? S.sync.text : '');
  const btn = h('button.btn.ghost.sync-btn' + (S.sync.running ? '.spin' : ''), { onclick: () => sync(), disabled: S.sync.running, title: 'Download new games' },
    icon('M20 11a8 8 0 00-14.9-3M4 13a8 8 0 0014.9 3M4 4v4h4m12 12v-4h-4'), S.sync.running ? 'Syncing' : 'Sync');
  topbar.append(h('div.top-right', status, S.settings.lichess || S.settings.chesscom ? btn : null));
}

let navFoot;
function renderNav() {
  document.body.classList.toggle('nav-collapsed', !!S.settings.navCollapsed);
  navFoot = h('div.nav-foot');
  nav.replaceChildren(
    h('div.brand', h('span.logo', '♞'), h('span.label', 'Chess Lens')),
    ...NAV.map(([id, label, d]) => h('button.nav-item' + (S.view === id || (S.view === 'review' && id === 'games') ? '.on' : ''), { onclick: () => go(id), title: label }, icon(d), h('span.label', label))),
    navFoot,
    h('button.nav-item.collapse-btn', {
      title: S.settings.navCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
      onclick: () => { S.settings.navCollapsed = !S.settings.navCollapsed; save('settings'); renderNav(); setTimeout(() => window.dispatchEvent(new Event('resize')), 260); },
    }, icon(S.settings.navCollapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'), h('span.label', 'Collapse')),
  );
  renderBatch();
}

function renderBatch() {
  const b = S.batch;
  if (!b.running) { navFoot.replaceChildren(); return; }
  let el = navFoot.querySelector('.batch');
  if (!el) {
    el = h('div.batch', { title: 'Batch analysis' },
      h('div.batch-label'), h('div.progress', h('div')),
      h('button.link.small', { onclick: () => { S.batch.cancel = true; } }, 'Stop'));
    navFoot.replaceChildren(el);
  }
  el.querySelector('.batch-label').textContent = `Analyzing ${b.done}/${b.total}`;
  el.querySelector('.progress div').style.width = (b.done / b.total) * 100 + '%';
}

let prevView = null;
export function render() {
  if (prevView === 'review' && S.view !== 'review') leaveReview();
  prevView = S.view;
  destroyCharts();
  renderNav();
  renderTopbar();
  main.classList.toggle('fill', S.view === 'review' || S.view === 'train');
  main.replaceChildren();
  main.scrollTop = 0;
  if (!S.settings.lichess && !S.settings.chesscom && S.view !== 'settings') {
    main.append(onboarding());
    return;
  }
  const view = VIEWS[S.view] || dashboard;
  const el = view();
  el.classList.add('view-enter');
  main.append(el);
}

const DATA_VIEWS = new Set(['dashboard', 'openings', 'games', 'patterns', 'train']);
function refreshKeepScroll() {
  const y = main.scrollTop;
  render();
  main.scrollTop = y;
  main.firstElementChild?.classList.remove('view-enter');
}

async function boot() {
  const root = document.getElementById('root');
  nav = h('nav.sidebar');
  topbar = h('header.topbar');
  main = h('main.main');
  root.append(nav, h('div.content', topbar, main));
  await load();
  onChange((what) => {
    if (what === 'sync') renderTopbar();
    else if (what === 'batch') renderBatch();
    else if (what === 'analysis') { if (DATA_VIEWS.has(S.view)) refreshKeepScroll(); toast('Batch analysis finished'); }
    else if (what === 'games') {
      if (S.view === 'review' || S.view === 'train') renderTopbar(); else refreshKeepScroll();
      if (S.sync.error) toast(S.sync.text, 'err'); else if (S.sync.text) toast('Sync complete: ' + S.sync.text);
    } else render();
  });
  render();
  if (S.settings.lichess || S.settings.chesscom) {
    const stale = !S.settings.lastSync || Date.now() - S.settings.lastSync > 30 * 60e3;
    if (stale) sync();
  }
}

export { emit };
window.__S = S;
window.__sync = sync;
boot();
