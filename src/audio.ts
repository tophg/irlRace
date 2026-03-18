/* ── Hood Racer — Procedural Audio (v2 — Multi-Layer Engine) ── */

import { getSettings } from './settings';

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

// ── Predefined Music Tracks ──
let titleMusicAudio: HTMLAudioElement | null = null;
let gameMusicAudio: HTMLAudioElement | null = null;

function getTitleMusic() {
  if (!titleMusicAudio) {
    titleMusicAudio = new Audio('/audio/title-theme.wav');
    titleMusicAudio.loop = true;
  }
  return titleMusicAudio;
}

function getGameMusic() {
  if (!gameMusicAudio) {
    gameMusicAudio = new Audio('/audio/game-music.wav');
    gameMusicAudio.loop = true;
  }
  return gameMusicAudio;
}

export function playTitleMusic() {
  const s = getSettings();
  const m = getTitleMusic();
  m.volume = s.masterVolume * 0.6;
  // Start 35s into the track for a more impactful intro; loops from beginning after
  if (m.currentTime === 0 || m.paused) m.currentTime = 35;
  m.play().catch(() => console.warn('Browser blocked autoplay build-up'));
  if (gameMusicAudio && !gameMusicAudio.paused) gameMusicAudio.pause();
}

export function playGameMusic() {
  const s = getSettings();
  const m = getGameMusic();
  m.volume = s.masterVolume * 0.4; // scaled slightly
  m.play().catch(() => {});
  if (titleMusicAudio && !titleMusicAudio.paused) titleMusicAudio.pause();
}

export function pauseMusic() {
  if (titleMusicAudio && !titleMusicAudio.paused) titleMusicAudio.pause();
  if (gameMusicAudio && !gameMusicAudio.paused) gameMusicAudio.pause();
}

export function resumeMusic() {
  // We only resume game music, since we only pause during a race
  if (gameMusicAudio) gameMusicAudio.play().catch(() => {});
}

export function stopAllMusic() {
  if (titleMusicAudio) { titleMusicAudio.pause(); titleMusicAudio.currentTime = 0; }
  if (gameMusicAudio) { gameMusicAudio.pause(); gameMusicAudio.currentTime = 0; }
}

export function updateMusicVolume() {
  const s = getSettings();
  if (titleMusicAudio) titleMusicAudio.volume = s.masterVolume * 0.6;
  if (gameMusicAudio) gameMusicAudio.volume = s.masterVolume * 0.4;
}

// Multi-oscillator engine (fundamental + 2 harmonics)
let engineOscs: OscillatorNode[] = [];
let engineGains: GainNode[] = [];
let engineMaster: GainNode | null = null;
let engineFilter: BiquadFilterNode | null = null;
let prevGear = 0;
let crackleTimeout: number | null = null;

// Wind noise layer
let windSource: AudioBufferSourceNode | null = null;
let windGain: GainNode | null = null;
let windFilter: BiquadFilterNode | null = null;

const GEAR_RATIOS = [3.2, 2.1, 1.4, 1.0, 0.78];
const GEAR_COUNT = GEAR_RATIOS.length;
const IDLE_FREQ = 75;
const REDLINE_FREQ = 320;

export function initAudio() {
  stopAudio();

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

  const s = getSettings();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = s.masterVolume;
  masterGain.connect(audioCtx.destination);

  engineMaster = audioCtx.createGain();
  engineMaster.gain.value = 0;

  engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 800;
  engineFilter.Q.value = 1.5;
  engineFilter.connect(engineMaster);
  engineMaster.connect(masterGain);

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

  // Wind noise layer (persistent white noise through bandpass)
  const windBufLen = audioCtx.sampleRate * 2;
  const windBuf = audioCtx.createBuffer(1, windBufLen, audioCtx.sampleRate);
  const windData = windBuf.getChannelData(0);
  for (let i = 0; i < windBufLen; i++) windData[i] = Math.random() * 2 - 1;
  windSource = audioCtx.createBufferSource();
  windSource.buffer = windBuf;
  windSource.loop = true;
  windFilter = audioCtx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 400;
  windFilter.Q.value = 0.8;
  windGain = audioCtx.createGain();
  windGain.gain.value = 0;
  windSource.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(masterGain);
  windSource.start();
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

  // Engine volume (scaled by settings)
  const vol = (0.02 + ratio * 0.09) * getSettings().engineVolume;
  engineMaster.gain.setTargetAtTime(vol, t, 0.05);

  if (masterGain) masterGain.gain.setTargetAtTime(getSettings().masterVolume, t, 0.1);

  // Filter opens with RPM
  engineFilter!.frequency.setTargetAtTime(600 + rpmInGear * 600, t, ramp);

  // Wind noise — volume scales with speed², frequency shifts for whoosh
  if (windGain && windFilter) {
    const windVol = Math.pow(ratio, 2) * 0.06 * getSettings().sfxVolume;
    windGain.gain.setTargetAtTime(windVol, t, 0.1);
    windFilter.frequency.setTargetAtTime(400 + ratio * 1200, t, 0.1);
  }

  // Exhaust crackle on deceleration (RPM dropping while speed is high)
  if (ratio > 0.3 && rpmInGear < 0.15 && speed > 0) {
    if (!crackleTimeout) {
      crackleTimeout = window.setTimeout(() => { crackleTimeout = null; }, 150);
      playExhaustCrackle();
    }
  }
}

