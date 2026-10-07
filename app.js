import { generateCandidate, isLogicallySolvable } from './src/logic.js';

const APP_VERSION = '1.1.3';
const DEDICATION = 'Dedicated to my daughter Lilly ♥';
const LONG_PRESS_MS = 480;
const LONG_PRESS_MOVE_PX = 12;
const STATS_KEY = 'minesweeper:stats:v1';

const PRESETS = {
  beginner: { label: 'Beginner', rows: 9, cols: 9, mines: 10 },
  intermediate: { label: 'Intermediate', rows: 16, cols: 16, mines: 40 },
  expert: { label: 'Expert', rows: 16, cols: 30, mines: 99 }
};

const boardEl = document.querySelector('#board');
const boardFrameEl = document.querySelector('.board-frame');
const gameInsetEl = document.querySelector('.game-inset');
const windowEl = document.querySelector('.window');
const desktopShellEl = document.querySelector('.desktop-shell');
const mineCounterEl = document.querySelector('#mine-counter');
const timerEl = document.querySelector('#timer');
const faceButton = document.querySelector('#face-button');
const generationNote = document.querySelector('#generation-note');
const bestTimesDialog = document.querySelector('#best-times-dialog');
const achievementsDialog = document.querySelector('#achievements-dialog');
const statsSummary = document.querySelector('#stats-summary');
const achievementList = document.querySelector('#achievement-list');
const importAchievementsFile = document.querySelector('#import-achievements-file');
const helpDialog = document.querySelector('#help-dialog');
const helpTitle = document.querySelector('#help-title');
const helpContent = document.querySelector('#help-content');
const soundCheck = document.querySelector('#sound-check');
const themeColorMeta = document.querySelector('meta[name="theme-color"]');

let difficulty = localStorage.getItem('minesweeper:difficulty') || 'beginner';
if (!PRESETS[difficulty]) difficulty = 'beginner';
let config = PRESETS[difficulty];
let board = null;
let cells = [];
let revealed = new Uint8Array(0);
let marks = new Uint8Array(0); // 0 none, 1 flag, 2 question
let status = 'ready';
let openedSafe = 0;
let flagCount = 0;
let startTime = 0;
let elapsedSeconds = 0;
let timerHandle = 0;
let generationRequest = 0;
let generatorWorker = null;
let deferredInstallPrompt = null;
let soundEnabled = localStorage.getItem('minesweeper:sound') !== 'off';
const systemThemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)') || null;
let theme = localStorage.getItem('minesweeper:theme') || 'system';
if (!['system', 'light', 'dark'].includes(theme)) theme = 'system';
let audioContext = null;
let touchPress = null;
let suppressClickUntil = 0;
let suppressContextMenuUntil = 0;

const supportsWorker = typeof Worker !== 'undefined';
if (supportsWorker) generatorWorker = new Worker('./generator-worker.js', { type: 'module' });

function formatCounter(value) {
  const clamped = Math.max(-99, Math.min(999, value));
  return clamped < 0 ? `-${String(Math.abs(clamped)).padStart(2, '0')}` : String(clamped).padStart(3, '0');
}

function updateCounter() {
  const remaining = config.mines - flagCount;
  mineCounterEl.textContent = formatCounter(remaining);
  const label = remaining >= 0
    ? `${remaining} mine${remaining === 1 ? '' : 's'} remaining`
    : `${Math.abs(remaining)} extra flag${remaining === -1 ? '' : 's'} placed`;
  mineCounterEl.setAttribute('aria-label', label);
  mineCounterEl.title = label;
}

function updateTimer() {
  if (status !== 'playing') return;
  elapsedSeconds = Math.min(999, Math.floor((Date.now() - startTime) / 1000));
  timerEl.textContent = formatCounter(elapsedSeconds);
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = 0;
}

function startTimer() {
  stopTimer();
  startTime = Date.now();
  elapsedSeconds = 0;
  timerEl.textContent = '000';
  timerHandle = setInterval(updateTimer, 250);
}

function setFace(kind = 'normal') {
  faceButton.classList.remove('surprised', 'dead', 'cool');
  if (kind !== 'normal') faceButton.classList.add(kind);
}

function makeCell(index) {
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = 'cell';
  cell.dataset.index = String(index);
  cell.setAttribute('role', 'gridcell');
  cell.setAttribute('aria-label', `Covered cell ${index + 1}`);
  return cell;
}

function px(style, property) {
  return Number.parseFloat(style.getPropertyValue(property)) || 0;
}

function horizontalPadding(element) {
  const style = getComputedStyle(element);
  return px(style, 'padding-left') + px(style, 'padding-right');
}

