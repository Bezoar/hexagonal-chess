// ui.js — app controller. Browser-only; ties the DOM-free engine to the renderer,
// touch input, dialogs, persistence, and audio.

import { Game } from './game.js';
import { Match, formatScore } from './match.js';
import { Renderer } from './render.js';
import * as store from './storage.js';
import * as audio from './audio.js';
import { opponent } from './hex.js';
import { chooseMove, analyse } from './bot.js';
import { explain } from './explain.js';

const VALUE = { Q: 9, R: 5, B: 3, N: 3, P: 1, K: 0 };
const GLYPHS = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const ROLE_LABEL = { white: 'White', black: 'Black' };
const SEAT_LABEL = { near: 'Near', far: 'Far' };
const DRAG_THRESHOLD = 8;

// Time controls (ms). `clockPreset` in Settings selects one; null = untimed.
// Keys are "base+increment" in minutes+seconds (chess clock notation).
const CLOCK_PRESETS = {
  off: null,
  '5+0': { base: 5 * 60000, increment: 0 },
  '3+2': { base: 3 * 60000, increment: 2000 },
  '10+5': { base: 10 * 60000, increment: 5000 },
  '90+30': { base: 90 * 60000, increment: 30000 },
};

// Stepped ranges for the custom builder (base minutes, increment seconds) — a
// sensible spread from blitz to classical without a thousand taps.
const CUSTOM_BASES = [1, 2, 3, 5, 10, 15, 20, 25, 30, 45, 60, 90, 120];
const CUSTOM_INCS = [0, 1, 2, 3, 5, 10, 15, 20, 30, 60];
// Step a value through its list by dir (±1), snapping an off-list value to the nearest first.
const stepList = (list, val, dir) => {
  let i = list.findIndex((v) => v >= val);
  if (i < 0) i = list.length - 1;
  return list[Math.max(0, Math.min(list.length - 1, i + dir))];
};

// Below this a clock switches to a red tenths readout and the scramble beep fires.
const LOW_TIME_MS = 10000;

// How long the bot "thinks" before its move lands, so the human sees it happen.
const BOT_DELAY_MS = 500;

