// Electron main process: window, local storage, and game downloads.
const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, 'dist');
const UA = 'ChessLens/1.0 (personal game analyzer; Electron)';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// ---------- local JSON store ----------
const storeDir = () => path.join(app.getPath('userData'), 'store');
const storeFile = (name) => path.join(storeDir(), name.replace(/[^a-z0-9_-]/gi, '') + '.json');

ipcMain.handle('store:get', (_e, name) => {
  try { return JSON.parse(fs.readFileSync(storeFile(name), 'utf8')); } catch { return null; }
});
ipcMain.handle('store:set', (_e, name, value) => {
  fs.mkdirSync(storeDir(), { recursive: true });
  const f = storeFile(name);
  fs.writeFileSync(f + '.tmp', JSON.stringify(value));
  fs.renameSync(f + '.tmp', f);
  return true;
});
ipcMain.handle('store:clear', () => {
  fs.rmSync(storeDir(), { recursive: true, force: true });
  return true;
});
ipcMain.handle('open:external', (_e, url) => {
  if (/^https:\/\/(lichess\.org|www\.chess\.com)\//.test(url)) shell.openExternal(url);
});

// ---------- downloads ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 429) { await sleep(5000 * (i + 1)); continue; }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return res.json();
  }
  throw new Error('Rate limited by server, try again in a minute');
}

async function fetchLichess(sender, user, since) {
  const params = new URLSearchParams({
    pgnInJson: 'false', clocks: 'true', opening: 'true', moves: 'true', sort: 'dateAsc',
  });
  if (since) params.set('since', String(since));
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?${params}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/x-ndjson' } });
  if (res.status === 404) throw new Error(`Lichess user "${user}" not found`);
  if (res.status === 429) throw new Error('Lichess rate limit hit, wait a minute and retry');
  if (!res.ok) throw new Error(`Lichess error ${res.status}`);
  const games = [];
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) games.push(JSON.parse(line));
    }
    sender.send('import:progress', { site: 'lichess', text: `Lichess: ${games.length} games downloaded` });
  }
  if (buf.trim()) games.push(JSON.parse(buf));
  return games;
}

async function fetchChesscom(sender, user, since) {
  const u = encodeURIComponent(user.toLowerCase());
  const idx = await getJson(`https://api.chess.com/pub/player/${u}/games/archives`);
  if (!idx) throw new Error(`Chess.com user "${user}" not found`);
  let archives = idx.archives || [];
  if (since) {
    const d = new Date(since);
    const key = d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
    archives = archives.filter((a) => {
      const m = a.match(/(\d{4})\/(\d{2})$/);
      return m && +m[1] * 100 + +m[2] >= key;
    });
  }
  const games = [];
  for (let i = 0; i < archives.length; i++) {
    sender.send('import:progress', { site: 'chesscom', text: `Chess.com: month ${i + 1} of ${archives.length} (${games.length} games)` });
    const month = await getJson(archives[i]);
    if (month && month.games) games.push(...month.games.filter((g) => !since || g.end_time * 1000 >= since));
    await sleep(150);
  }
  return games;
}

ipcMain.handle('import:lichess', (e, user, since) => fetchLichess(e.sender, user, since));
ipcMain.handle('import:chesscom', (e, user, since) => fetchChesscom(e.sender, user, since));

// ---------- window ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#121211',
    title: 'Chess Lens',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#121211', symbolColor: '#c3c2b7', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !process.env.CL_SELFTEST,
    },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(lichess\.org|www\.chess\.com)\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
  win.loadURL('app://local/index.html');
  if (process.env.CL_SELFTEST) win.webContents.once('did-finish-load', () => selfTest(win).catch((e) => { console.error('SELFTEST FAIL', e); app.exit(1); }));
}

