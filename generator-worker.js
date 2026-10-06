import { generateCandidate, isLogicallySolvable, serializeBoard } from './src/logic.js';

self.addEventListener('message', (event) => {
  const { rows, cols, mineCount, firstIndex, requestId } = event.data;
  let attempts = 0;
  const started = performance.now();

  while (true) {
    attempts++;
    const board = generateCandidate(rows, cols, mineCount, firstIndex);
    if (isLogicallySolvable(board, firstIndex)) {
      self.postMessage({
        type: 'generated',
        requestId,
        attempts,
        elapsedMs: Math.round(performance.now() - started),
        firstIndex,
        board: serializeBoard(board)
      });
      return;
    }
    if (attempts % 250 === 0) {
      self.postMessage({ type: 'progress', requestId, attempts });
    }
  }
});
