// render.js — SVG board renderer. Browser-only (keeps the engine DOM-free).
//
// The board is drawn once and never flips; orientation is by army (the far army's
// pieces are rotated 180°) and the whole presentation is flipped for solo play via
// a CSS class on the app root (Flip view, spec §9.5).

import {
  CELLS, cellColor, cellPixel, key, parseKey, cubeToSquareOriented,
} from './hex.js';
import { makePiece } from './pieces.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const SIZE = 40;
const ROOT3 = Math.sqrt(3);

const el = (name, attrs = {}) => {
  const e = document.createElementNS(SVGNS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

function hexPoints(cx, cy, r) {
  const p = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * 60 * i;
    p.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return p.join(' ');
}

export class Renderer {
  constructor(svg) {
    this.svg = svg;
    this.center = new Map(); // cellKey -> [cx, cy]
    this._buildStatic();
    this.layers = {
      lastmove: el('g'), check: el('g'), targets: el('g'),
      selection: el('g'), coords: el('g'), pieces: el('g'),
    };
    for (const k of ['lastmove', 'check', 'targets', 'selection', 'coords', 'pieces']) {
      this.svg.appendChild(this.layers[k]);
    }
  }

  _buildStatic() {
    const xs = CELLS.map(([x]) => cellPixel(x, 0, SIZE).px);
    const ys = CELLS.map(([x, y]) => cellPixel(x, y, SIZE).py);
    const pad = SIZE * 1.15;
    const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - Math.min(...xs) + 2 * pad;
    const h = Math.max(...ys) - Math.min(...ys) + 2 * pad;
    this.svg.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`);
    const cells = el('g');
    for (const [x, y] of CELLS) {
      const { px, py } = cellPixel(x, y, SIZE);
      this.center.set(key(x, y), [px, py]);
      cells.appendChild(el('polygon', {
        points: hexPoints(px, py, SIZE), class: 'cell t' + cellColor(x, y), 'data-key': key(x, y),
      }));
    }
    this.svg.appendChild(cells);
  }

  // Full redraw of the dynamic layers from game + ui state.
  // `ui.animate` (optional) glides the moving piece for one render:
  //   { from, to, faceFar, isKnight, captureKey, capturedPiece:{type,army,role} }
  draw(game, ui = {}) {
    const { selected = null, targets = [], showCoords = false, animate = null } = ui;
    this._clear();

    // last-move trail
    const last = game.history[game.history.length - 1];
    if (last) {
      for (const k of [last.from, last.to]) {
        const [cx, cy] = this.center.get(k);
        this.layers.lastmove.appendChild(el('polygon', { points: hexPoints(cx, cy, SIZE), class: 'lastmove' }));
      }
    }

    // check indicator on the in-check king
    const checked = game.checkedArmy && game.checkedArmy();
    if (checked) {
      const kk = [...game.board.entries()].find(([, p]) => p.type === 'K' && p.army === checked);
      if (kk) {
        const [cx, cy] = this.center.get(kk[0]);
        this.layers.check.appendChild(el('polygon', { points: hexPoints(cx, cy, SIZE), class: 'check-fill' }));
        this.layers.check.appendChild(el('polygon', { points: hexPoints(cx, cy, SIZE * 0.82), class: 'check-stroke' }));
      }
    }

    // coordinate labels — file+rank tucked into each cell's lower-right corner,
    // with a 180°-rotated copy so each player reads their own (dual-facing).
    if (showCoords) {
      const dx = SIZE * 0.52, dy = SIZE * 0.60;
      const farWhite = game.whiteArmy === 'far'; // orient labels to White's home edge
      for (const [k, [cx, cy]] of this.center) {
        const sq = cubeToSquareOriented(...parseKey(k), farWhite);
        const near = el('text', { x: cx + dx, y: cy + dy, 'text-anchor': 'end', class: 'coord' });
        near.textContent = sq;
        this.layers.coords.appendChild(near);
        const far = el('text', {
          x: cx + dx, y: cy + dy, 'text-anchor': 'end', class: 'coord',
          transform: `rotate(180 ${cx} ${cy})`,
        });
        far.textContent = sq;
        this.layers.coords.appendChild(far);
      }
    }

    // selection + targets
    if (selected && this.center.has(selected)) {
      const [cx, cy] = this.center.get(selected);
      this.layers.selection.appendChild(el('polygon', { points: hexPoints(cx, cy, SIZE * 0.9), class: 'sel-fill' }));
      this.layers.selection.appendChild(el('polygon', { points: hexPoints(cx, cy, SIZE * 0.86), class: 'sel-stroke' }));
    }
    for (const m of targets) {
      const [cx, cy] = this.center.get(m.to);
      const cls = m.capture ? 'tgt cap' : 'tgt move';
      this.layers.targets.appendChild(el('polygon', { points: hexPoints(cx, cy, SIZE * 0.8), class: cls }));
    }

    // pieces
    let movingEl = null;
    for (const [k, p] of game.board) {
      const [cx, cy] = this.center.get(k);
      const pieceEl = makePiece({
        type: p.type, role: game.role(p.army), faceFar: p.army === 'far', cx, cy, size: SIZE,
      });
      this.layers.pieces.appendChild(pieceEl);
      if (animate && k === animate.to) movingEl = pieceEl;
    }

    this._animate(animate, movingEl);
  }

  // Glide the moving piece from its source, hop knights, fade a captured piece.
  _animate(animate, movingEl) {
    if (!animate) return;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const rot = animate.faceFar ? ' rotate(180)' : '';

    if (movingEl && this.center.has(animate.from) && this.center.has(animate.to)) {
      const [fx, fy] = this.center.get(animate.from);
      const [tx, ty] = this.center.get(animate.to);
      movingEl.setAttribute('transform', `translate(${fx} ${fy})${rot}`); // start at source
      movingEl.getBoundingClientRect();                                    // commit (FLIP)
      movingEl.classList.add('gliding');
      if (animate.isKnight) movingEl.classList.add('knight-hop');
      movingEl.setAttribute('transform', `translate(${tx} ${ty})${rot}`); // glide to dest
    }

    if (animate.captureKey && animate.capturedPiece && this.center.has(animate.captureKey)) {
      const [gx, gy] = this.center.get(animate.captureKey);
      const cap = animate.capturedPiece;
      const ghost = makePiece({
        type: cap.type, role: cap.role, faceFar: cap.army === 'far', cx: gx, cy: gy, size: SIZE,
      });
      ghost.classList.add('capture-ghost');
      this.layers.pieces.appendChild(ghost);
      setTimeout(() => ghost.remove(), 240);
    }
  }

  _clear() {
    for (const k of Object.keys(this.layers)) this.layers[k].replaceChildren();
  }

  // Map a client point to a cell key. Uses elementFromPoint so it stays correct
  // under any CSS transform (notably the 180° Flip-view rotation on the app root);
  // only cell polygons are hit-testable (pieces/overlays are pointer-events:none).
  cellAtPoint(clientX, clientY) {
    const hit = document.elementFromPoint(clientX, clientY);
    const cell = hit && hit.closest('[data-key]');
    return cell ? cell.getAttribute('data-key') : null;
  }
}

export { SIZE };
