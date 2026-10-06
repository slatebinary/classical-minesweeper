import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, generateCandidate, isLogicallySolvable, neighborsOf } from '../src/logic.js';

test('neighbor counts are correct', () => {
  const board = createBoard(3, 3, [0]);
  assert.equal(board.counts[1], 1);
  assert.equal(board.counts[4], 1);
  assert.equal(board.counts[8], 0);
});

test('first click and its neighbours are mine-free', () => {
  const rows = 9, cols = 9, first = 40;
  const board = generateCandidate(rows, cols, 10, first, () => 0.37);
  for (const idx of [first, ...neighborsOf(first, rows, cols)]) assert.equal(board.mines[idx], 0);
});

test('simple deterministic board is solvable', () => {
  const board = createBoard(3, 3, [0]);
  assert.equal(isLogicallySolvable(board, 8), true);
});

test('generator can find no-guess standard boards', () => {
  const configs = [
    [9, 9, 10],
    [16, 16, 40],
    [16, 30, 99]
  ];
  for (const [rows, cols, mines] of configs) {
    const first = Math.floor((rows * cols) / 2);
    let found = false;
    for (let attempt = 0; attempt < 500 && !found; attempt++) {
      const board = generateCandidate(rows, cols, mines, first);
      found = isLogicallySolvable(board, first);
    }
    assert.equal(found, true, `Expected a solvable ${cols}x${rows}/${mines} board`);
  }
});
