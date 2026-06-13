# Move Hints (Teaching Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On demand, suggest the human's best move and explain *why* in plain language, reusing the bot's search.

**Architecture:** Three pure DOM-free modules — `eval.js` (named evaluation terms whose weighted sum drives the search), `bot.js` (`analyse()` returns the chosen move plus its principal variation and the most tempting refuted alternative), and `explain.js` (turns those search facts into a structured teaching rationale). The UI repurposes the 🤖 Bot gutter slot into a 💡 Hint button once a game is underway (untimed games, human seats only), highlighting the suggested move on the board and showing a reasons card.

**Tech Stack:** Vanilla ES modules, no build step. Tests via `node --test` (`.mjs`). SVG board renderer. Follows ADR-0003 (DOM-free engine).

**Spec:** `docs/superpowers/specs/2026-06-12-move-hints-design.md`

---

## File structure

- **Create `src/eval.js`** — `evaluateTerms(board, army) → {material, centre}`, `score(terms)`, `evaluate(board, army)`, exported `VALUE`. The one home for piece values and the scoring function.
- **Modify `src/bot.js`** — import eval from `eval.js` (drop the local `VALUE`/`evaluate`); `negamax` returns `{score, line}`; new `analyse()` returns `{move, score, pv, runnerUp, tempting}`; `chooseMove` becomes a thin wrapper over `analyse`.
- **Create `src/explain.js`** — `explain(pos, army, analysis, farWhite) → {moveLabel, lead, reasons[], contrast}`. The teaching brain. Pure.
- **Modify `src/render.js`** — add a `hint` layer; `draw()` accepts `ui.hint = {from, to}` and outlines both cells.
- **Modify `index.html`** — add `botslot` class to each Bot button; add the `#hintcard` overlay.
- **Modify `src/ui.js`** — import `analyse`/`explain`; `_showHint`/`_closeHint`/`_renderHintCard`; `hint` action; repurpose the slot in `_updateGutter`; thread `ui.hint` through resets and `_drawBoard`.
- **Modify `styles.css`** — hint board outlines + `#hintcard` styling.
- **Modify `sw.js`** — bump `CACHE`, precache the two new modules.
- **Create `tests/eval.test.mjs`, `tests/explain.test.mjs`; extend `tests/bot.test.mjs`.**

---

## Task 1: `src/eval.js` — named evaluation terms

**Files:**
- Create: `src/eval.js`
- Test: `tests/eval.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/eval.test.mjs`:

```js
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
  // Side A is a pawn up but its pieces are all on the rim; side B is centralised.
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/eval.test.mjs`
Expected: FAIL — `Cannot find module '../src/eval.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/eval.js`:

```js
// eval.js — explainable evaluation for the search and the hint layer.
// Pure and DOM-free (ADR-0003). Material drives most decisions; a small centre
// term teaches the core hex principle that central pieces radiate furthest.
// `score` is the scalar the search maximises; `evaluateTerms` exposes the named
// pieces the hint reads. Kept cheap (O(pieces), no attack maps) because it runs
// at every search leaf — see the bot spike's 2 s -> 75 ms perf note.
import { parseKey } from './hex.js';

export const VALUE = { Q: 9, R: 5, B: 3, N: 3, P: 1, K: 0 };

// Centre weight: deliberately tiny so no centralisation sum can overturn a whole
// pawn of material — it only breaks ties between otherwise-equal moves.
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/eval.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/eval.js tests/eval.test.mjs
git commit -m "feat: explainable evaluation terms (material + centre)"
```

---

## Task 2: `src/bot.js` — `analyse()` returning the principal variation

**Files:**
- Modify: `src/bot.js`
- Test: `tests/bot.test.mjs` (extend; the five existing tests must stay green)

- [ ] **Step 1: Write the failing test**

Append to `tests/bot.test.mjs` (add `analyse` to the import on line 3 so it reads `import { chooseMove, analyse } from '../src/bot.js';`):

