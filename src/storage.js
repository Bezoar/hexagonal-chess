// storage.js — three independent local-storage stores (spec §10.1):
// Settings, the match scoreboard, and the live game. All access is guarded so a
// blocked/unavailable localStorage (private mode) degrades to in-memory defaults.

const PREFIX = 'hexchess:';
const KEYS = { settings: PREFIX + 'settings', match: PREFIX + 'match', game: PREFIX + 'game' };

export const DEFAULT_SETTINGS = {
  stalemateAsDraw: false,
  threefold: true,
  fiftyMove: true,
  requestDraw: true,
  requestUndo: true,
  theme: 'dark',
  coords: false,
  sound: true,
  clockPreset: 'off', // 'off' | '5+0' | '10+0' (keys of CLOCK_PRESETS in ui.js)
  clockHandoff: 'auto', // 'auto' (switch on your move) | 'press' (tap your clock to end the turn)
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — keep running in memory */
  }
}

export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) });
export const saveSettings = (s) => write(KEYS.settings, s);

export const loadMatch = () => read(KEYS.match, null);
export const saveMatch = (m) => write(KEYS.match, m);

export const loadGame = () => read(KEYS.game, null);
export const saveGame = (g) => write(KEYS.game, g);
