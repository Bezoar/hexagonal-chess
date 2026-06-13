# Move hints (teaching layer) — design

Status: approved design. Builds on the bot spike
(`docs/superpowers/specs/2026-06-11-bot-opponent-design.md`, PR #40) to turn the
search into a **learning tool**: on demand, suggest the best move for the human
to play and explain — in plain language — *why* it is the best option.

## Goal

Help a solo learner get better at Gliński's hexagonal chess. The same search
that powers the robot opponent suggests a move for the human and gives a
**teaching breakdown**: several honest, concrete reasons drawn from the very
evaluation the search used to choose it. The hint never moves for you — you read
the reasoning and play it yourself.

## Decisions (from brainstorming)

- **Rationale depth:** full teaching breakdown — several named reasons per move,
  not a single tactical one-liner.
- **Trigger:** on-demand. The 🤖 Bot button's gutter slot becomes a 💡 Hint
  button once the game is underway.
- **Eval coherence:** unify. The named-term evaluation *replaces* material-only
  as the search's scoring function, so the rationale cites the very terms that
  made the move win — the explanation can never contradict the choice. The bot
  also plays a little stronger as a side effect.
- **Surface:** board highlight (from/to cells) **plus** a dismissible reasons
  card.
- **Scope:** untimed games only (matches the bot spike's boundary; reading
  reasons never eats a clock).
- **Rationale architecture:** Approach A (principal-variation delta narration)
  as the spine, with a light dash of Approach C (one contrast line vs. a
  tempting-but-refuted alternative).

## Architecture — three pure, DOM-free units (ADR-0003)

### `src/eval.js` (new)

```
evaluateTerms(board, army) → { material, centre }   // named terms, army's POV
score(terms) → number                                // weighted sum used by search
```

- **material** — Σ signed piece values (`P,N,B,R,Q ≈ 1,3,3,5,9`, K excluded),
  positive when `army` is ahead. Unchanged from the spike.
- **centre** — centralisation. Reward each piece by its closeness to the centre
  cell via hex-ring distance `ring = (|x| + |y| + |z|) / 2` (centre = 0, edge =
  5); own pieces add `(5 − ring)·w`, enemy pieces subtract it, for a small weight
  `w` that cannot overturn a real material difference. Teaches *the* core hex
  principle: the three long files cross the centre, so central pieces radiate
  furthest. O(pieces), no attack maps.

`score` is the scalar the search maximises. Keeping the per-node eval cheap is
deliberate: it runs ~1,600× at depth-2, and the spike already fought a
2 s → 75 ms battle. King-safety and mobility as *search* terms are out (they need
per-node attack maps); they appear instead as light hint-time notes (below).

### `src/bot.js` (refactor)

- `chooseMove(pos, army, opts)` — unchanged signature and behaviour; now scores
  via `eval.score`. **All five spike tests must still pass.**
- `analyse(pos, army, opts) → { move, score, pv, runnerUp }` — new. Same
  negamax/alpha-beta, but returns the **principal variation** (`pv`: the best
  line, at minimum the suggested move + the opponent's best reply) and the
  best **runnerUp** root move with its searched score. This is the only search
  change; `chooseMove` becomes a thin wrapper that takes `analyse().move` (with
  the existing random tie-break among equal-best moves preserved for the bot).

The PV is what lets the explanation be honest about two-ply payoffs ("defends,
because otherwise they capture next move") rather than only the immediate ply.

### `src/explain.js` (new) — the teaching brain

```
explain(pos, army, analysis, farWhite) → { moveLabel, lead, reasons[], contrast? }
```

Pure. Turns search facts into **structured** rationale (not baked strings, so the
UI owns presentation and the logic is unit-testable). Uses the engine's
`cubeToSquareOriented(x, y, farWhite)` for human square/piece labels and
`isAttacked(board, key, army)` for tactical facts.

Composition:

1. **lead** — the single dominant reason, by priority:
   `mate > wins material > defends a hanging piece > creates a threat >
   best positional (centralisation)`.
2. **reasons[]** — 0–2 supporting bullets: the next-strongest facts or term
   deltas not already in the lead ("Develops your knight toward the centre",
   "Gives check").
3. **contrast?** — at most one line, present **only** when a tempting greedy
   capture exists whose *searched* score is clearly worse than the suggestion:
   "Taking the pawn on d5 looks good, but it drops your rook to the reply."
   Omitted whenever nothing tempting-but-bad exists, so it never pads.

Expensive facts (captured/net material won from the PV, gives check, a piece that
*was* hanging now safe, a *new* threat on an undefended enemy piece) are computed
**once** here for the suggested line via `isAttacked` — never per search node.

## UI wiring (`index.html`, `src/ui.js`, `styles.css`)

- **Button repurpose.** The 🤖 Bot button already sits in each gutter's
  `.controls` cluster and is enabled only pre-game. Post-first-move the same slot
  becomes **💡 Hint** for **human seats only**, enabled when it is that seat's
  turn, with no pending promotion, the game not over, and the game **untimed**:
  - *Bot game:* near slot → Hint; the far (robot) slot stays inert — you don't
    coach the bot.
  - *Hot-seat human-vs-human:* both slots → Hint, each enabled on its own turn.
  - *Timed game:* the slot stays inert post-start (out of scope).
- **Reveal.** Tapping Hint runs `analyse` + `explain` synchronously (~75 ms),
  then highlights the suggested **from/to** cells (reusing the existing
  move-target highlight CSS) and opens a **reasons card** reusing the
  overlay / `face-near` / `face-far` styling (same family as the bot colour
  dialog). The card shows `lead`, the supporting bullets, the optional
  `contrast`, and a **Got it** button.
- **Dismiss.** Closing the card clears the highlight. The hint never moves —
  the learner plays it themselves. No auto-replay or arrow animation this slice.

## Data flow

```
human's turn (untimed) → tap 💡 Hint
   → analyse(game.pos(), seat) → { move, pv, runnerUp }
   → explain(pos, seat, analysis, farWhite) → { moveLabel, lead, reasons[], contrast? }
   → highlight(move.from, move.to)  +  open reasons card
   → "Got it" → clear highlight; human makes their own move
```

No new persisted state, no clock interaction, no change to `Game.move`.

## Testing (`node --test`)

- **`tests/eval.test.mjs`** — the centre term rewards a central piece over an
  edge piece of the same type; `material` matches the old scalar on sample
  boards; `score(terms)` orders a material-up position above an equal one.
- **`tests/bot.test.mjs`** — the existing five spike tests stay green after the
  eval refactor (regression guard); `analyse` returns a `pv` whose first move
  equals `chooseMove`'s pick under a fixed rng and includes a reply ply.
- **`tests/explain.test.mjs`** (the teaching brain) — crafted positions assert
  structured output:
  - a free capture → `lead` is "wins a knight";
  - a move that shelters a hanging queen → `lead` is "defends your queen";
  - a quiet developing move → `lead` is the centre reason;
  - `contrast` is **present** when a greedy capture is refuted and **absent**
    when no tempting-but-bad capture exists.
  Deterministic via injected rng; kings placed off the centre rays (the spike's
  null-king lesson — a contrived position with a king in check lets a search line
  capture it and crash `kingKey`).

## Scope boundaries (explicitly out)

- **Untimed only.** No Hint while a clock runs.
- **No hint for a bot seat** — you coach yourself, not the robot.
- **King-safety / mobility as search terms deferred** — kept as light hint-time
  notes only, to protect per-node search performance.
- The rationale is **depth-2-bounded and heuristic**: it explains *what the quick
  search sees*, framed honestly on the card, not deep strategy.
- **English-only** strings; no opening-book or named-theory commentary.

## Sequencing

PR #40 (the bot spike) is open, green, and its `bot.js` is exactly what this
feature refactors. Cleanest path: **merge #40 first** (validated and done), then
branch `feat/move-hints` off `main`, so the spike stays a reviewable unit and the
teaching layer is a second focused PR rather than one sprawling diff. Confirm the
merge before any code lands.

## Follow-ups (post-this-slice)

- King-safety and mobility as real (cheap-enough) search terms, with tuning.
- Difficulty/teaching dial: shallower search + simpler reasons for beginners.
- "Explain my last move" / blunder review after a move is played.
- Hint in timed games (with a clock-aware affordance).
- Piece-square tables and pawn-structure terms for richer positional reasons.
