// All sound goes through one Web Audio context.
// iOS only allows audio after a user gesture, so unlockAudio() must be
// called from the START button's click handler.

let ctx = null;
const buffers = new Map();

export function unlockAudio() {
  // iOS 17+: let Web Audio play even when the ringer switch is on silent.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}

  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();

  // Playing a silent buffer inside the gesture fully unlocks older iOS versions.
  const b = ctx.createBuffer(1, 1, 22050);
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.connect(ctx.destination);
  s.start(0);
}

function beep(freq, dur, when = 0, vol = 0.4) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sounds = {
  /** Exercise change: two quick rising tones. */
  change() { beep(880, 0.2); beep(1320, 0.28, 0.18); },
  /** Get-ready countdown tick. */
  tick() { beep(660, 0.08, 0, 0.25); },
  /** Workout finished: little ascending fanfare. */
  finish() { [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.3, i * 0.15)); },
};

/** Fetch and decode voice clips up front so they play instantly. */
export async function loadClips(urls) {
  if (!ctx) return;
  await Promise.all(urls.filter((u) => !buffers.has(u)).map(async (u) => {
    try {
      const r = await fetch(u);
      if (!r.ok) return;
      buffers.set(u, await ctx.decodeAudioData(await r.arrayBuffer()));
    } catch { /* a missing clip just stays silent */ }
  }));
}

export function playClip(url) {
  const b = buffers.get(url);
  if (!b || !ctx) return;
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.connect(ctx.destination);
  s.start();
}