function horizontalBorder(element) {
  const style = getComputedStyle(element);
  return px(style, 'border-left-width') + px(style, 'border-right-width');
}

// Keep the complete minefield visible on narrow screens. The classic desktop
// cell size is preserved whenever it fits; otherwise every column is fitted.
function fitBoardToViewport() {
  // Size against the layout viewport, not visualViewport. On iPhone pinch-zoom
  // changes visualViewport.width; using it here would shrink the cells again and
  // cancel the user's zoom gesture. The layout viewport still changes normally
  // on rotation/resizing, so the board remains responsive without fighting zoom.
  const layoutWidth = document.documentElement.clientWidth || window.innerWidth;
  const shellChrome = horizontalPadding(desktopShellEl);
  const windowChrome = horizontalPadding(windowEl) + horizontalBorder(windowEl);
  const insetChrome = horizontalPadding(gameInsetEl);
  const frameChrome = horizontalPadding(boardFrameEl) + horizontalBorder(boardFrameEl);
  const safetyGap = 2;
  const availableBoardWidth = Math.max(1, Math.floor(layoutWidth - shellChrome - windowChrome - insetChrome - frameChrome - safetyGap));

  const preferredCellSize = matchMedia('(pointer: coarse)').matches ? 26 : 24;
  const fittedCellSize = Math.max(8, Math.min(preferredCellSize, Math.floor((availableBoardWidth / config.cols) * 100) / 100));
  const bevel = fittedCellSize <= 12 ? 1 : fittedCellSize <= 18 ? 2 : 3;

  boardEl.style.setProperty('--cell-size', `${fittedCellSize}px`);
  boardEl.style.setProperty('--cell-bevel', `${bevel}px`);
  boardEl.dataset.cellSize = String(fittedCellSize);
}

let fitFrame = 0;
function scheduleBoardFit() {
  if (fitFrame) cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    fitBoardToViewport();
  });
}

function renderBoard() {
  const size = config.rows * config.cols;
  boardEl.style.setProperty('--rows', config.rows);
  boardEl.style.setProperty('--cols', config.cols);
  boardEl.replaceChildren();
  cells = [];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < size; i++) {
    const cell = makeCell(i);
    cells.push(cell);
    frag.appendChild(cell);
  }
  boardEl.appendChild(frag);
  fitBoardToViewport();
}

function updateDifficultyChecks() {
  document.querySelectorAll('[data-difficulty]').forEach((button) => {
    const active = button.dataset.difficulty === difficulty;
    button.setAttribute('aria-checked', String(active));
    button.querySelector('.check-slot').textContent = active ? '✓' : '';
  });
}

function resolvedTheme(preference = theme) {
  if (preference === 'system') return systemThemeQuery?.matches ? 'dark' : 'light';
  return preference === 'dark' ? 'dark' : 'light';
}

function applyTheme(nextTheme, persist = true) {
  theme = ['system', 'light', 'dark'].includes(nextTheme) ? nextTheme : 'system';
  const effectiveTheme = resolvedTheme(theme);
  document.documentElement.dataset.theme = effectiveTheme;
  document.documentElement.dataset.themePreference = theme;
  themeColorMeta?.setAttribute('content', effectiveTheme === 'dark' ? '#202424' : '#c0c0c0');
  if (persist) localStorage.setItem('minesweeper:theme', theme);
  document.querySelectorAll('[data-theme]').forEach((button) => {
    const active = button.dataset.theme === theme;
    button.setAttribute('aria-checked', String(active));
    button.querySelector('.check-slot').textContent = active ? '✓' : '';
  });
}

function handleSystemThemeChange() {
  if (theme === 'system') applyTheme('system', false);
}

function updateSoundMenu() {
  soundCheck.textContent = soundEnabled ? '✓' : '';
  const button = document.querySelector('[data-setting="sound"]');
  button?.setAttribute('aria-checked', String(soundEnabled));
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('minesweeper:sound', soundEnabled ? 'on' : 'off');
  updateSoundMenu();
  if (soundEnabled) {
    ensureAudio();
    playTone(660, 0.045, 'square', 0.025);
  }
}

function ensureAudio() {
  if (!soundEnabled) return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioContext) audioContext = new AudioCtx();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function playTone(frequency, duration = 0.05, type = 'square', volume = 0.025, delay = 0) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.01);
}

function playRevealSound() {
  playTone(1050, 0.035, 'square', 0.018);
}

function playFlagSound() {
  playTone(220, 0.075, 'square', 0.03);
}

function playWinSound() {
  playTone(523.25, 0.09, 'square', 0.022, 0);
  playTone(659.25, 0.09, 'square', 0.022, 0.09);
  playTone(783.99, 0.14, 'square', 0.024, 0.18);
}

