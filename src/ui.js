// ui.js — app controller. Browser-only; ties the DOM-free engine to the renderer,
// touch input, dialogs, persistence, and audio.

import { Game } from './game.js';
import { Match, formatScore } from './match.js';
import { Renderer } from './render.js';
import * as store from './storage.js';
import * as audio from './audio.js';
import { opponent } from './hex.js';

const VALUE = { Q: 9, R: 5, B: 3, N: 3, P: 1, K: 0 };
const GLYPHS = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const ROLE_LABEL = { white: 'White', black: 'Black' };
const SEAT_LABEL = { near: 'Near', far: 'Far' };
const DRAG_THRESHOLD = 8;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

class App {
  constructor() {
    this.settings = store.loadSettings();
    this.match = new Match(store.loadMatch() || {});
    this.app = $('#app');
    this.renderer = new Renderer($('#board'));
    this.gutters = { near: $('.gutter.near'), far: $('.gutter.far') };
    this.flipped = false;

    this.ui = { selected: null, targets: [], pendingPromo: null, request: null, undoKeep: 0, advExpanded: null };
    this.drag = null;
    this.endHandled = false;

    this._loadGame();
    this._applyTheme();
    audio.setMuted(!this.settings.sound);
    this._wire();
    this.updateAll();
    if (this.game.result) { this.endHandled = true; this._showEnd(); }
  }

  rules() {
    return {
      threefold: this.settings.threefold,
      fiftyMove: this.settings.fiftyMove,
      stalemateAsDraw: this.settings.stalemateAsDraw,
    };
  }

  _loadGame() {
    const saved = store.loadGame();
    try {
      this.game = saved ? Game.deserialize(saved) : new Game(this.rules());
    } catch {
      this.game = new Game(this.rules());
    }
  }

  _applyTheme() { this.app.dataset.theme = this.settings.theme; }

