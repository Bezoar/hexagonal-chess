import test from 'node:test';
import assert from 'node:assert/strict';
import { key, squareToCube } from '../src/hex.js';
import { Game } from '../src/game.js';

const K = (sq) => { const [x, y] = squareToCube(sq); return key(x, y); };
const play = (g, seq) => seq.map(([f, t, p]) => g.move(K(f), K(t), p));

test("Fool's mate ends in checkmate; first mover is White; notation is correct", () => {
  const g = new Game();
  const recs = play(g, [
    ['e1', 'c3'], ['e10', 'c6'], ['b1', 'b2'], ['b7', 'b6'],
    ['f3', 'b1'], ['e7', 'e6'], ['c3', 'f9'],
  ]);
  for (let i = 0; i < recs.length; i++) assert.ok(recs[i] && !recs[i].needsPromotion, `move ${i} legal`);
  assert.equal(g.role('near'), 'white'); // near moved first
  assert.equal(g.role('far'), 'black');
  assert.equal(g.result.kind, 'checkmate');
  assert.equal(g.result.winner, 'near');
  assert.equal(recs[0].san, 'Qe1c3');
  assert.equal(recs[2].san, 'b1b2');           // pawn push, no piece letter
  assert.equal(recs[6].san, 'Qc3xBf9#');       // capture keeps the captured-piece letter
});

test('far moves first: notation is oriented to White (180° board view)', () => {
  const g = new Game();
  const rec = g.move(K('e7'), K('e6')); // far pawn push; far claims White
  assert.ok(rec && !rec.needsPromotion, 'far pawn push is legal');
  assert.equal(g.role('far'), 'white');  // first mover claims White
  assert.equal(g.role('near'), 'black');
  // White's view rotates the board 180°: files reverse (e->g) and ranks flip,
  // so far's e7->e6 push reads as g4->g5, not the board-fixed e7e6.
  assert.equal(rec.san, 'g4g5');
});

test('en passant: capture lands on the skipped cell and removes the passing pawn', () => {
  const g = new Game();
  g.board = new Map([
    [K('l1'), { type: 'K', army: 'near' }],
    [K('a6'), { type: 'K', army: 'far' }],
    [K('b5'), { type: 'P', army: 'near' }],
    [K('c5'), { type: 'P', army: 'far' }], // just double-stepped c7->c5
  ]);
  g.toMove = 'near'; g.whiteArmy = 'near';
  g.epTarget = K('c6'); g.epCapture = K('c5'); g.result = null;

  const legal = g.legalFrom(K('b5'));
  const ep = legal.find((m) => m.to === K('c6'));
  assert.ok(ep && ep.isEnPassant, 'en passant offered');

  const rec = g.move(K('b5'), K('c6'));
  assert.ok(rec && rec.san.includes('e.p.'), 'san tags e.p.');
  assert.equal(g.board.has(K('c5')), false, 'passing pawn removed');
  assert.deepEqual(g.board.get(K('c6')), { type: 'P', army: 'near' });
});

test('promotion: picker required, then full underpromotion; knight underpromotion can give check', () => {
  const g = new Game();
  g.board = new Map([
    [K('a1'), { type: 'K', army: 'near' }],
    [K('d8'), { type: 'K', army: 'far' }],
    [K('f10'), { type: 'P', army: 'near' }],
  ]);
  g.toMove = 'near'; g.whiteArmy = 'near'; g.result = null;

  const needs = g.move(K('f10'), K('f11'));
  assert.deepEqual(needs, { needsPromotion: true, from: K('f10'), to: K('f11') });

  const rec = g.move(K('f10'), K('f11'), 'N');
  assert.equal(g.board.get(K('f11')).type, 'N');
  assert.ok(rec.san.endsWith('=N+'), `knight promotion gives check: ${rec.san}`);
  assert.equal(g.inCheck('far'), true);
});

test('threefold repetition draws after the third occurrence', () => {
  const g = new Game();
  const cycle = [['d1', 'g2'], ['d9', 'g9'], ['g2', 'd1'], ['g9', 'd9']];
  play(g, cycle); play(g, cycle);
  assert.equal(g.result, null, 'no draw before third occurrence');
  play(g, cycle);
  assert.ok(g.result && g.result.reason === 'threefold');
});

test('fifty-move rule draws after 100 reversible plies (threefold disabled)', () => {
  const g = new Game({ threefold: false });
  const cycle = [['d1', 'g2'], ['d9', 'g9'], ['g2', 'd1'], ['g9', 'd9']];
  for (let i = 0; i < 25; i++) play(g, cycle); // 100 plies
  assert.ok(g.result && g.result.reason === 'fifty-move', g.result && g.result.reason);
});

test('undo: rewinds to a chosen point, keeps a forward buffer, and a new move discards it', () => {
  const g = new Game();
  play(g, [['e1', 'c3'], ['e10', 'c6'], ['b1', 'b2'], ['b7', 'b6']]);
  assert.equal(g.history.length, 4);
  g.undoTo(2); // keep first two plies
  assert.equal(g.history.length, 2);
  assert.equal(g.forward.length, 2);
  assert.equal(g.toMove, 'near'); // after 2 plies it's near's move again
  assert.equal(g.board.has(K('b2')), false, 'b1b2 undone');
  g.move(K('b1'), K('b3')); // a different move discards the redo buffer
  assert.equal(g.forward.length, 0);
});

test('serialize / deserialize round-trips a game', () => {
  const g = new Game();
  play(g, [['e1', 'c3'], ['e10', 'c6'], ['b1', 'b2']]);
  const g2 = Game.deserialize(g.serialize());
  assert.equal(g2.history.length, 3);
  assert.equal(g2.role('near'), 'white');
  assert.deepEqual([...g2.board.keys()].sort(), [...g.board.keys()].sort());
});

test('flag: opponent wins on time when they still have mating material', () => {
  const g = new Game(); // full board
  g.flag('near'); // near's clock fell
  assert.equal(g.result.kind, 'timeout');
  assert.equal(g.result.winner, 'far');
});

test('flag: a draw when the side that did not flag has only a bare king', () => {
  const g = new Game();
  for (const [k, p] of [...g.board]) if (p.army === 'near' && p.type !== 'K') g.board.delete(k);
  g.flag('far'); // far flagged; the would-be winner 'near' is a bare king -> draw
  assert.equal(g.result.kind, 'draw');
  assert.equal(g.result.reason, 'timeout-insufficient');
  assert.equal(g.result.winner, null);
});

test('flag is ignored once the game already has a result', () => {
  const g = new Game();
  g.resign('near'); // far already won
  g.flag('far');
  assert.equal(g.result.kind, 'resign');
});

test('a timed game serializes and restores its clock; untimed is clock:null', () => {
  const untimed = new Game();
  assert.equal(untimed.clock, null);
  assert.equal(untimed.serialize().clock, null);

  const g = new Game({}, { base: 300000, increment: 2000 });
  g.clock.start('near', 1000);
  const data = g.serialize();
  assert.equal(data.clock.base, 300000);
  const r = Game.deserialize(data);
  assert.deepEqual(r.clock.serialize(), g.clock.serialize());
});
