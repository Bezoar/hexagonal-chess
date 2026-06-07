import test from 'node:test';
import assert from 'node:assert/strict';
import { gameScore, Match, formatScore } from '../src/match.js';

test('scoring values: checkmate, resign, stalemate ¾/¼, draw', () => {
  assert.deepEqual(gameScore({ kind: 'checkmate', winner: 'near' }), { near: 1, far: 0 });
  assert.deepEqual(gameScore({ kind: 'resign', winner: 'far' }), { near: 0, far: 1 });
  assert.deepEqual(gameScore({ kind: 'stalemate', winner: 'near' }), { near: 0.75, far: 0.25 });
  assert.deepEqual(gameScore({ kind: 'draw', winner: null }), { near: 0.5, far: 0.5 });
  assert.deepEqual(gameScore({ kind: 'timeout', winner: 'far' }), { near: 0, far: 1 });
});

test('match accumulates per-seat totals across games', () => {
  const m = new Match();
  m.record({ kind: 'checkmate', winner: 'near' }); // 1-0
  m.record({ kind: 'draw', winner: null });        // ½-½
  m.record({ kind: 'stalemate', winner: 'far' });  // ¼ - ¾
  assert.equal(m.near, 1.75);
  assert.equal(m.far, 1.25);
  assert.equal(m.games, 3);
});

test('formatScore renders unicode fractions', () => {
  assert.equal(formatScore(0), '0');
  assert.equal(formatScore(1), '1');
  assert.equal(formatScore(0.5), '½');
  assert.equal(formatScore(1.75), '1¾');
  assert.equal(formatScore(0.25), '¼');
});
