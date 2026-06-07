# First mover claims White; the match score is anchored to the seat

White/Black is a **per-game role**, not a fixed seat or piece color. The opening
position renders **both armies White (light)**; the **first seat to move claims the
White role** (and the first-move advantage), and at that moment the opposing army
recolors to **Black**. The match **scoreboard is anchored to the seat** (the physical
side of the iPad), never to a color: each seat's gutter always shows that seat's
cumulative total, and the totals never move even as the White role alternates from
game to game. A game's result accrues to the seat that held the relevant role.

We chose this over fixing colors to seats (near = always White). Fixing colors gives
the near player the first-move advantage every game; alternating colors on a fixed
board would otherwise force a player's army to start on the far edge (reaching across
the table), breaking the ergonomics that let the board stay unflipped (ADR-0001).
"First mover claims White" lets either player take the first move so fairness is
self-managing, lets both players keep their seats, and keeps a session scoreboard
coherent because it tracks the two physical seats rather than a role that swaps.

This is hard to reverse and surprising: it dictates the game-state model (role
assigned lazily at move 1, both-armies-light opening), the renderer (orientation and
home edge fixed by seat, color decided at first move), and the scoring/persistence
model (per-seat totals, role recorded per game). A future reader expecting "White is
always the bottom/light side" needs this context.