```js
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
});

test('analyse returns null when the side has no legal moves', () => {
  const b = new Map();
  placeXY(b, 3, 1, 'K', 'far');
  assert.equal(analyse(pos(b), 'near', det), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bot.test.mjs`
Expected: FAIL — `analyse` is not exported (`a` is undefined / not a function).

- [ ] **Step 3: Rewrite `src/bot.js`**

Replace the whole file with:

```js
// bot.js — a small automated opponent and the search behind the hint layer.
// Pure and DOM-free like the rest of the engine (ADR-0003): it consumes a
// position `{ board, epTarget, epCapture }` and returns a move (and, for the
// hint, the line it foresees). Depth-2 alpha-beta (negamax) over the named-term
// evaluation in eval.js. See docs/superpowers/specs/2026-06-12-move-hints-design.md.

import { allLegalMoves, applyMoveToBoard, cloneBoard, inCheck } from './rules.js';
import { opponent, parseKey, key, add, pawnForward } from './hex.js';
import { evaluate, VALUE } from './eval.js';

const MATE = 1e6; // dwarfs any material score, so mates dominate the search

// The position after `move`, including the next en-passant target. The pure
// rules layer applies the move to a board but the ep bookkeeping lives in the
// Game; we mirror just that slice here so child nodes generate pawn moves right.
function childPos(pos, move) {
  const board = cloneBoard(pos.board);
  const piece = pos.board.get(move.from);
  applyMoveToBoard(board, move, 'Q'); // the bot always promotes to Queen
  let epTarget = null;
  let epCapture = null;
  if (move.isDoubleStep) {
    const [fx, fy] = parseKey(move.from);
    const skipped = add([fx, fy, -fx - fy], pawnForward(piece.army));
    epTarget = key(skipped[0], skipped[1]);
    epCapture = move.to;
  }
  return { board, epTarget, epCapture };
}

// Captures first (most valuable victim first) — cheap move ordering that makes
// alpha-beta prune far more of the tree.
function order(board, moves) {
  const victim = (m) => (m.captureKey && board.get(m.captureKey) ? VALUE[board.get(m.captureKey).type] : 0);
  moves.sort((a, b) => victim(b) - victim(a));
}

// Negamax with alpha-beta. Returns { score, line } where `line` is the principal
// variation (move objects) from this node for the side to move.
function negamax(pos, army, depth, alpha, beta) {
  // Leaf: static eval only (no move generation just to detect terminals — that
  // doubles work on the most numerous layer; see the spike's perf note).
  if (depth === 0) return { score: evaluate(pos.board, army), line: [] };
  const moves = allLegalMoves(pos, army);
  if (moves.length === 0) {
    // No legal move: checkmate (in check) is worst; stalemate is neutral for now
    // (Gliński actually scores it 3/4-1/4 — deferred). +depth prefers the
    // quickest mate and the most delayed loss.
    return { score: inCheck(pos, army) ? -(MATE + depth) : 0, line: [] };
  }
  order(pos.board, moves);
  let best = -Infinity;
  let bestLine = [];
  for (const m of moves) {
    const child = negamax(childPos(pos, m), opponent(army), depth - 1, -beta, -alpha);
    const sc = -child.score;
    if (sc > best) { best = sc; bestLine = [m, ...child.line]; }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // opponent won't allow this line
  }
  return { score: best, line: bestLine };
}

// Full analysis for `army` in `pos`, or null when there are no legal moves.
// Returns the chosen move (with its principal variation), the best alternative,
// and the most "tempting" refuted capture — the hooks the hint layer narrates.
// `opts.depth` (default 2) and `opts.rng` (default Math.random) tune search and
// tie-breaking. The root uses a full window so every move gets an exact score.
export function analyse(pos, army, opts = {}) {
  const depth = opts.depth ?? 2;
  const rng = opts.rng ?? Math.random;
  const moves = allLegalMoves(pos, army);
  if (moves.length === 0) return null;
  order(pos.board, moves);

  const scored = [];
  for (const m of moves) {
    const child = negamax(childPos(pos, m), opponent(army), depth - 1, -Infinity, Infinity);
    scored.push({ move: m, score: -child.score, line: [m, ...child.line] });
  }

  // Best score, tie-broken at random (so the robot varies; tests inject rng).
  let bestScore = -Infinity;
  for (const s of scored) if (s.score > bestScore) bestScore = s.score;
  const best = scored.filter((s) => s.score === bestScore);
  const choice = best[Math.floor(rng() * best.length)];

  // Best alternative move (highest-scoring move that isn't the chosen one).
  let runnerUp = null;
  for (const s of scored) {
    if (s === choice) continue;
    if (!runnerUp || s.score > runnerUp.score) runnerUp = s;
  }

  // Most tempting refuted capture: a meaningful grab (victim >= a minor piece)
  // whose searched score is clearly worse than the suggestion. Drives the
  // "looks tempting, but..." contrast line. null when no such trap exists.
  let tempting = null;
  for (const s of scored) {
    if (s === choice || !s.move.captureKey) continue;
    const victimPiece = pos.board.get(s.move.captureKey);
    const victim = victimPiece ? VALUE[victimPiece.type] : 0;
    if (victim < 3 || bestScore - s.score < 1) continue;
    if (!tempting || victim > tempting.victim) tempting = { ...s, victim };
  }

  const pack = (s) => s && { move: { from: s.move.from, to: s.move.to, promo: s.move.isPromotion ? 'Q' : undefined }, score: s.score, pv: s.line };
  return {
    move: { from: choice.move.from, to: choice.move.to, promo: choice.move.isPromotion ? 'Q' : undefined },
    score: choice.score,
    pv: choice.line,
    runnerUp: pack(runnerUp),
    tempting: tempting && { ...pack(tempting), victim: tempting.victim, moveObj: tempting.move },
  };
}

// Choose a move for `army` (the robot opponent). Thin wrapper over analyse so
// the bot and the hint share one search. Returns { from, to, promo } or null.
export function chooseMove(pos, army, opts = {}) {
  const a = analyse(pos, army, opts);
  return a && a.move;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bot.test.mjs`
