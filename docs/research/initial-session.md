# Gliński's Hexagonal Chess — Tabletop iPad Web App

**Handoff spec.** Drop this file at the root of `Bezoar/hexagonal-chess`, then start a
Claude Code session scoped to that repo and say: *"Implement the app described in SPEC.md."*
Everything needed is below — verified rules, coordinate math, and architecture. No video or
external lookups required.

---

## 1. Product

A single-page web app implementing **Gliński's hexagonal chess** for **two players sharing one
iPad laid flat on a table** (hotseat — no network/AI in v1).

**Decided requirements:**
- **Target:** iPad Safari, landscape, touch input. Must work by opening `index.html` (also
  hostable on GitHub Pages — keep it a static site, no build step required).
- **Static dual-facing display** (the headline feature): the board is rendered **once and stays
  fixed**. Each army's pieces face their own player (White's pieces upright for the player at the
  near edge; Black's pieces rotated 180° so they read upright from the far edge). **Text feedback
  is bidirectional**: status/turn/check/last-move readouts appear in *two* banners — the bottom
  banner upright, the top banner rotated 180° — so each player reads their own side right-side-up
  simultaneously. Move highlights, check indicators, and last-move markers are seat-agnostic
  (drawn on the shared board) and therefore correct for both.

---

## 2. The board

- A **regular hexagon, side 6, 91 cells**, oriented point-up with **vertical files** (flat-top
  hexes — every cell has a neighbor directly above and below).
- **Three cell colors** (light / mid / dark); no two edge-adjacent cells share a color. Center
  cell `f6` is mid-tone.
