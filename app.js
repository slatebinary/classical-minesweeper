import { generateCandidate, isLogicallySolvable } from './src/logic.js';

const PRESETS = {
  beginner: { label: 'Beginner', rows: 9, cols: 9, mines: 10 },
  intermediate: { label: 'Intermediate', rows: 16, cols: 16, mines: 40 },
  expert: { label: 'Expert', rows: 16, cols: 30, mines: 99 }
};

const boardEl = document.querySelector('#board');
const mineCounterEl = document.querySelector('#mine-counter');
const timerEl = document.querySelector('#timer');
const faceButton = document.querySelector('#face-button');
const generationNote = document.querySelector('#generation-note');
const bestTimesDialog = document.querySelector('#best-times-dialog');
const helpDialog = document.querySelector('#help-dialog');
const helpTitle = document.querySelector('#help-title');
const helpContent = document.querySelector('#help-content');
const installMenuItem = document.querySelector('#install-menu-item');

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
let touchMode = 'reveal';
let deferredInstallPrompt = null;

const supportsWorker = typeof Worker !== 'undefined';
if (supportsWorker) generatorWorker = new Worker('./generator-worker.js', { type: 'module' });

function formatCounter(value) {
  const clamped = Math.max(-99, Math.min(999, value));
  return clamped < 0 ? `-${String(Math.abs(clamped)).padStart(2, '0')}` : String(clamped).padStart(3, '0');
}

function updateCounter() {
  mineCounterEl.textContent = formatCounter(config.mines - flagCount);
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
}

function updateDifficultyChecks() {
  document.querySelectorAll('[data-difficulty]').forEach((button) => {
    const active = button.dataset.difficulty === difficulty;
    button.setAttribute('aria-checked', String(active));
    button.querySelector('.check-slot').textContent = active ? '✓' : '';
  });
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

  const queue = [index];
  for (let q = 0; q < queue.length; q++) {
    const idx = queue[q];
    if (revealed[idx] || marks[idx] === 1 || board.mines[idx]) continue;
    revealed[idx] = 1;
    marks[idx] = 0;
    openedSafe++;
    paintRevealed(idx);
    if (board.counts[idx] === 0) {
      for (const n of neighbors(idx)) if (!revealed[n] && marks[n] !== 1) queue.push(n);
    }
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

function cycleMark(index) {
  if (status === 'generating' || status === 'won' || status === 'lost' || revealed[index]) return;
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
  for (let i = 0; i < cells.length; i++) {
    if (board.mines[i] && marks[i] !== 1) {
      cells[i].className = 'cell revealed mine';
      if (i === explodedIndex) cells[i].classList.add('exploded');
    } else if (!board.mines[i] && marks[i] === 1) {
      cells[i].classList.add('wrong-flag');
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
      <p>Version 1.0.0. No Microsoft code, artwork, or game assets are included.</p>`;
  } else {
    helpTitle.textContent = 'How to Play';
    helpContent.innerHTML = `
      <p>Reveal every square that does not contain a mine. A number tells you how many mines touch that square.</p>
      <ul>
        <li><strong>Left click / Reveal:</strong> open a square.</li>
        <li><strong>Right click / Flag:</strong> cycle flag → question mark → clear.</li>
        <li><strong>Double-click a revealed number:</strong> chord-open its neighbours when the correct number of flags is present.</li>
        <li><strong>F2:</strong> start a new game.</li>
      </ul>
      <p>The first click and its surrounding squares are protected, and the final board is accepted only when it can be solved by forced deductions.</p>`;
  }
  helpDialog.showModal();
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

document.querySelector('#game-menu-button').addEventListener('click', () => toggleMenu(document.querySelector('#game-menu-button'), document.querySelector('#game-menu')));
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
});

document.querySelector('#help-menu').addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  closeMenus();
  if (button.dataset.action === 'how-to-play') showHelp('help');
  else if (button.dataset.action === 'about') showHelp('about');
  else if (button.dataset.action === 'install' && deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installMenuItem.hidden = true;
  }
});

boardEl.addEventListener('click', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  const index = Number(cell.dataset.index);
  if (matchMedia('(pointer: coarse)').matches && touchMode === 'flag') cycleMark(index);
  else revealCell(index);
});

boardEl.addEventListener('contextmenu', (event) => {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  event.preventDefault();
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
  if (cell && event.button === 0 && !cell.classList.contains('revealed')) {
    cell.classList.add('pressing');
    setFace('surprised');
  }
});

document.addEventListener('pointerup', () => {
  document.querySelectorAll('.cell.pressing').forEach((cell) => cell.classList.remove('pressing'));
  if (status !== 'lost' && status !== 'won' && status !== 'generating') setFace('normal');
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

document.querySelector('#touch-controls').addEventListener('click', (event) => {
  const button = event.target.closest('[data-touch-mode]');
  if (!button) return;
  touchMode = button.dataset.touchMode;
  document.querySelectorAll('[data-touch-mode]').forEach((b) => b.classList.toggle('pressed', b === button));
});

document.querySelector('#reset-times').addEventListener('click', () => {
  for (const key of Object.keys(PRESETS)) localStorage.removeItem(`minesweeper:best:${key}`);
  renderBestTimes();
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installMenuItem.hidden = false;
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  installMenuItem.hidden = true;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

newGame();
