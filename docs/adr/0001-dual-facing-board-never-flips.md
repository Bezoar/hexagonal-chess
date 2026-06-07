# Dual-facing presentation: the board is rendered once and never flips

We present the game so each player reads it from their own seat, but the board
itself is **drawn once and never rotated** during two-player play. Orientation is
applied per element instead: each army's pieces are oriented to that army's seat
(near upright, far rotated 180°) and each seat gets its own status/score banner
(near upright, top rotated), while cells, highlights, the last-move trail, and check
markers stay seat-agnostic on the shared board.

We chose this over the obvious alternative of flipping the whole board to face
whoever is on the move. Because the start position is a 180° rotational mirror, each
army already begins on its own player's edge, so seat-oriented rendering is
ergonomic for both players simultaneously and avoids per-turn reorientation,
animation churn, and the disorientation of a moving board. A 2-D glyph cannot read
upright from both sides at once, so the deliberate trade-off is: *your own pieces
always read upright to you; the opponent's army appears rotated.*

This is hard to reverse because it shapes the renderer, the coordinate/orientation
model, and every UI surface (gutters, pickers, result card all duplicate/rotate by
seat). A separate, explicit **Flip view** control exists for solo play (one person
rotating the whole presentation 180°), but that is view-only and does not change the
two-player "never flips" rule.
