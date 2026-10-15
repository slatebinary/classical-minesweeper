import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, isLogicallySolvable, neighborsOf } from '../src/logic.js';

// Regression fixtures for the reported v1.2.3 final-mine incident.
// Coordinates in the screenshots are 1-based; indices below are 0-based.
const index = (row, col, cols = 9) => (row - 1) * cols + (col - 1);
const flagged = [
  [2, 3], [2, 9], [3, 1],
  [8, 5], [8, 7], [9, 3], [9, 4], [9, 8], [9, 9]
].map(([r, c]) => index(r, c));
const actualMine = index(1, 1);
const alternateMine = index(2, 1);
const opened = [
  '1,2,2', '1,3,1', '1,4,1', '1,5,0', '1,6,0', '1,7,0', '1,8,1', '1,9,1',
  '2,2,3', '2,4,1', '2,5,0', '2,6,0', '2,7,0', '2,8,1',
  '3,2,2', '3,3,1', '3,4,1', '3,5,0', '3,6,0', '3,7,0', '3,8,1', '3,9,1',
  '4,1,1', '4,2,1',
  '7,4,1', '7,5,1', '7,6,2', '7,7,1', '7,8,1',
  '8,2,1', '8,3,2', '8,4,3', '8,6,2', '8,8,3', '8,9,2',
  '9,2,1', '9,5,2', '9,6,2', '9,7,2'
].map(s => s.split(',').map(Number));

test('incident: all screenshot clues agree with the actual mine arrangement', () => {
  const board = createBoard(9, 9, [...flagged, actualMine]);
  assert.equal(board.mineCount, 10);
  for (const [row, col, clue] of opened) {
    const i = index(row, col);
    assert.equal(board.mines[i], 0, `Clue at (${row},${col}) must be safe`);
    assert.equal(board.counts[i], clue, `Wrong clue at (${row},${col})`);
  }
});

test('incident: the last two covered cells are indistinguishable from revealed clues', () => {
  const actual = createBoard(9, 9, [...flagged, actualMine]);
  const alternate = createBoard(9, 9, [...flagged, alternateMine]);
  for (const [row, col, clue] of opened) {
    const i = index(row, col);
    assert.equal(actual.counts[i], clue);
    assert.equal(alternate.counts[i], clue,
      `Swapping the final mine should preserve the visible clue at (${row},${col})`);
  }
  assert.equal(actual.mines[actualMine], 1);
  assert.equal(alternate.mines[actualMine], 0);
  assert.equal(actual.mines[alternateMine], 0);
  assert.equal(alternate.mines[alternateMine], 1);
});

test('solver rejects an initial position with an unavoidable ambiguous choice', () => {
  // First click at bottom right reveals 1, with three indistinguishable neighbours.
  const board = createBoard(2, 2, [0]);
  assert.equal(isLogicallySolvable(board, 3), false);
});

test('solver accepts a deterministic zero-expansion board', () => {
  const board = createBoard(3, 3, [0]);
  assert.equal(isLogicallySolvable(board, 8), true);
});

test('number clues are computed from all eight neighbours, including diagonals', () => {
  const board = createBoard(3, 3, [0, 2, 6, 8]);
  assert.equal(board.counts[4], 4);
  assert.equal(neighborsOf(4, 3, 3).length, 8);
});