Expected: PASS — all seven tests (the five original spike tests plus the two new `analyse` tests).

- [ ] **Step 5: Commit**

```bash
git add src/bot.js tests/bot.test.mjs
git commit -m "feat: bot analyse() returns principal variation + alternatives"
```

---

## Task 3: `src/explain.js` — the teaching brain

**Files:**
- Create: `src/explain.js`
- Test: `tests/explain.test.mjs`

`explain` consumes an `analysis` from `analyse()` and the position *before* the move. It applies the move on a clone to read tactical facts via `isAttacked`, then composes a structured rationale. `analysis.pv[0]` is the full chosen move object (with `captureKey`/`isPromotion`); `analysis.move` is the `{from,to}` label form.

- [ ] **Step 1: Write the failing test**

Create `tests/explain.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../src/bot.js';
import { explain } from '../src/explain.js';
import { key, ORTHO, isOnBoard } from '../src/hex.js';
import { inCheck } from '../src/rules.js';

const pos = (board) => ({ board, epTarget: null, epCapture: null });
const placeXY = (b, x, y, type, army) => b.set(key(x, y), { type, army });
const det = { rng: () => 0 };
const CENTRE = key(0, 0);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/explain.test.mjs`
Expected: FAIL — `Cannot find module '../src/explain.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/explain.js`:

