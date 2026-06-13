import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseMove, analyse } from '../src/bot.js';
import { startingBoard } from '../src/game.js';
import { allLegalMoves, inCheck } from '../src/rules.js';
import { key, squareToCube, ORTHO, isOnBoard } from '../src/hex.js';

// --- helpers -------------------------------------------------------------
const pos = (board) => ({ board, epTarget: null, epCapture: null });
const placeXY = (b, x, y, type, army) => b.set(key(x, y), { type, army });
const det = { rng: () => 0 }; // deterministic tie-break: always the first best move

// f6 is the board centre (0,0); all six orthogonal neighbours are on-board.
const CENTRE = key(0, 0);
const neighbour = (i) => {
  const [dx, dy] = ORTHO[i];
  assert.ok(isOnBoard(dx, dy), `neighbour ${i} should be on-board`);
  return key(dx, dy);
};
// A cell is on one of the centre rook's six rays iff x==0 || y==0 || x==-y.
// Kings are placed off every ray so no king starts in check (which would let the
// search "capture" a king and blow up). This asserts that invariant.
const assertNoCheck = (board) => {
  assert.ok(!inCheck(pos(board), 'near') && !inCheck(pos(board), 'far'), 'setup: neither king in check');
};

// --- tests ---------------------------------------------------------------
test('returns a legal move for the opening position', () => {
  const board = startingBoard();
  const m = chooseMove(pos(board), 'near', det);
  assert.ok(m, 'should return a move');
  const legal = allLegalMoves(pos(board), 'near');
  assert.ok(legal.some((l) => l.from === m.from && l.to === m.to), 'chosen move must be legal');
});

test('grabs a free, undefended capture', () => {
  const b = new Map();
  placeXY(b, 0, 0, 'R', 'near');   // bot rook in the centre
  placeXY(b, -3, -2, 'K', 'near'); // kings off every ray, far from the action
  placeXY(b, 3, 1, 'K', 'far');
  const pawnCell = neighbour(0);
  b.set(pawnCell, { type: 'P', army: 'far' }); // undefended enemy pawn next to the rook
  assertNoCheck(b);

  const m = chooseMove(pos(b), 'near', det);
  assert.equal(m.from, CENTRE);
  assert.equal(m.to, pawnCell, 'should capture the free pawn');
});

test('prefers the larger of two free captures', () => {
  const b = new Map();
  placeXY(b, 0, 0, 'R', 'near');
  placeXY(b, -3, -2, 'K', 'near');
  placeXY(b, 3, 1, 'K', 'far');
  const pawnCell = neighbour(0);
  const queenCell = neighbour(1);
  b.set(pawnCell, { type: 'P', army: 'far' });
  b.set(queenCell, { type: 'Q', army: 'far' }); // both undefended
  assertNoCheck(b);

  const m = chooseMove(pos(b), 'near', det);
  assert.equal(m.to, queenCell, 'should take the queen, not the pawn');
});

test('does not hang the rook for a defended pawn (the depth-2 payoff)', () => {
  const b = new Map();
  placeXY(b, 0, 0, 'R', 'near');
  placeXY(b, -3, -2, 'K', 'near');
  const pawnCell = neighbour(0);
  b.set(pawnCell, { type: 'P', army: 'far' });
  // Put the far king adjacent to the pawn so it recaptures: rook x pawn (+1)
  // then king x rook (-5) = -4. A 1-ply greedy bot grabs the pawn; depth-2 won't.
  const [px, py] = pawnCell.split(',').map(Number);
  let kingPlaced = false;
  for (let i = 0; i < ORTHO.length && !kingPlaced; i++) {
    const [kx, ky] = [px + ORTHO[i][0], py + ORTHO[i][1]];
    const kk = key(kx, ky);
    // adjacent to the pawn, on-board, not the rook's square, and not itself in
    // check from the rook (so the setup stays legal)
    if (isOnBoard(kx, ky) && kk !== CENTRE && !b.has(kk) && kx !== 0 && ky !== 0 && kx !== -ky) {
      placeXY(b, kx, ky, 'K', 'far');
      kingPlaced = true;
    }
  }
  assert.ok(kingPlaced, 'test setup: far king must defend the pawn');
  assertNoCheck(b);

  const m = chooseMove(pos(b), 'near', det);
  assert.notEqual(m.to, pawnCell, 'should not capture into a losing recapture');
});

test('returns null when the side has no legal moves', () => {
  const b = new Map();
  placeXY(b, 3, 1, 'K', 'far'); // only the far army is on the board
  assert.equal(chooseMove(pos(b), 'near', det), null);
});

test('analyse returns a principal variation starting with the chosen move', () => {
  const b = new Map();
  placeXY(b, 0, 0, 'R', 'near');
  placeXY(b, -3, -2, 'K', 'near');
  placeXY(b, 3, 1, 'K', 'far');
  const knightCell = neighbour(0);
  b.set(knightCell, { type: 'N', army: 'far' }); // free knight next to the rook
  assertNoCheck(b);

  const a = analyse(pos(b), 'near', det);
  assert.ok(a, 'should return an analysis');
  assert.equal(a.move.from, CENTRE);
  assert.equal(a.move.to, knightCell, 'best move is the free capture');
  assert.ok(Array.isArray(a.pv) && a.pv.length >= 1, 'pv is a non-empty move list');
  assert.equal(a.pv[0].from, a.move.from, 'pv leads with the chosen move');
  assert.equal(a.pv[0].to, a.move.to);
  assert.ok(a.runnerUp, 'a non-capturing alternative exists');
  assert.ok(a.runnerUp.score <= a.score, 'the chosen move is at least as good as the runner-up');
});

test('analyse returns null when the side has no legal moves', () => {
  const b = new Map();
  placeXY(b, 3, 1, 'K', 'far');
  assert.equal(analyse(pos(b), 'near', det), null);
});
