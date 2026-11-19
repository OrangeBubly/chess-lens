# Chess Lens

A desktop app (Electron) for analyzing your **Lichess** and **Chess.com** games together, with Stockfish running locally.

## Features
- **Dashboard**: an interactive rating-over-time chart (per game or daily, toggle series, scroll to zoom, drag to pan, click a point to open that game, fullscreen view, with current/peak/low stats), score vs. rating expectation, results by color, how games end, score by opponent strength and by time of day, and momentum/tilt across sessions.
- **Openings**: an interactive explorer of your own games, problem lines where you score under 45%, and your repertoire by opening family.
- **Games**: a searchable, filterable list. Click any game to open it on the analysis board.
- **Analysis board**
  - Full-game review: accuracy, inaccuracies/mistakes/blunders, a clickable eval graph, and best-move arrows.
  - Live Stockfish with 1–5 top engine lines (click any move in a line to play it out).
  - Show/hide the engine lines and the eval bar independently.
  - Drag pieces to explore your own lines. They appear as variations in the move list and are saved.
  - Promotion picker with underpromotion (click a piece, or press Q/R/B/N; Esc cancels).
  - Add comments to any move. Right-click a side-line move to delete it.
  - Keyboard: ← → to step, ↑ ↓ for start/end, `f` to flip.
- **Patterns**: batch-analyze games, then see errors by game phase, clock-pressure mistakes, thrown wins, costliest blunders and accuracy by opening.
- **Train**: puzzles built from your own mistakes. Find the better move.

## Download (Windows)
Grab the latest build from [Releases](https://github.com/OrangeBubly/chess-lens/releases):
- **Chess-Lens-Setup-x.y.z.exe**: installer (per-user, no admin rights needed; adds Start-menu and desktop shortcuts).
- **Chess-Lens-x.y.z-portable.exe**: a single file that runs without installing.

The builds aren't code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.

## Run from source
Requires Node.js 18+.

    npm install
    npm start

On Windows you can also double-click `Start Chess Lens.cmd`.

Games, analysis, notes and settings are stored locally in `%APPDATA%\Chess Lens\store` on Windows. Only the public Lichess and Chess.com APIs are contacted.

## Development
- `npm run build` bundles `src/` into `dist/` with esbuild.
- `npm run dist` builds the Windows installer and portable exe into `release/` (electron-builder). NSIS can't handle paths over 260 characters, so build from a short folder path.
- `npm run icon` regenerates `build/icon.png`.
- `F12` opens DevTools.
- Self-test: `CL_SELFTEST=<out dir> CL_LI=<lichess user> CL_CC=<chess.com user> electron .` drives every screen, runs the analysis-board checks, and saves screenshots to the output directory.

## Credits
[Stockfish](https://stockfishchess.org/) (GPLv3) via the `stockfish` npm package, [chessground](https://github.com/lichess-org/chessground) (GPLv3), [chess.js](https://github.com/jhlywa/chess.js), and [Chart.js](https://www.chartjs.org/).
