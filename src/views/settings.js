import { S, save, sync } from '../state.js';
import { h, card, toast } from '../ui.js';

function accountFields() {
  const li = h('input.input', { placeholder: 'Lichess username', value: S.settings.lichess, spellcheck: 'false' });
  const cc = h('input.input', { placeholder: 'Chess.com username', value: S.settings.chesscom, spellcheck: 'false' });
  return { li, cc, el: h('div.fields',
    h('label.field', h('span.site.lichess', 'LI'), h('span', 'Lichess'), li),
    h('label.field', h('span.site.chesscom', 'CC'), h('span', 'Chess.com'), cc)) };
}

function rangePicker() {
  return h('div.seg', [['3m', 'Last 3 months'], ['1y', 'Last year'], ['all', 'All time']].map(([v, l]) =>
    h('button' + (S.settings.range === v ? '.on' : ''), { onclick: (e) => {
      S.settings.range = v;
      e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
    } }, l)));
}

export function onboarding() {
  const f = accountFields();
  const go = () => {
    S.settings.lichess = f.li.value.trim();
    S.settings.chesscom = f.cc.value.trim();
    if (!S.settings.lichess && !S.settings.chesscom) { toast('Enter at least one username', 'err'); return; }
    save('settings', 0);
    window.go('dashboard');
    sync();
  };
  return h('div.onboard',
    h('div.onboard-card',
      h('div.hero-logo', '♞'),
      h('h1', 'Chess Lens'),
      h('p.muted', 'Download your Lichess and Chess.com games, see where your points go, and review every game with Stockfish on your own machine.'),
      f.el,
      h('div.field-label', 'Import games from'),
      rangePicker(),
      h('button.btn.big', { onclick: go }, 'Import my games'),
      h('p.muted.small', 'Uses the sites\' public APIs. Nothing leaves your computer except the download requests.')));
}

export function settingsView() {
  const f = accountFields();
  const depthSel = (key, opts) => h('div.seg.small', opts.map(([v, l]) => h('button' + (S.settings[key] === v ? '.on' : ''), { onclick: () => { S.settings[key] = v; save('settings'); window.go('settings'); } }, l)));
  const total = S.games.length;
  const counts = (site) => S.games.filter((g) => g.site === site).length;
  return h('div.stack.narrow',
    card('Accounts', null, f.el,
      h('div.field-label', 'History for newly added accounts'), rangePicker(),
      h('div.btn-row', h('button.btn', { onclick: () => {
        const changed = f.li.value.trim() !== S.settings.lichess || f.cc.value.trim() !== S.settings.chesscom;
        S.settings.lichess = f.li.value.trim();
        S.settings.chesscom = f.cc.value.trim();
        save('settings', 0);
        toast('Saved');
        if (changed) sync();
      } }, 'Save & sync'))),
    card('Engine', 'Stockfish 17.1 lite, running locally in WebAssembly',
      h('div.setting', h('div', h('b', 'Single-game review depth'), h('p.muted', 'Higher is more accurate but slower.')),
        depthSel('depth', [[12, '12'], [14, '14'], [16, '16'], [18, '18']])),
      h('div.setting', h('div', h('b', 'Batch analysis depth'), h('p.muted', 'Used when analyzing many games for Patterns.')),
        depthSel('batchDepth', [[8, '8'], [10, '10'], [12, '12'], [14, '14']]))),
    card('Data', `${total.toLocaleString()} games stored (${counts('lichess')} Lichess, ${counts('chesscom')} Chess.com) · ${Object.keys(S.summaries).length} analyzed`,
      h('div.btn-row',
        h('button.btn.ghost', { onclick: () => {
          if (!confirm('Delete all stored analysis? Games are kept.')) return;
          S.analysis = {}; S.summaries = {}; S.trained = {};
          save('analysis', 0); save('summaries', 0); save('trained', 0);
          toast('Analysis cleared');
          window.go('settings');
        } }, 'Clear analysis'),
        h('button.btn.danger', { onclick: async () => {
          if (!confirm('Delete all games, analysis and settings from this computer?')) return;
          await window.api.clear();
          location.reload();
        } }, 'Reset everything'))));
}
