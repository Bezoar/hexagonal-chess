// clock.js — chess clock for timed games (sudden-death + Fischer increment).
// Pure and DOM-free: every time-dependent operation takes an injected `now` (ms),
// so it is deterministic under `node --test` (ADR-0003). Time is "banked" remaining
// ms per seat plus a running-since timestamp; the live remaining for the running
// seat is `banked - (now - runningSince)`. The clock is advanced by the controller
// (start / switchTurn / pause / resume); it never auto-runs.

import { opponent } from './hex.js';

export class Clock {
  // config: { base, increment } in milliseconds (increment is the Fischer bonus
  // added to a seat when it completes a move).
  constructor({ base, increment = 0 } = {}) {
    this.base = base;
    this.increment = increment;
    this.times = { near: base, far: base }; // banked remaining ms
    this.running = null; // 'near' | 'far' | null (no clock ticking)
    this.runningSince = null; // ms timestamp while ticking; null when paused/stopped
  }

  // Live remaining ms for `seat` as of `now` (clamped at 0).
  remaining(seat, now) {
    const banked = this.times[seat];
    if (seat === this.running && this.runningSince != null) {
      return Math.max(0, banked - (now - this.runningSince));
    }
    return banked;
  }

  // The running seat if its clock has hit zero, else null.
  flagged(now) {
    if (this.running == null || this.runningSince == null) return null;
    return this.remaining(this.running, now) <= 0 ? this.running : null;
  }

  // Begin ticking `seat` from `now` (used for the pre-game start).
  start(seat, now) {
    this.running = seat;
    this.runningSince = now;
  }

  // The running seat completed a move: bank its time, add its increment (unless it
  // has already flagged), then hand the clock to the opponent.
  switchTurn(now) {
    if (this.running == null) return;
    this._bank(now);
    if (this.times[this.running] > 0) this.times[this.running] += this.increment;
    this.running = opponent(this.running);
    this.runningSince = now;
  }

  // Freeze the running clock (banking its live time) — for overlays / backgrounding.
  pause(now) {
    if (this.running != null && this.runningSince != null) {
      this._bank(now);
      this.runningSince = null;
    }
  }

  // Resume a paused clock without losing any banked time.
  resume(now) {
    if (this.running != null && this.runningSince == null) {
      this.runningSince = now;
    }
  }

  _bank(now) {
    this.times[this.running] = this.remaining(this.running, now);
  }

  serialize() {
    return {
      base: this.base,
      increment: this.increment,
      times: { ...this.times },
      running: this.running,
      runningSince: this.runningSince,
    };
  }

  static fromJSON(d) {
    const c = new Clock({ base: d.base, increment: d.increment });
    c.times = { near: d.times.near, far: d.times.far };
    c.running = d.running;
    c.runningSince = d.runningSince;
    return c;
  }
}