```js
// explain.js — the teaching brain. Pure and DOM-free (ADR-0003). Turns a search
// result from bot.analyse() into a structured, human-readable rationale:
//   { moveLabel, lead, reasons[], contrast }
// "Lead" is the single dominant reason; "reasons" are up to two supporting
// points; "contrast" warns about a tempting-but-refuted alternative when one
// exists. The UI owns presentation — this layer only produces strings + data.
import { applyMoveToBoard, cloneBoard, allLegalMoves, inCheck } from './rules.js';
import { isAttacked } from './rules.js';
import { opponent, parseKey, cubeToSquareOriented } from './hex.js';
import { VALUE, evaluateTerms } from './eval.js';

const NAME = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };

// A piece on `k` is "hanging" for `side`: attacked by the enemy and undefended.
const hanging = (board, side, k) =>
  isAttacked(board, k, opponent(side)) && !isAttacked(board, k, side);

// Keys of `side`'s hanging non-king pieces on `board`.
function hangingKeys(board, side) {
  const out = [];
  for (const [k, p] of board) {
    if (p.army === side && p.type !== 'K' && hanging(board, side, k)) out.push([k, p.type]);
  }
  return out;
}

const materialBalance = (board, army) => {
  let s = 0;
  for (const p of board.values()) s += (p.army === army ? 1 : -1) * VALUE[p.type];
  return s;
};

const afterLine = (board, line) => {
  const b = cloneBoard(board);
  for (const m of line) applyMoveToBoard(b, m, 'Q');
  return b;
};

export function explain(pos, army, analysis, farWhite) {
  const sq = (k) => cubeToSquareOriented(...parseKey(k), farWhite);
  const label = (m) => `${sq(m.from)}→${sq(m.to)}`;
  const move = analysis.pv[0];                 // full chosen move object
  const movedType = pos.board.get(move.from).type;

  // Board after our move only (for check / threats / saved pieces), and after the
  // whole foreseen line (for net material won).
  const afterMove = cloneBoard(pos.board);
  applyMoveToBoard(afterMove, move, 'Q');
  const afterPos = { board: afterMove, epTarget: null, epCapture: null };
  const endBoard = afterLine(pos.board, analysis.pv);

  // --- facts -------------------------------------------------------------
  const oppMoves = allLegalMoves(afterPos, opponent(army));
  const isMate = oppMoves.length === 0 && inCheck(afterPos, opponent(army));
  const givesCheck = !isMate && inCheck(afterPos, opponent(army));

  const capturedType = move.captureKey ? (pos.board.get(move.captureKey) || {}).type : null;
  const net = materialBalance(endBoard, army) - materialBalance(pos.board, army);
  const winsType = capturedType && net >= 1 ? capturedType : null;

  // A piece type that was hanging before our move but is safe after it.
  const wasHanging = hangingKeys(pos.board, army).map(([, t]) => t);
  const stillHanging = new Set(hangingKeys(afterMove, army).map(([, t]) => t));
  const savedType = wasHanging.find((t) => !stillHanging.has(t)) || null;

  // An enemy piece type newly hanging after our move (a fresh threat).
  const enemyHangingBefore = new Set(hangingKeys(pos.board, opponent(army)).map(([, t]) => t));
  const threatType = hangingKeys(afterMove, opponent(army))
    .map(([, t]) => t)
    .find((t) => !enemyHangingBefore.has(t)) || null;

  const centreUp = evaluateTerms(afterMove, army).centre > evaluateTerms(pos.board, army).centre;

  // --- lead (the single dominant reason) ---------------------------------
  let lead;
  let used = '';
  if (isMate) { lead = 'Checkmate — this ends the game.'; used = 'mate'; }
  else if (winsType) { lead = `Wins a ${NAME[winsType]}.`; used = 'wins'; }
  else if (savedType) { lead = `Saves your ${NAME[savedType]} from capture.`; used = 'saves'; }
  else if (threatType) { lead = `Threatens to win their ${NAME[threatType]}.`; used = 'threat'; }
  else if (centreUp) { lead = `Develops your ${NAME[movedType]} toward the centre — the most powerful squares in hex chess.`; used = 'centre'; }
  else { lead = 'Keeps your position solid.'; used = 'solid'; }

  // --- supporting reasons (max two, excluding whatever is in the lead) ----
  const reasons = [];
  if (givesCheck) reasons.push('Gives check.');
  if (used !== 'saves' && savedType) reasons.push(`Saves your ${NAME[savedType]} from capture.`);
  if (used !== 'threat' && threatType) reasons.push(`Also threatens their ${NAME[threatType]}.`);
  if (used !== 'centre' && centreUp) reasons.push(`Brings your ${NAME[movedType]} toward the centre.`);
  reasons.length = Math.min(reasons.length, 2);

  // --- contrast (the dash of "why not the obvious grab") ------------------
  let contrast;
  if (analysis.tempting) {
    const t = analysis.tempting;
    const victimType = (pos.board.get(t.moveObj.captureKey) || {}).type;
    const reply = t.pv[1] ? label(t.pv[1]) : null;
    contrast = `Grabbing the ${NAME[victimType]} on ${sq(t.move.to)} is tempting, but `
      + (reply ? `${reply} ` : 'the reply ') + 'refutes it.';
  }

  return { moveLabel: label(move), lead, reasons, contrast };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/explain.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the whole suite (regression)**

Run: `node --test`
Expected: PASS — every test across `tests/` (eval, bot, explain, and all pre-existing engine tests).

- [ ] **Step 6: Commit**

```bash
git add src/explain.js tests/explain.test.mjs
git commit -m "feat: explain.js teaching rationale for suggested moves"
```

---

## Task 4: `src/render.js` — hint highlight layer

**Files:**
- Modify: `src/render.js` (constructor layers ~line 36-42; `draw` signature line 68; add render block after the targets block ~line 120)

No unit test (DOM/SVG); verified by the full suite staying green and a manual smoke check in Task 7.

- [ ] **Step 1: Add the `hint` layer to the constructor**

In `src/render.js`, change the `this.layers` object and its append loop (lines 36-42) so `hint` sits just above `lastmove` (under pieces):

```js
    this.layers = {
      lastmove: el('g'), hint: el('g'), check: el('g'), targets: el('g'),
      selection: el('g'), coords: el('g'), pieces: el('g'),
    };
    for (const k of ['lastmove', 'hint', 'check', 'targets', 'selection', 'coords', 'pieces']) {
      this.svg.appendChild(this.layers[k]);
    }
