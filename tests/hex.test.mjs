import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CELLS, CELL_KEYS, frToCube, cubeToFr, cubeToSquare, squareToCube,
  cellColor, isOnBoard, KNIGHT, ORTHO, DIAG, fileIndex,
} from '../src/hex.js';

test('board has exactly 91 cells', () => {
  assert.equal(CELLS.length, 91);
  assert.equal(CELL_KEYS.size, 91);
});

test('f6 is the center (0,0,0)', () => {
  assert.deepEqual(frToCube('f', 6), [0, 0, 0]);
});

test('(file,rank) <-> cube round-trips for all 91 cells', () => {
  for (const [x, y] of CELLS) {
    const { file, rank } = cubeToFr(x, y);
    assert.deepEqual(frToCube(file, rank), [x, y, -x - y + 0], `${file}${rank}`);
  }
});

test('documented anchors', () => {
  // near-army pawn chevron b1..k1 (apex f5)
  assert.deepEqual(frToCube('b', 1), [-4, -1, 5]);
  assert.deepEqual(frToCube('f', 5), [0, -1, 1]);
  // e4 + NE = f5 (Wikipedia pawn-capture example)
  const e4 = frToCube('e', 4);
  const NE = [1, 0, -1];
  assert.deepEqual([e4[0] + NE[0], e4[1] + NE[1], e4[2] + NE[2]], frToCube('f', 5));
  // far-army king
  assert.deepEqual(frToCube('g', 10), [1, 4, -5]);
});

test('j file is skipped; 11 files', () => {
  assert.equal(fileIndex('f'), 0);
  assert.equal(fileIndex('g'), 1); // not j
  assert.equal(fileIndex('l'), 5);
});

test('square <-> cube', () => {
  assert.equal(cubeToSquare(0, 0), 'f6');
  assert.deepEqual(squareToCube('g10'), [1, 4, -5]);
});

test('three cell colors; f6 mid; no edge-adjacent share a color', () => {
  const colors = new Set(CELLS.map(([x, y]) => cellColor(x, y)));
  assert.deepEqual([...colors].sort(), [0, 1, 2]);
  // orthogonal neighbours always differ in color
  for (const [x, y, z] of CELLS) {
    for (const [dx, dy, dz] of ORTHO) {
      const nx = x + dx, ny = y + dy;
      if (isOnBoard(nx, ny, z + dz)) {
        assert.notEqual(cellColor(x, y), cellColor(nx, ny), `${x},${y} ~ ${nx},${ny}`);
      }
    }
  }
});

test('diagonal steps preserve color (bishop color-lock)', () => {
  for (const [x, y, z] of CELLS) {
    for (const [dx, dy, dz] of DIAG) {
      const nx = x + dx, ny = y + dy;
      if (isOnBoard(nx, ny, z + dz)) {
        assert.equal(cellColor(x, y), cellColor(nx, ny));
      }
    }
  }
});

test('knight vectors: 12, valid permutations of {1,2,3} summing to 0', () => {
  assert.equal(KNIGHT.length, 12);
  for (const v of KNIGHT) {
    assert.equal(v[0] + v[1] + v[2], 0);
    assert.deepEqual([...v.map(Math.abs)].sort(), [1, 2, 3]);
  }
});
