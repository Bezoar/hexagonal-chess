// match.js — match scoreboard, anchored to the SEAT/army, not to a color (ADR-0002).
// Scoring: win = 1, loss = 0, draw = ½ each, Gliński stalemate = ¾ to the
// stalemating side / ¼ to the stalemated side.

import { opponent } from './hex.js';

// Pure: points earned this game, keyed by army. `result` is Game.result.
export function gameScore(result) {
  const z = { near: 0, far: 0 };
  if (!result) return z;
  switch (result.kind) {
    case 'checkmate':
    case 'resign':
      return { ...z, [result.winner]: 1, [opponent(result.winner)]: 0 };
    case 'stalemate': // result.winner is the stalemating side
      return { ...z, [result.winner]: 0.75, [opponent(result.winner)]: 0.25 };
    case 'draw':
      return { near: 0.5, far: 0.5 };
    default:
      return z;
  }
}

export class Match {
  constructor(state = {}) {
    this.near = state.near || 0;
    this.far = state.far || 0;
    this.games = state.games || 0;
  }

  record(result) {
    const s = gameScore(result);
    this.near += s.near;
    this.far += s.far;
    this.games += 1;
    return s;
  }

  reset() { this.near = 0; this.far = 0; this.games = 0; }

  serialize() { return { near: this.near, far: this.far, games: this.games }; }
}

// Render a score as a tidy string with a unicode fraction (½ ¼ ¾).
export function formatScore(n) {
  const whole = Math.floor(n);
  const frac = n - whole;
  const f = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : '';
  if (f) return (whole ? String(whole) : '') + f;
  return String(whole);
}
