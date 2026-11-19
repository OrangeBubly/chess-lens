// Bundles the renderer and copies static assets into dist/.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const out = 'dist';
fs.mkdirSync(path.join(out, 'engine'), { recursive: true });

await esbuild.build({
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'esm',
  target: 'chrome130',
  outfile: path.join(out, 'app.js'),
  sourcemap: true,
  logLevel: 'warning',
});

const copy = (from, to) => fs.copyFileSync(from, path.join(out, to));
copy('src/index.html', 'index.html');
// Board squares as an inline SVG background.
let sq = '';
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) sq += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
const boardSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="#dcdfe4"/><g fill="#8494a8">${sq}</g></svg>`;
const css = fs.readFileSync('src/styles.css', 'utf8')
  .replace('__BOARD__', 'data:image/svg+xml;base64,' + Buffer.from(boardSvg).toString('base64'));
fs.writeFileSync(path.join(out, 'styles.css'), css);
copy('node_modules/chessground/assets/chessground.base.css', 'cg-base.css');
copy('node_modules/chessground/assets/chessground.cburnett.css', 'cg-pieces.css');

const sfDir = 'node_modules/stockfish/src';
for (const f of fs.readdirSync(sfDir)) {
  if (/^stockfish-17\.1-lite-single-[0-9a-f]+\.(js|wasm)$/.test(f)) {
    const ext = path.extname(f);
    fs.copyFileSync(path.join(sfDir, f), path.join(out, 'engine', 'stockfish' + ext));
  }
}
console.log('build ok');