function playGearShiftPop() {
  if (!audioCtx || !masterGain) return;
  const sfxVol = getSettings().sfxVolume;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(60, audioCtx.currentTime + 0.06);
  gain.gain.setValueAtTime(0.08 * sfxVol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.08);
}

function playExhaustCrackle() {
  if (!audioCtx || !masterGain) return;
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
  gain.gain.value = 0.06 * getSettings().sfxVolume;
  src.connect(flt);
  flt.connect(gain);
  gain.connect(masterGain);
  src.start();
}

/** Play a checkpoint chirp with sub-bass thump. */
export function playCheckpointSFX() {
  if (!audioCtx || !masterGain) return;
  const sv = getSettings().sfxVolume;
  const now = audioCtx.currentTime;

  // High chirp (ascending sine)
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, now);
  osc.frequency.exponentialRampToValueAtTime(1800, now + 0.1);
  gain.gain.setValueAtTime(0.15 * sv, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start();
  osc.stop(now + 0.15);

  // Sub-bass thump (80Hz sine, 120ms)
  const bass = audioCtx.createOscillator();
  const bassGain = audioCtx.createGain();
  bass.type = 'sine';
  bass.frequency.value = 80;
  bassGain.gain.setValueAtTime(0.2 * sv, now);
  bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  bass.connect(bassGain);
  bassGain.connect(masterGain);
  bass.start();
  bass.stop(now + 0.12);
}

/** Play a lap completion fanfare. */
export function playLapFanfare() {
  if (!audioCtx || !masterGain) return;
  const sv = getSettings().sfxVolume;
  const dest = masterGain;
  const notes = [523, 659, 784];
  notes.forEach((freq, i) => {
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, audioCtx!.currentTime + i * 0.08);
    gain.gain.linearRampToValueAtTime(0.12 * sv, audioCtx!.currentTime + i * 0.08 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx!.currentTime + i * 0.08 + 0.4);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(audioCtx!.currentTime + i * 0.08);
    osc.stop(audioCtx!.currentTime + i * 0.08 + 0.4);
  });
}

/** Play a race finish fanfare — triumphant ascending arpeggio + sustained chord. */
export function playFinishFanfare() {
  if (!audioCtx || !masterGain) return;
  const sv = getSettings().sfxVolume;
  const dest = masterGain;
  const now = audioCtx.currentTime;

  // Ascending arpeggio: C5→E5→G5→C6
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const start = now + i * 0.1;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.15 * sv, start + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(start);
    osc.stop(start + 0.6);
  });

  // Sustained major chord after arpeggio (C5+E5+G5, sine, 1s)
  const chordNotes = [523, 659, 784];
  chordNotes.forEach((freq) => {
    const osc = audioCtx!.createOscillator();
    const gain = audioCtx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = now + 0.4;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.08 * sv, start + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 1.2);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(start);
    osc.stop(start + 1.2);
  });
}

/** Play tire screech on heavy drift. */
export function playDriftSFX(intensity: number) {
  if (!audioCtx || !masterGain || intensity < 0.3) return;

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
  gain.connect(masterGain!);
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
  gain.connect(masterGain!);
  source.start();
  source.stop(audioCtx.currentTime + 0.25);
}

