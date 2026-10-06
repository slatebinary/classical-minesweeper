export const UNKNOWN = 0;
export const OPEN = 1;
export const MARKED_MINE = 2;

export function neighborsOf(index, rows, cols) {
  const row = Math.floor(index / cols);
  const col = index % cols;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < rows && c >= 0 && c < cols) out.push(r * cols + c);
    }
  }
  return out;
}

export function createBoard(rows, cols, mineIndexes) {
  const size = rows * cols;
  const mines = new Uint8Array(size);
  const counts = new Uint8Array(size);
  for (const idx of mineIndexes) mines[idx] = 1;
  for (let i = 0; i < size; i++) {
    if (mines[i]) continue;
    let count = 0;
    for (const n of neighborsOf(i, rows, cols)) count += mines[n];
    counts[i] = count;
  }
  return { rows, cols, mineCount: mineIndexes.length, mines, counts };
}

function shuffleInPlace(values, rng) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

export function generateCandidate(rows, cols, mineCount, firstIndex, rng = Math.random) {
  const protectedCells = new Set([firstIndex, ...neighborsOf(firstIndex, rows, cols)]);
  const available = [];
  for (let i = 0; i < rows * cols; i++) {
    if (!protectedCells.has(i)) available.push(i);
  }
  if (mineCount > available.length) throw new Error('Too many mines for the protected first-click area.');
  shuffleInPlace(available, rng);
  return createBoard(rows, cols, available.slice(0, mineCount));
}

function setDifference(a, b) {
  const out = [];
  for (const value of a) if (!b.has(value)) out.push(value);
  return out;
}

function isSubset(a, b) {
  if (a.size > b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * Simulates a deduction-only player. It uses only information a player can derive:
 *  - standard numbered-cell rules,
 *  - total mine-count rule,
 *  - subset constraint deductions.
 * If no forced move exists before all safe cells are open, the board is rejected.
 */
export function isLogicallySolvable(board, firstIndex) {
  const { rows, cols, mineCount, mines, counts } = board;
  const size = rows * cols;
  const state = new Uint8Array(size);
  let openedSafe = 0;
  let markedCount = 0;

  const reveal = (start) => {
    if (state[start] !== UNKNOWN) return { ok: true, changed: false };
    if (mines[start]) return { ok: false, changed: false };
    let changed = false;
    const queue = [start];
    for (let q = 0; q < queue.length; q++) {
      const idx = queue[q];
      if (state[idx] !== UNKNOWN) continue;
      if (mines[idx]) return { ok: false, changed };
      state[idx] = OPEN;
      openedSafe++;
      changed = true;
      if (counts[idx] === 0) {
        for (const n of neighborsOf(idx, rows, cols)) {
          if (state[n] === UNKNOWN) queue.push(n);
        }
      }
    }
    return { ok: true, changed };
  };

  const markMine = (idx) => {
    if (state[idx] !== UNKNOWN) return false;
    state[idx] = MARKED_MINE;
    markedCount++;
    return true;
  };

  const initial = reveal(firstIndex);
  if (!initial.ok) return false;

  const safeTarget = size - mineCount;
  for (let safety = 0; safety < size * 12; safety++) {
    if (openedSafe === safeTarget) return true;
    let progress = false;
    const constraints = [];

    // Direct deductions from every visible clue.
    for (let i = 0; i < size; i++) {
      if (state[i] !== OPEN || counts[i] === 0) continue;
      let adjacentMarked = 0;
      const unknown = [];
      for (const n of neighborsOf(i, rows, cols)) {
        if (state[n] === MARKED_MINE) adjacentMarked++;
        else if (state[n] === UNKNOWN) unknown.push(n);
      }
      const needed = counts[i] - adjacentMarked;
      if (needed < 0 || needed > unknown.length) return false;
      if (!unknown.length) continue;

      if (needed === 0) {
        for (const n of unknown) {
          const result = reveal(n);
          if (!result.ok) return false;
          progress ||= result.changed;
        }
      } else if (needed === unknown.length) {
        for (const n of unknown) progress ||= markMine(n);
      } else {
        constraints.push({ cells: new Set(unknown), needed });
      }
    }

    if (openedSafe === safeTarget) return true;

    // The mine counter itself is a valid global constraint.
    const unknownAll = [];
    for (let i = 0; i < size; i++) if (state[i] === UNKNOWN) unknownAll.push(i);
    const remainingMines = mineCount - markedCount;
    if (remainingMines < 0 || remainingMines > unknownAll.length) return false;
    if (remainingMines === 0) {
      for (const n of unknownAll) {
        const result = reveal(n);
        if (!result.ok) return false;
        progress ||= result.changed;
      }
    } else if (remainingMines === unknownAll.length) {
      for (const n of unknownAll) progress ||= markMine(n);
    } else if (unknownAll.length) {
      constraints.push({ cells: new Set(unknownAll), needed: remainingMines });
    }

    if (openedSafe === safeTarget) return true;
    if (progress) continue;

    // Remove duplicate constraints.
    const unique = [];
    const seen = new Set();
    for (const constraint of constraints) {
      const sorted = [...constraint.cells].sort((a, b) => a - b);
      const key = `${constraint.needed}:${sorted.join(',')}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(constraint);
      }
    }

    // If A is a subset of B, B-A is also a constraint. When its mine count is
    // zero or equals its cell count, those cells are forced safe or forced mines.
    const safeDeductions = new Set();
    const mineDeductions = new Set();
    for (let a = 0; a < unique.length; a++) {
      for (let b = 0; b < unique.length; b++) {
        if (a === b) continue;
        const A = unique[a];
        const B = unique[b];
        if (A.cells.size >= B.cells.size || !isSubset(A.cells, B.cells)) continue;
        const diff = setDifference(B.cells, A.cells);
        const diffNeeded = B.needed - A.needed;
        if (diffNeeded < 0 || diffNeeded > diff.length) continue;
        if (diffNeeded === 0) for (const n of diff) safeDeductions.add(n);
        else if (diffNeeded === diff.length) for (const n of diff) mineDeductions.add(n);
      }
    }

    for (const n of mineDeductions) progress ||= markMine(n);
    for (const n of safeDeductions) {
      if (state[n] !== UNKNOWN) continue;
      const result = reveal(n);
      if (!result.ok) return false;
      progress ||= result.changed;
    }

    if (!progress) return false;
  }
  return false;
}

export function serializeBoard(board) {
  return {
    rows: board.rows,
    cols: board.cols,
    mineCount: board.mineCount,
    mines: Array.from(board.mines),
    counts: Array.from(board.counts)
  };
}
