# Bot opponent — feasibility spike design

Status: approved design (spike). Captures the first vertical slice of an
automated opponent for Gliński's hexagonal chess. Deliberately minimal: prove
the end-to-end loop and *feel* how it plays, then decide whether to invest in
real strength.

## Goal

Let a solo player play against the app. This slice is a **feasibility spike**,
not a strong engine — the smallest honest version that plays a full game so we
can judge the idea before committing to depth, tuning, or difficulty levels.

## Why it's feasible

The engine is already DOM-free and pure (ADR-0003) and exposes exactly the
surface a search needs — no engine changes required:

- `Game.pos()` → `{ board, epTarget, epCapture }` — a complete position.
- `allLegalMoves(pos, army)` — full legal move generation (en passant,
  promotion, pins all handled).
- `cloneBoard(board)` + `applyMoveToBoard(board, move, promoType)` — make moves
  on copies.
- `status(pos, army)` — checkmate / stalemate / check for terminal nodes.

The opponent is therefore a **bolt-on module** that takes a position and returns
a move.

## Architecture

### `src/bot.js` (new, pure, DOM-free)

```
chooseMove(pos, army, opts = {}) → { from, to, promo }
```

- **Search:** depth-2 alpha-beta (negamax). On 91 cells with a midgame
  branching factor of ~40, that's ~40² leaf nodes — comfortably under a frame on
  the main thread, and unlike strict 1-ply it won't hang a queen for a pawn.
- **Evaluation:** material only for the spike — sum of piece values
  (`P,N,B,R,Q` ≈ `1,3,3,5,9`; king excluded / large sentinel), from `army`'s
  perspective. A terminal checkmate scores ±∞, stalemate 0 (the eval stays
  neutral on draws; scoring nuance is out of scope for the spike).
- **Variety:** equal-scoring moves are broken with an injectable RNG
  (`opts.rng`, default `Math.random`) so production games differ while tests stay
  deterministic — the same injection discipline the clock uses for `now`
  (ADR-0003).
- **Promotion:** the bot always promotes to Queen (`promo: 'Q'`).
- Reuses the engine's `allLegalMoves` / `cloneBoard` / `applyMoveToBoard`. It
  reconstructs child positions' en-passant state inline (mirroring
  `Game._apply`) so search nodes are correct; this is the one piece of game
  logic the pure rules layer doesn't already hand us.

Note: Gliński scores stalemate ¾/¼ (it is **not** a draw), but the spike's
material-only eval treats a stalemate node as neutral (0). That nuance is left
to the post-spike eval work; it won't matter for casual depth-2 play.

### UI wiring (`src/ui.js`, `index.html`, `styles.css`)

- **Robot button:** an additional `.btn` in each gutter's bottom `.controls`
  cluster — `🤖 Bot`, `data-action="bot"`, `data-seat`. Enabled **only pre-game**
  (before any move / `whiteArmy` unset), using the existing `dis(action, cond)`
  enable/disable pattern; inert once the game is underway. Present in **both**
  gutters for visual symmetry with the dual-facing layout.
- **Color dialog:** tapping `🤖 Bot` opens a small modal — **"Play as White /
  Black"** — reusing the existing overlay styling, oriented to the tapping seat
  (like Settings/Help do via `face-far`).
- **Seat model:** the bot always takes the **far** seat; the human plays
  **near**. No ADR-0002 special-casing:
  - Human picks **White** → they simply move first and auto-claim White (today's
    "first mover claims White" rule, unchanged).
  - Human picks **Black** → we kick the bot to move first; its move auto-claims
    White the same way.

  The only new state is `bot = { enabled: true, seat: 'far' }` plus a transient
  "bot moves first" trigger from the dialog.
- **Move presentation:** after any move, if bot-mode is on and it's now the
  **far** seat's turn and there's no result, schedule `_botMove()` after a short
  deliberate delay (~500 ms). `_botMove()` applies the chosen move through the
  normal `Game.move()` path, so animation, sound, notation, and captured-pieces
  all work for free.
- **Input safety:** board input already restricts selection to the side to move,
  so the human cannot move the bot's pieces during its turn — no new guard.
- **Identity:** the far gutter shows a light **"Robot" / "thinking…"** state in
  place of "Far seat" while bot-mode is active.

## Data flow

```
human moves (near, via board)
        │  Game.move() → _postMove → updateAll
        ▼
toMove === 'far' && bot.enabled && !result ?
        │  yes → setTimeout(~500ms)
        ▼
_botMove(): chooseMove(game.pos(), 'far')  →  Game.move(from,to,'Q')
        │  → _postMove → updateAll  (toMove flips back to near)
        ▼
human's turn again
```

Picking Black just means the very first `_botMove()` runs at game start instead
of after a human move.

## Scope boundaries (explicitly out for the spike)

- **Untimed only.** Bot-vs-clock is deferred — the robot-button start flow and
  the tap-clock-to-start flow would otherwise collide.
- **Single fixed strength**, bot fixed to the far seat, **no difficulty levels.**
- **Main thread.** A Web Worker is only warranted if we later search deeper than
  ~depth-2/3 (where the per-node `cloneBoard` cost would start to bite and we'd
  move to incremental make/unmake).
- No opening book, no transposition table, no positional eval terms.

## Testing

`tests/bot.test.mjs` (`node --test`):

- returns a **legal** move for a normal mid-board position;
- grabs a **free capture** when one exists;
- prefers the **larger** of two available captures;
- does **not** hang material into an immediate recapture (the payoff of depth-2
  over 1-ply);
- handles a **no-legal-moves** position without throwing (returns null / a
  documented sentinel).

## Follow-ups (post-spike, only if the feel justifies it)

- Difficulty levels (search depth + randomness knob).
- Positional eval (piece-square tables, king safety, pawn structure) + tuning.
- Iterative deepening within a time budget; move ordering; transposition table.
- Let the bot take either seat / play timed games; "thinking" affordance polish.
