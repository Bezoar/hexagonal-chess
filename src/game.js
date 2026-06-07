// game.js — game state, move application, notation, draws, undo. DOM-free (ADR-0003).
//
// Armies are 'near' / 'far' (fixed by home edge). White/Black is a per-game ROLE:
// the first army to move claims White (ADR-0002); before then `toMove` is null and
// either army may move. Movement direction is by army, never by role.

import {
  key, squareToCube, cubeToSquareOriented, parseKey, opponent, pawnForward, add,
} from './hex.js';
import {
  legalMoves, applyMoveToBoard, status as posStatus, inCheck, cloneBoard,
} from './rules.js';
import { Clock } from './clock.js';

const START = [
  ['K', 'g1', 'near'], ['Q', 'e1', 'near'], ['R', 'c1', 'near'], ['R', 'i1', 'near'],
  ['N', 'd1', 'near'], ['N', 'h1', 'near'], ['B', 'f1', 'near'], ['B', 'f2', 'near'], ['B', 'f3', 'near'],
  ['P', 'b1', 'near'], ['P', 'c2', 'near'], ['P', 'd3', 'near'], ['P', 'e4', 'near'], ['P', 'f5', 'near'],
  ['P', 'g4', 'near'], ['P', 'h3', 'near'], ['P', 'i2', 'near'], ['P', 'k1', 'near'],
  ['K', 'g10', 'far'], ['Q', 'e10', 'far'], ['R', 'c8', 'far'], ['R', 'i8', 'far'],
  ['N', 'd9', 'far'], ['N', 'h9', 'far'], ['B', 'f9', 'far'], ['B', 'f10', 'far'], ['B', 'f11', 'far'],
  ['P', 'b7', 'far'], ['P', 'c7', 'far'], ['P', 'd7', 'far'], ['P', 'e7', 'far'], ['P', 'f7', 'far'],
  ['P', 'g7', 'far'], ['P', 'h7', 'far'], ['P', 'i7', 'far'], ['P', 'k7', 'far'],
];

export function startingBoard() {
  const board = new Map();
  for (const [type, sq, army] of START) {
    const [x, y] = squareToCube(sq);
    board.set(key(x, y), { type, army });
  }
  return board;
}

const DEFAULT_RULES = { threefold: true, fiftyMove: true, stalemateAsDraw: false };

function hashPosition(board, toMove, epTarget) {
  const cells = [...board.entries()]
    .map(([k, p]) => `${k}:${p.type}${p.army[0]}`)
    .sort()
    .join(';');
  return `${cells}|${toMove}|${epTarget}`;
}

