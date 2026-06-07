// hex.js — cube-coordinate math for Gliński's hexagonal chess.
// Pure / DOM-free: safe to import in Node for tests (ADR-0003).
//
// Board: a regular hexagon, side 6, 91 cells, point-up with vertical files.
//   BOARD = { (x,y,z) : x+y+z = 0, |x|<=5, |y|<=5, |z|<=5 },  f6 = (0,0,0)
// Files are lettered a b c d e f g h i k l  (j is skipped).

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'k', 'l'];
export const RADIUS = 5;

export const fileIndex = (file) => FILES.indexOf(file) - 5; // a=-5 … f=0 … l=5
export const fileLetter = (x) => FILES[x + 5];

const min0 = (x) => Math.min(0, x);

// (file, rank) -> cube. rank 1 is at the near edge (bottom of each file).
export function frToCube(file, rank) {
  const x = fileIndex(file);
  const y = rank - 6 - min0(x);
  return [x, y, -x - y + 0]; // +0 normalizes -0 -> 0
}

// cube -> { file, rank }
export function cubeToFr(x, y) {
  return { file: fileLetter(x), rank: y + 6 + min0(x) };
}

// Square name e.g. "f6"  <->  cube
export const cubeToSquare = (x, y) => {
  const { file, rank } = cubeToFr(x, y);
  return file + rank;
};

// Square name presented from White's side of the board. When the White army
// sits on the far edge we rotate the labels 180° (a point reflection of the
// board, x,y -> -x,-y), so the far player reads files a–l left-to-right and
// rank 1 at their near edge — exactly the view a near-White player gets.
// `farWhite` applies the rotation; otherwise the board-fixed labels are used.
export const cubeToSquareOriented = (x, y, farWhite) =>
  (farWhite ? cubeToSquare(-x, -y) : cubeToSquare(x, y));
export function squareToCube(sq) {
  return frToCube(sq[0], parseInt(sq.slice(1), 10));
}

// Internal cell key (z is derived, so x,y is enough).
export const key = (x, y) => x + ',' + y;
export const parseKey = (k) => k.split(',').map(Number);

export function isOnBoard(x, y, z = -x - y) {
  return Math.abs(x) <= RADIUS && Math.abs(y) <= RADIUS && Math.abs(z) <= RADIUS;
}

// All 91 cells, as [x,y,z] triples and as a Set of keys.
export const CELLS = [];
for (let x = -RADIUS; x <= RADIUS; x++) {
  for (let y = -RADIUS; y <= RADIUS; y++) {
    const z = -x - y;
    if (Math.abs(z) <= RADIUS) CELLS.push([x, y, z]);
  }
}
export const CELL_KEYS = new Set(CELLS.map(([x, y]) => key(x, y)));

// Three cell colors (0/1/2). Orthogonal steps change it; diagonal steps preserve it.
export const cellColor = (x, y) => ((x - y) % 3 + 3) % 3;

// --- Movement vectors -------------------------------------------------------

// 6 orthogonal (edge) unit vectors.
export const ORTHO = [
  [0, 1, -1],  // N  — up a file (near-army pawn forward)
  [0, -1, 1],  // S  — down a file (far-army pawn forward)
  [1, 0, -1],  // NE
  [-1, 0, 1],  // SW
  [-1, 1, 0],  // NW
  [1, -1, 0],  // SE
];

// 6 diagonal (vertex) vectors — bishop / queen.
export const DIAG = [
  [1, 1, -2], [-1, 2, -1], [-2, 1, 1],
  [-1, -1, 2], [1, -2, 1], [2, -1, -1],
];

// 12 knight vectors — signed permutations of {1,2,3} summing to 0.
export const KNIGHT = [
  [3, -2, -1], [-3, 2, 1], [3, -1, -2], [-3, 1, 2],
  [-2, 3, -1], [2, -3, 1], [-1, 3, -2], [1, -3, 2],
  [-2, -1, 3], [2, 1, -3], [-1, -2, 3], [1, 2, -3],
];

// Named orthogonal directions (for pawns).
export const N = [0, 1, -1];
export const S = [0, -1, 1];
export const NW = [-1, 1, 0];
export const NE = [1, 0, -1];
export const SW = [-1, 0, 1];
export const SE = [1, -1, 0];

// Armies are identified by home edge. Forward direction & capture diagonals are
// fixed by the army, NOT by the White/Black role (ADR-0002).
export const NEAR = 'near'; // starts at rank-1 edge, advances toward far border (N)
export const FAR = 'far';   // starts at far edge, advances toward near border (S)

export const pawnForward = (army) => (army === NEAR ? N : S);
export const pawnCaptures = (army) => (army === NEAR ? [NW, NE] : [SW, SE]);

// The nine starting pawn cells of each army (double-step is allowed from any of
// them, not only a pawn's own origin).
const startKeys = (squares) =>
  new Set(squares.map((s) => { const [x, y] = squareToCube(s); return key(x, y); }));
export const NEAR_PAWN_STARTS = startKeys(['b1', 'c2', 'd3', 'e4', 'f5', 'g4', 'h3', 'i2', 'k1']);
export const FAR_PAWN_STARTS = startKeys(['b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7', 'i7', 'k7']);
export const pawnStarts = (army) => (army === NEAR ? NEAR_PAWN_STARTS : FAR_PAWN_STARTS);

export const opponent = (army) => (army === NEAR ? FAR : NEAR);

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// Pixel layout (flat-top). py is negated so the near army sits at the bottom.
export function cellPixel(x, y, size) {
  return { px: size * 1.5 * x, py: -size * Math.sqrt(3) * (y + x / 2) };
}