```

(`_clear()` iterates `this.layers`, so the new layer is cleared automatically.)

- [ ] **Step 2: Accept `hint` in `draw()`**

Change line 68 to destructure `hint`:

```js
    const { selected = null, targets = [], showCoords = false, animate = null, hint = null } = ui;
```

- [ ] **Step 3: Render the hint outlines**

Immediately after the `for (const m of targets) { ... }` block (ends ~line 120, before the `// pieces` comment), add:

```js
    // suggested-move hint (teaching layer): outline the from and to cells.
    if (hint && this.center.has(hint.from) && this.center.has(hint.to)) {
      for (const [k, cls] of [[hint.from, 'hint from'], [hint.to, 'hint to']]) {
        const [cx, cy] = this.center.get(k);
        this.layers.hint.appendChild(el('polygon', { points: hexPoints(cx, cy, SIZE * 0.86), class: cls }));
      }
    }
```

- [ ] **Step 4: Verify nothing regressed**

Run: `node --test`
Expected: PASS (engine tests untouched; renderer has no unit tests but must not error on import — covered by Task 7's smoke check).

- [ ] **Step 5: Commit**

```bash
git add src/render.js
git commit -m "feat: render a suggested-move hint outline"
```

---

## Task 5: `index.html` — `botslot` hook + reasons card

**Files:**
- Modify: `index.html` (Bot buttons at lines 55 and 419; add `#hintcard` after the `#botdlg` block ~line 98)

- [ ] **Step 1: Tag both Bot buttons with a stable class**

The button's `data-action` will be toggled between `bot` and `hint` at runtime, so give it a class the code can always find. Change line 55 and line 419:

```html
      <button class="btn botslot" data-action="bot" data-seat="near">🤖 Bot</button>
```
```html
      <button class="btn botslot" data-action="bot" data-seat="far">🤖 Bot</button>
```

- [ ] **Step 2: Add the reasons card overlay**

After the `#botdlg` overlay block (closes at line 98) and before the `<!-- game over -->` comment, add:

```html
    <!-- hint: suggested move + teaching rationale -->
    <div class="overlay hintcard" id="hintcard" hidden>
      <div class="card">
        <div class="ttl">Suggested move</div>
        <div class="movelabel" data-bind="hint-move"></div>
        <div class="lead" data-bind="hint-lead"></div>
        <ul class="reasons" data-bind="hint-reasons"></ul>
        <div class="contrast" data-bind="hint-contrast" hidden></div>
        <button class="btn primary" data-action="hint-close">Got it</button>
      </div>
    </div>
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: hint card markup + botslot hook"
```

---

## Task 6: `src/ui.js` — wire the Hint button

**Files:**
- Modify: `src/ui.js` (import line 10; `ui` init lines 66, 351; `_action` ~line 320; `_postMove` ~line 209; `_drawBoard` line 626; `_updateGutter` control block ~line 732)

- [ ] **Step 1: Import `analyse` and `explain`**

Change line 10:

```js
import { chooseMove, analyse } from './bot.js';
import { explain } from './explain.js';
```

- [ ] **Step 2: Add `hint: null` to both `ui` state objects**

In the constructor (line 66) and in `_newGame` (line 351), add `hint: null` to the `this.ui = { ... }` literal. Both literals become:

```js
    this.ui = { selected: null, targets: [], pendingPromo: null, request: null, undoKeep: 0, advExpanded: null, awaitingPress: null, hint: null };
```

(Also update the identical literal inside `_saveSettings`, line 464, the same way — it rebuilds `this.ui` on a time-control change.)

- [ ] **Step 3: Clear the hint after any move**

In `_postMove` (line 209), extend the reset line so a played move dismisses a stale hint:

```js
    this.ui.selected = null; this.ui.targets = []; this.ui.request = null; this.ui.hint = null;
    $('#hintcard').hidden = true;
```

- [ ] **Step 4: Thread `hint` into the board draw**

Change `_drawBoard` (lines 626-630) to pass the hint:

```js
  _drawBoard() {
    this.renderer.draw(this.game, {
      selected: this.ui.selected, targets: this.ui.targets, showCoords: this.settings.coords,
      animate: this._pendingAnim || null, hint: this.ui.hint || null,
    });
    this._pendingAnim = null; // animate only the render right after a move
  }
```

- [ ] **Step 5: Add the `hint` and `hint-close` actions**

In `_action` (the switch ~lines 318-320), add two cases next to the bot cases:

```js
      case 'hint': this._showHint(seat); break;
      case 'hint-close': this._closeHint(); break;
```

- [ ] **Step 6: Add the hint methods**

Add these methods right after `_botMove()` (after line 268), in the bot section:

```js
  // ---- move hints (teaching layer) ----
  // Suggest the side-to-move human's best move and explain why. Untimed games
  // only, never for a seat the robot holds. Reuses the bot search (analyse) and
  // the explain layer; it never moves for you — you read it and play it yourself.
  _showHint(seat) {
    if (!this.game.whiteArmy || this.game.result || this.game.clock) return;
    if (this.game.toMove !== seat || this.ui.pendingPromo) return;
    if (this.bot.enabled && seat === this.bot.seat) return;
    const analysis = analyse(this.game.pos(), seat);
    if (!analysis) return;
    const farWhite = this.game.whiteArmy === 'far';
    const r = explain(this.game.pos(), seat, analysis, farWhite);
    this.ui.hint = { from: analysis.move.from, to: analysis.move.to };
    this._drawBoard();
    this._renderHintCard(r, seat);
  }

  _renderHintCard(r, seat) {
    const card = $('#hintcard');
    $('[data-bind="hint-move"]', card).textContent = r.moveLabel;
    $('[data-bind="hint-lead"]', card).textContent = r.lead;
    const list = $('[data-bind="hint-reasons"]', card);
    list.replaceChildren();
    for (const reason of r.reasons) {
      const li = document.createElement('li');
      li.textContent = reason;
      list.appendChild(li);
    }
    const contrast = $('[data-bind="hint-contrast"]', card);
    contrast.textContent = r.contrast || '';
    contrast.hidden = !r.contrast;
    card.classList.toggle('face-far', seat === 'far'); // orient to the asking seat
    card.hidden = false;
  }

  _closeHint() {
    $('#hintcard').hidden = true;
    this.ui.hint = null;
    this._drawBoard();
  }
```

- [ ] **Step 7: Repurpose the gutter slot in `_updateGutter`**

In `_updateGutter`, replace the existing bot enable line (line 732, `dis('bot', whiteSet || over);`) with the slot-repurpose block below. It keeps the slot as the 🤖 Bot opener pre-game and turns it into 💡 Hint once the game starts (human seats only, untimed):

```js
    // Bot/Hint slot: pre-game it opens the robot picker; once a game is underway
    // it becomes the Hint button for a human seat (untimed only; hidden on the
    // robot's own seat). data-action is toggled, so we find it by .botslot class.
    const slot = $(`.botslot[data-seat="${seat}"]`, g);
    if (slot) {
      const isBotSeat = this.bot.enabled && seat === this.bot.seat;
      if (!whiteSet) {
        slot.dataset.action = 'bot';
        slot.textContent = '🤖 Bot';
        slot.hidden = false;
        slot.disabled = over;
      } else {
        slot.dataset.action = 'hint';
        slot.textContent = '💡 Hint';
        slot.hidden = isBotSeat; // don't coach the robot
        slot.disabled = over || !!this.game.clock || isBotSeat
          || this.game.toMove !== seat || !!this.ui.pendingPromo;
      }
    }
```

- [ ] **Step 8: Run the suite (no UI tests, but imports must resolve)**

Run: `node --test`
Expected: PASS — engine/eval/bot/explain tests all green. (ui.js is browser-only and not imported by tests; this guards the modules it pulls in.)

- [ ] **Step 9: Commit**

```bash
git add src/ui.js
git commit -m "feat: wire the Hint button (analyse + explain + board highlight)"
```

---

## Task 7: `styles.css` + `sw.js` — styling and offline cache

**Files:**
- Modify: `styles.css` (after the `.tgt` rules ~line 162; after the `.botdlg .btn` rule ~line 196)
- Modify: `sw.js` (lines 3 and 7)

- [ ] **Step 1: Add the hint board-outline styles**

After the `.tgt` block (line 162 region in `styles.css`), add:

```css
/* suggested-move hint outline (teaching layer) */
.hint { fill:none; stroke:var(--accent-soft); stroke-width:5.5; stroke-linejoin:round; pointer-events:none; }
.hint.from { opacity:.5; stroke-dasharray:7 5; }
.hint.to { opacity:.95; }
```

- [ ] **Step 2: Add the reasons-card styles**

After the `.botdlg .btn { margin-top:3px; }` rule (line 196), add:

```css
/* hint reasons card */
.hintcard .card { padding:15px 18px; display:flex; flex-direction:column; align-items:stretch; gap:9px; width:280px; }
.hintcard.face-far .card { transform:rotate(180deg); }
.hintcard .ttl { font-family:"Fraunces",serif; font-weight:600; color:var(--accent-soft); text-align:center; }
.hintcard .movelabel { font-family:"Fraunces",serif; font-size:24px; font-weight:600; color:var(--ink); text-align:center;
  font-variant-numeric:tabular-nums; }
.hintcard .lead { font-size:14.4px; color:var(--ink); line-height:1.3; }
.hintcard .reasons { margin:0; padding-left:18px; display:flex; flex-direction:column; gap:4px; }
.hintcard .reasons:empty { display:none; }
.hintcard .reasons li { font-size:12.8px; color:var(--ink-dim); line-height:1.3; }
.hintcard .contrast { font-size:12.6px; color:var(--ink-faint); line-height:1.3; border-top:1px solid var(--panel-edge); padding-top:8px; }
.hintcard .btn { margin-top:3px; }
```

- [ ] **Step 3: Bump the service-worker cache and precache the new modules**

In `sw.js` change line 3:

```js
const CACHE = 'hexchess-v40';
```

and add the two new modules to the `ASSETS` list (line 7), so that line reads:

```js
  './src/render.js', './src/pieces.js', './src/storage.js', './src/audio.js', './src/clock.js', './src/bot.js', './src/eval.js', './src/explain.js',
```

- [ ] **Step 4: Full suite + manual smoke test**

Run: `node --test`
Expected: PASS (whole suite).

Then serve and smoke-test in a browser on a **fresh port** (avoids the stale-SW trap from the spike):

```bash
python3 -m http.server 8750
```

Verify in the browser (untimed game — Settings → time control Off):
1. Pre-game both gutters show **🤖 Bot**; start a hot-seat game with one move.
2. The side-to-move gutter now shows an enabled **💡 Hint**; the waiting gutter's Hint is disabled.
3. Tap **💡 Hint** → the suggested from/to cells get an outline and the reasons card appears with a move label, a lead sentence, and any supporting bullets.
4. Tap **Got it** → card closes, outline clears; play any move → a stale hint never lingers.
5. Start a bot game (🤖 Bot → pick a colour): the robot's far gutter shows **no** Hint button; your near gutter offers Hint on your turn.
6. In a **timed** game (e.g. 5+0), confirm the slot stays inert post-start (no Hint).

- [ ] **Step 5: Commit**

```bash
git add styles.css sw.js
git commit -m "feat: hint styles + precache eval/explain (cache v40)"
```

---

## Self-review

**Spec coverage:**
- Full teaching breakdown (lead + reasons + contrast) → Task 3 (`explain.js`).
- On-demand trigger reusing the Bot slot → Tasks 5 (markup) + 6 (repurpose).
- Unified eval drives search → Tasks 1 (`eval.js`) + 2 (`bot.js` uses `evaluate`).
- Board highlight + reasons card → Tasks 4 (outline) + 5/6/7 (card).
- Untimed-only, human-seats-only, not the bot seat → Task 6 Steps 6-7 guards.
- Approach A (PV-delta narration) → `explain.js` reads the PV (`afterLine`, net material). Dash of C (contrast) → `analyse().tempting` + the contrast line.
- Perf: cheap per-node eval (material + centre, no attack maps); `isAttacked`-based facts run once in `explain` → Tasks 1 + 3.
- Testing: `eval.test.mjs`, `bot.test.mjs` (regression + PV), `explain.test.mjs` → Tasks 1-3.

**Placeholder scan:** none — every step ships complete code or an exact command.

**Type consistency:** `analyse()` returns `{move, score, pv, runnerUp, tempting}`; `explain` reads `analysis.pv[0]` (full move object), `analysis.tempting.moveObj`/`.move`/`.pv`/`.victim`. `evaluateTerms` returns `{material, centre}` used by `score` and by `explain`'s `centreUp`. `ui.hint = {from, to}` matches `render.draw`'s `hint` destructure and the `hint.from`/`hint.to` reads. Button found via `.botslot[data-seat]`; `data-action` toggled between `bot`/`hint`, both handled in `_action`. Consistent throughout.