function playExplosionSound() {
  const ctx = ensureAudio();
  if (!ctx) return;
  const duration = 0.42;
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const envelope = Math.pow(1 - i / length, 2.2);
    data[i] = (Math.random() * 2 - 1) * envelope;
  }
  const noise = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  noise.buffer = buffer;
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1800, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + duration);
  gain.gain.setValueAtTime(0.11, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start();
  noise.stop(ctx.currentTime + duration);
  playTone(90, 0.32, 'sawtooth', 0.045);
}

function defaultStats() {
  return {
    version: 1,
    gamesStarted: { beginner: 0, intermediate: 0, expert: 0 },
    wins: { beginner: 0, intermediate: 0, expert: 0 },
    losses: { beginner: 0, intermediate: 0, expert: 0 },
    currentWinStreak: 0,
    bestWinStreak: 0,
    totalSafeCellsRevealed: 0,
    firstPlayedAt: null,
    lastPlayedAt: null,
    lastWinAt: null
  };
}

function loadStats() {
  const fallback = defaultStats();
  try {
    const parsed = JSON.parse(localStorage.getItem(STATS_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return fallback;
    for (const key of Object.keys(PRESETS)) {
      fallback.gamesStarted[key] = Number(parsed.gamesStarted?.[key]) || 0;
      fallback.wins[key] = Number(parsed.wins?.[key]) || 0;
      fallback.losses[key] = Number(parsed.losses?.[key]) || 0;
    }
    fallback.currentWinStreak = Number(parsed.currentWinStreak) || 0;
    fallback.bestWinStreak = Number(parsed.bestWinStreak) || 0;
    fallback.totalSafeCellsRevealed = Number(parsed.totalSafeCellsRevealed) || 0;
    fallback.firstPlayedAt = parsed.firstPlayedAt || null;
    fallback.lastPlayedAt = parsed.lastPlayedAt || null;
    fallback.lastWinAt = parsed.lastWinAt || null;
    return fallback;
  } catch {
    return fallback;
  }
}

function saveStats(stats) {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function mutateStats(mutator) {
  const stats = loadStats();
  mutator(stats);
  saveStats(stats);
  return stats;
}

function recordGameStarted() {
  const now = new Date().toISOString();
  mutateStats((stats) => {
    stats.gamesStarted[difficulty]++;
    stats.firstPlayedAt ||= now;
    stats.lastPlayedAt = now;
  });
}

function recordCellsRevealed(count) {
  if (!count) return;
  mutateStats((stats) => { stats.totalSafeCellsRevealed += count; });
}

function recordLoss() {
  mutateStats((stats) => {
    stats.losses[difficulty]++;
    stats.currentWinStreak = 0;
  });
}

function recordWin() {
  const now = new Date().toISOString();
  mutateStats((stats) => {
    stats.wins[difficulty]++;
    stats.currentWinStreak++;
    stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.currentWinStreak);
    stats.lastWinAt = now;
  });
}

function bestTimesObject() {
  const out = {};
  for (const key of Object.keys(PRESETS)) {
    const value = Number(localStorage.getItem(`minesweeper:best:${key}`));
    out[key] = value || null;
  }
  return out;
}

function getAchievements(stats = loadStats(), best = bestTimesObject()) {
  const totalWins = Object.values(stats.wins).reduce((a, b) => a + b, 0);
  const totalCompleted = Object.keys(PRESETS).reduce((sum, key) => sum + stats.wins[key] + stats.losses[key], 0);
  return [
    { id: 'first-sweep', name: 'First Sweep', description: 'Win your first game.', earned: totalWins >= 1 },
    { id: 'beginner-clear', name: 'Beginner Clear', description: 'Win a Beginner field.', earned: stats.wins.beginner >= 1 },
    { id: 'intermediate-clear', name: 'Intermediate Clear', description: 'Win an Intermediate field.', earned: stats.wins.intermediate >= 1 },
    { id: 'expert-clear', name: 'Expert Clear', description: 'Win an Expert field.', earned: stats.wins.expert >= 1 },
    { id: 'on-a-roll', name: 'On a Roll', description: 'Win 3 games in a row.', earned: stats.bestWinStreak >= 3 },
    { id: 'veteran', name: 'Veteran Sweeper', description: 'Complete 25 games.', earned: totalCompleted >= 25 },
    { id: 'quick-beginner', name: 'Quick Beginner', description: 'Clear Beginner in 60 seconds or less.', earned: best.beginner !== null && best.beginner <= 60 },
    { id: 'expert-pace', name: 'Expert Pace', description: 'Clear Expert in 300 seconds or less.', earned: best.expert !== null && best.expert <= 300 }
  ];
}

function renderAchievements() {
  const stats = loadStats();
  const best = bestTimesObject();
  const achievements = getAchievements(stats, best);
  const totalWins = Object.values(stats.wins).reduce((a, b) => a + b, 0);
  const totalStarted = Object.values(stats.gamesStarted).reduce((a, b) => a + b, 0);
  statsSummary.innerHTML = `
    <div><strong>Games:</strong> ${totalStarted}</div>
    <div><strong>Wins:</strong> ${totalWins}</div>
    <div><strong>Best streak:</strong> ${stats.bestWinStreak}</div>
    <div><strong>Safe cells revealed:</strong> ${stats.totalSafeCellsRevealed}</div>`;
  achievementList.replaceChildren();
  for (const achievement of achievements) {
    const li = document.createElement('li');
    li.className = achievement.earned ? 'earned' : 'locked';
    li.innerHTML = `<span class="achievement-mark" aria-hidden="true">${achievement.earned ? '✓' : '·'}</span><span><strong>${achievement.name}</strong><small>${achievement.description}</small></span>`;
    achievementList.appendChild(li);
  }
}

function showAchievements() {
  renderAchievements();
  achievementsDialog.showModal();
}

function buildAchievementExport() {
  const stats = loadStats();
  const bestTimes = bestTimesObject();
  return {
    app: 'Classical Minesweeper PWA',
    appVersion: APP_VERSION,
    dedication: DEDICATION,
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    bestTimesSeconds: bestTimes,
    statistics: stats,
    achievements: getAchievements(stats, bestTimes).filter((item) => item.earned).map(({ id, name, description }) => ({ id, name, description }))
  };
}


function sanitizeNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function sanitizeImportedDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function normalizeImportedStats(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The file does not contain valid Minesweeper statistics.');

  const stats = defaultStats();
  for (const key of Object.keys(PRESETS)) {
    stats.wins[key] = sanitizeNonNegativeInteger(raw.wins?.[key]);
    stats.losses[key] = sanitizeNonNegativeInteger(raw.losses?.[key]);
    const minimumStarted = stats.wins[key] + stats.losses[key];
    stats.gamesStarted[key] = Math.max(minimumStarted, sanitizeNonNegativeInteger(raw.gamesStarted?.[key]));
  }

  const totalWins = Object.values(stats.wins).reduce((sum, value) => sum + value, 0);
  stats.currentWinStreak = Math.min(totalWins, sanitizeNonNegativeInteger(raw.currentWinStreak));
  stats.bestWinStreak = Math.max(stats.currentWinStreak, sanitizeNonNegativeInteger(raw.bestWinStreak));
  stats.totalSafeCellsRevealed = sanitizeNonNegativeInteger(raw.totalSafeCellsRevealed);
  stats.firstPlayedAt = sanitizeImportedDate(raw.firstPlayedAt);
  stats.lastPlayedAt = sanitizeImportedDate(raw.lastPlayedAt);
  stats.lastWinAt = sanitizeImportedDate(raw.lastWinAt);
  return stats;
}

function normalizeImportedBestTimes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The file does not contain valid best times.');
  const best = {};
  for (const key of Object.keys(PRESETS)) {
    const value = raw[key];
    if (value === null || value === undefined || value === '') {
      best[key] = null;
      continue;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 999) throw new Error(`Invalid ${PRESETS[key].label} best time.`);
    best[key] = Math.floor(number);
  }
  return best;
}

function parseAchievementImport(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('The selected JSON file is not a Minesweeper backup.');
  if (payload.app && payload.app !== 'Classical Minesweeper PWA') throw new Error('This JSON file belongs to a different application.');
  if (payload.exportVersion !== 1) throw new Error('This backup format is not supported by this version of Minesweeper.');

  return {
    stats: normalizeImportedStats(payload.statistics),
    bestTimes: normalizeImportedBestTimes(payload.bestTimesSeconds)
  };
}

function applyAchievementImport(imported) {
  saveStats(imported.stats);
  for (const key of Object.keys(PRESETS)) {
    const storageKey = `minesweeper:best:${key}`;
    const value = imported.bestTimes[key];
    if (value === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, String(value));
  }
  renderAchievements();
  renderBestTimes();
}

async function importAchievements(file) {
  if (!file) return;
  if (file.size > 1_000_000) {
    window.alert('That JSON file is unexpectedly large. Please select a Minesweeper achievements export.');
    return;
  }

  let imported;
  try {
    imported = parseAchievementImport(await file.text());
  } catch (error) {
    window.alert(error?.message || 'The JSON file could not be imported.');
    return;
  }

  const proceed = window.confirm('Import this Minesweeper backup? This will replace the local statistics, achievements and best times currently stored on this device.');
  if (!proceed) return;

  applyAchievementImport(imported);
  window.alert('Minesweeper statistics, achievements and best times were imported successfully.');
}

async function exportAchievements() {
  const payload = JSON.stringify(buildAchievementExport(), null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `minesweeper-achievements-${date}.json`;
  const file = new File([payload], filename, { type: 'application/json' });

  try {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: 'Minesweeper achievements', files: [file] });
      return;
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function newGame(nextDifficulty = difficulty) {
  generationRequest++;
  difficulty = nextDifficulty;
  config = PRESETS[difficulty];
  localStorage.setItem('minesweeper:difficulty', difficulty);
  stopTimer();
  board = null;
  revealed = new Uint8Array(config.rows * config.cols);
  marks = new Uint8Array(config.rows * config.cols);
  openedSafe = 0;
  flagCount = 0;
  elapsedSeconds = 0;
  status = 'ready';
  timerEl.textContent = '000';
  updateCounter();
  setFace('normal');
  generationNote.textContent = 'Every board is generated to be solvable by deduction without guessing.';
  renderBoard();
  updateDifficultyChecks();
  closeMenus();
}

function hydrateBoard(serialized) {
  return {
    rows: serialized.rows,
    cols: serialized.cols,
    mineCount: serialized.mineCount,
    mines: Uint8Array.from(serialized.mines),
    counts: Uint8Array.from(serialized.counts)
  };
}

async function generateInFallback(firstIndex, requestId) {
  let attempts = 0;
  while (requestId === generationRequest) {
    for (let batch = 0; batch < 20; batch++) {
      attempts++;
      const candidate = generateCandidate(config.rows, config.cols, config.mines, firstIndex);
      if (isLogicallySolvable(candidate, firstIndex)) {
        finishGeneration(candidate, firstIndex, requestId, attempts);
        return;
      }
    }
    generationNote.textContent = `Building a no-guess field… ${attempts} candidates checked.`;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function beginGeneration(firstIndex) {
  if (status !== 'ready') return;
  status = 'generating';
  setFace('surprised');
  recordGameStarted();
  const requestId = ++generationRequest;
  generationNote.textContent = 'Building a no-guess field…';

  if (generatorWorker) {
    generatorWorker.postMessage({
      requestId,
      rows: config.rows,
      cols: config.cols,
      mineCount: config.mines,
      firstIndex
    });
  } else {
    generateInFallback(firstIndex, requestId);
  }
}

function finishGeneration(generatedBoard, firstIndex, requestId, attempts) {
  if (requestId !== generationRequest || status !== 'generating') return;
  board = generatedBoard;
  status = 'playing';
  setFace('normal');
  generationNote.textContent = `Logic-only field ready (${attempts} candidate${attempts === 1 ? '' : 's'} checked).`;
  startTimer();
  revealCell(firstIndex);
}

if (generatorWorker) {
  generatorWorker.addEventListener('message', (event) => {
    const message = event.data;
    if (message.requestId !== generationRequest) return;
    if (message.type === 'progress') {
      generationNote.textContent = `Building a no-guess field… ${message.attempts} candidates checked.`;
    } else if (message.type === 'generated') {
      finishGeneration(hydrateBoard(message.board), message.firstIndex, message.requestId, message.attempts);
    }
  });
}

function revealCell(index) {
  if (status === 'ready') {
    cells[index].classList.add('first-click');
    beginGeneration(index);
    return;
  }
  if (status !== 'playing' || !board || revealed[index] || marks[index] === 1) return;
  if (board.mines[index]) {
    lose(index);
    return;
  }

  let newlyOpened = 0;
  const queue = [index];
  for (let q = 0; q < queue.length; q++) {
    const idx = queue[q];
    if (revealed[idx] || marks[idx] === 1 || board.mines[idx]) continue;
    revealed[idx] = 1;
    marks[idx] = 0;
    openedSafe++;
    newlyOpened++;
    paintRevealed(idx);
    if (board.counts[idx] === 0) {
      for (const n of neighbors(idx)) if (!revealed[n] && marks[n] !== 1) queue.push(n);
    }
  }
  if (newlyOpened) {
    recordCellsRevealed(newlyOpened);
    playRevealSound();
  }
  checkWin();
}

function neighbors(index) {
  const row = Math.floor(index / config.cols);
  const col = index % config.cols;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const r = row + dr, c = col + dc;
      if (r >= 0 && r < config.rows && c >= 0 && c < config.cols) out.push(r * config.cols + c);
    }
  }
  return out;
}

function paintRevealed(index) {
  const cell = cells[index];
  const value = board.counts[index];
  cell.className = 'cell revealed';
  cell.dataset.value = String(value);
  cell.textContent = value ? String(value) : '';
  cell.setAttribute('aria-label', value ? `Revealed ${value}` : 'Revealed empty');
}

function cycleMark(index, withSound = true) {
  if (status === 'generating' || status === 'won' || status === 'lost' || revealed[index]) return false;
  const cell = cells[index];
  cell.classList.remove('flag', 'question');
  if (marks[index] === 0) {
    marks[index] = 1;
    flagCount++;
    cell.classList.add('flag');
    cell.setAttribute('aria-label', 'Flagged cell');
  } else if (marks[index] === 1) {
    marks[index] = 2;
    flagCount--;
    cell.classList.add('question');
    cell.setAttribute('aria-label', 'Question-marked cell');
  } else {
    marks[index] = 0;
    cell.setAttribute('aria-label', `Covered cell ${index + 1}`);
  }
  updateCounter();
  if (withSound) playFlagSound();
  return true;
}

function chord(index) {
  if (status !== 'playing' || !revealed[index] || board.counts[index] === 0) return;
  const ns = neighbors(index);
  const flags = ns.filter((n) => marks[n] === 1).length;
  if (flags !== board.counts[index]) return;
  for (const n of ns) {
    if (!revealed[n] && marks[n] !== 1) {
      revealCell(n);
      if (status === 'lost') return;
    }
  }
}

function lose(explodedIndex) {
  elapsedSeconds = Math.min(999, Math.floor((Date.now() - startTime) / 1000));
  timerEl.textContent = formatCounter(elapsedSeconds);
  status = 'lost';
  stopTimer();
  setFace('dead');
  playExplosionSound();
  recordLoss();
  for (let i = 0; i < cells.length; i++) {
    if (board.mines[i] && marks[i] !== 1) {
      cells[i].className = 'cell revealed mine';
      if (i === explodedIndex) cells[i].classList.add('exploded');
    } else if (!board.mines[i] && marks[i] === 1) {
      const cell = cells[i];
      cell.classList.add('wrong-flag');
      cell.setAttribute('aria-label', 'Incorrect flag');
      const cross = document.createElement('span');
      cross.className = 'wrong-x';
      cross.setAttribute('aria-hidden', 'true');
      cell.appendChild(cross);
    }
  }
  generationNote.textContent = 'Mine hit. Press F2 or the face to start a new no-guess field.';
}

function checkWin() {
  if (status !== 'playing' || openedSafe !== config.rows * config.cols - config.mines) return;
  elapsedSeconds = Math.min(999, Math.floor((Date.now() - startTime) / 1000));
  timerEl.textContent = formatCounter(elapsedSeconds);
  status = 'won';
  stopTimer();
  setFace('cool');
  for (let i = 0; i < cells.length; i++) {
    if (board.mines[i] && marks[i] !== 1) {
      marks[i] = 1;
      flagCount++;
      cells[i].classList.add('flag');
    }
  }
  updateCounter();
  saveBestTime();
  recordWin();
  playWinSound();
  generationNote.textContent = `Solved without guessing in ${elapsedSeconds} second${elapsedSeconds === 1 ? '' : 's'}.`;
}

function saveBestTime() {
  const key = `minesweeper:best:${difficulty}`;
  const previous = Number(localStorage.getItem(key));
  if (!previous || elapsedSeconds < previous) localStorage.setItem(key, String(elapsedSeconds));
}

function renderBestTimes() {
  for (const key of Object.keys(PRESETS)) {
    const value = Number(localStorage.getItem(`minesweeper:best:${key}`));
    document.querySelector(`#best-${key}`).textContent = value ? `${value} seconds` : '---';
  }
}

function showBestTimes() {
  renderBestTimes();
  bestTimesDialog.showModal();
}

function showHelp(kind) {
  if (kind === 'about') {
    helpTitle.textContent = 'About Minesweeper';
    helpContent.innerHTML = `
      <p><strong>Classical Minesweeper PWA</strong> — a clean-room, Windows 95-inspired web implementation.</p>
      <p>Unlike traditional random Minesweeper, every generated field is tested by a deduction solver. If the solver would have to guess, that field is discarded before play begins.</p>
      <p>Version ${APP_VERSION} · ${DEDICATION}</p>
      <p>Sounds are synthesized in the browser; no Microsoft code, artwork, sounds, or game assets are included.</p>`;
  } else {
    helpTitle.textContent = 'How to Play';
    helpContent.innerHTML = `
      <p>Reveal every square that does not contain a mine. A number tells you how many mines touch that square.</p>
      <ul>
        <li><strong>Phone / tablet:</strong> short tap to reveal; press and hold to cycle flag → question mark → clear.</li>
        <li><strong>Mouse:</strong> left click to reveal; right click to cycle flag → question mark → clear.</li>
        <li><strong>Double-click a revealed number:</strong> chord-open its neighbours when the correct number of flags is present.</li>
        <li><strong>Keyboard:</strong> press F on a focused cell to mark it; F2 starts a new game.</li>
      </ul>
      <p>The first revealed square and its surrounding squares are protected, and the final board is accepted only when it can be solved by forced deductions.</p>`;
  }
  helpDialog.showModal();
}

function isStandaloneDisplay() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOSDevice() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function showInstallHelp(message = '') {
  helpTitle.textContent = 'Install Minesweeper';
  const intro = message ? `<p><strong>${message}</strong></p>` : '';

  if (isStandaloneDisplay()) {
    helpContent.innerHTML = `${intro}<p>Minesweeper is already running as an installed app.</p>`;
  } else if (isIOSDevice()) {
    helpContent.innerHTML = `${intro}
      <p>On iPhone and iPad, websites cannot open the PWA installation prompt themselves.</p>
      <ol>
        <li>Open this game in <strong>Safari</strong>.</li>
        <li>Tap the <strong>Share</strong> button.</li>
        <li>Choose <strong>Add to Home Screen</strong>.</li>
        <li>Tap <strong>Add</strong>.</li>
      </ol>
      <p>The Home Screen version then opens as a standalone app and continues to work offline after it has been cached.</p>`;
  } else {
    helpContent.innerHTML = `${intro}
      <p>If your browser supports direct PWA installation, use the install icon in the address bar or the browser's app/install menu.</p>
      <p>In Chrome, look for <strong>Install Minesweeper</strong> or <strong>Install app</strong>. In Edge, use <strong>Apps → Install this site as an app</strong>.</p>
      <p>If no install option is shown, make sure you opened the deployed HTTPS GitHub Pages site rather than a local file or the GitHub repository page.</p>`;
  }
  helpDialog.showModal();
}

async function handleInstallAction() {
  closeMenus();

  if (isStandaloneDisplay()) {
    showInstallHelp();
    return;
  }

  if (!deferredInstallPrompt) {
    showInstallHelp();
    return;
  }

  try {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (choice?.outcome !== 'accepted') showInstallHelp('Installation was not completed.');
  } catch {
    deferredInstallPrompt = null;
    showInstallHelp('The browser could not open its install prompt.');
  }
}

function closeMenus() {
  document.querySelectorAll('.menu-popup').forEach((menu) => { menu.hidden = true; });
  document.querySelectorAll('.menu-trigger').forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
}

function toggleMenu(button, menu) {
  const shouldOpen = menu.hidden;
  closeMenus();
  if (shouldOpen) {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  }
}

function cancelTouchPress(resetFace = true) {
  if (!touchPress) return;
  clearTimeout(touchPress.timer);
  cells[touchPress.index]?.classList.remove('pressing', 'long-press-active');
  touchPress = null;
  if (resetFace && status !== 'lost' && status !== 'won' && status !== 'generating') setFace('normal');
}

document.querySelector('#game-menu-button').addEventListener('click', () => toggleMenu(document.querySelector('#game-menu-button'), document.querySelector('#game-menu')));
document.querySelector('#options-menu-button').addEventListener('click', () => toggleMenu(document.querySelector('#options-menu-button'), document.querySelector('#options-menu')));
document.querySelector('#help-menu-button').addEventListener('click', () => toggleMenu(document.querySelector('#help-menu-button'), document.querySelector('#help-menu')));

document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.menu-wrap')) closeMenus();
});

