import { generateCandidate, isLogicallySolvable } from './src/logic.js';

const APP_VERSION = '1.2.3';
const DEDICATION = 'Dedicated to my daughter Lilly ♥';
const LONG_PRESS_MS = 480;
const LONG_PRESS_MOVE_PX = 12;
const STATS_KEY = 'minesweeper:stats:v1';
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const UPDATE_RECHECK_ON_RESUME_MS = 5 * 60 * 1000;

// iOS/iPadOS does not expose a general-purpose web vibration API.
// Safari 18 can haptically tick a real native switch control, but using an
// invisible switch as a game-cell proxy is intermittent and interferes with
// gestures. v1.1.9 therefore uses haptics only where the standard Vibration
// API is actually available, keeping iPhone gameplay deterministic.
const IS_IOS = /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const TACTILE_SUPPORTED = typeof navigator.vibrate === 'function';

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
const shareDialog = document.querySelector('#share-dialog');
const shareText = document.querySelector('#share-text');
const shareStatus = document.querySelector('#share-status');
const nativeShareButton = document.querySelector('#native-share-results');
const copyShareButton = document.querySelector('#copy-share-results');
const soundCheck = document.querySelector('#sound-check');
const tactileCheck = document.querySelector('#tactile-check');
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const updateBanner = document.querySelector('#update-banner');
const updateTitle = document.querySelector('#update-title');
const updateMessage = document.querySelector('#update-message');
const updateNowButton = document.querySelector('#update-now');
const updateLaterButton = document.querySelector('#update-later');
const precisionPanel = document.querySelector('#precision-panel');
const precisionPreviewGrid = document.querySelector('#precision-preview-grid');
const precisionSelectionStatus = document.querySelector('#precision-selection-status');
const precisionRevealButton = document.querySelector('#precision-reveal');
const precisionFlagButton = document.querySelector('#precision-flag');
const precisionFitButton = document.querySelector('#precision-fit');
const precisionMoveButtons = [...document.querySelectorAll('[data-precision-move]')];
const touchHint = document.querySelector('#touch-hint');

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
const tactilePreference = localStorage.getItem('minesweeper:tactile') !== 'off';
let tactileEnabled = TACTILE_SUPPORTED && tactilePreference;
const systemThemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)') || null;
let theme = localStorage.getItem('minesweeper:theme') || 'system';
if (!['system', 'light', 'dark'].includes(theme)) theme = 'system';
let audioContext = null;
let touchPress = null;
let suppressClickUntil = 0;
let suppressContextMenuUntil = 0;
let serviceWorkerRegistration = null;
let waitingUpdateWorker = null;
let availableUpdateVersion = null;
let dismissedUpdateVersion = null;
let updateCheckPromise = null;
let updateActivationRequested = false;
let controllerChangeReloading = false;
let lastUpdateCheckAt = 0;
let touchControlMode = localStorage.getItem('minesweeper:touch-controls') || 'direct';
if (!['direct', 'precision'].includes(touchControlMode)) touchControlMode = 'direct';
let precisionSelectedIndex = null;
let precisionCrosshairEl = null;
let precisionZoom = 1;
let precisionPanX = 0;
let precisionPanY = 0;
let precisionPointers = new Map();
let precisionPinch = null;
let precisionGestureWasPinch = false;
const PRECISION_MAX_ZOOM = 3;
const PRECISION_PINCH_THRESHOLD_PX = 14;

const supportsWorker = typeof Worker !== 'undefined';
if (supportsWorker) generatorWorker = new Worker('./generator-worker.js', { type: 'module' });

function formatCounter(value) {
  const clamped = Math.max(-99, Math.min(999, value));
  return clamped < 0 ? `-${String(Math.abs(clamped)).padStart(2, '0')}` : String(clamped).padStart(3, '0');
}

