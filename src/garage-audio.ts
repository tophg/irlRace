/* ── Hood Racer — Garage Procedural SFX ──
 *
 * Extracted from garage.ts. All sounds are synthesized via Web Audio API
 * (no sample files needed).
 */

let garageSfxCtx: AudioContext | null = null;

function getGarageSfxCtx(): AudioContext {
  if (!garageSfxCtx) garageSfxCtx = new AudioContext();
  return garageSfxCtx;
}

/** Short mechanical "click-whirr" for car switching. */
export function playClickSfx() {
  try {
    const ctx = getGarageSfxCtx();
    const now = ctx.currentTime;

    // Click: short noise burst
    const bufSize = ctx.sampleRate * 0.03;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    noise.connect(noiseGain).connect(ctx.destination);
    noise.start(now);

    // Whirr: short sine sweep
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.08);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.06, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  } catch {}
}

/** Satisfying "confirm" chord for selection. */
export function playConfirmSfx() {
  try {
    const ctx = getGarageSfxCtx();
    const now = ctx.currentTime;
    [523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.1, now + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3 + i * 0.05);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.05);
      osc.stop(now + 0.35 + i * 0.05);
    });
  } catch {}
}

/** "Cha-ching" unlock sound. */
export function playUnlockSfx() {
  try {
    const ctx = getGarageSfxCtx();
    const now = ctx.currentTime;
    // Metallic ping
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(2400, now + 0.15);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.45);
    // Shimmer
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 3200;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.04, now + 0.1);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(g2).connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.55);
  } catch {}
}

/** Paint spray hiss. */
export function playSpraySfx() {
  try {
    const ctx = getGarageSfxCtx();
    const now = ctx.currentTime;
    const bufSize = ctx.sampleRate * 0.15;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(now);
  } catch {}
}

/** Dispose the AudioContext on garage teardown. */
export function destroyGarageSfx() {
  if (garageSfxCtx) {
    garageSfxCtx.close().catch(() => {});
    garageSfxCtx = null;
  }
}
