# Gliński's Hexagonal Chess — Primary Spec

A single-page, static web app implementing **Gliński's hexagonal chess** for **two
players sharing one iPad laid flat on a table** (hotseat — no network or AI in v1).
Its defining feature is a **dual-facing** presentation so both players read the game
from their own side without the board ever flipping.

> Terminology in this spec is governed by [`CONTEXT.md`](../../CONTEXT.md). Decisions
> that are hard to reverse and surprising are recorded as ADRs in [`docs/adr/`](../adr/).
> UI mockups referenced below live in [`mockups/`](../../mockups/) and are illustrative
> (the visual language is locked; exact pixel values are not).

---

## 1. Goals & non-goals

**Goals (v1)**
- Faithful, fully legal Gliński hex-chess engine (check/checkmate/stalemate, en
  passant, promotion).
- Dual-facing tabletop presentation; **board rendered once, never flips** during
  two-player play (see [ADR-0001](../adr/0001-dual-facing-board-never-flips.md)).
- Hotseat match play with a running, seat-anchored scoreboard.
- Consent-based Draw and a teaching-grade, target-selectable Undo; Resign; solo
  Flip-view.
- Persisted Settings, scoreboard, **and** in-progress game (resume on reload).
- Professional, easy-on-the-eyes **dark** theme (light theme available); smooth,
  tactile feel; subtle sound.
- Static site, **no build step**, hostable by opening `index.html` or on GitHub
  Pages (see [ADR-0003](../adr/0003-static-no-build-dom-free-engine.md)).

**Non-goals (deferred)**
- AI opponent, online/network play, clocks/timers (the design leaves room for
  timers later — see §11), multi-slot saved games, other hex variants
  (McCooey/Shafran), accounts.

---

## 2. Platform & delivery

- **Target:** iPad Safari, touch input, flat on a table. **Both landscape and
  portrait** are supported (§12.4).
- **Delivery:** static files; works by opening `index.html`; also GitHub-Pages
  hostable. No bundler, no transpile, no server. ES modules loaded directly.
- **Persistence:** browser local storage only (no backend).

---

## 3. The dual-facing presentation (headline feature)

The board is drawn **once and stays fixed**. Orientation is applied per element:

- **Pieces** are oriented to the army's **seat** (the physical side of the iPad it
  belongs to): the near-edge army reads upright for the near player; the far-edge
  army is rotated 180° so it reads upright for the far player. Because the start
  position is a 180° rotational mirror, *each army already begins on its own
  player's edge* — so this is ergonomic for both at once and is exactly why the
  board need never flip.
- **Status/score** appear in **two seat banners/gutters** — the near one upright,
  the far one rotated 180° — so each player reads their own turn/check/result
  right-side-up simultaneously.
- **Cells, highlights, last-move trail, and check markers are seat-agnostic**
  (drawn on the shared board) and therefore correct for both players with no
  duplication.

A 2-D glyph cannot read upright from both sides at once, so the deliberate choice
is "**your own pieces always read upright to you**; the opponent's army appears
rotated." See [ADR-0001](../adr/0001-dual-facing-board-never-flips.md).

For **solo practice**, a **Flip view** control rotates the *entire* presentation
180° (animated, view-only — never changes game state). See §9.5.

---

## 4. Board geometry & coordinates

- A **regular hexagon, side 6, 91 cells**, oriented **point-up** with **vertical
  files** (flat-top cells — every cell has a neighbor directly above and below).
- **11 files** lettered `a b c d e f g h i k l` — **`j` is skipped**. File heights:
  `a6 b7 c8 d9 e10 f11 g10 h9 i8 k7 l6`. Ranks 1..N per file, **rank 1 at the
  near/White-home end**. `6×11 + (9+7+5+3+1) = 91`.
- **Three cell colors** (light / mid / dark); no two edge-adjacent cells share a
  color; center `f6` is mid-tone.

### 4.1 Cube coordinates (verified — use directly)

Use cube coordinates `(x,y,z)` with `x+y+z=0`:

```
BOARD = { (x,y,z) : x+y+z=0, |x|≤5, |y|≤5, |z|≤5 }   // 91 cells, f6 = (0,0,0)
```