function formatElapsedDisplay(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  if (seconds <= 999) return String(seconds).padStart(3, '0');
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours === 0) return `${Math.floor(seconds / 60)}:${String(secs).padStart(2, '0')}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatElapsedHuman(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function renderTimer() {
  const display = formatElapsedDisplay(elapsedSeconds);
  timerEl.textContent = display;
  timerEl.dataset.digits = String(display.length);
  const label = `Elapsed time ${formatElapsedHuman(elapsedSeconds)}`;
  timerEl.setAttribute('aria-label', label);
  timerEl.title = label;
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
  elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  renderTimer();
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = 0;
}

function startTimer() {
  stopTimer();
  startTime = Date.now();
  elapsedSeconds = 0;
  renderTimer();
  timerHandle = setInterval(updateTimer, 250);
}

function setFace(kind = 'normal') {
  faceButton.classList.remove('surprised', 'dead', 'cool');
  if (kind !== 'normal') faceButton.classList.add(kind);
}

function makeCell(index) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.dataset.index = String(index);
  cell.tabIndex = 0;
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
  if (touchControlMode === 'precision') requestAnimationFrame(() => applyPrecisionTransform());
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
  precisionCrosshairEl = document.createElement('div');
  precisionCrosshairEl.className = 'precision-crosshair';
  precisionCrosshairEl.setAttribute('aria-hidden', 'true');
  precisionCrosshairEl.hidden = true;
  boardEl.appendChild(precisionCrosshairEl);
  fitBoardToViewport();
  if (isPrecisionMode() && cells.length && precisionSelectedIndex === null) {
    precisionSelectedIndex = precisionCenterIndex();
  }
  updatePrecisionSelection(false);
}


function isPrecisionMode() {
  return touchControlMode === 'precision';
}

function precisionCellSize() {
  return Number.parseFloat(boardEl.dataset.cellSize || getComputedStyle(boardEl).getPropertyValue('--cell-size')) || 24;
}

function clampPrecisionPan() {
  if (!isPrecisionMode()) {
    precisionPanX = 0;
    precisionPanY = 0;
    return;
  }
  const frameWidth = boardFrameEl.clientWidth;
  const frameHeight = boardFrameEl.clientHeight;
  const scaledWidth = boardEl.offsetWidth * precisionZoom;
  const scaledHeight = boardEl.offsetHeight * precisionZoom;
  const minX = Math.min(0, frameWidth - scaledWidth);
  const minY = Math.min(0, frameHeight - scaledHeight);
  precisionPanX = Math.min(0, Math.max(minX, precisionPanX));
  precisionPanY = Math.min(0, Math.max(minY, precisionPanY));
}

function applyPrecisionTransform() {
  if (!isPrecisionMode()) {
    boardEl.style.transform = '';
    boardEl.style.transformOrigin = '';
    boardFrameEl.classList.remove('precision-active', 'precision-zoomed');
    return;
  }
  clampPrecisionPan();
  boardFrameEl.classList.add('precision-active');
  boardFrameEl.classList.toggle('precision-zoomed', precisionZoom > 1.001);
  boardEl.style.transformOrigin = '0 0';
  boardEl.style.transform = `translate3d(${precisionPanX}px, ${precisionPanY}px, 0) scale(${precisionZoom})`;
  if (precisionFitButton) {
    precisionFitButton.title = precisionZoom > 1.001
      ? `Return to fitted view (currently ${Math.round(precisionZoom * 100)}%)`
      : 'Board is fitted to the available width';
  }
}

function resetPrecisionView() {
  precisionZoom = 1;
  precisionPanX = 0;
  precisionPanY = 0;
  precisionPinch = null;
  precisionPointers.clear();
  applyPrecisionTransform();
  if (precisionSelectedIndex !== null) ensurePrecisionSelectionVisible();
}


function precisionCenterIndex() {
  if (!cells.length) return null;
  if (precisionSelectedIndex !== null && precisionSelectedIndex >= 0 && precisionSelectedIndex < cells.length) return precisionSelectedIndex;
  const size = precisionCellSize();
  const viewWidth = boardFrameEl.clientWidth || boardEl.offsetWidth || size;
  const viewHeight = boardFrameEl.clientHeight || boardEl.offsetHeight || size;
  const visibleCenterX = ((viewWidth / 2) - precisionPanX) / Math.max(precisionZoom, 0.001);
  const visibleCenterY = ((viewHeight / 2) - precisionPanY) / Math.max(precisionZoom, 0.001);
  const col = Math.max(0, Math.min(config.cols - 1, Math.round((visibleCenterX / Math.max(size, 1)) - 0.5)));
  const row = Math.max(0, Math.min(config.rows - 1, Math.round((visibleCenterY / Math.max(size, 1)) - 0.5)));
  return row * config.cols + col;
}

function movePrecisionSelection(deltaRow = 0, deltaCol = 0) {
  if (!cells.length || !isPrecisionMode()) return false;
  const baseIndex = precisionCenterIndex();
  if (baseIndex === null) return false;
  const row = Math.floor(baseIndex / config.cols);
  const col = baseIndex % config.cols;
  const nextRow = Math.max(0, Math.min(config.rows - 1, row + deltaRow));
  const nextCol = Math.max(0, Math.min(config.cols - 1, col + deltaCol));
  const nextIndex = nextRow * config.cols + nextCol;
  return selectPrecisionCell(nextIndex, true);
}

function updatePrecisionMoveButtons() {
  const playable = Boolean(cells.length) && isPrecisionMode();
  for (const button of precisionMoveButtons) {
    button.disabled = !playable;
  }
}

function precisionSelectionDescription(index) {
  if (index === null || index < 0 || index >= cells.length) return 'No tile selected';
  const row = Math.floor(index / config.cols) + 1;
  const col = (index % config.cols) + 1;
  let stateText = 'Covered';
  if (revealed[index]) {
    const value = board ? board.counts[index] : 0;
    stateText = value ? `Revealed ${value}` : 'Revealed empty';
  } else if (marks[index] === 1) stateText = 'Flagged';
  else if (marks[index] === 2) stateText = 'Question mark';
  return `Row ${row} · Column ${col} · ${stateText}`;
}

function ensurePrecisionSelectionVisible() {
  if (!isPrecisionMode() || precisionSelectedIndex === null || precisionZoom <= 1.001) return;
  const size = precisionCellSize();
  const row = Math.floor(precisionSelectedIndex / config.cols);
  const col = precisionSelectedIndex % config.cols;
  const margin = 10;
  const left = col * size * precisionZoom + precisionPanX;
  const top = row * size * precisionZoom + precisionPanY;
  const right = left + size * precisionZoom;
  const bottom = top + size * precisionZoom;
  const width = boardFrameEl.clientWidth;
  const height = boardFrameEl.clientHeight;

  if (left < margin) precisionPanX += margin - left;
  else if (right > width - margin) precisionPanX -= right - (width - margin);
  if (top < margin) precisionPanY += margin - top;
  else if (bottom > height - margin) precisionPanY -= bottom - (height - margin);
  applyPrecisionTransform();
}

function renderPrecisionPreview() {
  if (!precisionPreviewGrid) return;
  precisionPreviewGrid.replaceChildren();
  if (precisionSelectedIndex === null || !cells.length) {
    for (let i = 0; i < 9; i++) {
      const blank = document.createElement('span');
      blank.className = 'cell preview-cell preview-blank';
      blank.setAttribute('aria-hidden', 'true');
      precisionPreviewGrid.appendChild(blank);
    }
    precisionSelectionStatus.textContent = 'Use the arrows or tap the board to aim';
    return;
  }

  const selectedRow = Math.floor(precisionSelectedIndex / config.cols);
  const selectedCol = precisionSelectedIndex % config.cols;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const row = selectedRow + dr;
      const col = selectedCol + dc;
      if (row < 0 || row >= config.rows || col < 0 || col >= config.cols) {
        const blank = document.createElement('span');
        blank.className = 'cell preview-cell preview-blank';
        blank.setAttribute('aria-hidden', 'true');
        precisionPreviewGrid.appendChild(blank);
        continue;
      }
      const source = cells[row * config.cols + col];
      const clone = source.cloneNode(true);
      clone.removeAttribute('tabindex');
      clone.removeAttribute('role');
      clone.removeAttribute('aria-label');
      clone.removeAttribute('data-index');
      clone.classList.remove('pressing', 'long-press-active', 'first-click');
      clone.classList.add('preview-cell');
      if (dr === 0 && dc === 0) clone.classList.add('preview-selected');
      clone.setAttribute('aria-hidden', 'true');
      precisionPreviewGrid.appendChild(clone);
    }
  }
  precisionSelectionStatus.textContent = precisionSelectionDescription(precisionSelectedIndex);
}

function updatePrecisionControls() {
  const selected = precisionSelectedIndex !== null && precisionSelectedIndex >= 0 && precisionSelectedIndex < cells.length;
  const playable = status === 'ready' || status === 'playing';
  const isRevealed = selected && Boolean(revealed[precisionSelectedIndex]);
  const isFlagged = selected && marks[precisionSelectedIndex] === 1;
  const chordable = isRevealed && board && board.counts[precisionSelectedIndex] > 0;

  precisionRevealButton.disabled = !selected || !playable || (isFlagged && !isRevealed) || (isRevealed && !chordable);
  precisionFlagButton.disabled = !selected || !playable || isRevealed;

  if (selected && !isRevealed) {
    const mark = marks[precisionSelectedIndex];
    precisionFlagButton.title = mark === 0 ? 'Place a flag' : mark === 1 ? 'Change the flag to a question mark' : 'Clear the question mark';
  } else {
    precisionFlagButton.title = 'Select a covered tile first';
  }
  precisionRevealButton.title = chordable ? 'Chord this revealed number' : 'Reveal the selected tile';
  updatePrecisionMoveButtons();
}

function updatePrecisionSelection(ensureVisible = true) {
  if (!isPrecisionMode()) {
    if (precisionCrosshairEl) precisionCrosshairEl.hidden = true;
    renderPrecisionPreview();
    updatePrecisionControls();
    return;
  }
  const valid = precisionSelectedIndex !== null && precisionSelectedIndex >= 0 && precisionSelectedIndex < cells.length;
  if (!valid) {
    precisionSelectedIndex = null;
    if (precisionCrosshairEl) precisionCrosshairEl.hidden = true;
  } else if (precisionCrosshairEl) {
    const size = precisionCellSize();
    const row = Math.floor(precisionSelectedIndex / config.cols);
    const col = precisionSelectedIndex % config.cols;
    const crosshairSize = Math.max(12, size * 0.7);
    const offset = (size - crosshairSize) / 2;
    precisionCrosshairEl.hidden = false;
    precisionCrosshairEl.style.width = `${crosshairSize}px`;
    precisionCrosshairEl.style.height = `${crosshairSize}px`;
    precisionCrosshairEl.style.left = `${(col * size) + offset}px`;
    precisionCrosshairEl.style.top = `${(row * size) + offset}px`;
  }
  renderPrecisionPreview();
  updatePrecisionControls();
  if (ensureVisible && valid) ensurePrecisionSelectionVisible();
}

function selectPrecisionCell(index, ensureVisible = true) {
  if (!Number.isInteger(index) || index < 0 || index >= cells.length) return false;
  precisionSelectedIndex = index;
  updatePrecisionSelection(ensureVisible);
  return true;
}

function clearPrecisionSelection() {
  precisionSelectedIndex = null;
  updatePrecisionSelection(false);
}

function updateTouchControlMenu() {
  document.querySelectorAll('[data-touch-controls]').forEach((button) => {
    const active = button.dataset.touchControls === touchControlMode;
    button.setAttribute('aria-checked', String(active));
    button.querySelector('.check-slot').textContent = active ? '✓' : '';
  });
}

function applyTouchControlMode(nextMode, persist = true) {
  touchControlMode = nextMode === 'precision' ? 'precision' : 'direct';
  if (persist) localStorage.setItem('minesweeper:touch-controls', touchControlMode);
  cancelTouchPress(false);
  precisionPointers.clear();
  precisionPinch = null;
  precisionGestureWasPinch = false;
  precisionPanel.hidden = !isPrecisionMode();
  boardFrameEl.classList.toggle('precision-mode', isPrecisionMode());
  touchHint.textContent = isPrecisionMode()
    ? 'Precision: arrows or tap/drag to aim · Reveal or Flag below · pinch to zoom'
    : 'Tap to reveal · Hold to flag';
  if (!isPrecisionMode()) {
    precisionZoom = 1;
    precisionPanX = 0;
    precisionPanY = 0;
    clearPrecisionSelection();
  }
  applyPrecisionTransform();
  updateTouchControlMenu();
  updatePrecisionSelection(false);
}

function precisionCellAtPoint(clientX, clientY) {
  const target = document.elementFromPoint(clientX, clientY);
  const cell = target?.closest?.('.cell');
  if (!cell || !boardEl.contains(cell) || cell.classList.contains('preview-cell')) return null;
  const index = Number(cell.dataset.index);
  return Number.isInteger(index) ? index : null;
}

function precisionPointerDown(event, cell) {
  if (event.button !== 0 && event.pointerType === 'mouse') return;
  ensureAudio();
  if (event.pointerType === 'mouse') {
    selectPrecisionCell(Number(cell.dataset.index));
    return;
  }

  event.preventDefault();
  window.getSelection?.()?.removeAllRanges?.();
  precisionPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  try { boardEl.setPointerCapture(event.pointerId); } catch {}

  if (precisionPointers.size === 1) {
    precisionGestureWasPinch = false;
    selectPrecisionCell(Number(cell.dataset.index));
    tactile(10);
    return;
  }

  if (precisionPointers.size === 2) {
    precisionGestureWasPinch = true;
    const pts = [...precisionPointers.values()];
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const rect = boardFrameEl.getBoundingClientRect();
    const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
    const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
    precisionPinch = {
      distance: Math.max(1, Math.hypot(dx, dy)),
      startZoom: precisionZoom,
      anchorX: (midX - precisionPanX) / precisionZoom,
      anchorY: (midY - precisionPanY) / precisionZoom,
      active: false
    };
  }
}

function precisionPointerMove(event) {
  if (!precisionPointers.has(event.pointerId)) return;
  event.preventDefault();
  precisionPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (precisionPointers.size >= 2 && precisionPinch) {
    const pts = [...precisionPointers.values()].slice(0, 2);
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    if (!precisionPinch.active) {
      if (Math.abs(distance - precisionPinch.distance) < PRECISION_PINCH_THRESHOLD_PX) return;
      precisionPinch.active = true;
    }
    const rect = boardFrameEl.getBoundingClientRect();
    const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
    const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
    precisionZoom = Math.max(1, Math.min(PRECISION_MAX_ZOOM, precisionPinch.startZoom * (distance / precisionPinch.distance)));
    precisionPanX = midX - precisionPinch.anchorX * precisionZoom;
    precisionPanY = midY - precisionPinch.anchorY * precisionZoom;
    applyPrecisionTransform();
    return;
  }

  if (!precisionGestureWasPinch && precisionPointers.size === 1) {
    const index = precisionCellAtPoint(event.clientX, event.clientY);
    if (index !== null && index !== precisionSelectedIndex) selectPrecisionCell(index, false);
  }
}

function precisionPointerEnd(event) {
  if (!precisionPointers.has(event.pointerId)) return;
  precisionPointers.delete(event.pointerId);
  if (precisionPointers.size < 2) precisionPinch = null;
  if (precisionPointers.size === 0) {
    precisionGestureWasPinch = false;
    if (precisionSelectedIndex !== null) ensurePrecisionSelectionVisible();
  }
}

function precisionRevealSelected() {
  if (precisionSelectedIndex === null) return;
  const index = precisionSelectedIndex;
  if (revealed[index]) chord(index);
  else revealCell(index);
  updatePrecisionSelection(false);
}

function precisionFlagSelected() {
  if (precisionSelectedIndex === null) return;
  if (cycleMark(precisionSelectedIndex)) tactile([18, 24, 26]);
  updatePrecisionSelection(false);
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

function updateTactileMenu() {
  const button = document.querySelector('[data-setting="tactile"]');
  const label = button?.querySelector('.setting-label');
  tactileCheck.textContent = tactileEnabled ? '✓' : '';
  button?.setAttribute('aria-checked', String(tactileEnabled));
  if (!button) return;

  if (!TACTILE_SUPPORTED) {
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    if (IS_IOS) {
      if (label) label.textContent = 'Tactile feedback (iPhone unavailable)';
      button.title = 'iPhone/iPad web apps do not expose a reliable programmable haptics API. The previous native-switch workaround was removed because it was intermittent.';
    } else {
      if (label) label.textContent = 'Tactile feedback (unavailable)';
      button.title = 'This browser/device does not expose the Vibration API.';
    }
    return;
  }

  button.disabled = false;
  button.removeAttribute('aria-disabled');
  if (label) label.textContent = 'Tactile feedback';
  button.title = 'Uses the device Vibration API. Enabled by default on supported devices.';
}

function tactile(pattern = 10) {
  if (!tactileEnabled || !TACTILE_SUPPORTED) return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

function toggleTactile() {
  if (!TACTILE_SUPPORTED) return;
  tactileEnabled = !tactileEnabled;
  localStorage.setItem('minesweeper:tactile', tactileEnabled ? 'on' : 'off');
  updateTactileMenu();
  if (tactileEnabled) tactile([12, 22, 12]);
  else navigator.vibrate(0);
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
    const raw = localStorage.getItem(`minesweeper:best:${key}`);
    if (raw === null) {
      out[key] = null;
      continue;
    }
    const value = Number(raw);
    out[key] = Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
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
    if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid ${PRESETS[key].label} best time.`);
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
  renderTimer();
  updateCounter();
  setFace('normal');
  generationNote.textContent = 'Every board is generated to be solvable by deduction without guessing.';
  precisionSelectedIndex = null;
  precisionZoom = 1;
  precisionPanX = 0;
  precisionPanY = 0;
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
  updatePrecisionSelection(false);
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
  updatePrecisionSelection(false);
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
  elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  renderTimer();
  status = 'lost';
  stopTimer();
  setFace('dead');
  playExplosionSound();
  tactile([35, 30, 75]);
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
  updatePrecisionSelection(false);
}

