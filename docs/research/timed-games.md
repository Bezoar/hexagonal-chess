# Timed games — design exploration (WIP)

Branch: `feature/timed-games`. Status: **drilling design decisions before implementation.**
This note captures decisions as we lock them; not yet an ADR or spec change.

## Scope (decided)

- **Sudden-death base time + optional Fischer increment** (a fixed bonus added after each completed move).
- Deferred for now: Bronstein/simple delay, multi-period controls, full custom builder.

## Proposed architecture

- Pure **`src/clock.js`**: per-seat remaining ms, increment, start/stop, `tick(now)`, `flagged`.
  DOM-free with `now` injected, so it stays deterministically node-testable (preserves ADR-0003).
- Time tracked as **remaining-ms + a "running-since" timestamp**, elapsed computed against
  wall-clock on demand → correct across iOS tab-backgrounding (no reliance on interval accuracy).
- **`Game` owns the clock**: `serialize`/`deserialize` include it; flag-fall sets
  `game.result` (new kind `timeout`); `match.js` scores `timeout` like `resign` (1–0).
- **`ui.js`** runs the tick driver (rAF/interval) only while a clock is active; renders the
  clocks; handles flag-fall, pause, and `visibilitychange`.

## Decisions

1. **Clock start — pre-game clock-tap.** Clocks are shown but idle; no White yet. A player
   **taps their own clock** to start: that elects them **Black**, makes the opponent **White**,
   and **starts White's clock**; White then makes the first move. Because Black spends its
   handoff as the tap (no time), **White's first move is on the clock** — both sides are timed
   and symmetric (the real chess-clock convention applied to the opening).
   - *Open edge:* in a timed game, what if a player just moves on the board with no clock-start?
     (block until a clock-start, or let the move claim White with an untimed opening?) — TBD.

2. **Turn handoff — a Settings toggle.**
   - *Auto-switch:* completing a move on the board switches the clock automatically.
   - *Press-clock:* after moving, the mover taps their own clock button to end the turn
     (chess-authentic; forgetting keeps your clock running).
   - **Layout:** a large **clock button centered** in each console; the player's **time remaining
     beside it in large (~36pt) text**, facing the board. Dual-facing via the existing gutter
     rotation. The button is the pre-game start (elect Black) and, in press-mode, the per-move
     handoff.

3. **Flag-fall — loss on time, draw if the opponent can never mate.** Adopt the FIDE timeout
   rule: when the running clock hits 0 the flagged side loses (opponent wins on time, result
   `timeout`, scored 1–0), **unless the opponent has insufficient material to checkmate by any
   legal sequence (helpmate allowed)** — then it's a draw (½–½). Auto-declared by the app.
   - Requires an **insufficient-mating-material check**, which is **variant-specific** for
     Gliński's hex chess and not yet in the engine (this is the spec's deferred insufficient-
     material work, pulled in). Reusable later for a dead-position auto-draw.
   - **Insufficient-material set — RESEARCHED (computationally, via the engine's own `status()`):**
     for each candidate material we searched whether *any* checkmate-of-a-lone-king position
     exists (helpmate-existence — the correct test for the timeout rule). Result, unlike
     standard chess: a **single knight or single bishop CAN mate** a bare king with king support
     (mates exist at board corners, e.g. `Ka1` vs `Kc3 + Nb4`, and `Ka1` vs `Kc3 + Bf11`).
     Since any single checking-capable piece (N/B/R/Q; pawns promote) can mate, the **only
     insufficient material is a bare king**. ⇒ Timeout is a draw **iff the non-flagged side has
     no piece other than its king**; otherwise a win on time. Trivial to implement; also defines
     a future dead-position auto-draw (only K-vs-K).

4. **Undo — disabled in timed games.** No takebacks once a time control is set (the Undo
   request/accept flow is unavailable). Mirrors clocked chess and keeps clock state minimal —
   no per-ply time snapshots needed (just remaining-ms per seat + who's running + running-since).

5. **Pause** when the app is backgrounded / device locks **and** while Settings or Help is open;
   the clock keeps running during the mover's own move (including the promotion picker).
   Implemented via `visibilitychange` + overlay open/close, recomputing from the running-since
   timestamp on resume (correct even if the timer was throttled while hidden).

6. **Display.** Large (~36pt) readout per console, facing the board, active side highlighted.
   Format **m:ss**, switching to **s.t (tenths) and red** when under 10 s. Inactive clock dimmed.

7. **Settings — a "Clock" group:** Off + common presets (e.g. 5+0, 3+2, 10+5, 25+10) + a Custom
   builder (base minutes + increment seconds), plus the auto-switch/press-clock handoff toggle.
   A chosen time control applies at the **next new game** (not mid-game), like the rules settings.

8. **Audio.** A single beep when a clock first drops under 10 s (optionally also 30 s), plus a
   distinct flag-fall sound at zero — all gated by the existing Mute/sound setting (`audio.js`).

## Resolved edge — starting a timed game

When a time control is set, the board is **inert until a player taps a clock** to start: that
tapper elects **Black**, the opponent is **White** and moves first (White's clock running). So in
a timed game a board move can't begin the game — the clock-tap start is required, with a prompt
cueing it. Untimed games keep today's behaviour (the first move claims White).

## Implementation plan (phased)

**Phase 1 — engine core (AFK, fully node-testable).**
- `src/clock.js`: pure clock — `{ near, far }` remaining ms, `base`, `increment`, `running` seat,
  `runningSince` timestamp; `start(seat, now)`, `switch(now)` (stop running seat → add increment →
  start the other), `pause(now)`/`resume(now)`, `remaining(seat, now)`, `flagged(now)`. `now` is
  injected, so it's deterministic under `node --test` (preserves ADR-0003).
- `game.js`: own a clock; include it in `serialize`/`deserialize`; add `flag(seat)` → result
  `{ kind:'timeout', winner }`, where winner = opponent **unless** the opponent is a **bare king**
  (`insufficientToMate`) → `draw`. `match.js`: score `timeout` 1–0 (`draw` already handled).
- Tests: `clock.test.mjs` (increment, switch, pause/resume, flag via injected `now`); `game`
  timeout result + bare-king → draw.

**Phase 2 — UI (some HITL for layout).**
- Console: large centred clock **button** + ~36 pt time readout (dual-facing via gutter rotation),
  active highlight, m:ss → tenths+red under 10 s.
- `ui.js`: tick driver (rAF) only while a clock runs; clock-tap start (elect Black → White's clock);
  handoff per the setting (auto on move / press the button); pause on overlay + `visibilitychange`;
  Undo disabled; flag-fall → end card ("wins on time").
- Settings: "Clock" group (Off / presets / custom + handoff toggle), applied at the next new game.

**Phase 3 — polish.** Threshold beep + flag sound (`audio.js`); reduced-motion; restoring a saved
mid-clock game; the start prompt.
