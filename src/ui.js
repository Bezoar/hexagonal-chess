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

// Time controls (ms). `clockPreset` in Settings selects one; null = untimed.
const CLOCK_PRESETS = {
  off: null,
  '5+0': { base: 5 * 60000, increment: 0 },
  '10+0': { base: 10 * 60000, increment: 0 },
};

// Remaining ms -> "m:ss" (ceil so a clock reads 0:01 until it truly hits zero).
const fmtClock = (ms) => {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

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
    this._tickId = null; // requestAnimationFrame id for the clock ticker

    this._loadGame();
    this._applyTheme();
    audio.setMuted(!this.settings.sound);
    this._wire();
    this._initFullscreen();
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
      this.game = saved ? Game.deserialize(saved) : new Game(this.rules(), this._clockConfig());
    } catch {
      this.game = new Game(this.rules(), this._clockConfig());
    }
    // A persisted game banks its clock paused (see updateAll); resume it on load so
    // the offline gap isn't counted against the player on the move.
    const c = this.game.clock;
    if (c && c.running && c.runningSince == null && !this.game.result) c.resume(Date.now());
  }

  // The time control for a NEW game, from Settings (null = untimed).
  _clockConfig() { return CLOCK_PRESETS[this.settings.clockPreset] || null; }

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
    if (this.game.clock && !this.game.whiteArmy) return; // timed: tap a clock to start first
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
    // Auto-switch handoff: a completed move stops the mover's clock and starts the
    // opponent's (the press-clock alternative is a later slice).
    if (rec.from && this.game.clock && this.game.clock.running) this.game.clock.switchTurn(Date.now());
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
      case 'fullscreen': this._toggleFullscreen(); break;
      case 'clock': this._clockTap(seat); break;
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
    this._stopTick();
    this.game = new Game(this.rules(), this._clockConfig());
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
    const prevPreset = this.settings.clockPreset;
    this.settings = { ...this._draft };
    store.saveSettings(this.settings);
    audio.setMuted(!this.settings.sound);
    this._applyTheme();
    this.game.rules = this.rules(); // apply to the running game
    // A changed time control applies to a fresh (unstarted) game right away, so you
    // can flip it on and play; an in-progress game keeps its clock until the next one.
    if (this.settings.clockPreset !== prevPreset && !this.game.history.length && !this.game.result) {
      this._stopTick();
      this.game = new Game(this.rules(), this._clockConfig());
      this.ui = { selected: null, targets: [], pendingPromo: null, request: null, undoKeep: 0, advExpanded: null };
    }
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

  // ---- clock (timed games) ----
  // Tapping a clock before the game starts elects that seat Black; the opponent is
  // White and moves first, with White's clock running (so White's first move is
  // timed too). Mid-game the button is inert in this auto-switch MVP.
  _clockTap(seat) {
    const c = this.game.clock;
    if (!c || this.game.result || this.game.whiteArmy) return;
    const white = opponent(seat);
    this.game.whiteArmy = white;
    this.game.toMove = white;
    c.start(white, Date.now());
    this.updateAll();
  }

  // Run the ticker while a clock is actively counting; stop otherwise.
  _syncTick() {
    const c = this.game.clock;
    const run = !!(c && c.running && c.runningSince != null && !this.game.result);
    if (run) this._tick(); else this._stopTick();
  }

  _tick() {
    if (this._tickId) return; // already running
    const frame = () => {
      this._tickId = null;
      const c = this.game.clock;
      if (!c || !c.running || c.runningSince == null || this.game.result) return;
      const now = Date.now();
      const flagged = c.flagged(now);
      if (flagged) { this._onFlag(flagged); return; }
      this._renderClocks(now);
      this._tickId = requestAnimationFrame(frame);
    };
    this._tickId = requestAnimationFrame(frame);
  }

  _stopTick() {
    if (this._tickId) { cancelAnimationFrame(this._tickId); this._tickId = null; }
  }

  _onFlag(seat) {
    this._stopTick();
    this.game.flag(seat);
    this.updateAll();
    if (!this.endHandled) this._endGame();
  }

  // Update just the time readouts each frame (cheap; the heavy render is in updateAll).
  _renderClocks(now) {
    const c = this.game.clock;
    if (!c) return;
    for (const seat of ['near', 'far']) {
      const el = $('[data-bind="clock-time"]', this.gutters[seat]);
      if (el) el.textContent = fmtClock(c.remaining(seat, now));
    }
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

  // ---- fullscreen ----
  _toggleFullscreen() {
    const d = document;
    const el = d.documentElement;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) {
        (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      } else {
        (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      }
    } catch { /* not permitted / unsupported */ }
  }

  _initFullscreen() {
    const el = document.documentElement;
    if (!el.requestFullscreen && !el.webkitRequestFullscreen) {
      $$('[data-action="fullscreen"]').forEach((b) => b.remove()); // unsupported (e.g. iPhone)
      return;
    }
    const sync = () => {
      const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
      $$('[data-action="fullscreen"]').forEach((b) => b.classList.toggle('on', on));
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
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
    // Persist a *paused* clock snapshot (banked, no live runningSince) so a reload
    // doesn't count the offline gap; the live clock is resumed immediately after.
    const c = this.game.clock;
    const ticking = c && c.running && c.runningSince != null;
    if (ticking) c.pause(Date.now());
    store.saveGame(this.game.serialize());
    if (ticking) c.resume(Date.now());
    this._syncTick();
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

    // Header is the fixed seat identity ("Near seat"/"Far seat"); the role
    // (White/Black) is carried by the status box, so we don't echo it here.
    set('name', `${SEAT_LABEL[seat]} seat`);
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
      if (this.game.clock) {
        set('turn', 'New game'); set('state', 'Tap your clock to start');
        set('last', 'tapping picks Black; opponent plays White');
      } else {
        set('turn', 'New game'); set('state', 'Move to play White'); set('last', 'first move claims White');
      }
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
    dis('undo', over || !this.game.history.length || !this.settings.requestUndo || !!this.game.clock);
    dis('draw', over || this.game.toMove !== seat || !this.settings.requestDraw);
    dis('resign', over || !whiteSet);
    $(`[data-action="mute"][data-seat="${seat}"]`, g).classList.toggle('on', !this.settings.sound);

    // clock (timed games): show the readout, mark armed (pre-game, tap to start) or
    // active (this seat's clock running); the button is only interactive pre-game.
    const clockEl = $('[data-bind="clock"]', g);
    if (clockEl) {
      const c = this.game.clock;
      clockEl.hidden = !c;
      if (c) {
        set('clock-time', fmtClock(c.remaining(seat, Date.now())));
        const pregame = !this.game.whiteArmy && !r;
        clockEl.classList.toggle('armed', pregame);
        clockEl.classList.toggle('active', !pregame && c.running === seat && c.runningSince != null && !r);
        const btn = $('[data-action="clock"]', clockEl);
        if (btn) btn.disabled = !pregame;
      }
    }
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
    if (r.kind === 'timeout') return r.winner === seat ? 'Won on time' : 'Lost on time';
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
    else if (r.kind === 'timeout') { kick = 'Time'; main = `${ROLE_LABEL[this.game.role(r.winner)]} wins on time`; }
    else { kick = 'Draw'; main = this._drawLabel(r.reason); }
    $$('[data-bind="end-kick"]').forEach((e) => (e.textContent = kick));
    $$('[data-bind="end-main"]').forEach((e) => (e.textContent = main));
    $('#endcard').hidden = false;
  }

  _drawLabel(reason) {
    return {
      threefold: 'Threefold repetition', 'fifty-move': '50-move rule',
      'stalemate-draw': 'Stalemate', agreement: 'By agreement',
      'timeout-insufficient': 'Insufficient material',
    }[reason] || 'Draw';
  }

  _toggleAdv(seat) {
    this.ui.advExpanded = this.ui.advExpanded === seat ? null : seat;
    this._updateGutter('near');
    this._updateGutter('far');
  }
}

// A tablet is a touch device with no mouse hover; anything else (a desktop with a
// mouse) gets a one-time, dismissible warning that this is a two-player tablet game.
function checkDevice() {
  const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  const noHover = window.matchMedia('(hover: none)').matches;
  if (touch && noHover) return; // looks like a tablet — all good
  let dismissed = false;
  try { dismissed = sessionStorage.getItem('dw-dismissed') === '1'; } catch { /* private mode */ }
  if (dismissed) return;
  const el = document.getElementById('deviceWarning');
  if (!el) return;
  el.hidden = false;
  const btn = document.getElementById('deviceWarningDismiss');
  if (btn) {
    btn.addEventListener('click', () => {
      el.hidden = true;
      try { sessionStorage.setItem('dw-dismissed', '1'); } catch { /* ignore */ }
    });
  }
}

window.addEventListener('DOMContentLoaded', () => { checkDevice(); window.__app = new App(); });

// Register the service worker for offline / installable use (no-op if unsupported).
// updateViaCache:'none' makes the browser re-fetch sw.js itself on every update
// check (not from HTTP cache), so new deploys are noticed promptly. When a new
// worker takes control of an already-controlled page we reload once so the fresh
// CSS/JS is shown immediately instead of on a later visit.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return; // skip the first-ever install
      reloaded = true;
      window.location.reload();
    });
  });
}
