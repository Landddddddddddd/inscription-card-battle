// Procedural sound effects via the Web Audio API — no audio files needed.
// Every sound is synthesized on the fly (oscillators + noise), so it works
// fully offline with zero assets. The module is Node-safe: if there is no
// browser AudioContext it silently no-ops, so engine/ai/headless sims that
// happen to import it never throw.

let ctx = null;
let master = null;
let muted = false;
let unlocked = false;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  } catch (_) { ctx = null; }
  return ctx;
}

// Browsers require a user gesture before audio can start. Call this from the
// first click / keypress so the context is "running".
export function unlockAudio() {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  unlocked = true;
}

export function setMuted(m) { muted = !!m; }
export function isMuted() { return muted; }
export function loadMute(m) { muted = !!m; }

// --- low-level voice ---------------------------------------------------
function tone(freq, dur, opts = {}) {
  const c = ensureCtx();
  if (!c || muted || !unlocked) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, opts.slideTo), t0 + dur);
  const peak = opts.gain != null ? opts.gain : 0.5;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function noise(dur, opts = {}) {
  const c = ensureCtx();
  if (!c || muted || !unlocked) return;
  const t0 = c.currentTime;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain != null ? opts.gain : 0.35, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const filt = c.createBiquadFilter();
  filt.type = opts.filter || 'highpass';
  filt.frequency.value = opts.freq || 800;
  src.connect(filt); filt.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

// --- named effects -----------------------------------------------------
export const SFX = {
  click()    { tone(520, 0.05, { type: 'square', gain: 0.18 }); },
  play()     { tone(360, 0.12, { type: 'triangle', slideTo: 540 }); },
  summon()   { tone(300, 0.16, { type: 'sine', slideTo: 620, gain: 0.4 }); },
  sacrifice(){ noise(0.22, { filter: 'lowpass', freq: 500, gain: 0.4 }); tone(140, 0.2, { type: 'sawtooth', slideTo: 70, gain: 0.3 }); },
  bone()     { noise(0.1, { filter: 'bandpass', freq: 1100, gain: 0.32 }); tone(200, 0.12, { type: 'square', slideTo: 330, gain: 0.22 }); },
  attack()   { tone(220, 0.09, { type: 'sawtooth', slideTo: 150 }); noise(0.08, { filter: 'bandpass', freq: 1200, gain: 0.25 }); },
  hit()      { noise(0.14, { filter: 'highpass', freq: 600, gain: 0.4 }); tone(180, 0.1, { type: 'square', slideTo: 90, gain: 0.25 }); },
  scale()    { tone(660, 0.14, { type: 'sine', slideTo: 880, gain: 0.35 }); },
  pack()     { tone(440, 0.1, { type: 'triangle' }); setTimeout(() => tone(660, 0.12, { type: 'triangle' }), 90); setTimeout(() => tone(880, 0.18, { type: 'triangle' }), 200); },
  win()      { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.22, { type: 'triangle', gain: 0.5 }), i * 110)); },
  lose()     { [392, 311, 233].forEach((f, i) => setTimeout(() => tone(f, 0.3, { type: 'sawtooth', gain: 0.4 }), i * 140)); },
  error()    { tone(160, 0.16, { type: 'square', slideTo: 110, gain: 0.3 }); },
};

// Convenience: play by key, e.g. playSfx('hit').
export function playSfx(name) { const f = SFX[name]; if (f) f(); }
