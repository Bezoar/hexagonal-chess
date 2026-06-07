import test from 'node:test';
import assert from 'node:assert/strict';
import { Clock } from '../src/clock.js';

test('both seats start at base; nothing ticks until started', () => {
  const c = new Clock({ base: 60000, increment: 2000 });
  assert.equal(c.remaining('near', 999999), 60000);
  assert.equal(c.remaining('far', 999999), 60000);
  assert.equal(c.flagged(999999), null);
});

test('running seat ticks against injected now; the other is frozen', () => {
  const c = new Clock({ base: 60000, increment: 0 });
  c.start('near', 1000);
  assert.equal(c.remaining('near', 6000), 55000); // 5s elapsed
  assert.equal(c.remaining('far', 6000), 60000); // not running
});

test('switchTurn banks time, adds the increment, and hands to the opponent', () => {
  const c = new Clock({ base: 60000, increment: 2000 });
  c.start('near', 0);
  c.switchTurn(5000); // near used 5s, gets +2s -> 57s; far now runs from 5000
  assert.equal(c.remaining('near', 999999), 57000);
  assert.equal(c.running, 'far');
  assert.equal(c.remaining('far', 8000), 57000); // 3s elapsed since 5000
});

test('pause freezes the clock; resume continues without losing banked time', () => {
  const c = new Clock({ base: 60000, increment: 0 });
  c.start('near', 0);
  c.pause(5000); // bank 55s
  assert.equal(c.remaining('near', 999999), 55000); // frozen while paused
  c.resume(100000);
  assert.equal(c.remaining('near', 105000), 50000); // 5s more after resume
});

test('flagged reports the running seat once it hits zero, never the idle seat', () => {
  const c = new Clock({ base: 3000, increment: 1000 });
  c.start('near', 0);
  assert.equal(c.flagged(2000), null);
  assert.equal(c.flagged(3000), 'near'); // exactly out
  assert.equal(c.flagged(4000), 'near');
  assert.equal(c.remaining('near', 4000), 0); // clamped, never negative
});

test('a flagged clock does not get revived by the increment on switchTurn', () => {
  const c = new Clock({ base: 3000, increment: 1000 });
  c.start('near', 0);
  c.switchTurn(5000); // near already flagged at 3000 -> stays 0, no increment
  assert.equal(c.remaining('near', 999999), 0);
});

test('serialize / fromJSON round-trips the full state', () => {
  const c = new Clock({ base: 60000, increment: 3000 });
  c.start('near', 1000);
  c.switchTurn(4000); // mutate some state
  const data = c.serialize();
  const r = Clock.fromJSON(data);
  assert.deepEqual(r.serialize(), data);
  assert.equal(r.remaining('far', 9000), c.remaining('far', 9000));
});