function checkWin() {
  if (status !== 'playing' || openedSafe !== config.rows * config.cols - config.mines) return;
  elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  renderTimer();
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
  tactile([12, 28, 12, 28, 22]);
  generationNote.textContent = `Solved without guessing in ${formatElapsedHuman(elapsedSeconds)}.`;
  updatePrecisionSelection(false);
}

function saveBestTime() {
  const key = `minesweeper:best:${difficulty}`;
  const previous = Number(localStorage.getItem(key));
  if (!previous || elapsedSeconds < previous) localStorage.setItem(key, String(elapsedSeconds));
}

function renderBestTimes() {
  const best = bestTimesObject();
  for (const key of Object.keys(PRESETS)) {
    const value = best[key];
    document.querySelector(`#best-${key}`).textContent = value === null ? '---' : formatElapsedHuman(value);
  }
}

function showBestTimes() {
  renderBestTimes();
  bestTimesDialog.showModal();
}

function buildSharePayload() {
  const stats = loadStats();
  const best = bestTimesObject();
  const achievements = getAchievements(stats, best);
  const earned = achievements.filter((item) => item.earned).length;
  const wins = Object.values(stats.wins).reduce((sum, value) => sum + value, 0);
  const losses = Object.values(stats.losses).reduce((sum, value) => sum + value, 0);
  const completed = wins + losses;
  const started = Object.values(stats.gamesStarted).reduce((sum, value) => sum + value, 0);
  const winRate = completed ? Math.round((wins / completed) * 100) : 0;
  const bestLine = Object.keys(PRESETS)
    .map((key) => `${PRESETS[key].label}: ${best[key] === null ? '—' : formatElapsedHuman(best[key])}`)
    .join(' · ');

  const lines = ['Classical Minesweeper — no-guess boards'];
  if (status === 'won') lines.push(`Just cleared ${config.label} in ${formatElapsedHuman(elapsedSeconds)}.`);
  lines.push(`Games started: ${started} · Completed: ${completed} · Wins: ${wins} (${winRate}%)`);
  lines.push(`Best streak: ${stats.bestWinStreak} · Achievements: ${earned}/${achievements.length}`);
  lines.push(`Best times — ${bestLine}`);

  const url = new URL('./', window.location.href).href;
  return {
    title: 'Classical Minesweeper',
    text: lines.join('\n'),
    url,
    fullText: `${lines.join('\n')}\n${url}`
  };
}