**File ⇆ x:** `a=-5, b=-4, c=-3, d=-2, e=-1, f=0, g=1, h=2, i=3, k=4, l=5` (no `j`).

**(file, rank) → cube**
```
x = fileIndex(file)
y = rank - 6 - min(0, x)
z = -x - y
```
**cube → (file, rank)**
```
file = fileLetter(x)
rank = y + 6 + min(0, x)
```
(Verified: f6→(0,0,0); white pawns b1..k1 reproduce the chevron; e4+NE=f5 matching
the Wikipedia pawn-capture example; black king g10=(1,4,-5).)

**Cell color (3 classes):** `color = ((x - y) % 3 + 3) % 3`. Orthogonal steps change
it; diagonal steps preserve it (the bishop color-lock).

### 4.2 Pixel layout (flat-top)

```
px = SIZE * 1.5 * x
py = -SIZE * √3 * (y + x/2)      // negated so White/near is at the bottom edge
```
Hex cell polygon: vertices at angles `0°,60°,…,300°` (flat top/bottom, points
left/right). The viewBox is the min/max of cell centers padded by ~1.15·SIZE.

---

## 5. Pieces, armies & starting position

Each **army** has **18 pieces**: 1 K, 1 Q, 2 R, 2 N, **3 B**, **9 P** (orthodox army
plus a third bishop and a ninth pawn). The three bishops stack on the central file
and are color-locked (one per cell-color); they never defend each other.

| | Near-home army | Far-home army |
|---|---|---|
| King | g1 | g10 |
| Queen | e1 | e10 |
| Rooks | c1, i1 | c8, i8 |
| Knights | d1, h1 | d9, h9 |
| Bishops | f1, f2, f3 | f9, f10, f11 |
| Pawns | b1, c2, d3, e4, f5, g4, h3, i2, k1 | b7, c7, d7, e7, f7, g7, h7, i7, k7 |

The near army's pawns form a forward chevron (apex f5); the far army's nine pawns
fill rank 7. The armies are 180° rotational mirrors.

### 5.1 Color & the White role (first mover claims White)

Piece **art color is decided at the first move**, not fixed to a seat. See
[ADR-0002](../adr/0002-first-mover-white-seat-anchored-score.md):

- In the **opening position, both armies render White (light)**.
- The **first seat to make a legal move claims the White role** (and the first-move
  advantage); at that instant the **other army recolors to Black (dark)**.
- "White"/"Black" is therefore a **per-game role**, decided fresh each game. Turn
  order, notation, and scoring use the role. Piece *orientation* and *home edge*
  remain fixed by seat regardless of role.
- Before the first move, **either** side's pieces are selectable; after it, only the
  side-to-move's pieces are selectable.

Piece art is a **pluggable interface**: v1 ships a clean, open-licensed silhouette
set (e.g. Cburnett, CC-BY-SA) with the Black army rotated 180° per the dual-facing
rule; the interface allows swapping in bespoke/directional art later without
touching engine or layout code. (Final art is SVG; mockups use Unicode glyphs as
placeholders.)

---

## 6. Movement rules

Identical to orthodox chess **except** as noted. Verified against Wikipedia
"Hexagonal chess", Gliński section.

- **Rook** — any distance through cell **edges** (orthogonal): 6 directions.
- **Bishop** — any distance through cell **vertices** (diagonal): 6 directions;
  color-locked.
- **Queen** — rook + bishop (all 12 directions).
- **King** — one cell, orthogonal or diagonal. **No castling.**
- **Knight** — two cells orthogonally then one orthogonally at a 60° turn; **jumps**.
  = any nearest cell not on an orthogonal or diagonal line through its square →
  **12 destinations**.
- **Pawn:**
  - Moves **one vacant cell straight forward up its file** (White toward the far
    border, Black toward the near border).
  - **Double-step** two vacant cells forward if it stands on **any of its own color's
    nine starting cells** (not only its origin) — a pawn that captured sideways onto
    another start-file regains the double-step.
  - **Captures one cell diagonally forward** — the two *orthogonal* edges 60° off
    vertical (forward-left / forward-right). Never captures straight ahead.
  - **En passant:** yes (e.g. Black `c7→c5`, then White `b5` plays `b5xc6`, landing on
    the skipped cell).
  - **Promotion** on reaching the **far end of any file** (the 11 border cells of the
    opposite side). Promote to **Q, R, B, or N** (full underpromotion) via a
    dual-facing picker oriented to the promoting seat. Promoting to a bishop yields
    one locked to the promotion cell's color.