// Dev-only: drives the UI with public test accounts and saves screenshots.
async function selfTest(win) {
  const out = process.env.CL_SELFTEST;
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    await wait(1500);
    win.webContents.invalidate();
    await wait(300);
    fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
    console.log('shot', name);
  };
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) console.log('RENDERER', e.message); });
  await wait(800);
  win.setSize(1440, 920);
  await shot('0-onboarding');
  await js(`__S.settings.lichess='${process.env.CL_LI || ''}'; __S.settings.chesscom='${process.env.CL_CC || ''}'; __S.settings.range='3m'; go('dashboard'); __sync()`);
  console.log('sync:', await js('__S.sync.text + " / games=" + __S.games.length'));
  await shot('1-dashboard');
  let fails = 0;
  const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fails++; };
  // Rating chart: daily mode, series toggle, fullscreen
  await js(`[...document.querySelectorAll('.rating-head .seg button')].find(b => b.textContent === 'Daily').click()`);
  await wait(400);
  check(await js(`document.querySelectorAll('.rstat').length > 0 && !!document.querySelector('.rating-chart canvas')`), 'rating chart renders with stats in daily mode');
  const nChips = await js(`document.querySelectorAll('.series-chip').length`);
  if (nChips > 1) {
    await js(`document.querySelectorAll('.series-chip')[1].click()`); await wait(300);
    check(await js(`document.querySelectorAll('.rstat').length === ${nChips - 1}`), 'series chip hides a series');
    await js(`document.querySelectorAll('.series-chip')[1].click()`);
  }
  await win.webContents.executeJavaScript(`document.querySelector('.fs-btn').click()`, true);
  await wait(900);
  check(await js(`!!document.querySelector('.fs-overlay .rating-chart canvas')`), 'fullscreen overlay opens with chart');
  console.log('  html fullscreen active:', await js('!!document.fullscreenElement'));
  await shot('1b-rating-fullscreen');
  await js(`document.querySelector('.fs-close').click()`); await wait(500);
  check(await js(`!document.querySelector('.fs-overlay') && !document.fullscreenElement`), 'fullscreen closes cleanly');
  await js(`[...document.querySelectorAll('.rating-head .seg button')].find(b => b.textContent === 'Per game').click()`);
  await js(`go('openings')`); await shot('2-openings');
  await js(`go('games')`); await shot('3-games');
  const id = await js(`__S.games.find(g => g.moves.length > 40).id`);
  await js(`__S.settings.depth = 12; go('review', { reviewId: '${id}' }); document.querySelector('.analyzing .btn')?.click()`);
  for (let i = 0; i < 240 && !(await js(`!!__S.analysis['${id}']`)); i++) await wait(500);
  await js(`go('review', { reviewId: '${id}' })`);
  const st = () => js('__review.test.state()');
  const waitLines = async (n = 2, depth = 12) => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.lines.length >= n && s.depth >= depth) return s; await wait(250); } return st(); };
  await js(`__S.notes['${id}'] = { c: {}, v: [] }; __S.settings.showEval = true; __S.settings.showEngine = true; __S.settings.multipv = 3; go('review', { reviewId: '${id}' })`);
  let s = await waitLines(3);
  check(s.lines.length === 3 && s.depth >= 12, `live engine gives 3 lines (got ${s.lines.length} at depth ${s.depth})`);
  await shot('4-review');
  // Go to move 10, play the engine's 2nd choice (a new line), then its reply.
  await js(`__review.nav('start'); for (let i = 0; i < 19; i++) __review.nav('fwd')`);
  s = await waitLines(3);
  const alt = s.lines.find((u) => u !== s.nextMain);
  await js(`__review.test.play('${alt}')`);
  s = await st();
  check(!s.main && s.varLines === 1, `user move creates a side line (main=${s.main}, varLines=${s.varLines})`);
  s = await waitLines(1, 10);
  await js(`__review.test.play('${s.lines[0]}')`);
  await js(`__review.test.comment('Testing a comment on this line')`);
  await wait(700);
  s = await st();
  check(s.cmts >= 1, `comment shows in move list (${s.cmts})`);
  const n = await js(`JSON.stringify(__S.notes['${id}'])`);
  check(/Testing a comment/.test(n) && JSON.parse(n).v.length === 1, `notes saved: ${n}`);
  await shot('4b-variation');
  // Toggles
  await js(`document.querySelectorAll('.switch')[0].click(); document.querySelectorAll('.switch')[1].click()`);
  await wait(400);
  s = await st();
  check(s.evalHidden && s.engineCollapsed, `toggles hide eval bar and engine lines`);
  await shot('4c-toggled-off');
  await js(`document.querySelectorAll('.switch')[0].click(); document.querySelectorAll('.switch')[1].click()`);
  // Persistence across re-render
  await js(`go('games')`); await wait(300); await js(`go('review', { reviewId: '${id}' })`); await wait(500);
  s = await st();
  check(s.varLines === 1 && s.cmts >= 1, `line + comment survive leaving the page (varLines=${s.varLines}, cmts=${s.cmts})`);
  // Delete line
  await js(`__review.nav('back'); __review.test.del()`); await wait(300);
  s = await st();
  check(s.varLines === 0 && s.main, `deleting the line removes it (varLines=${s.varLines})`);
  // Underpromotion through the move tree: 1.e4 d5 2.exd5 c6 3.dxc6 Nf6 4.cxb7 Nbd7 5.bxa8=N
  await js(`__review.nav('start')`);
  for (const u of ['e2e4', 'd7d5', 'e4d5', 'c7c6', 'd5c6', 'g8f6', 'c6b7', 'b8d7', 'b7a8n']) await js(`__review.test.play('${u}')`);
  await wait(300);
  s = await st();
  check(/bxa8=N$/.test(s.key), `underpromotion to knight lands in the tree (${s.key.split(' ').slice(-1)[0]})`);
  // Picker UI: open over the board, pick with the mouse, then with the keyboard
  await js(`window.__pp = __pickPromotion(document.querySelector('.board-wrap.rv .cg-wrap'), 'a8', 'white', 'white'); 0`);
  await wait(300);
  check(await js(`document.querySelectorAll('.promo-sq').length === 4`), 'promotion picker shows 4 choices');
  await shot('4e-promotion-picker');
  await js(`document.querySelectorAll('.promo-sq')[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  check((await js('window.__pp')) === 'r', 'clicking the rook picks r');
  await js(`window.__pp = __pickPromotion(document.querySelector('.board-wrap.rv .cg-wrap'), 'a8', 'white', 'white'); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }))`);
  check((await js('window.__pp')) === 'b', 'pressing B picks bishop');
  await js(`window.__pp = __pickPromotion(document.querySelector('.board-wrap.rv .cg-wrap'), 'a8', 'white', 'white'); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  check((await js('window.__pp')) === null, 'Escape cancels the promotion');
  for (let i = 0; i < 8; i++) await js(`__review.nav('back')`);
  await js(`__review.test.del()`); await wait(200);
  check((await st()).varLines === 0, 'promotion test line cleaned up');
  // Collapsed sidebar + smaller window
  await js(`document.querySelector('.collapse-btn').click()`);
  win.setSize(1180, 760);
  await shot('4d-collapsed-small');
  await js(`document.querySelector('.collapse-btn').click()`);
  win.setSize(1440, 920);
  await js(`go('patterns'); document.querySelector('.analyze-box .btn')?.click()`);
  for (let i = 0; i < 600 && (await js('__S.batch.running')); i++) await wait(1000);
  await js(`go('patterns')`); await shot('5-patterns');
  await js(`go('train')`); await shot('6-train');
  await js(`go('settings')`); await shot('7-settings');
  console.log(fails ? `SELFTEST: ${fails} failure(s)` : 'SELFTEST: all checks passed');
  app.exit(fails ? 1 : 0);
}

if (process.env.CL_SELFTEST) app.setPath('userData', path.join(process.env.CL_SELFTEST, 'userdata'));

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());