export class Game {
  // `clockConfig` ({ base, increment } in ms) makes this a timed game; null = untimed.
  constructor(rules = {}, clockConfig = null) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.clockConfig = clockConfig;
    this.reset();
  }

  reset() {
    this.board = startingBoard();
    this.toMove = null;        // null until the first move assigns White
    this.whiteArmy = null;
    this.epTarget = null;      // skipped cell capturable via en passant
    this.epCapture = null;     // cell of the pawn removed by that en passant
    this.halfmove = 0;         // plies since last capture/pawn move (100 = 50-move)
    this.history = [];         // applied move records
    this.forward = [];         // undone moves, retained until the next move
    this.positions = new Map();
    this.result = null;        // null | { kind, winner, reason }
    this.clock = this.clockConfig ? new Clock(this.clockConfig) : null; // null = untimed
    this._count(hashPosition(this.board, this.toMove, this.epTarget));
  }

  _count(h) {
    const n = (this.positions.get(h) || 0) + 1;
    this.positions.set(h, n);
    return n;
  }

  role(army) {
    if (!this.whiteArmy) return null;
    return army === this.whiteArmy ? 'white' : 'black';
  }

  pos() {
    return { board: this.board, epTarget: this.epTarget, epCapture: this.epCapture };
  }

  // Armies whose pieces are currently selectable.
  selectable() {
    if (this.result) return [];
    return this.toMove ? [this.toMove] : ['near', 'far'];
  }

  legalFrom(fromKey) {
    if (this.result) return [];
    const piece = this.board.get(fromKey);
    if (!piece || !this.selectable().includes(piece.army)) return [];
    return legalMoves(this.pos(), fromKey);
  }

  // Apply a move by from/to squares (cube keys). Returns a record, or
  // { needsPromotion: true } if a promotion choice is required.
  move(fromKey, toKey, promoType) {
    const rec = this._apply(fromKey, toKey, promoType);
    if (rec && !rec.needsPromotion) this.forward = []; // a real move discards redo
    return rec;
  }

  _apply(fromKey, toKey, promoType) {
    if (this.result) return null;
    const candidates = this.legalFrom(fromKey).filter((m) => m.to === toKey);
    if (!candidates.length) return null;
    // promotion and non-promotion can't share a from/to, so candidates are equivalent
    const m = candidates[0];
    if (m.isPromotion && !promoType) return { needsPromotion: true, from: fromKey, to: toKey };

    const piece = this.board.get(fromKey);
    const captured = m.captureKey ? this.board.get(m.captureKey) : null;
    applyMoveToBoard(this.board, m, promoType || 'Q');

    // en-passant target for the *next* move
    if (m.isDoubleStep) {
      const [fx, fy] = parseKey(fromKey);
      const skipped = add([fx, fy, -fx - fy], pawnForward(piece.army));
      this.epTarget = key(skipped[0], skipped[1]);
      this.epCapture = toKey;
    } else {
      this.epTarget = null;
      this.epCapture = null;
    }

    this.halfmove = (m.capture || piece.type === 'P') ? 0 : this.halfmove + 1;
    if (!this.whiteArmy) this.whiteArmy = piece.army;        // first mover claims White
    this.toMove = opponent(piece.army);

    const h = hashPosition(this.board, this.toMove, this.epTarget);
    const reps = this._count(h);

    const st = posStatus(this.pos(), this.toMove); // status for the side now to move
    const san = this._san(piece, m, captured, promoType, st);
    this._resolveResult(piece.army, st, reps);

    const record = {
      from: fromKey, to: toKey, promo: m.isPromotion ? (promoType || 'Q') : null,
      army: piece.army, pieceType: piece.type, captured, captureKey: m.captureKey || null,
      san, status: st,
    };
    this.history.push(record);
    return record;
  }

  _resolveResult(moverArmy, st, reps) {
    if (st === 'checkmate') {
      this.result = { kind: 'checkmate', winner: moverArmy, reason: 'checkmate' };
    } else if (st === 'stalemate') {
      this.result = this.rules.stalemateAsDraw
        ? { kind: 'draw', winner: null, reason: 'stalemate-draw' }
        : { kind: 'stalemate', winner: moverArmy, reason: 'stalemate' }; // ¾ to mover
    } else if (this.rules.threefold && reps >= 3) {
      this.result = { kind: 'draw', winner: null, reason: 'threefold' };
    } else if (this.rules.fiftyMove && this.halfmove >= 100) {
      this.result = { kind: 'draw', winner: null, reason: 'fifty-move' };
    }
  }

  // Long-algebraic with retained captured-piece letter (spec §14).
  _san(piece, m, captured, promoType, st) {
    const farWhite = this.whiteArmy === 'far'; // notation oriented to White's home edge
    const from = cubeToSquareOriented(...parseKey(m.from), farWhite);
    const to = cubeToSquareOriented(...parseKey(m.to), farWhite);
    const lead = piece.type === 'P' ? '' : piece.type;
    let s = lead + from;
    if (m.capture) s += 'x' + (captured ? captured.type : 'P') + to;
    else s += to;
    if (m.isPromotion) s += '=' + (promoType || 'Q');
    if (m.isEnPassant) s += ' e.p.';
    if (st === 'checkmate') s += '#';
    else if (st === 'check') s += '+';
    return s;
  }

  // --- Result actions ---
  resign(army) {
    if (this.result) return;
    this.result = { kind: 'resign', winner: opponent(army), reason: 'resign' };
  }

  agreeDraw() {
    if (this.result) return;
    this.result = { kind: 'draw', winner: null, reason: 'agreement' };
  }

  // `seat`'s clock has run out. The opponent wins on time — unless the opponent has
  // no way to mate, which in Gliński's hex chess means only a bare king (a single
  // knight or bishop CAN mate; see docs/research/timed-games.md), then it is a draw.
  flag(seat) {
    if (this.result) return;
    const winner = opponent(seat);
    this.result = this._insufficientToMate(winner)
      ? { kind: 'draw', winner: null, reason: 'timeout-insufficient' }
      : { kind: 'timeout', winner, reason: 'timeout' };
  }

  // True when `army` has nothing but its king (cannot checkmate by any sequence).
  _insufficientToMate(army) {
    for (const p of this.board.values()) {
      if (p.army === army && p.type !== 'K') return false;
    }
    return true;
  }

  // --- Undo (target-selectable, ADR/spec §9.4) ---

  // Default rewind target for a requester: the position immediately before their
  // most recent move (index into history to keep).
  defaultUndoIndex(requesterArmy) {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].army === requesterArmy) return i;
    }
    return this.history.length;
  }

  // Rewind so that `keep` plies remain. Undone moves are retained in `forward`.
  undoTo(keep) {
    if (keep < 0 || keep >= this.history.length) return;
    const replay = this.history.slice(0, keep).map((r) => ({ from: r.from, to: r.to, promo: r.promo }));
    const undone = this.history.slice(keep);
    this.reset();
    for (const mv of replay) this._apply(mv.from, mv.to, mv.promo);
    this.forward = undone; // kept until the next real move (redo buffer; no v1 UI)
  }

  inCheck(army) { return inCheck(this.pos(), army); }
  checkedArmy() {
    for (const a of ['near', 'far']) if (this.inCheck(a)) return a;
    return null;
  }

  // Serializable snapshot for persistence (spec §10.1).
  serialize() {
    return {
      rules: this.rules,
      moves: this.history.map((r) => ({ from: r.from, to: r.to, promo: r.promo })),
      forward: this.forward.map((r) => ({ from: r.from, to: r.to, promo: r.promo })),
      result: this.result,
      clock: this.clock ? this.clock.serialize() : null,
    };
  }

  static deserialize(data) {
    const g = new Game(data.rules);
    for (const mv of data.moves || []) g._apply(mv.from, mv.to, mv.promo);
    g.forward = data.forward || [];
    if (data.result) g.result = data.result;
    if (data.clock) { // restore the live clock (its base/increment are embedded)
      g.clock = Clock.fromJSON(data.clock);
      g.clockConfig = { base: g.clock.base, increment: g.clock.increment };
    }
    return g;
  }
}