document.querySelector('#game-menu').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.difficulty) newGame(button.dataset.difficulty);
  else if (button.dataset.action === 'new') newGame();
  else if (button.dataset.action === 'best-times') { closeMenus(); showBestTimes(); }
  else if (button.dataset.action === 'achievements') { closeMenus(); showAchievements(); }
});

document.querySelector('#options-menu').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.setting === 'sound') toggleSound();
  else if (button.dataset.theme) applyTheme(button.dataset.theme);
});

document.querySelector('#help-menu').addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  closeMenus();
  if (button.dataset.action === 'how-to-play') showHelp('help');
  else if (button.dataset.action === 'about') showHelp('about');
  else if (button.dataset.action === 'install') await handleInstallAction();
});

boardEl.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  if (performance.now() < suppressClickUntil) {
    event.preventDefault();
    return;
  }
  revealCell(Number(cell.dataset.index));
});

boardEl.addEventListener('contextmenu', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  event.preventDefault();
  if (performance.now() < suppressContextMenuUntil) return;
  cycleMark(Number(cell.dataset.index));
});

boardEl.addEventListener('dblclick', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  event.preventDefault();
  chord(Number(cell.dataset.index));
});

boardEl.addEventListener('pointerdown', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell || event.button !== 0 || cell.classList.contains('revealed')) return;

  ensureAudio(); // unlock Web Audio while iOS still considers this a user gesture
  cell.classList.add('pressing');
  setFace('surprised');

  if (event.pointerType === 'mouse') return;

  // Prevent iOS/Safari long-press text selection/callouts on nearby UI text.
  event.preventDefault();
  window.getSelection?.()?.removeAllRanges?.();

  cancelTouchPress(false);
  const index = Number(cell.dataset.index);
  const press = {
    pointerId: event.pointerId,
    index,
    startX: event.clientX,
    startY: event.clientY,
    longPressed: false,
    timer: 0
  };
  press.timer = window.setTimeout(() => {
    if (touchPress !== press) return;
    press.longPressed = true;
    window.getSelection?.()?.removeAllRanges?.();
    cell.classList.remove('pressing');
    cell.classList.add('long-press-active');
    setTimeout(() => cell.classList.remove('long-press-active'), 140);
    if (cycleMark(index)) navigator.vibrate?.(18);
    suppressClickUntil = performance.now() + 750;
    suppressContextMenuUntil = performance.now() + 900;
    if (status !== 'lost' && status !== 'won' && status !== 'generating') setFace('normal');
  }, LONG_PRESS_MS);
  touchPress = press;
  try { cell.setPointerCapture(event.pointerId); } catch {}
});