### 6.1 Engine vectors (verified)

```
6 orthogonal (edge) units:
N=(0,+1,-1)  S=(0,-1,+1)  NE=(+1,0,-1)  SW=(-1,0,+1)  NW=(-1,+1,0)  SE=(+1,-1,0)
  White pawn forward = N ; captures = NW, NE
  Black pawn forward = S ; captures = SW, SE

6 diagonal (vertex) vectors (bishop/queen):
(1,1,-2) (-1,2,-1) (-2,1,1) (-1,-1,2) (1,-2,1) (2,-1,-1)

12 knight vectors (signed perms of {1,2,3} summing to 0):
( 3,-2,-1) (-3, 2, 1) ( 3,-1,-2) (-3, 1, 2)
(-2, 3,-1) ( 2,-3, 1) (-1, 3,-2) ( 1,-3, 2)
(-2,-1, 3) ( 2, 1,-3) (-1,-2, 3) ( 1, 2,-3)
```

**Move generation:** sliders step the relevant unit vectors until off-board or
blocked (capture if an enemy occupies the blocking cell). King/knight take single
steps of their vectors, keeping on-board cells. Pawns as specified. Legality: a
pseudo-legal move must not leave one's own king attacked. Check = king's cell is
attacked; checkmate = in check with no legal move; stalemate = not in check with no
legal move.

---

## 7. Game end, draws & scoring

- **Checkmate / Resign:** the mated/resigning side loses; opponent scores **1**.
- **Stalemate (Gliński):** *not* a draw by default. The stalemating side scores
  **¾**, the stalemated side **¼**. A Settings option **"treat stalemate as draw"**
  switches to ½–½. (See §8 scoring.)
- **Draws:** ½ each. Available draw conditions (each a Settings toggle):
  - **Threefold repetition** — auto-draw when the same position (placement +
    side-to-move + en-passant state; no castling here) occurs three times. Requires
    position hashing in game state.
  - **50-move rule** — auto-draw after 50 moves by each side with no capture and no
    pawn move (counter in game state).
  - **Request/Accept Draw** — consent-based (§9.3).
  - **Insufficient material is deferred from v1.** Dead positions use Request Draw.

---

## 8. Match & scoreboard

A **match** is a sequence of games in one session between the same two seats.

- **Scoring values:** win = 1, loss = 0, draw = ½ each, Gliński stalemate = ¾ / ¼
  (or ½–½ if "stalemate = draw" is enabled).
- **The score is anchored to the seat** (the physical side of the iPad), never to a
  color. Each seat's gutter shows that seat's cumulative total; the totals never
  move. The "White"/"Black" word above a score is that seat's **role this game** and
  can flip between games (§5.1). A game's result accrues to the seat that held the
  winning/relevant role. See
  [ADR-0002](../adr/0002-first-mover-white-seat-anchored-score.md).
- **New Game** resets the board to the opening (both armies White; first mover
  claims White) and continues the match. **New Match** clears the scoreboard and
  starts a fresh game. At game over both appear as **centered, dual-labeled
  buttons** facing each seat (mockup: `mockups/game-over.png`).

---

## 9. Features & controls

All seat controls live in that seat's gutter/bar and are dual-facing (the far set
is rotated 180°). The board is the priority; controls must not crowd it.

### 9.1 Turn & status
Each seat banner shows turn ("Your move" / "Waiting"), state (to-play / Check /
Checkmate / Stalemate / result), and the last move in notation. The on-move seat's
banner is accented (turn indicator).

### 9.2 Resign
Always available; ends the game as a loss for the resigner.

### 9.3 Request / Accept Draw
A **toggleable feature**. The player on the move offers a draw; the game ends drawn
only if the opponent accepts (dual-facing Accept/Decline prompt in the opponent's
gutter). Hidden when the feature is off.

