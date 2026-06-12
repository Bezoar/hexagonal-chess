// audio.js — subtle move/capture/check cues via the WebAudio API (spec §9.6, §12.5).
// On by default; iOS Safari needs a user gesture before audio can play, so the
// context is created/resumed lazily on the first interaction.

let ctx = null;
let muted = false;

export const setMuted = (m) => { muted = m; };
export const isMuted = () => muted;

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) ctx = new AC();
}

function blip(freq, durMs, gain = 0.05, type = 'sine') {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000);
}

export function play(kind) {
  switch (kind) {
    case 'move': blip(440, 70); break;
    case 'capture': blip(220, 110, 0.06, 'triangle'); break;
    case 'check': blip(660, 90); setTimeout(() => blip(880, 110), 90); break;
    // timed games: a single high blip when a clock first drops under 10s, and a
    // distinct falling two-tone "flag drop" when a clock hits zero.
    case 'lowtime': blip(990, 130, 0.06); break;
    case 'flag': blip(330, 160, 0.07, 'sawtooth'); setTimeout(() => blip(165, 260, 0.07, 'sawtooth'), 140); break;
    default: break;
  }
}
