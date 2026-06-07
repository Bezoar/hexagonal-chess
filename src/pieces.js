// pieces.js — pluggable piece-art interface (spec §5).
//
// A piece "art set" maps a piece type (K/Q/R/B/N/P) to an SVG fragment drawn
// centered on (0,0). v1 ships a default set built from the solid Unicode chess
// glyphs (filled silhouettes), tinted per role. Swap in path-based / bespoke art
// later by calling setArtSet() with another implementation — nothing else changes.

const SOLID_GLYPHS = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };

const SVGNS = 'http://www.w3.org/2000/svg';

// Default art set: returns an <text> element with the solid glyph.
const glyphArtSet = {
  id: 'unicode-solid',
  create(type, size) {
    const t = document.createElementNS(SVGNS, 'text');
    t.setAttribute('class', 'piece-glyph');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.setAttribute('font-size', String(size * 1.05));
    t.textContent = SOLID_GLYPHS[type];
    return t;
  },
};

let artSet = glyphArtSet;
export const setArtSet = (set) => { artSet = set; };
export const getArtSet = () => artSet;

// Build a fully-positioned piece <g> for the board: tinted by role ('white'|'black'
// |null) and rotated 180° when the owning army sits at the far edge.
export function makePiece({ type, role, faceFar, cx, cy, size }) {
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('class', `piece role-${role || 'white'}`);
  let transform = `translate(${cx} ${cy})`;
  if (faceFar) transform += ' rotate(180)';
  g.setAttribute('transform', transform);
  g.appendChild(artSet.create(type, size));
  return g;
}
