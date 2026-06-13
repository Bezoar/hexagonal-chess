// explain.js — the teaching brain. Pure and DOM-free (ADR-0003). Turns a search
// result from bot.analyse() into a structured, human-readable rationale:
//   { moveLabel, lead, reasons[], contrast }
// "Lead" is the single dominant reason; "reasons" are up to two supporting
// points; "contrast" warns about a tempting-but-refuted alternative when one
// exists. The UI owns presentation — this layer only produces strings + data.
import { applyMoveToBoard, cloneBoard, allLegalMoves, inCheck, isAttacked } from './rules.js';
import { opponent, parseKey, cubeToSquareOriented } from './hex.js';
import { VALUE, evaluateTerms } from './eval.js';

const NAME = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };

// A piece on `k` is "hanging" for `side`: attacked by the enemy and undefended.
const hanging = (board, side, k) =>
  isAttacked(board, k, opponent(side)) && !isAttacked(board, k, side);

// Keys+types of `side`'s hanging non-king pieces on `board`. Callers match the
// resulting savedType/threatType by piece TYPE, so the signal is loose when two
// pieces share a type (e.g. one rook saved while another stays hung) — accepted
// imprecision for a teaching hint, never a wrong sign.
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
  if (!analysis || !analysis.pv || !analysis.pv.length) throw new Error('explain: analysis must have a non-empty pv');
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

  // Only a non-capturing move can honestly "develop toward the centre": a capture
  // also raises the net centre term just by removing the enemy piece. (captureKey
  // is set for en passant too, so those are covered.)
  const centreUp = !move.captureKey && evaluateTerms(afterMove, army).centre > evaluateTerms(pos.board, army).centre;

  // --- lead (the single dominant reason) ---------------------------------
  let lead;
  let used = '';
  if (isMate) { lead = 'Checkmate — this ends the game.'; used = 'mate'; }
  else if (move.isPromotion) { lead = 'Promotes a pawn to a queen.'; used = 'promo'; }
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
    if (victimType) {
      const reply = t.pv[1] ? label(t.pv[1]) : null;
      contrast = `Grabbing the ${NAME[victimType]} on ${sq(t.move.to)} is tempting, but `
        + (reply ? `${reply} ` : 'the reply ') + 'refutes it.';
    }
  }

  return { moveLabel: label(move), lead, reasons, contrast };
}
