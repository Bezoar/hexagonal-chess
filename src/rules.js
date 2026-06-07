// rules.js — move generation, attacks, check/checkmate/stalemate.
// Pure / DOM-free (ADR-0003). Operates on a "position":
//   { board: Map<key, {type, army}>, epTarget: key|null, epCapture: key|null }
// `epTarget` is the skipped cell a pawn may capture onto via en passant;
// `epCapture` is the cell of the pawn that would be removed.

import {
  key, parseKey, isOnBoard, ORTHO, DIAG, KNIGHT,
  pawnForward, pawnCaptures, pawnStarts, opponent, add,
} from './hex.js';

const SLIDERS = { R: ORTHO, B: DIAG, Q: [...ORTHO, ...DIAG] };
const STEPPERS = { N: KNIGHT, K: [...ORTHO, ...DIAG] };

export const cloneBoard = (board) => new Map(board);

export function kingKey(board, army) {
  for (const [k, p] of board) if (p.type === 'K' && p.army === army) return k;
  return null;
}

// Does `army` attack `targetKey`? (Pawns attack their two capture diagonals;
// sliders attack up to and including the first occupied cell.)
export function isAttacked(board, targetKey, army) {
  const [tx, ty] = parseKey(targetKey);
  for (const [k, p] of board) {
    if (p.army !== army) continue;
    const [x, y] = parseKey(k);
    const z = -x - y;
    if (p.type === 'P') {
      for (const d of pawnCaptures(p.army)) {
        if (x + d[0] === tx && y + d[1] === ty) return true;
      }
    } else if (STEPPERS[p.type]) {
      for (const d of STEPPERS[p.type]) {
        if (x + d[0] === tx && y + d[1] === ty) return true;
      }
    } else {
      for (const d of SLIDERS[p.type]) {
        let c = [x, y, z];
        while (true) {
          c = add(c, d);
          if (!isOnBoard(c[0], c[1], c[2])) break;
          const ck = key(c[0], c[1]);
          if (ck === targetKey) return true;
          if (board.has(ck)) break; // blocked
        }
      }
    }
  }
  return false;
}

export const inCheck = (pos, army) =>
  isAttacked(pos.board, kingKey(pos.board, army), opponent(army));

// Pseudo-legal moves for the piece at `fromKey` (ignores own-king safety).
// Returns move objects: { from, to, capture, captureKey, isEnPassant, isDoubleStep, isPromotion }
export function pseudoMoves(pos, fromKey) {
  const { board } = pos;
  const piece = board.get(fromKey);
  if (!piece) return [];
  const [x, y] = parseKey(fromKey);
  const z = -x - y;
  const moves = [];
  const mk = (to, opts = {}) => ({
    from: fromKey, to, capture: false, captureKey: null,
    isEnPassant: false, isDoubleStep: false, isPromotion: false, ...opts,
  });

  if (piece.type === 'P') {
    const fwd = pawnForward(piece.army);
    const promotes = (cx, cy, cz) => !isOnBoard(cx + fwd[0], cy + fwd[1], cz + fwd[2]);
    // one step forward
    const one = add([x, y, z], fwd);
    if (isOnBoard(...one) && !board.has(key(one[0], one[1]))) {
      moves.push(mk(key(one[0], one[1]), { isPromotion: promotes(...one) }));
      // double step from any own start cell
      if (pawnStarts(piece.army).has(fromKey)) {
        const two = add(one, fwd);
        if (isOnBoard(...two) && !board.has(key(two[0], two[1]))) {
          moves.push(mk(key(two[0], two[1]), { isDoubleStep: true }));
        }
      }
    }
    // diagonal captures (+ en passant)
    for (const d of pawnCaptures(piece.army)) {
      const t = add([x, y, z], d);
      if (!isOnBoard(...t)) continue;
      const tk = key(t[0], t[1]);
      const occ = board.get(tk);
      if (occ && occ.army !== piece.army) {
        moves.push(mk(tk, { capture: true, captureKey: tk, isPromotion: promotes(...t) }));
      } else if (!occ && tk === pos.epTarget) {
        moves.push(mk(tk, { capture: true, captureKey: pos.epCapture, isEnPassant: true }));
      }
    }
    return moves;
  }

  if (STEPPERS[piece.type]) {
    for (const d of STEPPERS[piece.type]) {
      const t = add([x, y, z], d);
      if (!isOnBoard(...t)) continue;
      const tk = key(t[0], t[1]);
      const occ = board.get(tk);
      if (!occ) moves.push(mk(tk));
      else if (occ.army !== piece.army) moves.push(mk(tk, { capture: true, captureKey: tk }));
    }
    return moves;
  }

  for (const d of SLIDERS[piece.type]) {
    let c = [x, y, z];
    while (true) {
      c = add(c, d);
      if (!isOnBoard(...c)) break;
      const tk = key(c[0], c[1]);
      const occ = board.get(tk);
      if (!occ) { moves.push(mk(tk)); continue; }
      if (occ.army !== piece.army) moves.push(mk(tk, { capture: true, captureKey: tk }));
      break; // blocked
    }
  }
  return moves;
}

// Apply a move to a *board* (mutates the given map). Returns the captured piece
// (or null). `promoType` overrides a promoting pawn's resulting type.
export function applyMoveToBoard(board, move, promoType = 'Q') {
  const piece = board.get(move.from);
  let captured = null;
  if (move.captureKey && board.has(move.captureKey)) {
    captured = board.get(move.captureKey);
    board.delete(move.captureKey);
  }
  board.delete(move.from);
  board.set(move.to, move.isPromotion ? { type: promoType, army: piece.army } : piece);
  return captured;
}

// Legal moves: pseudo-legal moves that don't leave the mover's king in check.
export function legalMoves(pos, fromKey) {
  const piece = pos.board.get(fromKey);
  if (!piece) return [];
  return pseudoMoves(pos, fromKey).filter((m) => {
    const b = cloneBoard(pos.board);
    applyMoveToBoard(b, m);
    return !isAttacked(b, kingKey(b, piece.army), opponent(piece.army));
  });
}

export function allLegalMoves(pos, army) {
  const out = [];
  for (const [k, p] of pos.board) if (p.army === army) out.push(...legalMoves(pos, k));
  return out;
}

export const hasLegalMove = (pos, army) => {
  for (const [k, p] of pos.board) {
    if (p.army === army && legalMoves(pos, k).length) return true;
  }
  return false;
};

// Status for `army` to move: 'checkmate' | 'stalemate' | 'check' | 'normal'.
export function status(pos, army) {
  const check = inCheck(pos, army);
  const any = hasLegalMove(pos, army);
  if (check && !any) return 'checkmate';
  if (!check && !any) return 'stalemate';
  return check ? 'check' : 'normal';
}