boardEl.addEventListener('pointermove', (event) => {
  if (!touchPress || event.pointerId !== touchPress.pointerId || touchPress.longPressed) return;
  const dx = event.clientX - touchPress.startX;
  const dy = event.clientY - touchPress.startY;
  if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_PX) cancelTouchPress();
});

boardEl.addEventListener('pointerup', (event) => {
  if (event.pointerType === 'mouse') return;
  if (!touchPress || event.pointerId !== touchPress.pointerId) return;
  const press = touchPress;
  clearTimeout(press.timer);
  cells[press.index]?.classList.remove('pressing');
  touchPress = null;
  suppressClickUntil = performance.now() + 750;
  suppressContextMenuUntil = performance.now() + 900;
  if (!press.longPressed) revealCell(press.index);
  if (status !== 'lost' && status !== 'won' && status !== 'generating') setFace('normal');
});

boardEl.addEventListener('pointercancel', () => cancelTouchPress());
boardEl.addEventListener('lostpointercapture', () => {
  if (touchPress && !touchPress.longPressed) cancelTouchPress();
});

document.addEventListener('pointerup', () => {
  document.querySelectorAll('.cell.pressing').forEach((cell) => cell.classList.remove('pressing'));
  if (status !== 'lost' && status !== 'won' && status !== 'generating' && !touchPress) setFace('normal');
});

