import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../src/bot.js';
import { explain } from '../src/explain.js';
import { key, ORTHO } from '../src/hex.js';
import { inCheck } from '../src/rules.js';

const pos = (board) => ({ board, epTarget: null, epCapture: null });
const placeXY = (b, x, y, type, army) => b.set(key(x, y), { type, army });
const det = { rng: () => 0 };
const neighbour = (i) => key(ORTHO[i][0], ORTHO[i][1]);
const assertNoCheck = (b) => assert.ok(!inCheck(pos(b), 'near') && !inCheck(pos(b), 'far'), 'setup: neither king in check');

// Run the real search then explain its choice (oriented to a near-White board).
const hintFor = (b, army) => explain(pos(b), army, analyse(pos(b), army, det), false);

test('a free capture leads with "Wins a ..."', () => {
  const b = new Map();
  placeXY(b, 0, 0, 'R', 'near');
  placeXY(b, -3, -2, 'K', 'near');
  placeXY(b, 3, 1, 'K', 'far');
  b.set(neighbour(0), { type: 'N', army: 'far' }); // undefended knight
  assertNoCheck(b);

  const r = hintFor(b, 'near');
  assert.equal(r.lead, 'Wins a knight.');
  assert.ok(!r.contrast, 'no tempting-but-refuted alternative here');
});

test('fleeing a hanging queen leads with "Saves your queen"', () => {
  const b = new Map();
  placeXY(b, 0, 0, 'Q', 'near');   // attacked along the x=0 file...
  placeXY(b, 0, 3, 'R', 'far');    // ...by this rook,
  placeXY(b, 0, 5, 'R', 'far');    // which is defended by this one (so QxR loses).
  placeXY(b, -3, -2, 'K', 'near');
  placeXY(b, 3, 1, 'K', 'far');
  assertNoCheck(b);

  const r = hintFor(b, 'near');
  assert.equal(r.lead, 'Saves your queen from capture.');
});

test('a quiet move leads with the centre teaching line', () => {
  const b = new Map();
  placeXY(b, 0, 0, 'K', 'near');   // king already central: it won't improve centre
  placeXY(b, 5, 0, 'N', 'near');   // knight on the rim: its hop improves centre most
  placeXY(b, -4, 2, 'K', 'far');   // lone far king, far from any contact
  assertNoCheck(b);

  const r = hintFor(b, 'near');
  assert.equal(r.lead, 'Develops your knight toward the centre — the most powerful squares in hex chess.');
});

test('a tempting but refuted grab produces a contrast line', () => {
  const b = new Map();
  placeXY(b, 0, 0, 'R', 'near');   // could grab the knight on the file...
  placeXY(b, 0, 2, 'N', 'far');    // ...but it is defended by
  placeXY(b, 1, 2, 'P', 'far');    // this pawn (P x f-file recaptures the rook).
  placeXY(b, -3, -2, 'K', 'near');
  placeXY(b, 3, 1, 'K', 'far');
  assertNoCheck(b);

  const r = hintFor(b, 'near');
  assert.ok(r.contrast, 'should warn about the refuted capture');
  assert.match(r.contrast, /knight/, 'names the tempting victim');
});

test('a promotion leads with "Promotes a pawn to a queen"', () => {
  const b = new Map();
  placeXY(b, 0, 4, 'P', 'near');   // one step from promoting at (0,5)
  placeXY(b, -3, -2, 'K', 'near');
  placeXY(b, 3, 1, 'K', 'far');
  assertNoCheck(b);
  const r = hintFor(b, 'near');
  assert.equal(r.lead, 'Promotes a pawn to a queen.');
});