- **11 files** lettered `a b c d e f g h i k l` — **`j` is skipped**.
- File heights (cells per file): `a6 b7 c8 d9 e10 f11 g10 h9 i8 k7 l6`. Ranks are numbered 1..11
  per file (rank 1 at White's/bottom end). 6×11 + 9+7+5+3+1 = **91**.

---

## 3. Pieces & starting position (18 per side)

Standard army **plus one extra bishop and one extra pawn**: 1 K, 1 Q, 2 R, 2 N, **3 B**, **9 P**.

Each White back-piece sits at the **bottom** end of its file; each Black back-piece at the **top**
end; the three bishops stack on the central file.

| | White | Black |
|---|---|---|
| King | g1 | g10 |
| Queen | e1 | e10 |
| Rooks | c1, i1 | c8, i8 |
| Knights | d1, h1 | d9, h9 |
| Bishops | f1, f2, f3 | f9, f10, f11 |
| Pawns | b1, c2, d3, e4, f5, g4, h3, i2, k1 | b7, c7, d7, e7, f7, g7, h7, i7, k7 |

White's pawns form a forward chevron (apex f5); Black's nine pawns fill rank 7. The armies are
180° rotational mirrors.

---

## 4. Rules (verified against Wikipedia "Hexagonal chess", Gliński section)

Identical to orthodox chess **except**:

- **Rook** — any distance through cell **edges** (orthogonal): 6 directions.
- **Bishop** — any distance through cell **vertices** (diagonal): 6 directions. Each diagonal step
  preserves cell color, so a bishop is locked to one color all game; the three bishops never defend
  each other.
- **Queen** — rook + bishop (all 12 directions).
- **King** — one cell, orthogonal or diagonal. **No castling.**
- **Knight** — two cells orthogonally, then one cell orthogonally at a 60° turn; **jumps**. = any
  nearest cell not on an orthogonal or diagonal line through its square → **12 destinations**.
- **Pawn:**
  - Moves **one vacant cell straight forward up its file** (White toward rank 11, Black toward
    rank 1).
  - **Double-step** two vacant cells forward if it stands on **any of its own color's nine starting
    cells** (not just its own) — so a pawn that captured sideways onto another start-file regains
    the double-step.
  - **Captures one cell diagonally forward** — the two *orthogonal* edges 60° off vertical
    (forward-left / forward-right). Never captures straight ahead.
  - **En passant:** yes. Source example: Black `c7→c5`, then White `b5` plays `bxc6` (lands on the
    skipped cell).
  - **Promotion** on reaching the **far end of any file** (the 11 cells of the opposite border).
    White: `a6 b7 c8 d9 e10 f11 g10 h9 i8 k7 l6`. Black: `a1 b1 c1 d1 e1 f1 g1 h1 i1 k1 l1`.
- **Check / checkmate:** standard.
- **Stalemate is NOT a draw:** scored between draw and win — stalemate*r* gets ¾ point, stalemated
  player ¼ point. (Implement as the default; offer a "treat stalemate as draw" toggle.)
- **Notation:** algebraic `<piece><from><to>` with `x` for captures (`Qe1c3`, `Qc3xBf9#`).

---

## 5. Engine math (verified — use directly)

Use **cube coordinates** `(x, y, z)` with `x + y + z = 0`. The board is exactly:

```
BOARD = { (x,y,z) : x+y+z = 0, |x|≤5, |y|≤5, |z|≤5 }   // 91 cells, f6 = (0,0,0)
```

**File ⇆ x:** `a=-5, b=-4, c=-3, d=-2, e=-1, f=0, g=1, h=2, i=3, k=4, l=5` (no `j`).

**(file, rank) → cube:**
```
x = fileIndex(file)
y = rank - 6 - min(0, x)
z = -x - y
```
**cube → (file, rank):**
```
file = fileLetter(x)
rank = y + 6 + min(0, x)
```
(Verified: f6→(0,0,0); white pawns b1..k1 reproduce the chevron; e4 + NE = f5 matching the
Wikipedia pawn-capture example; black king g10 = (1,4,-5).)

**Cell color** (3 classes): `color = ((x - y) % 3 + 3) % 3`. Orthogonal steps change it; diagonal
steps preserve it (bishop color-lock).

**6 orthogonal (edge) unit vectors** — rook/queen/king slide, knight build, pawn step/capture:
```
N  = ( 0, +1, -1)   // up a file   = White pawn forward
S  = ( 0, -1, +1)   // down a file = Black pawn forward
NE = (+1,  0, -1)
SW = (-1,  0, +1)
NW = (-1, +1,  0)
SE = (+1, -1,  0)
```
- **White pawn captures:** NW `(-1,+1,0)` and NE `(+1,0,-1)`.
- **Black pawn captures:** SW `(-1,0,+1)` and SE `(+1,-1,0)`.

**6 diagonal (vertex) vectors** — bishop/queen slide:
```
(1,1,-2) (-1,2,-1) (-2,1,1) (-1,-1,2) (1,-2,1) (2,-1,-1)
```

**12 knight vectors** (all signed permutations of magnitudes {1,2,3} summing to 0):
```
( 3,-2,-1) (-3, 2, 1) ( 3,-1,-2) (-3, 1, 2)
(-2, 3,-1) ( 2,-3, 1) (-1, 3,-2) ( 1,-3, 2)
(-2,-1, 3) ( 2, 1,-3) (-1,-2, 3) ( 1, 2,-3)
```

**Move generation:** sliders = step the relevant unit vectors until off-board or blocked (capture
if enemy on the blocking cell). King/knight = single step of their vectors, keep on-board cells.
Pawns as specified in §4. Legality = pseudo-legal move must not leave own king attacked (compute
attacks by generating opponent pseudo-legal targets, or a per-piece `attacks()` set). Check =
king cell is attacked; checkmate = in check with no legal move; stalemate = not in check with no
legal move.

**Engine self-test (Fool's mate from the source):**
`1.Qe1c3 Qe10c6  2.b1b2 b7b6  3.Bf3b1 e7e6?  4.Qc3xBf9#` — after move 4 Black must be in
**checkmate**. Wire this as an automated test.

---

## 6. Suggested architecture (static, no build step)

```
index.html            # board + two rotated status banners; loads ES modules
styles.css            # layout, hex sizing, dual-facing rotations, touch targets
src/
  hex.js              # cube math: board set, file/rank<->cube, neighbors, color, pixel layout
  rules.js            # move generation, attacks, check/mate/stalemate, en passant, promotion
  game.js             # game state, move application, history, undo, SAN-ish notation
  render.js           # SVG board; pieces rotated per owner; highlights/last-move/check markers
  ui.js               # tap-to-select -> legal targets -> tap-to-move; promotion picker
  pieces.js           # piece glyphs (Unicode chess symbols are fine: ♔♕♖♗♘♙ / ♚♛♜♝♞♟)
tests/
  rules.test.mjs      # Fool's-mate mate, start-position legal-move counts, en-passant, promotion
```

**Rendering notes for the dual-facing feature:**
- Lay out hex centers from cube coords (flat-top): `px = size * 1.5 * x`,
  `py = size * √3 * (y + x/2)` (then center/scale to viewport; tune orientation so files read
  vertically and White is at the bottom edge).
- Draw the 91 hex `<polygon>`s once, colored by `color`. Selection/last-move/check are overlays on
  these shared cells — no per-seat duplication.
- **Pieces:** render each glyph; apply `transform: rotate(180deg)` to pieces whose owner is the
  far-side player (Black) so each army faces its player.
- **Text:** two identical status regions — bottom upright, top `rotate(180deg)` — each showing
  turn, check/checkmate/stalemate, and last move in notation. That is the "one set facing up, one
  facing down" feedback.
- Big touch targets; tap a piece → highlight legal destinations → tap to move; long-press or a
  small popover for promotion choice.

**v1 scope:** full legal-move enforcement, check/checkmate/stalemate (with the ¾/¼ scoring note &
draw toggle), en passant, promotion, move history + undo, dual-facing render. **Defer:** AI
opponent, online play, clocks, saved games, other hex variants (McCooey/Shafran).

---

## 7. License note

If you bundle anything derived from Swiss Ephemeris or other AGPL assets, mind the license — but a
from-scratch hex-chess engine + your own piece SVGs has no such constraint. Unicode chess glyphs
are unencumbered.
```
