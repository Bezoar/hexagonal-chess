import test from 'node:test';
import assert from 'node:assert/strict';
import { key, squareToCube } from '../src/hex.js';
import { status, allLegalMoves, isAttacked } from '../src/rules.js';
import { startingBoard } from '../src/game.js';

const K = (sq) => { const [x, y] = squareToCube(sq); return key(x, y); };
const pos = (board, extra = {}) => ({ board, epTarget: null, epCapture: null, ...extra });

test('start position: both armies have equal, non-zero legal-move counts (180° symmetry)', () => {
  const p = pos(startingBoard());
  const near = allLegalMoves(p, 'near').length;
  const far = allLegalMoves(p, 'far').length;
  assert.ok(near > 0);
  assert.equal(near, far, 'symmetric opening move counts');
});

test('start position is not check/mate/stalemate for either side', () => {
  const p = pos(startingBoard());
  assert.equal(status(p, 'near'), 'normal');
  assert.equal(status(p, 'far'), 'normal');
});

test('stalemate detection: lone far king boxed in the a1 corner, not in check', () => {
  const board = new Map();
  board.set(K('a1'), { type: 'K', army: 'far' });
  board.set(K('l1'), { type: 'K', army: 'near' });
  board.set(K('b7'), { type: 'R', army: 'near' }); // covers b1,b2,b3
  board.set(K('f2'), { type: 'R', army: 'near' }); // covers a2,b2,c2 (z=4 line)
  const p = pos(board);
  assert.equal(isAttacked(board, K('a1'), 'near'), false, 'king not in check');
  for (const esc of ['a2', 'b2', 'b1', 'b3', 'c2']) {
    assert.equal(isAttacked(board, K(esc), 'near'), true, `${esc} covered`);
  }
  assert.equal(status(p, 'far'), 'stalemate');
});

test('isAttacked: a bishop is color-locked (never attacks an opposite-color cell)', () => {
  const board = new Map();
  board.set(K('f6'), { type: 'B', army: 'near' });
  // f6 neighbours along orthogonals are a different color and unreachable by the bishop
  assert.equal(isAttacked(board, K('f7'), 'near'), false);
  // but a diagonal cell is attacked
  assert.equal(isAttacked(board, K('g7'), 'near'), true); // f6 + (1,1,-2) = g7? verified on-board diagonal
});