/** Play position change audio cue. Ascending chirp = gained, descending = lost. */
export function playPositionSFX(gained: boolean) {
  if (!audioCtx || !masterGain) return;
  const sv = getSettings().sfxVolume;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  const t = audioCtx.currentTime;
  if (gained) {
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.12);
  } else {
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.12);
  }
  gain.gain.setValueAtTime(0.15 * sv, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start();
  osc.stop(t + 0.15);
}

// ── Nitrous SFX (procedural — zero external assets) ──

// Persistent burn hiss nodes (long-lived, start/stop with NOS)
let nitroHissSource: AudioBufferSourceNode | null = null;
let nitroHissGain: GainNode | null = null;
let nitroHissFilter: BiquadFilterNode | null = null;
let nitroHissLFO: OscillatorNode | null = null;
let nitroHissLFOGain: GainNode | null = null;
// Surge whistle
let nitroWhistleOsc: OscillatorNode | null = null;
let nitroWhistleGain: GainNode | null = null;
// Depletion warning
let depletionInterval: number | null = null;

/**
 * SFX 1: NOS activation blast — punchy low-frequency transient + air burst.
 * Inspired by NFS Underground 2's iconic NOS engage sound.
 */
export function playNitroActivate() {
  if (!audioCtx || !masterGain) return;
  const t = audioCtx.currentTime;
  const sv = getSettings().sfxVolume;

  // Component 1: Sub-bass thump (60Hz sine, 80ms decay)
  const thump = audioCtx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(60, t);
  thump.frequency.exponentialRampToValueAtTime(30, t + 0.08);
  const thumpGain = audioCtx.createGain();
  thumpGain.gain.setValueAtTime(0.3 * sv, t);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  thump.connect(thumpGain);
  thumpGain.connect(masterGain);
  thump.start(t);
  thump.stop(t + 0.12);

  // Component 2: Air burst (white noise → highpass 2kHz, 120ms decay)
  const burstLen = Math.floor(audioCtx.sampleRate * 0.12);
  const burstBuf = audioCtx.createBuffer(1, burstLen, audioCtx.sampleRate);
  const burstData = burstBuf.getChannelData(0);
  for (let i = 0; i < burstLen; i++) {
    burstData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (burstLen * 0.25));
  }
  const burstSrc = audioCtx.createBufferSource();
  burstSrc.buffer = burstBuf;
  const burstFilter = audioCtx.createBiquadFilter();
  burstFilter.type = 'highpass';
  burstFilter.frequency.value = 2000;
  const burstGain = audioCtx.createGain();
  burstGain.gain.setValueAtTime(0.15 * sv, t);
  burstGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  burstSrc.connect(burstFilter);
  burstFilter.connect(burstGain);
  burstGain.connect(masterGain);
  burstSrc.start(t);

  // Component 3: Metallic ping (1800Hz sine, 40ms — "valve opening" character)
  const ping = audioCtx.createOscillator();
  ping.type = 'sine';
  ping.frequency.value = 1800;
  const pingGain = audioCtx.createGain();
  pingGain.gain.setValueAtTime(0.06 * sv, t);
  pingGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  ping.connect(pingGain);
  pingGain.connect(masterGain);
  ping.start(t);
  ping.stop(t + 0.05);
}

/**
 * SFX 2+3: Start sustained NOS burn hiss + surge whistle.
 * Continuous pressurized gas release with LFO modulation and rising pitch whine.
 */