  // ---- wiring ----
  _wire() {
    this.app.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (b) { audio.unlock(); this._action(b.dataset.action, b.dataset.seat, b); }
      const sc = e.target.closest('.score-card');
      if (sc && !e.target.closest('.captured-pop')) this._toggleAdv(sc.closest('.gutter').dataset.seat);
      const seg = e.target.closest('.seg button');
      if (seg) this._segPick(seg);
      const tog = e.target.closest('.toggle');
      if (tog) this._togglePick(tog);
      const row = e.target.closest('.mrow');
      if (row && !$('#undo').hidden) this._pickUndoTarget(Number(row.dataset.keep));
      const ht = e.target.closest('[data-help-tab]');
      if (ht) this._helpTab(ht.dataset.helpTab);
      if (e.target.id === 'help') $('#help').hidden = true; // tap the backdrop to close
    });
    const board = $('#board');
    board.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
  }

  // ---- board input (drag-or-tap) ----
  _down(e) {
    audio.unlock();
    if (this.game.result || this.ui.pendingPromo || this._anyOverlay()) return;
    const cell = this.renderer.cellAtPoint(e.clientX, e.clientY);
    if (!cell) { this._deselect(); return; }
    if (this.ui.selected && this.ui.targets.some((t) => t.to === cell)) {
      this._attempt(this.ui.selected, cell); return;
    }
    const piece = this.game.board.get(cell);
    if (piece && this.game.selectable().includes(piece.army)) {
      if (cell === this.ui.selected) {
        // second tap on the already-selected piece: keep it for a possible drag,
        // but deselect on tap-up (handled in _up) so the highlights toggle off
        this.drag = { from: cell, x: e.clientX, y: e.clientY, moved: false, toggle: true };
      } else {
        this._select(cell);
        this.drag = { from: cell, x: e.clientX, y: e.clientY, moved: false };
      }
    } else {
      this._deselect();
    }
  }

  _move(e) {
    if (!this.drag) return;
    if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > DRAG_THRESHOLD) this.drag.moved = true;
  }

  _up(e) {
    if (!this.drag) return;
    const d = this.drag; this.drag = null;
    if (!d.moved) {
      if (d.toggle) this._deselect(); // second tap on the selected piece clears highlights
      return; // otherwise a tap leaves the selection for tap-tap
    }
    const cell = this.renderer.cellAtPoint(e.clientX, e.clientY);
    if (cell && this.ui.targets.some((t) => t.to === cell)) this._attempt(d.from, cell);
  }

  _select(cell) {
    this.ui.selected = cell;
    this.ui.targets = this.game.legalFrom(cell);
    this._drawBoard();
  }

  _deselect() { this.ui.selected = null; this.ui.targets = []; this._drawBoard(); }

  _attempt(from, to) {
    const rec = this.game.move(from, to);
    if (rec && rec.needsPromotion) { this._openPromo(from, to); return; }
    if (!rec) { this._deselect(); return; }
    this._postMove(rec);
  }

  _postMove(rec) {
    if (this.game.checkedArmy()) audio.play('check');
    else audio.play(rec.captured ? 'capture' : 'move');
    this.ui.selected = null; this.ui.targets = []; this.ui.request = null;
    if (rec.from) {
      this._pendingAnim = {
        from: rec.from, to: rec.to, faceFar: rec.army === 'far', isKnight: rec.pieceType === 'N',
        captureKey: rec.captureKey || null,
        capturedPiece: rec.captured
          ? { type: rec.captured.type, army: rec.captured.army, role: this.game.role(rec.captured.army) }
          : null,
      };
    }
    this._hidePrompts();
    this.updateAll();
    if (this.game.result && !this.endHandled) this._endGame();
  }

  _endGame() {
    this.endHandled = true;
    this.match.record(this.game.result);
    store.saveMatch(this.match.serialize());
    this.updateAll();
    this._showEnd();
  }

  // ---- promotion ----
  _openPromo(from, to) {
    this.ui.pendingPromo = { from, to };
    const army = this.game.board.get(from).army;
    const promo = $('#promo');
    promo.classList.toggle('face-far', army === 'far');
    promo.hidden = false;
  }

  _promote(piece) {
    const { from, to } = this.ui.pendingPromo;
    this.ui.pendingPromo = null;
    $('#promo').hidden = true;
    const rec = this.game.move(from, to, piece);
    if (rec) this._postMove(rec);
  }

  // ---- actions ----
  _action(action, seat, btn) {
    switch (action) {
      case 'flip': this.flipped = !this.flipped; this.app.classList.toggle('flip', this.flipped); break;
      case 'mute': this._setSound(!this.settings.sound); break;
      case 'settings': this._openSettings(seat); break;
      case 'help': this._openHelp(seat); break;
      case 'help-close': $('#help').hidden = true; break;
      case 'resign':
        if (!this.game.result && this.game.whiteArmy) { this.game.resign(seat); this._postMove({}); }
        break;
      case 'draw':
        // only the side to move may offer a draw (spec §9.3)
        if (this.settings.requestDraw && !this.game.result && this.game.toMove === seat) {
          this.ui.request = { kind: 'draw', by: seat }; this.updateAll();
        }
        break;
      case 'undo':
        if (this.settings.requestUndo && this.game.history.length && !this.game.result) this._openUndo(seat);
        break;
      case 'accept': this._accept(seat); break;
      case 'decline': this.ui.request = null; this.updateAll(); break;
      case 'new-game': this._newGame(false); break;
      case 'new-match': this._newGame(true); break;
      case 'promote': this._promote(btn.dataset.piece); break;
      case 'undo-cancel': $('#undo').hidden = true; break;
      case 'undo-request': this._requestUndo(); break;
      case 'settings-save': this._saveSettings(); break;
      case 'settings-cancel': $('#settings').hidden = true; break;
      case 'settings-reset': this._draft = { ...store.DEFAULT_SETTINGS }; this._renderSettings(); break;
      default: break;
    }
  }

  _accept(seat) {
    const r = this.ui.request;
    if (!r || r.by === seat) return; // only the opponent accepts
    if (r.kind === 'draw') {
      this.game.agreeDraw();
      this.ui.request = null; this._hidePrompts();
      this.updateAll();
      if (!this.endHandled) this._endGame();
    } else if (r.kind === 'undo') {
      this.game.undoTo(r.undoKeep);
      this.ui.request = null; this.ui.selected = null; this.ui.targets = [];
      this._hidePrompts();
      this.updateAll();
    }
  }

  _newGame(resetMatch) {
    if (resetMatch) { this.match.reset(); store.saveMatch(this.match.serialize()); }
    this.game = new Game(this.rules());
    this.ui = { selected: null, targets: [], pendingPromo: null, request: null, undoKeep: 0, advExpanded: null };
    this.endHandled = false;
    $('#endcard').hidden = true;
    this.updateAll();
  }

  // ---- undo picker ----
  _openUndo(seat) {
    this.ui.undoRequester = seat;
    this.ui.undoKeep = this.game.defaultUndoIndex(seat);
    this._renderUndoList();
    const u = $('#undo');
    u.classList.toggle('face-far', seat === 'far'); // orient to the requesting seat
    u.hidden = false;
  }

  _pickUndoTarget(keep) { this.ui.undoKeep = keep; this._renderUndoList(); }

  _renderUndoList() {
    const list = $('#mlist');
    list.replaceChildren();
    const keep = this.ui.undoKeep;
    this.game.history.forEach((rec, i) => {
      if (i === keep) {
        const div = document.createElement('div');
        div.className = 'rewind-div';
        div.textContent = '↩ rewind here';
        div.style.cssText = 'color:var(--accent-soft);font-size:11px;margin:6px 2px;text-transform:uppercase;letter-spacing:.06em';
        list.appendChild(div);
      }
      const row = document.createElement('div');
      row.className = 'mrow' + (i === keep ? ' target' : '');
      row.dataset.keep = String(i);
      row.innerHTML = `<span class="no">${i + 1}</span>
        <span class="mv ${i >= keep ? 'ghost' : ''}">${ROLE_LABEL[this.game.role(rec.army)] || rec.army}</span>
        <span class="mv ${i >= keep ? 'ghost' : ''}">${rec.san}</span>`;
      list.appendChild(row);
    });
    const undone = this.game.history.length - keep;
    $('#undo-hint').textContent = `Tap a point to rewind to — ${undone} move${undone === 1 ? '' : 's'} undone`;
  }

  _requestUndo() {
    $('#undo').hidden = true;
    this.ui.request = { kind: 'undo', by: this.ui.undoRequester, undoKeep: this.ui.undoKeep };
    this.updateAll();
  }

  // ---- settings ----
  _openSettings(seat) {
    this._draft = { ...this.settings };
    this._renderSettings();
    const s = $('#settings');
    s.classList.toggle('face-far', seat === 'far'); // orient to the opening seat
    s.hidden = false;
  }

  _renderSettings() {
    const s = this._draft;
    $$('#settings .toggle').forEach((t) => t.classList.toggle('on', !!s[t.dataset.set]));
    $$('#settings .seg').forEach((seg) => {
      const key = seg.dataset.set;
      $$('button', seg).forEach((b) => {
        const v = b.dataset.val === 'true' ? true : b.dataset.val === 'false' ? false : b.dataset.val;
        b.classList.toggle('act', s[key] === v);
      });
    });
  }

  _togglePick(t) {
    if ($('#settings').hidden) return;
    const k = t.dataset.set;
    this._draft[k] = !this._draft[k];
    this._renderSettings();
  }

  _segPick(btn) {
    if ($('#settings').hidden) return;
    const seg = btn.closest('.seg'); const k = seg.dataset.set;
    const v = btn.dataset.val === 'true' ? true : btn.dataset.val === 'false' ? false : btn.dataset.val;
    this._draft[k] = v;
    this._renderSettings();
  }

  _saveSettings() {
    this.settings = { ...this._draft };
    store.saveSettings(this.settings);
    audio.setMuted(!this.settings.sound);
    this._applyTheme();
    this.game.rules = this.rules(); // apply to the running game
    $('#settings').hidden = true;
    this.updateAll();
  }

  _setSound(on) {
    this.settings.sound = on;
    store.saveSettings(this.settings);
    audio.setMuted(!on);
    if (on) audio.unlock();
    this.updateAll();
  }

  // ---- help / field guide ----
  _openHelp(seat) {
    this._helpTab('howto'); // always open on "How to play"
    const h = $('#help');
    h.classList.toggle('face-far', seat === 'far'); // orient to the opening seat
    h.hidden = false;
  }

  _helpTab(id) {
    $$('#help .tab').forEach((t) => t.classList.toggle('act', t.dataset.helpTab === id));
    $$('#help .panel').forEach((p) => { p.hidden = p.dataset.helpPanel !== id; });
  }

  // ---- rendering ----
  _drawBoard() {
    this.renderer.draw(this.game, {
      selected: this.ui.selected, targets: this.ui.targets, showCoords: this.settings.coords,
      animate: this._pendingAnim || null,
    });
    this._pendingAnim = null; // animate only the render right after a move
  }

  updateAll() {
    this._drawBoard();
    for (const seat of ['near', 'far']) this._updateGutter(seat);
    store.saveGame(this.game.serialize());
  }

  _material() {
    let near = 0, far = 0;
    for (const p of this.game.board.values()) (p.army === 'near' ? (near += VALUE[p.type]) : (far += VALUE[p.type]));
    return { near, far };
  }

  _capturedBy(seat) {
    return this.game.history
      .filter((r) => r.captured && r.captured.army === opponent(seat))
      .map((r) => r.captured.type);
  }

  _updateGutter(seat) {
    const g = this.gutters[seat];
    const role = this.game.role(seat);
    const set = (bind, val) => { const e = $(`[data-bind="${bind}"]`, g); if (e) e.textContent = val; };

    set('name', role ? ROLE_LABEL[role] : SEAT_LABEL[seat]);
    set('dot', `${seat} seat`);
    set('score', formatScore(this.match[seat]));

    const mat = this._material();
    const lead = mat[seat] - mat[opponent(seat)];
    $('[data-bind="adv"]', g).textContent = lead > 0 ? `+${lead}` : '—';

    // captured-pieces pop-out
    const pop = $('[data-bind="captured"]', g);
    if (this.ui.advExpanded === seat) {
      const caps = this._capturedBy(seat).sort((a, b) => VALUE[b] - VALUE[a]).map((t) => GLYPHS[t]).join('');
      pop.innerHTML = `<div class="cap-title">Captured${lead > 0 ? ` · +${lead}` : ''}</div>`
        + (caps ? `<div class="cap-row">${caps}</div>` : '<div class="cap-none">No captures yet</div>');
      pop.hidden = false;
    } else {
      pop.hidden = true;
    }

    // status
    const r = this.game.result;
    const checked = this.game.checkedArmy();
    if (r) {
      set('turn', 'Game over');
      set('state', this._resultStateFor(seat));
      set('last', '');
    } else if (!this.game.whiteArmy) {
      set('turn', 'New game'); set('state', 'Move to play White'); set('last', 'first move claims White');
    } else if (this.game.toMove === seat) {
      set('turn', checked === seat ? 'Check' : 'Your move');
      set('state', checked === seat ? 'Defend the king' : `${ROLE_LABEL[role]} to play`);
      set('last', this._lastText());
    } else {
      set('turn', 'Waiting'); set('state', ROLE_LABEL[role]); set('last', this._lastText());
    }
    g.classList.toggle('on-move', !r && this.game.whiteArmy && this.game.toMove === seat);

    // prompt (shown to the opponent of the requester)
    const promptEl = $('[data-bind="prompt"]', g);
    if (this.ui.request && this.ui.request.by !== seat) {
      $('[data-bind="prompt-title"]', g).textContent = this._promptText();
      promptEl.hidden = false;
    } else {
      promptEl.hidden = true;
    }

    // control enabled states
    const whiteSet = !!this.game.whiteArmy;
    const over = !!r;
    const dis = (action, cond) => { const b = $(`[data-action="${action}"][data-seat="${seat}"]`, g); if (b) b.disabled = cond; };
    dis('undo', over || !this.game.history.length || !this.settings.requestUndo);
    dis('draw', over || this.game.toMove !== seat || !this.settings.requestDraw);
    dis('resign', over || !whiteSet);
    $(`[data-action="mute"][data-seat="${seat}"]`, g).classList.toggle('on', !this.settings.sound);
  }

  _lastText() {
    const h = this.game.history;
    if (!h.length) return '—';
    const last = h[h.length - 1];
    return `last · ${ROLE_LABEL[this.game.role(last.army)]} ${last.san}`;
  }

  _resultStateFor(seat) {
    const r = this.game.result;
    if (r.kind === 'draw') return r.reason === 'agreement' ? 'Draw agreed' : 'Draw';
    if (r.kind === 'stalemate') return r.winner === seat ? 'Stalemate (¾)' : 'Stalemated (¼)';
    return r.winner === seat ? 'You win' : (r.kind === 'resign' ? 'Resigned' : 'Checkmated');
  }

  _promptText() {
    const r = this.ui.request;
    const who = ROLE_LABEL[this.game.role(r.by)] || SEAT_LABEL[r.by];
    if (r.kind === 'draw') return `${who} offers a draw.`;
    const n = this.game.history.length - r.undoKeep;
    return `${who} requests undo — ${n} move${n === 1 ? '' : 's'} will be undone.`;
  }

  _hidePrompts() { $$('[data-bind="prompt"]').forEach((p) => (p.hidden = true)); }
  _anyOverlay() { return !$('#settings').hidden || !$('#undo').hidden || !$('#endcard').hidden || !$('#help').hidden; }

  _showEnd() {
    const r = this.game.result;
    let kick, main;
    if (r.kind === 'checkmate') { kick = 'Checkmate'; main = `${ROLE_LABEL[this.game.role(r.winner)]} wins`; }
    else if (r.kind === 'resign') { kick = 'Resignation'; main = `${ROLE_LABEL[this.game.role(r.winner)]} wins`; }
    else if (r.kind === 'stalemate') { kick = 'Stalemate'; main = `${ROLE_LABEL[this.game.role(r.winner)]} ¾ – ¼`; }
    else { kick = 'Draw'; main = this._drawLabel(r.reason); }
    $$('[data-bind="end-kick"]').forEach((e) => (e.textContent = kick));
    $$('[data-bind="end-main"]').forEach((e) => (e.textContent = main));
    $('#endcard').hidden = false;
  }

  _drawLabel(reason) {
    return {
      threefold: 'Threefold repetition', 'fifty-move': '50-move rule',
      'stalemate-draw': 'Stalemate', agreement: 'By agreement',
    }[reason] || 'Draw';
  }

  _toggleAdv(seat) {
    this.ui.advExpanded = this.ui.advExpanded === seat ? null : seat;
    this._updateGutter('near');
    this._updateGutter('far');
  }
}

window.addEventListener('DOMContentLoaded', () => { window.__app = new App(); });

// Register the service worker for offline / installable use (no-op if unsupported).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