function refreshShareDialog() {
  const payload = buildSharePayload();
  shareText.value = payload.fullText;
  shareStatus.textContent = '';
  nativeShareButton.hidden = typeof navigator.share !== 'function';
  return payload;
}

function showShareDialog() {
  refreshShareDialog();
  shareDialog.showModal();
}

async function shareResults() {
  const payload = buildSharePayload();
  if (typeof navigator.share !== 'function') {
    showShareDialog();
    shareStatus.textContent = 'Native sharing is not available here. Use Copy instead.';
    return;
  }
  try {
    await navigator.share({ title: payload.title, text: payload.text, url: payload.url });
    shareStatus.textContent = 'Shared.';
  } catch (error) {
    if (error?.name !== 'AbortError') shareStatus.textContent = 'Sharing could not be opened. You can copy the text instead.';
  }
}

async function copyShareResults() {
  const payload = buildSharePayload();
  try {
    await navigator.clipboard.writeText(payload.fullText);
    shareStatus.textContent = 'Copied to clipboard.';
  } catch {
    shareText.focus();
    shareText.select();
    shareStatus.textContent = 'Select and copy the highlighted text.';
  }
}

function showHelp(kind) {
  if (kind === 'about') {
    helpTitle.textContent = 'About Minesweeper';
    helpContent.innerHTML = `
      <p><strong>Classical Minesweeper PWA</strong> — a clean-room, Windows 95-inspired web implementation.</p>
      <p>Unlike traditional random Minesweeper, every generated field is tested by a deduction solver. If the solver would have to guess, that field is discarded before play begins.</p>
      <p>Version ${APP_VERSION} · ${DEDICATION}</p>
      <p>The original three-digit Minesweeper clock stopped at 999 seconds. This version preserves the classic 000–999 display, then continues with minutes and seconds so longer games are timed accurately.</p>
      <p>For small touch screens, Options offers a Precision touch mode with an unobtrusive corner crosshair, a compact four-arrow navigation pad, a live magnified 3×3 preview, large Reveal/Flag controls, and deliberate two-finger zoom up to 3×.</p>
      <p>Sounds are synthesized in the browser. Tactile feedback uses the standard Vibration API on supported devices and is enabled by default there. On iPhone/iPad, web apps do not expose a reliable programmable haptics API, so tactile feedback is shown as unavailable rather than using the previous intermittent native-switch workaround.</p>
      <p>No Microsoft code, artwork, sounds, or game assets are included.</p>`;
  } else {
    helpTitle.textContent = 'How to Play';
    helpContent.innerHTML = `
      <p>Reveal every square that does not contain a mine. A number tells you how many mines touch that square.</p>
      <ul>
        <li><strong>Phone / tablet — Direct:</strong> short tap to reveal; press and hold to cycle flag → question mark → clear.</li>
        <li><strong>Phone / tablet — Precision:</strong> choose Precision touch under Options, then move the crosshair with the compact four-arrow pad or by tapping/dragging the board. The magnified 3×3 preview follows the crosshair. Use Reveal or Flag below; Flag cycles flag → question mark → clear. Use a two-finger pinch/drag to zoom and pan the board; Fit returns to the full-board view.</li>
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

function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent);
}

function showInstallHelp(message = '') {
  helpTitle.textContent = 'Install Minesweeper';
  const intro = message ? `<p><strong>${message}</strong></p>` : '';

  if (isStandaloneDisplay()) {
    helpContent.innerHTML = `${intro}<p>Minesweeper is already running as an installed app.</p>`;
  } else if (isIOSDevice()) {
    helpContent.innerHTML = `${intro}
      <h3>iPhone / iPad</h3>
      <p>On iPhone and iPad, websites cannot open the PWA installation prompt themselves.</p>
      <ol>
        <li>Open this game in <strong>Safari</strong>.</li>
        <li>Tap the <strong>Share</strong> button.</li>
        <li>Choose <strong>Add to Home Screen</strong>.</li>
        <li>Tap <strong>Add</strong>.</li>
      </ol>
      <p>The Home Screen version then opens as a standalone app and continues to work offline after it has been cached.</p>`;
  } else if (isAndroidDevice()) {
    helpContent.innerHTML = `${intro}
      <h3>Android</h3>
      <p><strong>Chrome:</strong></p>
      <ol>
        <li>Open the deployed Minesweeper site in <strong>Chrome</strong>.</li>
        <li>Tap the <strong>⋮</strong> menu.</li>
        <li>Choose <strong>Install app</strong>. On some Chrome versions this appears under <strong>Add to Home screen</strong>.</li>
        <li>Confirm <strong>Install</strong>.</li>
      </ol>
      <p><strong>Samsung Internet:</strong> open the browser menu and choose <strong>Add page to → Home screen</strong>, or use its install shortcut when offered.</p>
      <p><strong>Edge:</strong> open the browser menu, choose <strong>Add to phone</strong> or <strong>Install app</strong>, then confirm.</p>
      <p>After installation, launch Minesweeper from the Home screen/app launcher. Once the game has been opened online and cached, it can continue to work offline.</p>`;
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

async function getServiceWorkerVersion(worker, timeoutMs = 1500) {
  if (!worker || typeof MessageChannel === 'undefined') return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { channel.port1.close(); } catch {}
      resolve(typeof value === 'string' && value ? value : null);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    channel.port1.onmessage = (event) => finish(event.data?.version);
    try {
      worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

function setUpdateBanner(worker, version, force = false) {
  waitingUpdateWorker = worker || serviceWorkerRegistration?.waiting || null;
  availableUpdateVersion = version || availableUpdateVersion || null;
  const dismissKey = availableUpdateVersion || 'new-version';
  if (!force && dismissedUpdateVersion === dismissKey) return;

  updateTitle.textContent = availableUpdateVersion
    ? `Minesweeper v${availableUpdateVersion} is available`
    : 'A Minesweeper update is available';
  updateMessage.textContent = `You are using v${APP_VERSION}. Update now reloads the app; achievements, best times and settings are preserved.`;
  updateNowButton.disabled = false;
  updateNowButton.textContent = 'Update now';
  updateBanner.hidden = false;
}

function hideUpdateBanner(dismiss = false) {
  if (dismiss) dismissedUpdateVersion = availableUpdateVersion || 'new-version';
  updateBanner.hidden = true;
}

async function announceWaitingUpdate(worker, force = false) {
  if (!worker || !navigator.serviceWorker?.controller) return null;
  const version = await getServiceWorkerVersion(worker);
  setUpdateBanner(worker, version, force);
  return { status: 'available', worker, version };
}

function waitForWorkerInstall(worker, timeoutMs = 12000) {
  if (!worker) return Promise.resolve();
  if (['installed', 'activated', 'redundant'].includes(worker.state)) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('statechange', onStateChange);
      resolve();
    };
    const onStateChange = () => {
      if (['installed', 'activated', 'redundant'].includes(worker.state)) finish();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    worker.addEventListener('statechange', onStateChange);
  });
}

function watchServiceWorkerRegistration(registration) {
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', async () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        await announceWaitingUpdate(registration.waiting || worker);
      }
    });
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  if (serviceWorkerRegistration) return serviceWorkerRegistration;

  try {
    try {
      serviceWorkerRegistration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    } catch {
      serviceWorkerRegistration = await navigator.serviceWorker.register('./sw.js');
    }
    watchServiceWorkerRegistration(serviceWorkerRegistration);
    if (serviceWorkerRegistration.waiting && navigator.serviceWorker.controller) {
      await announceWaitingUpdate(serviceWorkerRegistration.waiting);
    }
    return serviceWorkerRegistration;
  } catch {
    return null;
  }
}

function showUpdateCheckDialog(state, version = null) {
  helpTitle.textContent = 'Minesweeper Updates';
  if (state === 'checking') {
    helpContent.innerHTML = `<p><strong>Checking for updates…</strong></p><p>Current version: v${APP_VERSION}</p>`;
  } else if (state === 'available') {
    const label = version ? `v${version}` : 'a newer version';
    helpContent.innerHTML = `
      <p><strong>${label} is ready to install.</strong></p>
      <p>Current version: v${APP_VERSION}</p>
      <p>Updating reloads Minesweeper. Your achievements, best times, theme, sound and other local settings are kept.</p>
      <div class="update-inline-wrap"><button type="button" class="update-inline-action" id="update-now-inline">Update now</button></div>`;
    document.querySelector('#update-now-inline')?.addEventListener('click', async () => {
      helpDialog.close();
      await activateWaitingUpdate();
    });
  } else if (state === 'unsupported') {
    helpContent.innerHTML = `<p>Automatic PWA update checks are not available in this browser.</p><p>Current version: v${APP_VERSION}</p>`;
  } else if (state === 'error') {
    helpContent.innerHTML = `<p><strong>Could not check for updates.</strong></p><p>Current version: v${APP_VERSION}</p><p>Check your internet connection and try again later. The installed game remains usable offline.</p>`;
  } else {
    helpContent.innerHTML = `<p><strong>Minesweeper is up to date.</strong></p><p>Current version: v${APP_VERSION}</p>`;
  }
  if (!helpDialog.open) helpDialog.showModal();
}

async function checkForUpdates({ manual = false } = {}) {
  if (manual) showUpdateCheckDialog('checking');
  if (!('serviceWorker' in navigator)) {
    if (manual) showUpdateCheckDialog('unsupported');
    return { status: 'unsupported' };
  }
  if (updateCheckPromise) {
    const result = await updateCheckPromise;
    if (manual) showUpdateCheckDialog(result.status, result.version);
    return result;
  }

  updateCheckPromise = (async () => {
    const registration = await registerServiceWorker();
    if (!registration) return { status: 'error' };
    lastUpdateCheckAt = Date.now();

    if (registration.waiting && navigator.serviceWorker.controller) {
      const version = await getServiceWorkerVersion(registration.waiting);
      setUpdateBanner(registration.waiting, version, manual);
      return { status: 'available', version, worker: registration.waiting };
    }

    // On a first-ever installation there is no older controlled app to update.
    if (!navigator.serviceWorker.controller) return { status: 'current', version: APP_VERSION };

    try {
      await registration.update();
      if (registration.installing) await waitForWorkerInstall(registration.installing);
    } catch {
      return { status: 'error' };
    }

    const waiting = registration.waiting;
    if (waiting) {
      const version = await getServiceWorkerVersion(waiting);
      setUpdateBanner(waiting, version, manual);
      return { status: 'available', version, worker: waiting };
    }
    return { status: 'current', version: APP_VERSION };
  })();

  let result;
  try {
    result = await updateCheckPromise;
  } finally {
    updateCheckPromise = null;
  }
  if (manual) showUpdateCheckDialog(result.status, result.version);
  return result;
}

async function activateWaitingUpdate() {
  let worker = waitingUpdateWorker || serviceWorkerRegistration?.waiting || null;
  if (!worker) {
    const result = await checkForUpdates({ manual: true });
    worker = result.worker || serviceWorkerRegistration?.waiting || null;
    if (!worker) return;
  }

  if ((status === 'playing' || status === 'generating') && !window.confirm('Update now? The current board will close and Minesweeper will reload. Your statistics and settings will be preserved.')) return;

  updateActivationRequested = true;
  updateNowButton.disabled = true;
  updateNowButton.textContent = 'Updating…';
  updateMessage.textContent = 'Installing the update… Minesweeper will reload automatically.';
  updateBanner.hidden = false;

  try {
    worker.postMessage({ type: 'SKIP_WAITING' });
  } catch {
    updateNowButton.disabled = false;
    updateNowButton.textContent = 'Update now';
    updateMessage.textContent = 'The update could not be activated. Close and reopen the app, then try again.';
  }
}

async function initializeUpdateChecks() {
  const registration = await registerServiceWorker();
  if (!registration) return;
  window.setTimeout(() => checkForUpdates().catch(() => {}), 1200);
  window.setInterval(() => checkForUpdates().catch(() => {}), UPDATE_CHECK_INTERVAL_MS);
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
  else if (button.dataset.setting === 'tactile') toggleTactile();
  else if (button.dataset.touchControls) applyTouchControlMode(button.dataset.touchControls);
  else if (button.dataset.theme) applyTheme(button.dataset.theme);
});

document.querySelector('#help-menu').addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  closeMenus();
  if (button.dataset.action === 'how-to-play') showHelp('help');
  else if (button.dataset.action === 'about') showHelp('about');
  else if (button.dataset.action === 'install') await handleInstallAction();
  else if (button.dataset.action === 'check-updates') await checkForUpdates({ manual: true });
  else if (button.dataset.action === 'share') showShareDialog();
});

boardEl.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  if (isPrecisionMode()) {
    event.preventDefault();
    selectPrecisionCell(Number(cell.dataset.index));
    return;
  }
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
  if (isPrecisionMode()) {
    selectPrecisionCell(Number(cell.dataset.index));
    return;
  }
  if (performance.now() < suppressContextMenuUntil) return;
  cycleMark(Number(cell.dataset.index));
});

boardEl.addEventListener('dblclick', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  event.preventDefault();
  if (isPrecisionMode()) {
    selectPrecisionCell(Number(cell.dataset.index));
    return;
  }
  chord(Number(cell.dataset.index));
});

boardEl.addEventListener('pointerdown', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell || cell.classList.contains('preview-cell') || event.button !== 0) return;
  if (isPrecisionMode()) {
    precisionPointerDown(event, cell);
    return;
  }
  // Give an immediate, subtle physical acknowledgement where the browser
  // exposes the standard Vibration API. This is a no-op on iPhone/iPad.
  if (event.pointerType !== 'mouse') tactile(10);

  if (cell.classList.contains('revealed')) return;

  ensureAudio(); // unlock Web Audio while iOS still considers this a user gesture
  cell.classList.add('pressing');
  setFace('surprised');

  if (event.pointerType === 'mouse') return;

  // Prevent iOS/Safari long-press text selection/callouts on the board.
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

    if (cycleMark(index)) tactile([18, 24, 26]);

    suppressClickUntil = performance.now() + 750;
    suppressContextMenuUntil = performance.now() + 900;
    if (status !== 'lost' && status !== 'won' && status !== 'generating') setFace('normal');
  }, LONG_PRESS_MS);
  touchPress = press;
  try { cell.setPointerCapture(event.pointerId); } catch {}
});

boardEl.addEventListener('pointermove', (event) => {
  if (isPrecisionMode()) {
    precisionPointerMove(event);
    return;
  }
  if (!touchPress || event.pointerId !== touchPress.pointerId || touchPress.longPressed) return;
  const dx = event.clientX - touchPress.startX;
  const dy = event.clientY - touchPress.startY;
  if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_PX) cancelTouchPress();
});

boardEl.addEventListener('pointerup', (event) => {
  if (isPrecisionMode()) {
    precisionPointerEnd(event);
    return;
  }
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

boardEl.addEventListener('pointercancel', (event) => {
  if (isPrecisionMode()) precisionPointerEnd(event);
  else cancelTouchPress();
});
boardEl.addEventListener('lostpointercapture', (event) => {
  if (isPrecisionMode()) precisionPointerEnd(event);
  else if (touchPress && !touchPress.longPressed) cancelTouchPress();
});

document.addEventListener('pointerup', () => {
  document.querySelectorAll('.cell.pressing').forEach((cell) => cell.classList.remove('pressing'));
  if (status !== 'lost' && status !== 'won' && status !== 'generating' && !touchPress) setFace('normal');
});

boardEl.addEventListener('keydown', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  const index = Number(cell.dataset.index);
  if (isPrecisionMode() && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const base = precisionSelectedIndex ?? index;
    const row = Math.floor(base / config.cols);
    const col = base % config.cols;
    const nextRow = Math.max(0, Math.min(config.rows - 1, row + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)));
    const nextCol = Math.max(0, Math.min(config.cols - 1, col + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0)));
    selectPrecisionCell(nextRow * config.cols + nextCol);
  } else if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    if (isPrecisionMode()) {
      selectPrecisionCell(precisionSelectedIndex ?? index);
      precisionFlagSelected();
    } else cycleMark(index);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (isPrecisionMode()) {
      selectPrecisionCell(precisionSelectedIndex ?? index);
      precisionRevealSelected();
    } else revealCell(index);
  }
});


const PRECISION_MOVE_DELTAS = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1]
};

for (const button of precisionMoveButtons) {
  button.addEventListener('click', () => {
    const [deltaRow, deltaCol] = PRECISION_MOVE_DELTAS[button.dataset.precisionMove] || [0, 0];
    if (movePrecisionSelection(deltaRow, deltaCol)) {
      tactile(8);
    }
  });
}

precisionRevealButton.addEventListener('click', precisionRevealSelected);
precisionFlagButton.addEventListener('click', precisionFlagSelected);
precisionFitButton.addEventListener('click', resetPrecisionView);

faceButton.addEventListener('click', () => newGame());

updateNowButton.addEventListener('click', () => activateWaitingUpdate());
updateLaterButton.addEventListener('click', () => hideUpdateBanner(true));

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
document.querySelector('#share-achievements').addEventListener('click', () => { achievementsDialog.close(); showShareDialog(); });
nativeShareButton.addEventListener('click', () => shareResults());
copyShareButton.addEventListener('click', () => copyShareResults());
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

// Prevent rapid taps on the game controls from triggering browser double-tap zoom.
// Precision-board pinch zoom remains available through the dedicated two-pointer handler.
desktopShellEl.addEventListener('dblclick', (event) => {
  if (event.target.closest('.window, .precision-panel')) event.preventDefault();
}, { passive: false });

window.addEventListener('resize', scheduleBoardFit, { passive: true });
window.addEventListener('orientationchange', scheduleBoardFit, { passive: true });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateActivationRequested || controllerChangeReloading) return;
    controllerChangeReloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => initializeUpdateChecks().catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastUpdateCheckAt < UPDATE_RECHECK_ON_RESUME_MS) return;
    checkForUpdates().catch(() => {});
  });
}

if (systemThemeQuery?.addEventListener) systemThemeQuery.addEventListener('change', handleSystemThemeChange);
else systemThemeQuery?.addListener?.(handleSystemThemeChange);

document.querySelector('#app-version').textContent = `v${APP_VERSION}`;
applyTheme(theme, false);
updateSoundMenu();
updateTactileMenu();
applyTouchControlMode(touchControlMode, false);
newGame();
