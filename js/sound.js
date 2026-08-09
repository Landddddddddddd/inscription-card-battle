// Lightweight Web Audio sound effects. No external assets — every sound is
// synthesized from oscillators so the game stays zero-dependency and works
// offline. The AudioContext is created lazily on first use (and resumed on
// first call) to satisfy browser autoplay policies (sound only starts after a
// user gesture, which is exactly when these are first triggered).
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('evil_muted') === '1'; } catch (_) { /* ignore */ }

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (_) { return null; }
  }
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
  return ctx;
}

function tone(freq, dur, type, vol, when) {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + (when || 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol || 0.12, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.03);
}

export const Sound = {
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem('evil_muted', muted ? '1' : '0'); } catch (_) {}
    return muted;
  },
  click()  { tone(440, 0.05, 'square', 0.05); },
  summon() { tone(330, 0.11, 'triangle', 0.10); tone(494, 0.12, 'triangle', 0.07, 0.05); },
  hit()    { tone(170, 0.12, 'sawtooth', 0.11); tone(80, 0.14, 'square', 0.07); },
  scale()  { tone(523, 0.10, 'sine', 0.10); tone(700, 0.12, 'sine', 0.06, 0.05); },
  win()    { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.20, 'triangle', 0.12, i * 0.09)); },
  lose()   { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, 'sawtooth', 0.10, i * 0.10)); },
};
