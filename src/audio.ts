/* ── IRL Race — Procedural Audio (v2 — Multi-Layer Engine) ── */

import { getSettings } from './settings';
import { initNitroAudio, cleanupNitroAudio } from './audio-nitro';
export { playNitroActivate, startNitroBurn, stopNitroBurn, updateNitroBurnIntensity, updateDepletionWarning, stopDepletionWarning, playNitroRelease } from './audio-nitro';

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

export function preloadTitleMusic(): Promise<void> {
  const m = getTitleMusic();
  if (m.readyState >= 3) return Promise.resolve(); // HAVE_FUTURE_DATA+
  return new Promise<void>((resolve) => {
    m.addEventListener('canplaythrough', () => resolve(), { once: true });
    m.load();
  });
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

// ── Sample-based engine audio (3-layer crossfade) ──
let engineLayers: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
let engineMaster: GainNode | null = null;
let engineFilter: BiquadFilterNode | null = null;
let prevGear = 0;
let crackleTimeout: number | null = null;

// One-shot buffers
let bovBuffer: AudioBuffer | null = null;
let spoolBuffer: AudioBuffer | null = null;
let decelBuffer: AudioBuffer | null = null;
let spoolSource: AudioBufferSourceNode | null = null;
let decelSource: AudioBufferSourceNode | null = null;
let _prevNitro = false;
let _prevThrottle = 0;

// Wind noise layer
let windSource: AudioBufferSourceNode | null = null;
let windGain: GainNode | null = null;
let windFilter: BiquadFilterNode | null = null;

const GEAR_RATIOS = [3.2, 2.1, 1.4, 1.0, 0.78];
const GEAR_COUNT = GEAR_RATIOS.length;

// Layer sample files (loaded async)
const ENGINE_SAMPLES = [
  'audio/engine-idle.wav',
  'audio/engine-mid.wav',
  'audio/engine-high.wav',
];
const ONESHOT_SAMPLES = {
  bov: 'audio/turbo-bov.wav',
  spool: 'audio/turbo-spool.wav',
  decel: 'audio/engine-decel.wav',
};

/** Fetch + decode an audio file into an AudioBuffer. */
async function loadSample(url: string): Promise<AudioBuffer | null> {
  if (!audioCtx) return null;
  try {
    const resp = await fetch(url);
    const ab = await resp.arrayBuffer();
    return await audioCtx.decodeAudioData(ab);
  } catch {
    console.warn(`[audio] Failed to load sample: ${url}`);
    return null;
  }
}

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

  // Wire up nitro audio module
  initNitroAudio(audioCtx, masterGain);

  engineMaster = audioCtx.createGain();
  engineMaster.gain.value = 0;

  engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 1200;
  engineFilter.Q.value = 1.0;
  engineFilter.connect(engineMaster);
  engineMaster.connect(masterGain);

  // Load engine layer samples asynchronously
  loadEngineLayers();

  // Load one-shot samples
  loadSample(ONESHOT_SAMPLES.bov).then(buf => { bovBuffer = buf; });
  loadSample(ONESHOT_SAMPLES.spool).then(buf => { spoolBuffer = buf; });
  loadSample(ONESHOT_SAMPLES.decel).then(buf => { decelBuffer = buf; });

  prevGear = 0;
  _prevNitro = false;
  _prevThrottle = 0;

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

/** Load the 3 engine layer samples and create looping sources. */
async function loadEngineLayers() {
  if (!audioCtx || !engineFilter) return;
  const buffers = await Promise.all(ENGINE_SAMPLES.map(url => loadSample(url)));
  // Guard against race — audio may have been stopped while loading
  if (!audioCtx || !engineFilter) return;

  for (const buf of buffers) {
    if (!buf) continue;
    const source = audioCtx.createBufferSource();
    source.buffer = buf;
    source.loop = true;
    source.playbackRate.value = 1.0;
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(engineFilter);
    source.start();
    engineLayers.push({ source, gain });
  }
}

export function updateEngineAudio(speed: number, maxSpeed: number, timeScale = 1.0, isNitro = false, throttle = 0) {
  if (!audioCtx || !engineMaster || engineLayers.length === 0) return;

  const ratio = Math.min(Math.abs(speed) / maxSpeed, 1);
  const t = audioCtx.currentTime;
  const ramp = 0.06;

  // Gear selection based on speed ratio
  const gearFloat = ratio * (GEAR_COUNT - 1);
  const gear = Math.min(Math.floor(gearFloat), GEAR_COUNT - 1);

  // Gear shift event → play turbo BOV
  if (gear !== prevGear && ratio > 0.05) {
    if (gear > prevGear) playTurboBOV();
    prevGear = gear;
  }

  // ── 3-layer equal-power crossfade ──
  // Layer 0 (idle):  peak at ratio=0, fade out by ratio=0.35
  // Layer 1 (mid):   peak at ratio=0.4, fade in from 0.15, fade out by 0.75
  // Layer 2 (high):  peak at ratio=1.0, fade in from 0.5
  const gains = [0, 0, 0];
  if (ratio < 0.35) {
    // Idle → Mid crossfade
    const blend = ratio / 0.35;  // 0→1
    gains[0] = Math.cos(blend * Math.PI / 2); // 1→0
    gains[1] = Math.sin(blend * Math.PI / 2); // 0→1
  } else if (ratio < 0.6) {
    // Mid dominant
    gains[1] = 1;
  } else {
    // Mid → High crossfade
    const blend = (ratio - 0.6) / 0.4; // 0→1
    gains[1] = Math.cos(blend * Math.PI / 2); // 1→0
    gains[2] = Math.sin(blend * Math.PI / 2); // 0→1
  }

  // Pitch scaling: each layer pitches up with speed within its band
  // Idle: 0.85→1.3, Mid: 0.75→1.4, High: 0.7→1.5 (× timeScale for slow-mo)
  const pitches = [
    (0.85 + ratio * 0.45) * timeScale,
    (0.75 + ratio * 0.65) * timeScale,
    (0.7 + ratio * 0.8) * timeScale,
  ];

  for (let i = 0; i < engineLayers.length; i++) {
    const layer = engineLayers[i];
    const vol = gains[i] * getSettings().engineVolume * 0.12;
    layer.gain.gain.setTargetAtTime(vol, t, ramp);
    layer.source.playbackRate.setTargetAtTime(pitches[i], t, ramp);
  }

  // Engine master volume
  const vol = (0.02 + ratio * 0.09) * getSettings().engineVolume;
  engineMaster.gain.setTargetAtTime(vol, t, 0.05);

  if (masterGain) masterGain.gain.setTargetAtTime(getSettings().masterVolume, t, 0.1);

  // Filter opens with RPM
  engineFilter!.frequency.setTargetAtTime(800 + ratio * 1200, t, ramp);

  // Wind noise — volume scales with speed², frequency shifts for whoosh
  if (windGain && windFilter) {
    const windVol = Math.pow(ratio, 2) * 0.06 * getSettings().sfxVolume;
    windGain.gain.setTargetAtTime(windVol, t, 0.1);
    windFilter.frequency.setTargetAtTime(400 + ratio * 1200, t, 0.1);
  }

  // ── Turbo spool layer — play during nitro ──
  if (isNitro && !_prevNitro && spoolBuffer && masterGain) {
    try {
      spoolSource = audioCtx.createBufferSource();
      spoolSource.buffer = spoolBuffer;
      spoolSource.loop = true;
      spoolSource.playbackRate.value = 0.8 + ratio * 0.4;
      const spoolGain = audioCtx.createGain();
      spoolGain.gain.value = 0.06 * getSettings().sfxVolume;
      spoolSource.connect(spoolGain);
      spoolGain.connect(masterGain);
      spoolSource.start();
    } catch {}
  } else if (!isNitro && _prevNitro && spoolSource) {
    try { spoolSource.stop(); } catch {}
    spoolSource = null;
  }
  _prevNitro = isNitro;

  // ── Decel one-shot — throttle released at high speed ──
  if (throttle < 0.1 && _prevThrottle > 0.5 && ratio > 0.4 && decelBuffer && masterGain) {
    try {
      if (decelSource) { try { decelSource.stop(); } catch {} }
      decelSource = audioCtx.createBufferSource();
      decelSource.buffer = decelBuffer;
      decelSource.playbackRate.value = 0.8 + ratio * 0.4;
      const decelGain = audioCtx.createGain();
      decelGain.gain.value = 0.05 * getSettings().sfxVolume;
      decelSource.connect(decelGain);
      decelGain.connect(masterGain);
      decelSource.start();
    } catch {}
  }
  _prevThrottle = throttle;

  // Exhaust crackle on deceleration
  const rpmInGear = gearFloat - gear;
  if (ratio > 0.3 && rpmInGear < 0.15 && speed > 0) {
    if (!crackleTimeout) {
      crackleTimeout = window.setTimeout(() => { crackleTimeout = null; }, 150);
      playExhaustCrackle();
    }
  }
}

/** Play turbo blow-off valve sound on gear upshift. */
function playTurboBOV() {
  if (!audioCtx || !masterGain || !bovBuffer) return;
  const sfxVol = getSettings().sfxVolume;
  const source = audioCtx.createBufferSource();
  source.buffer = bovBuffer;
  source.playbackRate.value = 0.9 + Math.random() * 0.2; // slight pitch variation
  const gain = audioCtx.createGain();
  gain.gain.value = 0.08 * sfxVol;
  source.connect(gain);
  gain.connect(masterGain);
  source.start();
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
  source.stop(audioCtx.currentTime + 0.15); // Bug #4 fix: schedule stop to allow GC
}

let collisionSfxCooldown = 0;

/** Play metallic collision impact sound. intensity 0–1. */
export function playCollisionSFX(intensity: number) {
  if (!audioCtx || !masterGain || intensity < 0.1) return;
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
  // Stop sample-based engine layers
  for (const layer of engineLayers) { try { layer.source.stop(); } catch {} }
  engineLayers = [];
  engineMaster = null;
  engineFilter = null;
  masterGain = null;
  prevGear = 0;
  _prevNitro = false;
  _prevThrottle = 0;
  collisionSfxCooldown = 0;
  if (crackleTimeout) { clearTimeout(crackleTimeout); crackleTimeout = null; }
  if (windSource) { try { windSource.stop(); } catch {} windSource = null; }
  windGain = null; windFilter = null;
  if (spoolSource) { try { spoolSource.stop(); } catch {} spoolSource = null; }
  if (decelSource) { try { decelSource.stop(); } catch {} decelSource = null; }
  // Clean up NOS audio
  cleanupNitroAudio();
  // Note: audioCtx is kept alive as a singleton to avoid hitting browser limits
}

/** Scale game music playback rate for slow-mo effect (ts 0..1 → rate 0.5..1.0). */
export function setMusicTimeScale(ts: number) {
  if (gameMusicAudio) gameMusicAudio.playbackRate = 0.5 + ts * 0.5;
}

/** Play wrong-way warning beep — short descending tone. */
export function playWrongWayBeep() {
  if (!audioCtx || !masterGain) return;
  const sv = getSettings().sfxVolume;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
  gain.gain.setValueAtTime(0.12 * sv, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start();
  osc.stop(now + 0.12);
}

// ── Slow-Mo Entry/Exit SFX ──

/** Descending pitch sweep — "time slowing down" signature sound. */
export function playSlowMoEnter() {
  if (!audioCtx || !masterGain) return;
  const sv = getSettings().sfxVolume;
  const now = audioCtx.currentTime;

  // Primary: descending sine sweep 800→200Hz
  const osc1 = audioCtx.createOscillator();
  const gain1 = audioCtx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(800, now);
  osc1.frequency.exponentialRampToValueAtTime(200, now + 0.18);
  gain1.gain.setValueAtTime(0.18 * sv, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc1.connect(gain1);
  gain1.connect(masterGain);
  osc1.start();
  osc1.stop(now + 0.25);

  // Sub-harmonic for weight: 400→100Hz
  const osc2 = audioCtx.createOscillator();
  const gain2 = audioCtx.createGain();
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(400, now);
  osc2.frequency.exponentialRampToValueAtTime(100, now + 0.2);
  gain2.gain.setValueAtTime(0.1 * sv, now);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc2.connect(gain2);
  gain2.connect(masterGain);
  osc2.start();
  osc2.stop(now + 0.3);
}

/** Ascending pitch snap — "time resuming" signature sound. */
export function playSlowMoExit() {
  if (!audioCtx || !masterGain) return;
  const sv = getSettings().sfxVolume;
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.exponentialRampToValueAtTime(1000, now + 0.1);
  gain.gain.setValueAtTime(0.15 * sv, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start();
  osc.stop(now + 0.12);
}
