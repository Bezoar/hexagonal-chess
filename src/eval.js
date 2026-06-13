// eval.js — explainable evaluation for the search and the hint layer.
// Pure and DOM-free (ADR-0003). Material drives most decisions; a small centre
// term teaches the core hex principle that central pieces radiate furthest.
// `score` is the scalar the search maximises; `evaluateTerms` exposes the named
// pieces the hint reads. Kept cheap (O(pieces), no attack maps) because it runs
// at every search leaf — see the bot spike's 2 s -> 75 ms perf note.
import { parseKey } from './hex.js';

export const VALUE = { Q: 9, R: 5, B: 3, N: 3, P: 1, K: 0 };

// Centre weight: tiny so a single piece's centralisation advantage (max 0.10) can
// never overturn a pawn — it only breaks ties between otherwise-equal moves.
const CENTRE_W = 0.02;

// Hex-ring distance from the centre cell (0 at the centre, 5 at the edge). With
// z = -x - y, |z| = |x + y|, so ring = (|x| + |y| + |x + y|) / 2.
const ring = (x, y) => (Math.abs(x) + Math.abs(y) + Math.abs(x + y)) / 2;

// Named evaluation terms from `army`'s point of view (positive = army is ahead).
export function evaluateTerms(board, army) {
  let material = 0;
  let centre = 0;
  for (const [k, p] of board) {
    const sign = p.army === army ? 1 : -1;
    material += sign * VALUE[p.type];
    const [x, y] = parseKey(k);
    centre += sign * (5 - ring(x, y)) * CENTRE_W;
  }
  return { material, centre };
}

export const score = (terms) => terms.material + terms.centre;
export const evaluate = (board, army) => score(evaluateTerms(board, army));