export function startNitroBurn() {
  if (!audioCtx || !masterGain) return;
  stopNitroBurn(); // clean up any previous instance
  const sv = getSettings().sfxVolume;
  const t = audioCtx.currentTime;

  // ── Burn hiss: white noise → bandpass (3kHz) ──
  const hissLen = audioCtx.sampleRate * 2;
  const hissBuf = audioCtx.createBuffer(1, hissLen, audioCtx.sampleRate);
  const hissData = hissBuf.getChannelData(0);
  for (let i = 0; i < hissLen; i++) hissData[i] = Math.random() * 2 - 1;

  nitroHissSource = audioCtx.createBufferSource();
  nitroHissSource.buffer = hissBuf;
  nitroHissSource.loop = true;

  nitroHissFilter = audioCtx.createBiquadFilter();
  nitroHissFilter.type = 'bandpass';
  nitroHissFilter.frequency.value = 3000;
  nitroHissFilter.Q.value = 1.5;

  // LFO modulates bandpass center ±300Hz at 6Hz
  nitroHissLFO = audioCtx.createOscillator();
  nitroHissLFO.type = 'sine';
  nitroHissLFO.frequency.value = 6;
  nitroHissLFOGain = audioCtx.createGain();
  nitroHissLFOGain.gain.value = 300;
  nitroHissLFO.connect(nitroHissLFOGain);
  nitroHissLFOGain.connect(nitroHissFilter.frequency);
  nitroHissLFO.start(t);

  nitroHissGain = audioCtx.createGain();
  nitroHissGain.gain.setValueAtTime(0, t);
  nitroHissGain.gain.linearRampToValueAtTime(0.04 * sv, t + 0.2); // fade in 0.2s

  nitroHissSource.connect(nitroHissFilter);
  nitroHissFilter.connect(nitroHissGain);
  nitroHissGain.connect(masterGain);
  nitroHissSource.start(t);

  // ── Surge whistle: rising sine 800→2400Hz ──
  nitroWhistleOsc = audioCtx.createOscillator();
  nitroWhistleOsc.type = 'sine';
  nitroWhistleOsc.frequency.setValueAtTime(800, t);
  // Ramp to 2400Hz over ~5 seconds (full NOS tank duration)
  nitroWhistleOsc.frequency.linearRampToValueAtTime(2400, t + 5);

  nitroWhistleGain = audioCtx.createGain();
  nitroWhistleGain.gain.setValueAtTime(0, t);
  nitroWhistleGain.gain.linearRampToValueAtTime(0.015 * sv, t + 0.5); // slow fade-in

  nitroWhistleOsc.connect(nitroWhistleGain);
  nitroWhistleGain.connect(masterGain);
  nitroWhistleOsc.start(t);
}

/**
 * Update NOS burn intensity (call each frame while NOS is active).
 * Volume increases as nitro depletes (more pressure = louder hiss).
 * @param nitroPct 0–100
 */
export function updateNitroBurnIntensity(nitroPct: number) {
  if (!audioCtx || !nitroHissGain || !nitroWhistleGain) return;
  const sv = getSettings().sfxVolume;
  const t = audioCtx.currentTime;
  // Louder as tank empties: 0.04 at 100% → 0.08 at 0%
  const hissVol = (0.04 + (1 - nitroPct / 100) * 0.04) * sv;
  nitroHissGain.gain.setTargetAtTime(hissVol, t, 0.05);
  // Whistle volume also rises
  const whistleVol = (0.015 + (1 - nitroPct / 100) * 0.02) * sv;
  nitroWhistleGain.gain.setTargetAtTime(whistleVol, t, 0.05);
}

/** Stop the sustained NOS burn hiss + whistle. */
export function stopNitroBurn() {
  if (nitroHissSource) { try { nitroHissSource.stop(); } catch {} nitroHissSource = null; }
  if (nitroHissLFO) { try { nitroHissLFO.stop(); } catch {} nitroHissLFO = null; }
  if (nitroWhistleOsc) { try { nitroWhistleOsc.stop(); } catch {} nitroWhistleOsc = null; }
  nitroHissGain = null;
  nitroHissFilter = null;
  nitroHissLFOGain = null;
  nitroWhistleGain = null;
}

/**
 * SFX 4: Depletion warning — accelerating tick when tank < 15%.
 * @param nitroPct Current nitro percentage (0–100)
 */
export function updateDepletionWarning(nitroPct: number) {
  if (!audioCtx || !masterGain) return;

  if (nitroPct > 15 || nitroPct <= 0) {
    // Stop ticking
    if (depletionInterval !== null) {
      clearInterval(depletionInterval);
      depletionInterval = null;
    }
    return;
  }

  // Already ticking — rate adjustment happens via interval restart
  if (depletionInterval !== null) return;

  const playTick = () => {
    if (!audioCtx || !masterGain) return;
    const sv = getSettings().sfxVolume;
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 2000;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.06 * sv, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.01);
    osc.connect(gain);
    gain.connect(masterGain!);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.015);
  };

  // Rate: 250ms at 15% → 80ms at 2% (accelerating urgency)
  const rate = 80 + (nitroPct / 15) * 170;
  depletionInterval = window.setInterval(playTick, rate);
  playTick(); // immediate first tick
}

