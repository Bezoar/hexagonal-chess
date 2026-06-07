# Hexagonal Chess

A static, single-page web app implementing Gliński's hexagonal chess for two
players sharing one iPad laid flat on a table (hotseat). The defining feature is
its dual-facing presentation so both players read the game from their own side.

## Language

**Gliński's hexagonal chess**:
The specific hex-chess variant implemented here: a 91-cell regular hexagon, 18
pieces per side (adding a third bishop and a ninth pawn to the orthodox army).
_Avoid_: "hex chess" unqualified (other variants exist — McCooey, Shafran).

**Army**:
One player's full set of 18 pieces (1 K, 1 Q, 2 R, 2 N, 3 B, 9 P), identified by
its **home edge** — the **near army** and the **far army**. The home edge is fixed;
the army's color/role (White or Black) is **not** — it is decided each game at the
first move (see **White / Black (role)**). In the opening both armies render White.
_Avoid_: side, team; "the White army" / "the Black army" as fixed identities.

**Seat**:
A physical position at the table — the **near** seat (closest edge of the iPad) and
the **far** seat (opposite edge). Each seat owns the army on **its** edge for the
whole match (the near seat plays the near army, the far seat the far army), and that
never changes. A seat's **color/role is not fixed**: White is whichever seat — near
or far — makes the first move of the game, so either seat may be White in any given
game. Players keep their seats across games, which is what keeps the match
scoreboard coherent.
_Avoid_: position (overloaded with board position), player slot; do NOT equate the
near seat with White.

**Dual-facing**:
The presentation technique where the board is rendered once and never flips, but
each army's pieces and a dedicated text banner are oriented toward that army's
seat — so each player reads their own pieces and status right-side-up
simultaneously. The board cells, highlights, and markers are seat-agnostic.
_Avoid_: double-headed (the README's informal name — keep as friendly label only),
flipping, rotating-board.

**Cell**:
One of the 91 hexagonal spaces on the board, addressed by file+rank (e.g. `f6`)
or internally by cube coordinate. Each cell carries one of three colors.
_Avoid_: square, tile, hex (ambiguous with the board outline).

**File**:
A vertical column of cells sharing a letter `a b c d e f g h i k l` (`j` is
skipped). Files have unequal heights (6 to 11 cells).

**Request/Accept Draw**:
A consent-based draw. The player on the move offers a draw; the game ends drawn
only if the opponent accepts. A toggleable feature (off → no draw button).
_Avoid_: draw offer (informal), agreed draw.

**Request/Accept Undo**:
A consent-based takeback with a **selectable target**. The requester taps Undo and
picks any earlier position from the move history (defaulting to their own most
recent move; selection may reach back through the opponent's moves to the game
start) — useful for teaching "what if you'd played X". On the opponent's
acceptance the board rewinds to that position and play continues from there. The
moves after the target are **retained internally until the next move is made** (so
a future redo UX is possible), then discarded; v1 ships no redo UI. The
move-history panel doubles as the target picker. A toggleable feature.
_Avoid_: takeback, rewind (use these only informally).

**Resign**:
A player concedes, ending the game as a loss for the resigner. Always available
(not gated behind a settings toggle).

**Flip view**:
A view-only control that rotates the entire presentation (board + gutters/bars)
180° with a smooth animation, so one person playing both armies can face the other
side without turning the iPad. It changes orientation only — never the game state,
turn, or White/Black roles. Always available; offered in each seat's control batch
so an upright one is always reachable. Distinct from dual-facing (which orients each
army to its own seat simultaneously and never flips the board during two-player play).
_Avoid_: rotate board, switch sides (it does not change sides or roles).

**Match**:
A sequence of games played in one session between the same two seats. A running
**scoreboard** accumulates points across games (win = 1, draw = ½ each, Gliński
stalemate = ¾ to the stalemating side / ¼ to the stalemated side, or ½–½ if the
"treat stalemate as draw" Setting is enabled). The score is
**anchored to the seat** (the physical side of the iPad), not to a color: each
seat's gutter always shows that seat's cumulative total, and it never moves.
Because seats never move, the per-seat score stays coherent even as the White
role alternates game to game. The "White"/"Black" word shown above a seat's score
is that seat's **role in the current game only** and can flip between games; a
game's result accrues to the seat that held that role.
_Avoid_: series, tournament; do NOT anchor the score to White/Black.

**White / Black (role)**:
A per-game role, not a fixed identity. Both armies render White (light) in the
opening position; the **first seat to move claims White** (and the first-move
advantage), and at that moment the opposing army recolors to **Black** (dark).
The role drives turn order, notation, and scoring; it is decided fresh each game.
_Avoid_: treating White as a fixed seat or a fixed piece-art color.

**Settings**:
The dialog of persisted, reusable preferences and game options: the auto draw
conditions (threefold repetition, 50-move rule), the Request-Draw and Request-Undo
feature toggles, the stalemate-scoring rule (Gliński ¾/¼ vs treat-as-draw),
coordinate-label visibility, sound mute, and theme (dark by default). Uses an
**explicit commit model**: edits apply only on **Save** (persisted to local storage
and reused across sessions), **Cancel** discards them, and **Reset to default**
stages the default values (still requiring Save). (Insufficient-material auto-draw is
deferred from v1 — dead positions use Request Draw.) The board's size is the
priority; Settings live behind a control and must not crowd the board.
_Avoid_: config (informal); auto-save (Settings commits on Save); do NOT conflate
per-game rules with the live game state.

**Live game state**:
The full serializable state of the game in progress — piece placement, move
history, side to move, White/Black assignment, en-passant target, and any pending
promotion. Auto-saved every move and restored on reload, distinct from Settings
and the Match scoreboard (which persist independently).
_Avoid_: saved game (the deferred multi-slot feature), board state (ambiguous).

## Example dialogue

> **Dev:** When the far player promotes a pawn, which way does the promotion
> picker face?
> **Designer:** Toward the far seat — the picker faces whichever *seat* is
> promoting, not a fixed colour. If the far seat is promoting, it's rotated 180°
> like the rest of the far army and the top banner.
> **Dev:** And if the far player were White this game?
> **Designer:** Same thing — orientation follows the seat, the White/Black role
> doesn't change which way anything faces. The picker still faces the far seat.
> **Dev:** And the board itself doesn't rotate for that?
> **Designer:** Right. The board is dual-facing — it never flips. Only army
> pieces and the seat's banner are oriented; cells and highlights stay shared.
