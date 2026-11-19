# Chess Lens

A desktop app (Electron) for analyzing your **Lichess** and **Chess.com** games together, with Stockfish running locally.

## Features
- **Dashboard**: rating over time per site and time control, score vs. rating expectation, results by color, how games end, score by opponent strength and by time of day, and momentum/tilt across sessions.
- **Openings**: an interactive explorer of your own games, problem lines where you score under 45%, and your repertoire by opening family.
- **Games**: a searchable, filterable list. Click any game to open it on the analysis board.
- **Analysis board**
  - Full-game review: accuracy, inaccuracies/mistakes/blunders, a clickable eval graph, and best-move arrows.
  - Live Stockfish with 1–5 top engine lines (click any move in a line to play it out).
  - Show/hide the engine lines and the eval bar independently.
  - Drag pieces to explore your own lines. They appear as variations in the move list and are saved.
  - Add comments to any move. Right-click a side-line move to delete it.
  - Keyboard: ← → to step, ↑ ↓ for start/end, `f` to flip.
- **Patterns**: batch-analyze games, then see errors by game phase, clock-pressure mistakes, thrown wins, costliest blunders and accuracy by opening.
- **Train**: puzzles built from your own mistakes. Find the better move.

## Run
Requires Node.js 18+.

    npm install
    npm start

On Windows you can also double-click `Start Chess Lens.cmd`.

Games, analysis, notes and settings are stored locally in the app's user-data folder (`%APPDATA%\chess-lens\store` on Windows). Only the public Lichess and Chess.com APIs are contacted.

## Development
- `npm run build` bundles `src/` into `dist/` with esbuild.
- `F12` opens DevTools.
- Self-test: `CL_SELFTEST=<out dir> CL_LI=<lichess user> CL_CC=<chess.com user> electron .` drives every screen, runs the analysis-board checks, and saves screenshots to the output directory.

## Credits
[Stockfish](https://stockfishchess.org/) (GPLv3) via the `stockfish` npm package, [chessground](https://github.com/lichess-org/chessground) (GPLv3), [chess.js](https://github.com/jhlywa/chess.js), and [Chart.js](https://www.chartjs.org/).
