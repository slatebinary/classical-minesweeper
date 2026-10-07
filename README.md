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
- Mouse: left-click reveal; right-click cycles flag → question mark → clear.
- Touch: short tap reveals; press-and-hold cycles flag → question mark → clear.
- Double-click a revealed number to chord-open surrounding cells when its flag count matches.
- F2 or the face button starts a new game.
- Synthesized reveal, marking, explosion, and win sounds with a persistent Sound on/off option.
- Optional tactile feedback (ON by default) for field presses, long-press marking, mine hits, and wins on browsers/devices that expose the Vibration API.
- Persistent System, Light, and Dark themes while preserving the classic bevelled interface. System follows the device/OS preference live.
- Local play statistics, unlockable achievements, and JSON export/import (including iOS Share/Save to Files when available).
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

## v1.1.5

- Expands **Help → Install App...** with device-specific Android instructions.
- Chrome instructions cover **Install app** and **Add to Home screen** variants.
- Adds Samsung Internet and Microsoft Edge installation guidance on Android.
- Keeps the existing iPhone/iPad Safari instructions and desktop-browser fallback.

## v1.1.4

- Adds **Options → Tactile feedback**, enabled by default and remembered between sessions.
- Touching a field gives a short tactile pulse on supported devices.
- A successful long-press mark uses a stronger two-pulse pattern; mine hits and wins use distinct patterns.
- Uses the standard browser Vibration API and safely does nothing on browsers/devices that do not expose haptics.
- Turning tactile feedback off immediately cancels any active vibration.

## v1.1.3

- Adds **Import JSON** beside Export JSON in the Achievements dialog.
- Restores statistics, derived achievements, and Beginner/Intermediate/Expert best times from this app's exported JSON format.
- Validates the backup before changing local data; malformed, oversized, incompatible, or foreign-app JSON is rejected without changing the current records.
- Requires confirmation before replacing local statistics and best times, and refreshes the Achievements and Best Times displays immediately after a successful restore.
- On iPhone/iPad the import button opens the normal Files picker through the browser/PWA.

## v1.1.2

- Fixes **Help → Install App...** so it always responds: native browser install when available, iPhone/iPad Add to Home Screen instructions otherwise, and useful manual fallback instructions on other browsers.
- Makes incorrect flags much clearer after a loss with a large high-contrast red X while retaining the underlying flag.
- Keeps classic counter behaviour: placing more flags than the mine total shows a negative counter (for example `-01`), with clearer accessibility text.
- Prevents iPhone long-press flagging from selecting nearby page text or opening a text-selection callout.
- Fixes pinch zoom on iPhone by fitting the board to the layout viewport rather than the changing visual viewport; zoom now enlarges the game block instead of being counteracted by cell resizing.

## v1.1.1

- Adds a persistent footer credit beside the version: “Dedicated to my daughter Lilly ♥”.
- Adds **System theme** alongside Light and Dark.
- System theme follows the OS/browser `prefers-color-scheme` setting and updates live if the system appearance changes.
- New installations default to System theme; existing explicit Light/Dark choices remain respected.
- Includes the dedication in the About dialog and achievement export metadata.

## v1.1.0

- Replaces the separate touch Reveal/Flag mode with direct gestures: short tap reveals, long press marks.
- Adds synthesized high-pitch reveal feedback, low-pitch marking feedback, mine explosion audio, and a short win fanfare.
- Adds a persistent Sound on/off option.
- Adds persistent Light and Dark themes (expanded with System theme in v1.1.1).
- Adds play statistics and achievements for wins, difficulty clears, streaks, completed games, and speed milestones.
- Adds achievement/statistics export as JSON, using the native share sheet for files when supported.
- Keeps the v1.0.2 dynamic full-board fitting for iPhone and other narrow screens.

## v1.0.2

- Dynamically fits the entire minefield to the current viewport on phones and narrow windows.
- Recalculates cell size after rotation and viewport resizing.
- Scales cell bevels, flags, mines, and wrong-flag marks for compact mobile cells.
- Keeps the classic 24–26 px cell size whenever the full board already fits.
