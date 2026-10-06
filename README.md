# Classical Minesweeper PWA

A clean-room, dependency-free recreation of the classic Windows 95-era Minesweeper experience, built as an installable Progressive Web App for GitHub Pages.

The key difference from ordinary Minesweeper is **no-guess generation**: after your first click, the app generates candidate minefields and accepts a field only if its internal deduction solver can finish the board without guessing.

## Classic difficulty presets

| Level | Board | Mines |
|---|---:|---:|
| Beginner | 9 × 9 | 10 |
| Intermediate | 16 × 16 | 40 |
| Expert | 30 × 16 | 99 |

## Features

- Windows 95-inspired grey bevelled UI, title bar, menus, counters, face button and classic number colours.
- Guaranteed first-click safety, including the eight surrounding cells.
- Guaranteed no-guess boards for all built-in difficulty levels.
- Left-click reveal, right-click flag → question mark → clear.
- Double-click a revealed number to chord-open surrounding cells when its flag count matches.
- F2 or the face button starts a new game.
- Touchscreen Reveal / Flag controls for phones and tablets.
- Local best times for Beginner, Intermediate and Expert.
- PWA manifest and service worker for installability and offline play.
- Works from a GitHub Pages project subdirectory; no absolute-path assumptions.
- No framework, package runtime, external CDN, analytics, cookies or server component.

## How the no-guess guarantee works

Mine placement happens after the first click. The clicked square and its neighbours are excluded from mine placement. Each candidate layout is then run through an internal solver that is allowed to use only deductions available from the visible puzzle state:

1. If a revealed number already has all of its mines marked, every other covered neighbour is safe.
2. If a revealed number needs exactly as many mines as it has unknown neighbours, those neighbours are mines.
3. The global mine counter is treated as another valid constraint.
4. Subset constraints are compared. If one numbered constraint is fully contained inside another, the difference can sometimes prove additional cells safe or mined.

If the solver reaches a state where no cell is logically forced before all safe squares are opened, the candidate board is rejected and another one is generated. The player is therefore never intentionally handed a board that requires a 50/50 guess.

## Run locally

The game uses ES modules and a service worker, so serve it over HTTP rather than opening `index.html` directly as a `file://` URL.

For example, with Python installed:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080/`.

## Test

Node.js is needed only for development tests; the game itself has no Node dependency.

```bash
npm test
npm run check
```

## Publish with GitHub Pages

1. Create a new GitHub repository, for example `classical-minesweeper`.
2. Upload **all files and folders from this package**, including `.nojekyll`, `src/`, `icons/` and `tests/`.
3. Commit them to the `main` branch.
4. In GitHub, open **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select branch **main** and folder **/(root)**, then save.
7. After Pages deploys, open the URL GitHub provides. The app automatically works under a project path such as `https://USERNAME.github.io/classical-minesweeper/`.

### Updating the PWA

When changing production files, also change `CACHE_NAME` near the top of `sw.js` (for example from `v1.0.0` to `v1.0.1`). This ensures existing installations replace the old offline cache.

## Project structure

```text
classical-minesweeper-pwa/
├── .nojekyll
├── app.js
├── generator-worker.js
├── index.html
├── manifest.webmanifest
├── styles.css
├── sw.js
├── icons/
│   ├── icon.svg
│   └── icon-maskable.svg
├── src/
│   └── logic.js
├── tests/
│   └── logic.test.mjs
├── LICENSE
├── README.md
└── package.json
```

## Legal / attribution

This project is an original clean-room implementation. It does **not** contain Microsoft source code, bitmap assets, executables, sounds, or other extracted Windows files. The visual treatment is an original CSS recreation inspired by the Windows 95-era interface.

“Windows” and “Minesweeper” may be trademarks of their respective owners. This project is not affiliated with or endorsed by Microsoft.

## License

MIT License. See `LICENSE`.