// Remaining ms -> readout. Under 10s it's "s.t" tenths (the scramble view, floored
// so it ticks down); otherwise "m:ss" (ceil so a clock reads 0:01 until truly zero).
const fmtClock = (ms) => {
  const m = Math.max(0, ms);
  if (m < LOW_TIME_MS) return (Math.floor(m / 100) / 10).toFixed(1);
  const s = Math.ceil(m / 1000);
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

    this.ui = { selected: null, targets: [], pendingPromo: null, request: null, undoKeep: 0, advExpanded: null, awaitingPress: null, hint: null };
    this.drag = null;
    this.endHandled = false;
    this._tickId = null; // requestAnimationFrame id for the clock ticker
    this._lowBeeped = { near: false, far: false }; // under-10s beep fired this scramble?
    this._botTimer = null; // pending scheduled bot move

    this._loadGame();
    this._applyTheme();
    audio.setMuted(!this.settings.sound);
    this._wire();
    this._initFullscreen();
    this.updateAll();
    if (this.game.result) { this.endHandled = true; this._showEnd(); }
    this._maybeBot(); // a game reloaded on the bot's turn should resume thinking
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
    this.bot = store.loadBot() || { enabled: false, seat: 'far' };
    // A persisted game banks its clock paused (see updateAll); resume it on load so
    // the offline gap isn't counted against the player on the move.
    const c = this.game.clock;
    if (c && c.running && c.runningSince == null && !this.game.result) c.resume(Date.now());
  }

  // The time control for a NEW game, from Settings (null = untimed).
  _clockConfig(s = this.settings) {
    if (s.clockPreset === 'custom') {
      const c = s.clockCustom || store.DEFAULT_SETTINGS.clockCustom;
      return { base: c.base * 60000, increment: c.increment * 1000 };
    }
    return CLOCK_PRESETS[s.clockPreset] || null;
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
      // Any click may have opened/closed Settings or Help — reconcile the clock.
      this._syncClockPause();
    });
    const board = $('#board');
    board.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    // Backgrounding / device-lock pauses the active clock; returning resumes it.
    document.addEventListener('visibilitychange', () => this._syncClockPause());
  }

  // ---- board input (drag-or-tap) ----
  _down(e) {
    audio.unlock();
    if (this.game.result || this.ui.pendingPromo || this._anyOverlay()) return;
    if (this.game.clock && !this.game.whiteArmy) return; // timed: tap a clock to start first
    if (this.ui.awaitingPress) return; // press-handoff: board frozen until the mover taps their clock
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
    // Handoff: 'auto' switches the clock the moment a move completes; 'press' keeps
    // the mover's clock running until they tap their own clock to end the turn.
    if (rec.from && this.game.clock && this.game.clock.running) {
      if (this.settings.clockHandoff === 'press') this.ui.awaitingPress = this.game.clock.running;
      else this.game.clock.switchTurn(Date.now());
    }
    this.ui.selected = null; this.ui.targets = []; this.ui.request = null;
    this._clearHint();
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
    this._maybeBot(); // if it's now the robot's turn, schedule its reply
  }

  _endGame() {
    this.endHandled = true;
    this.match.record(this.game.result);
    store.saveMatch(this.match.serialize());
    this.updateAll();
    this._showEnd();
  }

  // ---- bot opponent (feasibility spike) ----
  // The robot always plays the far seat. Tapping 🤖 Bot pre-game opens a colour
  // picker; the human plays near. White moves first, so a human-Black game opens
  // with the robot. Untimed only for now.
  _openBotDialog(seat) {
    const d = $('#botdlg');
    d.classList.toggle('face-far', seat === 'far'); // orient to the tapping seat
    d.hidden = false;
  }

  _startBot(humanColor) {
    $('#botdlg').hidden = true;
    this._clearHint(); // defensive: starting a bot game clears any open hint
    this.bot = { enabled: true, seat: 'far' };
    store.saveBot(this.bot);
    this.updateAll(); // show the robot identity in the far gutter
    if (humanColor === 'black') this._botMove(); // robot is White and opens
  }

  // Schedule a bot move when it's the robot's turn (never pre-game — a human-White
  // game waits for the human's first move).
  _maybeBot() {
    if (!this.bot.enabled || this.game.result || this.ui.pendingPromo) return;
    if (this.game.toMove !== this.bot.seat) return;
    clearTimeout(this._botTimer);
    this._botTimer = setTimeout(() => this._botMove(), BOT_DELAY_MS);
  }

  _botMove() {
    this._botTimer = null;
    if (!this.bot.enabled || this.game.result) return;
    if (!this.game.selectable().includes(this.bot.seat)) return; // also allows the pre-game opener
    const m = chooseMove(this.game.pos(), this.bot.seat);
    if (!m) return;
    const rec = this.game.move(m.from, m.to, m.promo);
    if (rec && !rec.needsPromotion) this._postMove(rec);
  }

  // ---- move hints (teaching layer) ----
  // Suggest the side-to-move human's best move and explain why. Untimed games
  // only, never for a seat the robot holds. Reuses the bot search (analyse) and
  // the explain layer; it never moves for you — you read it and play it yourself.
  _showHint(seat) {
    if (!this.game.whiteArmy || this.game.result || this.game.clock) return;
    if (this.game.toMove !== seat || this.ui.pendingPromo) return;
    if (this.bot.enabled && seat === this.bot.seat) return;
    const analysis = analyse(this.game.pos(), seat);
    if (!analysis) return;
    const farWhite = this.game.whiteArmy === 'far';
    const r = explain(this.game.pos(), seat, analysis, farWhite);
    this.ui.hint = { from: analysis.move.from, to: analysis.move.to };
    this._drawBoard();
    this._renderHintCard(r, seat);
  }

  _renderHintCard(r, seat) {
    const card = $('#hintcard');
    $('[data-bind="hint-move"]', card).textContent = r.moveLabel;
    $('[data-bind="hint-lead"]', card).textContent = r.lead;
    const list = $('[data-bind="hint-reasons"]', card);
    list.replaceChildren();
    for (const reason of r.reasons) {
      const li = document.createElement('li');
      li.textContent = reason;
      list.appendChild(li);
    }
    const contrast = $('[data-bind="hint-contrast"]', card);
    contrast.textContent = r.contrast || '';
    contrast.hidden = !r.contrast;
    card.classList.toggle('face-far', seat === 'far'); // orient to the asking seat
    card.hidden = false;
  }

  _closeHint() {
    this._clearHint();
    this._drawBoard();
  }

  _clearHint() {
    this.ui.hint = null;
    $('#hintcard').hidden = true;
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
      case 'bot': this._openBotDialog(seat); break;
      case 'bot-color': this._startBot(btn.dataset.color); break;
      case 'bot-cancel': $('#botdlg').hidden = true; break;
      case 'hint': this._showHint(seat); break;
      case 'hint-close': this._closeHint(); break;
      case 'settings-reset': this._draft = { ...store.DEFAULT_SETTINGS }; this._renderSettings(); break;
      case 'clk-base': case 'clk-inc': this._stepCustom(action === 'clk-inc', Number(btn.dataset.dir)); break;
      default: break;
    }
  }

  _accept(seat) {
    const r = this.ui.request;
    if (!r || r.by === seat) return; // only the opponent accepts
    this._clearHint(); // accepting an undo/draw must not leave a stale hint card
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
    this._lowBeeped = { near: false, far: false };
    clearTimeout(this._botTimer); this._botTimer = null;
    this.bot = { enabled: false, seat: 'far' }; // New Game returns to human-vs-human; re-tap 🤖 for the robot
    store.saveBot(this.bot);
    this.game = new Game(this.rules(), this._clockConfig());
    this.ui = { selected: null, targets: [], pendingPromo: null, request: null, undoKeep: 0, advExpanded: null, awaitingPress: null, hint: null };
    this.endHandled = false;
    $('#endcard').hidden = true;
    this._clearHint();
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
    // Custom builder: reveal only when "Custom" is the chosen time control.
    const cb = $('#clk-custom');
    if (cb) {
      cb.hidden = s.clockPreset !== 'custom';
      const c = s.clockCustom || store.DEFAULT_SETTINGS.clockCustom;
      $('#clk-base-val').textContent = `${c.base} min`;
      $('#clk-inc-val').textContent = `+${c.increment} s`;
    }
  }

  // Adjust the custom builder's base (minutes) or increment (seconds) by ±1 step.
  _stepCustom(isInc, dir) {
    const c = { ...(this._draft.clockCustom || store.DEFAULT_SETTINGS.clockCustom) };
    if (isInc) c.increment = stepList(CUSTOM_INCS, c.increment, dir);
    else c.base = stepList(CUSTOM_BASES, c.base, dir);
    this._draft.clockCustom = c;
    this._renderSettings();
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
    const prevClock = JSON.stringify(this._clockConfig(this.settings));
    this.settings = { ...this._draft };
    store.saveSettings(this.settings);
    audio.setMuted(!this.settings.sound);
    this._applyTheme();
    this.game.rules = this.rules(); // apply to the running game
    // A changed time control applies to a fresh (unstarted) game right away, so you
    // can flip it on and play; an in-progress game keeps its clock until the next one.
    if (JSON.stringify(this._clockConfig(this.settings)) !== prevClock && !this.game.history.length && !this.game.result) {
      this._stopTick();
      this.game = new Game(this.rules(), this._clockConfig());
      this.ui = { selected: null, targets: [], pendingPromo: null, request: null, undoKeep: 0, advExpanded: null, awaitingPress: null, hint: null };
    }
    this._clearHint();
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
    if (!c || this.game.result) return;
    if (!this.game.whiteArmy) {
      // pre-game start: tapper elects Black; the opponent (White) moves first.
      const white = opponent(seat);
      this.game.whiteArmy = white;
      this.game.toMove = white;
      c.start(white, Date.now());
      this.updateAll();
    } else if (this.ui.awaitingPress === seat) {
      // press-handoff: the mover ends their turn, handing the clock to the opponent.
      c.switchTurn(Date.now());
      this.ui.awaitingPress = null;
      this.updateAll();
    }
  }

  // Pause the running clock while play is interrupted — the app is hidden
  // (backgrounded / device locked) or a meta-overlay (Settings/Help) is open —
  // and resume it on return. The mover's own move is NOT an interruption, so the
  // promotion picker (and other in-play prompts) are deliberately not checked.
  // Idempotent: it reconciles the clock to the *current* interrupted state each
  // call, so overlapping causes (e.g. hidden while Settings is open) compose
  // without reference counting.
  _syncClockPause() {
    const c = this.game.clock;
    if (!c || c.running == null || this.game.result) return;
    const interrupted = document.hidden || !$('#settings').hidden || !$('#help').hidden;
    const now = Date.now();
    if (interrupted && c.runningSince != null) {
      // Freeze. Recompute from the running-since timestamp first: if the active
      // side already ran out at this instant (e.g. rAF was throttled right as we
      // backgrounded), resolve the flag now instead of banking and resuming later.
      const flagged = c.flagged(now);
      if (flagged) { this._onFlag(flagged); return; }
      c.pause(now);
      this.updateAll(); // persists a paused snapshot and stops the ticker
    } else if (!interrupted && c.runningSince == null) {
      c.resume(now);
      const flagged = c.flagged(now); // defensive: a clock that hit zero while away
      if (flagged) { this._onFlag(flagged); return; }
      this.updateAll(); // restarts the ticker, re-banks a paused snapshot
    }
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
      this._maybeLowBeep(c, now);
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
    audio.play('flag');
    this.game.flag(seat);
    this.updateAll();
    if (!this.endHandled) this._endGame();
  }

  // Beep once when the running seat first drops under 10s; re-arm if an increment
  // lifts it back above the threshold so the next scramble beeps again.
  _maybeLowBeep(c, now) {
    const seat = c.running;
    if (c.remaining(seat, now) >= LOW_TIME_MS) { this._lowBeeped[seat] = false; return; }
    if (!this._lowBeeped[seat]) { this._lowBeeped[seat] = true; audio.play('lowtime'); }
  }

  // Update just the time readouts each frame (cheap; the heavy render is in updateAll).
  _renderClocks(now) {
    const c = this.game.clock;
    if (!c) return;
    for (const seat of ['near', 'far']) {
      const el = $('[data-bind="clock-time"]', this.gutters[seat]);
      const rem = c.remaining(seat, now);
      if (el) el.textContent = fmtClock(rem);
      const clockEl = $('[data-bind="clock"]', this.gutters[seat]);
      if (clockEl) clockEl.classList.toggle('low', rem < LOW_TIME_MS);
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
      animate: this._pendingAnim || null, hint: this.ui.hint || null,
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
    // (White/Black) is carried by the status box, so we don't echo it here. When
    // the robot holds a seat it's labelled "Robot" (thinking… on its turn).
    const isBot = this.bot.enabled && seat === this.bot.seat;
    const botThinking = isBot && !this.game.result && !!this.game.whiteArmy && this.game.toMove === this.bot.seat;
    set('name', isBot ? (botThinking ? 'Robot · thinking…' : 'Robot') : `${SEAT_LABEL[seat]} seat`);
    set('score', formatScore(this.match[seat]));

    const mat = this._material();
    const lead = mat[seat] - mat[opponent(seat)];
    $('[data-bind="adv"]', g).textContent = lead > 0 ? `+${lead}` : '—';

    // captured-pieces pop-out
    const pop = $('[data-bind="captured"]', g);
    if (this.ui.advExpanded === seat) {
      // Each glyph is its own element so the .cap-row flex gap/wrapping applies per piece.
      const caps = this._capturedBy(seat).sort((a, b) => VALUE[b] - VALUE[a]).map((t) => `<span>${GLYPHS[t]}</span>`).join('');
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
    } else if (this.ui.awaitingPress) {
      if (this.ui.awaitingPress === seat) {
        set('turn', 'Move played'); set('state', 'Press your clock'); set('last', this._lastText());
      } else {
        set('turn', 'Waiting'); set('state', ROLE_LABEL[role]); set('last', this._lastText());
      }
    } else if (this.game.toMove === seat) {
      set('turn', checked === seat ? 'Check' : 'Your move');
      set('state', checked === seat ? 'Defend the king' : `${ROLE_LABEL[role]} to play`);
      set('last', this._lastText());
    } else {
      set('turn', 'Waiting'); set('state', ROLE_LABEL[role]); set('last', this._lastText());
    }
    const actor = this.ui.awaitingPress || this.game.toMove; // who must act (press, or move)
    g.classList.toggle('on-move', !r && !!this.game.whiteArmy && actor === seat);

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
    // Bot/Hint slot: pre-game it opens the robot picker; once a game is underway
    // it becomes the Hint button for a human seat (untimed only; hidden on the
    // robot's own seat). data-action is toggled, so we find it by .botslot class.
    const slot = $(`.botslot[data-seat="${seat}"]`, g);
    if (slot) {
      const isBotSeat = this.bot.enabled && seat === this.bot.seat;
      if (!whiteSet) {
        slot.dataset.action = 'bot';
        slot.textContent = '🤖 Bot';
        slot.hidden = false;
        slot.disabled = over;
      } else {
        slot.dataset.action = 'hint';
        slot.textContent = '💡 Hint';
        slot.hidden = isBotSeat; // don't coach the robot
        slot.disabled = over || !!this.game.clock || isBotSeat
          || this.game.toMove !== seat || !!this.ui.pendingPromo;
      }
    }
    dis('resign', over || !whiteSet);
    $(`[data-action="mute"][data-seat="${seat}"]`, g).classList.toggle('on', !this.settings.sound);

    // clock (timed games): show the readout, mark armed (pre-game, tap to start) or
    // active (this seat's clock running); the button is only interactive pre-game.
    const clockEl = $('[data-bind="clock"]', g);
    if (clockEl) {
      const c = this.game.clock;
      clockEl.hidden = !c;
      if (c) {
        const rem = c.remaining(seat, Date.now());
        set('clock-time', fmtClock(rem));
        const pregame = !this.game.whiteArmy && !r;
        const canPress = this.ui.awaitingPress === seat && !r; // press-handoff: this seat ends the turn
        clockEl.classList.toggle('armed', pregame || canPress); // tappable (brass)
        clockEl.classList.toggle('active', !r && c.running === seat && c.runningSince != null);
        clockEl.classList.toggle('low', !r && rem < LOW_TIME_MS); // scramble: red tenths
        const btn = $('[data-action="clock"]', clockEl);
        if (btn) btn.disabled = !(pregame || canPress);
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
  _anyOverlay() { return !$('#settings').hidden || !$('#undo').hidden || !$('#endcard').hidden || !$('#help').hidden || !$('#hintcard').hidden; }

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

// Any touch-capable device counts as a tablet (including an iPad with a Magic
// Keyboard / trackpad, which reports (hover: hover)); a device with no touch input
// at all gets a one-time, dismissible warning that this is a two-player tablet game.
function checkDevice() {
  const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  if (touch) return; // looks like a tablet — all good
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