### 9.4 Request / Accept Undo (target-selectable)
A **toggleable feature**; a consent-based takeback with a **selectable target**:

- The requester taps **Undo**; the **move-history panel** opens and acts as the
  target picker (mockup: `mockups/undo-picker.png`).
- The requester selects **any earlier position** (default = their own most recent
  move; selectable back through the opponent's moves to the game start). The board
  **previews** the chosen position.
- On the opponent's **Accept**, the board rewinds there and play continues from that
  position. The moves after the target are **retained internally until the next move
  is made** (so a future *redo* UX is possible), then discarded. **v1 ships no redo
  UI.** No "for teaching" copy is shown in-app.

### 9.5 Flip view (solo)
A **view-only** button (always available, one per seat's control batch) that rotates
the **entire presentation 180°** with a smooth animation, so one person playing both
armies can face the other side without turning the iPad. It never changes game
state, turn, or roles.

### 9.6 Mute
A quick **Mute** toggle in each seat's control batch (thin, distinct), separate from
the Settings sound preference. Sound is on by default (§12.5).

### 9.7 Settings
Opens the persisted Settings dialog (§10), oriented to whichever seat opened it.

### 9.8 Review (game over)
At game over, a **Review/History** affordance lets either player step back and forth
through the finished game **read-only** (does not alter state — distinct from the
state-changing Undo). The final position stays explorable behind the result card.

---

## 10. Settings (persisted) & persistence model

**Settings** is the dialog of persisted, reusable preferences and game options
(mockup: `mockups/settings.png`). Contents:

- **Rules:** stalemate scoring (Gliński ¾–¼ | Draw); threefold repetition (on/off);
  50-move rule (on/off).
- **Requests:** Request/Accept Draw (on/off); Request/Accept Undo (on/off).
- **Display & Sound:** theme (Dark default | Light); coordinate labels (on/off);
  sound (on/off).

**Footer / commit model:** the dialog uses explicit commit, **not** auto-save.
Edits are staged while the dialog is open and applied only on **Save** (persisted
and reflected in the live game); **Cancel** discards staged edits and closes
without changing anything; **Reset to default** restores all options to their
defaults (still staged — the user must Save to keep them, or Cancel to abandon).
Saved settings are reused across sessions.

### 10.1 Persistence (local storage)
Three independently-persisted stores, restored on load:

1. **Settings** — preferences above.
2. **Match scoreboard** — per-seat cumulative totals + game count.
3. **Live game state** — the full serializable game: piece placement, full move
   history, side to move, White/Black assignment, en-passant target, pending
   promotion, draw counters / repetition hashes, and the retained-forward-moves
   buffer. Auto-saved every move; on load the app resumes exactly where it left off
   (important when an iPad sleeps mid-game).

This supersedes the old "defer saved games" note for the *current* game; multi-slot
*named* saved games remain deferred.

---

## 11. Interaction model (touch)

Goal: a smooth, tactile feel (mockup: `mockups/layout-v3.png`).

- **Selection feedback is immediate but eased.** On **touch-down** on a selectable
  piece, the legal-destination decorations **fade in from 0 s and gently pulsate**
  (no long-press timer — an instant-but-faded reveal avoids both lag and
  distraction, and leaves room for future timed games).
- **Unified drag-or-tap completion:**
  - Finger moves past a small threshold → **drag**; the piece follows; release on a
    legal hex completes the move (release elsewhere snaps back, keeps it selected).
  - Finger lifts without moving → **tap-select**; destinations stay lit; **tap** a
    legal hex to complete.
  - Tapping another own piece reselects; tapping empty/illegal deselects.
- **Highlight style:** each legal target gets a **thick inset hex-border** in its
  cell — **blue = quiet move, red = capture** (the inset frames an occupied hex so
  the enemy piece stays visible). **Color is backed by shape** for colorblind safety
  (a filled inner dot for a quiet move vs a ring/frame for a capture), so meaning
  never relies on hue alone.
- **Selection** shows an amber inset outline + faint amber fill on the source cell.
- **Promotion** uses a dual-facing Q/R/B/N picker oriented to the promoting seat
  (mockup: `mockups/promotion.png`).
- **Turn enforcement:** only the side-to-move's pieces are selectable (both sides
  before the first move; §5.1).

---

## 12. Visual design language

Locked direction: a **refined, low-glare "analog-luxury" dark theme** — premium and
easy on the eyes for long sessions. Default **dark**; a **Light** theme is available
in Settings. Mockups: `mockups/layout-v3.png` (play), `mockups/game-over.png`,
`mockups/settings.png`, `mockups/undo-picker.png`, `mockups/promotion.png`,
`mockups/portrait-hires.png`, `mockups/opening.png`.

### 12.1 Palette (dark theme)
- Background: deep warm charcoal with a subtle top vignette (`#121319`→`#0d0e13`).
- Three hex tones (muted slate, low glare, clearly distinct): `#333b47`, `#465264`,
  `#5b6a80`.
- Single accent: **brass/amber** (`#d9a441`, soft `#e7c074`) — selection, branding,
  active seat, primary buttons.
- Move = blue `#5fa8e0`; capture = red `#e0685f`; last-move trail = amber at low
  alpha.
- Pieces: White = cream `#f1e8d6` (dark edge); Black = `#23262f` (light edge).
- Ink: `#ece7dd` / dim `#9aa3b0` / faint `#6c7382`.

### 12.2 Typography
- Display (scoreboard numerals, state, titles): **Fraunces** (characterful serif).
- Body/controls/notation: **Hanken Grotesk**.
- Explicitly avoid generic system fonts (Inter/Roboto/Arial) and the
  purple-on-white cliché.

### 12.3 Landscape layout — dual-facing **side gutters**
The point-up hexagon is height-constrained in landscape, so the left/right space is
essentially free. A compact dual-facing **gutter** per seat holds: seat role label,
seat-anchored **scoreboard** (large numeral), turn/status banner, legal-move legend,
and the control batch (Undo, Draw, Settings, Resign, Flip, Mute — feature-gated
items hidden when off). The far gutter is rotated 180°. Board fills the center,
maximized.

### 12.4 Portrait layout — top/bottom **bars**
Gutters reflow to horizontal bars (far seat on top, rotated; near seat on bottom),
each carrying seat + score + status + a labeled control row. Board re-fits to the
width-constrained dimension and stays large (mockup: `mockups/portrait-hires.png`).

### 12.5 Motion & sound
- **Animation:** pieces glide source→destination (~150–200 ms ease), captured piece
  fades out, knight "hops"; a persistent subtle **last-move trail** marks the
  from/to cells. Respect `prefers-reduced-motion` to disable. Flip view animates the
  180° rotation.
- **Sound:** subtle move/capture/check cues, **on by default**, with the per-seat
  **Mute** and the Settings sound toggle (both persisted). iOS Safari requires a
  user gesture before audio plays — the first tap unlocks it.

### 12.6 Optional displays
- **Coordinate labels** along the board edge — Settings toggle, off by default,
  low-contrast, seat-neutral.
- **Check indicator** — the in-check king's cell is framed/pulsed red, plus a
  "Check" word in the on-move banner (core feedback, always on).
- **Material advantage** — a compact **"+N" badge** by the leading seat, **expandable**
  on tap into the full captured-piece list (space-economical; no permanent tray).
- **Turn accent** — the on-move seat's banner is subtly emphasized.

---

## 13. UI states (reference mockups)

| State | File |
|---|---|
| Play (landscape, selection + highlights) | `mockups/layout-v3.png` |
| Pre-first-move opening (both armies White) | `mockups/opening.png` |
| Promotion picker | `mockups/promotion.png` |
| Undo / move-history picker | `mockups/undo-picker.png` |
| Game over (centered New Game / New Match) | `mockups/game-over.png` |
| Settings dialog | `mockups/settings.png` |
| Portrait reflow (2×) | `mockups/portrait-hires.png` |

---

## 14. Architecture

Static site, no build step ([ADR-0003](../adr/0003-static-no-build-dom-free-engine.md)).
The **engine is DOM-free** and import-able in Node for testing.

```
index.html            # board + two seat gutters/bars; loads ES modules
styles.css            # theme tokens, hex sizing, dual-facing/flip rotations, touch targets
src/
  hex.js              # cube math: board set, file/rank<->cube, neighbors, color, pixel layout
  rules.js            # move generation, attacks, check/mate/stalemate, en passant, promotion
  game.js             # game state, move application, history, undo/redo buffer, notation
  match.js            # match/scoreboard, White-role assignment, scoring
  render.js           # SVG board; pieces oriented per seat; highlights/last-move/check; flip
  ui.js               # touch (drag-or-tap), promotion picker, undo picker, dialogs
  pieces.js           # PLUGGABLE piece-art interface (default: rotated standard SVG set)
  storage.js          # local-storage persistence: settings, scoreboard, live game
  audio.js            # unlock-on-gesture move/capture/check cues
tests/
  *.test.mjs          # Node built-in test runner; see §15
```

- **Pluggable piece art** (`pieces.js`) so art can be swapped without touching engine
  or layout.
- **Notation grammar** (long algebraic, captured-piece letter retained — the
  handoff/"doc style"):
  `<piece><from>[x<captured>]<to>[=<promo>][+|#]`. Pawns omit the leading piece
  letter; `P` is used where a piece letter is required (e.g. a captured pawn). En
  passant tagged `e.p.`. Examples: `Qe1c3`, `b1b2`, `Bd3xPb6`, `b5xPc6 e.p.`,
  `f10f11=Q`, `Qc3xBf9#`.

---

## 15. Testing & engine self-tests

Node's built-in test runner over `.mjs` files importing the DOM-free engine modules
directly (no framework, no build). Minimum suite:

- **Fool's mate (from source):** `1.Qe1c3 Qe10c6 2.b1b2 b7b6 3.Bf3b1 e7e6? 4.Qc3xBf9#`
  — assert Black is in **checkmate** after move 4.
- **Start-position legal-move counts** (perft-style sanity at depth 1, both before
  and after the first move assigns roles).
- **En passant**: the `b5xc6 e.p.` example generates and applies correctly.
- **Promotion**: a pawn reaching a file's far end offers Q/R/B/N; **knight
  underpromotion** is generated and, where applicable, can give check.
- **Draws**: threefold repetition and 50-move counters trigger correctly; stalemate
  is detected and scored ¾/¼ (and ½–½ under the toggle).
- **Coordinate round-trips**: `(file,rank) ↔ cube` for all 91 cells; color classes;
  the documented anchors (f6, white chevron, e4+NE=f5, g10).

---

## 16. Accessibility & performance

- **Color independence:** legal-move meaning is conveyed by **shape as well as
  color** (dot vs ring/frame), not hue alone.
- **Reduced motion:** honor `prefers-reduced-motion` (disable glides/flip
  animation).
- **Touch targets:** large hexes and comfortably-sized controls; the board is
  maximized partly to keep cell tap targets big across the wide hex span.
- **Performance:** target 60 fps; animate with CSS transforms/opacity on SVG;
  pulsation via opacity. Engine generation must be instant for a 91-cell board.
- **Screen-reader scope:** v1 best-effort labels on controls and the status banner;
  full board screen-reader play is out of scope for v1.

---

## 17. v1 scope summary

**In:** full legal-move enforcement; check/checkmate/stalemate with Gliński ¾/¼
scoring + draw toggle; threefold & 50-move draws; Request/Accept Draw; target-
selectable Request/Accept Undo; Resign; Flip view; dual-facing render (landscape
gutters + portrait bars); first-mover-claims-White with seat-anchored match
scoreboard; promotion (Q/R/B/N); animation + last-move trail; sound + mute;
persisted Settings, scoreboard, and live game; coordinate-label toggle; compact
material badge; Review at game over; dark + light themes.

**Deferred:** AI; online play; clocks; insufficient-material auto-draw; redo UI;
multi-slot named saved games; other hex variants; bespoke/directional piece art;
full screen-reader board play.

---

## 18. License note

A from-scratch engine and open-licensed piece art (e.g. Cburnett, CC-BY-SA, with
attribution) carry no unusual constraints. Unicode chess glyphs are unencumbered.
Keep the piece-art interface pluggable so licensing of any future art set stays
isolated.
