import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTerms, score, evaluate, VALUE } from '../src/eval.js';
import { key } from '../src/hex.js';

const place = (b, x, y, type, army) => b.set(key(x, y), { type, army });

test('material is the signed piece-value sum from army POV', () => {
  const b = new Map();
  place(b, 0, 0, 'Q', 'near'); // +9 for near
  place(b, 1, 0, 'R', 'far');  // -5 for near
  assert.equal(evaluateTerms(b, 'near').material, VALUE.Q - VALUE.R);
  assert.equal(evaluateTerms(b, 'far').material, VALUE.R - VALUE.Q);
});

test('centre term rewards a central piece over an edge piece of the same type', () => {
  const central = new Map(); place(central, 0, 0, 'N', 'near');   // ring 0
  const edge = new Map();     place(edge, 5, 0, 'N', 'near');     // ring 5
  assert.ok(evaluateTerms(central, 'near').centre > evaluateTerms(edge, 'near').centre,
    'a knight in the centre scores higher on the centre term than one on the rim');
});

test('centre never overturns a full pawn of material', () => {
  const b = new Map();
  place(b, 5, 0, 'P', 'near'); place(b, 4, 1, 'P', 'near'); // near: 2 rim pawns
  place(b, 0, 0, 'P', 'far');                               // far: 1 central pawn
  assert.ok(score(evaluateTerms(b, 'near')) > 0, 'being a pawn up still reads as ahead');
});

test('evaluate equals score(evaluateTerms)', () => {
  const b = new Map();
  place(b, 0, 0, 'B', 'near'); place(b, 2, -1, 'P', 'far');
  assert.equal(evaluate(b, 'near'), score(evaluateTerms(b, 'near')));
});