/** Stop depletion warning. */
export function stopDepletionWarning() {
  if (depletionInterval !== null) {
    clearInterval(depletionInterval);
    depletionInterval = null;
  }
}

/**
 * SFX 5: NOS release — turbo flutter / blow-off valve "pssh".
 * Called on the falling edge of NOS deactivation.
 */
export function playNitroRelease() {
  if (!audioCtx || !masterGain) return;
  const t = audioCtx.currentTime;
  const sv = getSettings().sfxVolume;

  // Component 1: Blow-off "pssh" (white noise → bandpass 1.5kHz, 150ms decay)
  const pssLen = Math.floor(audioCtx.sampleRate * 0.15);
  const pssBuf = audioCtx.createBuffer(1, pssLen, audioCtx.sampleRate);
  const pssData = pssBuf.getChannelData(0);
  for (let i = 0; i < pssLen; i++) {
    pssData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (pssLen * 0.2));
  }
  const pssSrc = audioCtx.createBufferSource();
  pssSrc.buffer = pssBuf;
  const pssFilter = audioCtx.createBiquadFilter();
  pssFilter.type = 'bandpass';
  pssFilter.frequency.value = 1500;
  pssFilter.Q.value = 2;
  const pssGain = audioCtx.createGain();
  pssGain.gain.setValueAtTime(0.08 * sv, t);
  pssGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  pssSrc.connect(pssFilter);
  pssFilter.connect(pssGain);
  pssGain.connect(masterGain);
  pssSrc.start(t);

  // Component 2: Flutter — rapid sine pulses (400Hz, 4 × 10ms on/off)
  for (let i = 0; i < 4; i++) {
    const pulseStart = t + 0.06 + i * 0.02;
    const flutter = audioCtx.createOscillator();
    flutter.type = 'sine';
    flutter.frequency.value = 400 - i * 30; // descending pitch
    const flutterGain = audioCtx.createGain();
    flutterGain.gain.setValueAtTime(0.04 * sv * (1 - i * 0.2), pulseStart);
    flutterGain.gain.exponentialRampToValueAtTime(0.001, pulseStart + 0.01);
    flutter.connect(flutterGain);
    flutterGain.connect(masterGain);
    flutter.start(pulseStart);
    flutter.stop(pulseStart + 0.012);
  }
}

// ── Countdown engine rev (rising idle) ──
let countdownRevTimers: number[] = [];
export function playCountdownRevs() {
  stopCountdownRevs();
  if (!audioCtx || !masterGain) return;
  const vol = getSettings().sfxVolume * 0.25;
  if (vol <= 0) return;
  const ctx = audioCtx;
  const dest = masterGain;

  const revFreqs = [100, 120, 160]; // rising pitch per countdown step
  revFreqs.forEach((freq, i) => {
    const id = window.setTimeout(() => {
      if (!ctx || ctx.state === 'closed') return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(vol * 1.5, ctx.currentTime + 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      osc.stop(ctx.currentTime + 0.85);
    }, i * 900);
    countdownRevTimers.push(id);
  });
}

export function stopCountdownRevs() {
  for (const id of countdownRevTimers) clearTimeout(id);
  countdownRevTimers = [];
}

// ── Rumble strip audio (kerb contact) ──
let rumbleCooldown = 0;
export function playRumbleStrip() {
  if (!audioCtx || !masterGain) return;
  const now = performance.now();
  if (now - rumbleCooldown < 80) return; // debounce
  rumbleCooldown = now;

  const vol = getSettings().sfxVolume * 0.15;
  if (vol <= 0) return;
  const ctx = audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 60;
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start();
  osc.stop(ctx.currentTime + 0.08);
}

export function stopAudio() {
  stopAllMusic();
  for (const osc of engineOscs) { try { osc.stop(); } catch {} }
  engineOscs = [];
  engineGains = [];
  engineMaster = null;
  engineFilter = null;
  masterGain = null;
  prevGear = 0;
  collisionSfxCooldown = 0;
  if (crackleTimeout) { clearTimeout(crackleTimeout); crackleTimeout = null; }
  if (windSource) { try { windSource.stop(); } catch {} windSource = null; }
  windGain = null; windFilter = null;
  // Clean up NOS audio
  stopNitroBurn();
  stopDepletionWarning();
  // Note: audioCtx is kept alive as a singleton to avoid hitting browser limits
}
