// bot.js — a small automated opponent (feasibility spike).
// Pure and DOM-free like the rest of the engine (ADR-0003): it consumes a
// position `{ board, epTarget, epCapture }` and returns a move, with no UI or
// game-state coupling. Depth-2 alpha-beta (negamax) over a material-only
// evaluation — enough that it won't hand a queen back for a pawn, but no
// positional understanding. See docs/superpowers/specs/2026-06-11-bot-opponent-design.md.

import { allLegalMoves, applyMoveToBoard, cloneBoard, inCheck } from './rules.js';
import { opponent, parseKey, key, add, pawnForward } from './hex.js';

const VALUE = { Q: 9, R: 5, B: 3, N: 3, P: 1, K: 0 };
const MATE = 1e6; // dwarfs any material score, so mates dominate the search

// Material balance from `army`'s point of view (positive = army is ahead).
function evaluate(board, army) {
  let score = 0;
  for (const p of board.values()) score += (p.army === army ? 1 : -1) * VALUE[p.type];
  return score;
}

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

// Negamax with alpha-beta. Returns the value of `pos` for the side to move (army).
function negamax(pos, army, depth, alpha, beta) {
  // Leaf: static material only. We intentionally don't generate moves here just
  // to detect a terminal node — that doubles work on the most numerous layer of
  // the tree. The horizon trade-off: the bot won't *see* a mate that lands
  // exactly at a leaf, but a mate it can deliver one ply earlier is found at the
  // depth>=1 check below. Fine for the spike.
  if (depth === 0) return evaluate(pos.board, army);
  const moves = allLegalMoves(pos, army);
  if (moves.length === 0) {
    // No legal move: checkmate (in check) is worst; stalemate is treated as
    // neutral for the spike (Gliński actually scores it ¾/¼ — deferred).
    // +depth makes a mate found sooner score worse, so the bot prefers the
    // quickest mate and the most delayed loss.
    return inCheck(pos, army) ? -(MATE + depth) : 0;
  }
  order(pos.board, moves);
  let best = -Infinity;
  for (const m of moves) {
    const score = -negamax(childPos(pos, m), opponent(army), depth - 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // opponent won't allow this line
  }
  return best;
}

// Choose a move for `army` in `pos`. Returns { from, to, promo } or null when
// there are no legal moves. `opts.depth` (default 2) and `opts.rng` (default
// Math.random, injected for deterministic tests) tune search and tie-breaking.
export function chooseMove(pos, army, opts = {}) {
  const depth = opts.depth ?? 2;
  const rng = opts.rng ?? Math.random;
  const moves = allLegalMoves(pos, army);
  if (moves.length === 0) return null;
  order(pos.board, moves);

  // Root uses a full window so every move gets an exact score — that lets us
  // collect all equal-best moves and pick among them at random for variety.
  let bestScore = -Infinity;
  let best = [];
  for (const m of moves) {
    const score = -negamax(childPos(pos, m), opponent(army), depth - 1, -Infinity, Infinity);
    if (score > bestScore) { bestScore = score; best = [m]; }
    else if (score === bestScore) best.push(m);
  }
  const pick = best[Math.floor(rng() * best.length)];
  return { from: pick.from, to: pick.to, promo: pick.isPromotion ? 'Q' : undefined };
}
