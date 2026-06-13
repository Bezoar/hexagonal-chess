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
