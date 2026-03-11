/* ── Hood Racer — Procedural Audio (v2 — Multi-Layer Engine) ── */

let audioCtx: AudioContext | null = null;

// Multi-oscillator engine (fundamental + 2 harmonics)
let engineOscs: OscillatorNode[] = [];
let engineGains: GainNode[] = [];
let engineMaster: GainNode | null = null;
let engineFilter: BiquadFilterNode | null = null;
let prevGear = 0;
let crackleTimeout: number | null = null;

const GEAR_RATIOS = [3.2, 2.1, 1.4, 1.0, 0.78];
const GEAR_COUNT = GEAR_RATIOS.length;
const IDLE_FREQ = 75;
const REDLINE_FREQ = 320;

export function initAudio() {
  stopAudio();

  audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

  engineMaster = audioCtx.createGain();
  engineMaster.gain.value = 0;

  engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 800;
  engineFilter.Q.value = 1.5;
  engineFilter.connect(engineMaster);
  engineMaster.connect(audioCtx.destination);

  // Layer 1: fundamental (sawtooth — raw engine rumble)
  const osc1 = audioCtx.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.value = IDLE_FREQ;
  const g1 = audioCtx.createGain();
  g1.gain.value = 0.6;
  osc1.connect(g1);
  g1.connect(engineFilter);
  osc1.start();

  // Layer 2: 2nd harmonic (square — adds punch)
  const osc2 = audioCtx.createOscillator();
  osc2.type = 'square';
  osc2.frequency.value = IDLE_FREQ * 2;
  const g2 = audioCtx.createGain();
  g2.gain.value = 0.15;
  osc2.connect(g2);
  g2.connect(engineFilter);
  osc2.start();

  // Layer 3: 3rd harmonic (triangle — high-end buzz)
  const osc3 = audioCtx.createOscillator();
  osc3.type = 'triangle';
  osc3.frequency.value = IDLE_FREQ * 3;
  const g3 = audioCtx.createGain();
  g3.gain.value = 0.08;
  osc3.connect(g3);
  g3.connect(engineFilter);
  osc3.start();

  engineOscs = [osc1, osc2, osc3];
  engineGains = [g1, g2, g3];
  prevGear = 0;
}

export function updateEngineAudio(speed: number, maxSpeed: number) {
  if (!audioCtx || !engineMaster || engineOscs.length === 0) return;

  const ratio = Math.min(Math.abs(speed) / maxSpeed, 1);

  // Gear selection based on speed ratio
  const gearFloat = ratio * (GEAR_COUNT - 1);
  const gear = Math.min(Math.floor(gearFloat), GEAR_COUNT - 1);
  const rpmInGear = gearFloat - gear;

  // Gear shift event
  if (gear !== prevGear && ratio > 0.05) {
    if (gear > prevGear) playGearShiftPop();
    prevGear = gear;
  }

  // Map RPM within current gear to frequency
  const freq = IDLE_FREQ + rpmInGear * (REDLINE_FREQ - IDLE_FREQ);
  const t = audioCtx.currentTime;
  const ramp = 0.06;
  engineOscs[0].frequency.setTargetAtTime(freq, t, ramp);
  engineOscs[1].frequency.setTargetAtTime(freq * 2, t, ramp);
  engineOscs[2].frequency.setTargetAtTime(freq * 3, t, ramp);

  // Harmonic mix shifts with RPM — more 2nd harmonic at high RPM
  engineGains[0].gain.setTargetAtTime(0.5 + rpmInGear * 0.15, t, ramp);
  engineGains[1].gain.setTargetAtTime(0.10 + rpmInGear * 0.18, t, ramp);
  engineGains[2].gain.setTargetAtTime(0.05 + rpmInGear * 0.10, t, ramp);

  // Master volume
  const vol = 0.02 + ratio * 0.09;
  engineMaster.gain.setTargetAtTime(vol, t, 0.05);

  // Filter opens with RPM
  engineFilter!.frequency.setTargetAtTime(600 + rpmInGear * 600, t, ramp);

  // Exhaust crackle on deceleration (RPM dropping while speed is high)
  if (ratio > 0.3 && rpmInGear < 0.15 && speed > 0) {
    if (!crackleTimeout) {
      crackleTimeout = window.setTimeout(() => { crackleTimeout = null; }, 150);
      playExhaustCrackle();
    }
  }
}

function playGearShiftPop() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(60, audioCtx.currentTime + 0.06);
  gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.08);
}

function playExhaustCrackle() {
  if (!audioCtx) return;
  const len = Math.floor(audioCtx.sampleRate * 0.04);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.2));
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const flt = audioCtx.createBiquadFilter();
  flt.type = 'highpass';
  flt.frequency.value = 1500;
  const gain = audioCtx.createGain();
  gain.gain.value = 0.06;
  src.connect(flt);
  flt.connect(gain);
  gain.connect(audioCtx.destination);
  src.start();
}

/** Play a checkpoint chirp. */
export function playCheckpointSFX() {
  if (!audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1800, audioCtx.currentTime + 0.1);
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.15);
}

/** Play a lap completion fanfare. */
export function playLapFanfare() {
  if (!audioCtx) return;

  const notes = [523, 659, 784]; // C5, E5, G5 — major chord
  notes.forEach((freq, i) => {
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, audioCtx!.currentTime + i * 0.08);
    gain.gain.linearRampToValueAtTime(0.12, audioCtx!.currentTime + i * 0.08 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx!.currentTime + i * 0.08 + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx!.destination);
    osc.start(audioCtx!.currentTime + i * 0.08);
    osc.stop(audioCtx!.currentTime + i * 0.08 + 0.4);
  });
}

/** Play tire screech on heavy drift. */
export function playDriftSFX(intensity: number) {
  if (!audioCtx || intensity < 0.3) return;

  // White noise through bandpass for screech
  const bufferSize = audioCtx.sampleRate * 0.15;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * intensity;
  }

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 3000 + intensity * 2000;
  filter.Q.value = 2;

  const gain = audioCtx.createGain();
  gain.gain.value = 0.04 * intensity;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  source.start();
}

let collisionSfxCooldown = 0;

/** Play metallic collision impact sound. intensity 0–1. */
export function playCollisionSFX(intensity: number) {
  if (!audioCtx || intensity < 0.1) return;
  const now = audioCtx.currentTime;
  if (now - collisionSfxCooldown < 0.08) return;
  collisionSfxCooldown = now;

  // Metallic clang: short burst of white noise + resonant filter
  const bufferSize = Math.floor(audioCtx.sampleRate * (0.08 + intensity * 0.12));
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const env = Math.exp(-i / (bufferSize * 0.3));
    data[i] = (Math.random() * 2 - 1) * env;
  }

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800 + intensity * 600;
  filter.Q.value = 3;

  const hiFilter = audioCtx.createBiquadFilter();
  hiFilter.type = 'highshelf';
  hiFilter.frequency.value = 2000;
  hiFilter.gain.value = intensity * 8;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.1 + intensity * 0.15, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15 + intensity * 0.1);

  source.connect(filter);
  filter.connect(hiFilter);
  hiFilter.connect(gain);
  gain.connect(audioCtx.destination);
  source.start();
  source.stop(audioCtx.currentTime + 0.25);
}

export function stopAudio() {
  for (const osc of engineOscs) { try { osc.stop(); } catch {} }
  engineOscs = [];
  engineGains = [];
  engineMaster = null;
  engineFilter = null;
  prevGear = 0;
  collisionSfxCooldown = 0;
  if (crackleTimeout) { clearTimeout(crackleTimeout); crackleTimeout = null; }
  if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
}