boardEl.addEventListener('keydown', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    cycleMark(Number(cell.dataset.index));
  }
});

faceButton.addEventListener('click', () => newGame());

document.addEventListener('keydown', (event) => {
  if (event.key === 'F2') {
    event.preventDefault();
    newGame();
  } else if (event.key === 'Escape') {
    closeMenus();
  }
});

document.querySelector('#reset-times').addEventListener('click', () => {
  for (const key of Object.keys(PRESETS)) localStorage.removeItem(`minesweeper:best:${key}`);
  renderBestTimes();
});

document.querySelector('#export-achievements').addEventListener('click', () => exportAchievements());
document.querySelector('#import-achievements').addEventListener('click', () => {
  importAchievementsFile.value = '';
  importAchievementsFile.click();
});
importAchievementsFile.addEventListener('change', async () => {
  const [file] = importAchievementsFile.files || [];
  try {
    await importAchievements(file);
  } finally {
    importAchievementsFile.value = '';
  }
});

document.querySelector('#reset-achievements').addEventListener('click', () => {
  if (!window.confirm('Reset all statistics, achievements and best times?')) return;
  localStorage.removeItem(STATS_KEY);
  for (const key of Object.keys(PRESETS)) localStorage.removeItem(`minesweeper:best:${key}`);
  renderAchievements();
  renderBestTimes();
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
});

window.addEventListener('resize', scheduleBoardFit, { passive: true });
window.addEventListener('orientationchange', scheduleBoardFit, { passive: true });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

if (systemThemeQuery?.addEventListener) systemThemeQuery.addEventListener('change', handleSystemThemeChange);
else systemThemeQuery?.addListener?.(handleSystemThemeChange);

document.querySelector('#app-version').textContent = `v${APP_VERSION}`;
applyTheme(theme, false);
updateSoundMenu();
newGame();
