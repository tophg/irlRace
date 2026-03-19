/* ── IRL Race — Nitrous Sound Effects (procedural) ──
 *
 * Extracted from audio.ts. All NOS-related SFX:
 *   • Activation blast (sub-bass thump + air burst + metallic ping)
 *   • Sustained burn hiss + surge whistle
 *   • Burn intensity modulation
 *   • Depletion warning (accelerating tick)
 *   • Release blow-off valve
 */

import { getSettings } from './settings';

// Audio context injected from main audio module
let _audioCtx: AudioContext | null = null;
let _masterGain: GainNode | null = null;

/** Wire up the shared AudioContext and master gain from audio.ts. */
export function initNitroAudio(ctx: AudioContext, master: GainNode) {
  _audioCtx = ctx;
  _masterGain = master;
}

/** Cleanup references (called by stopAudio). */
export function cleanupNitroAudio() {
  stopNitroBurn();
  stopDepletionWarning();
  _audioCtx = null;
  _masterGain = null;
}

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
  if (!_audioCtx || !_masterGain) return;
  const t = _audioCtx.currentTime;
  const sv = getSettings().sfxVolume;

  // Component 1: Sub-bass thump (60Hz sine, 80ms decay)
  const thump = _audioCtx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(60, t);
  thump.frequency.exponentialRampToValueAtTime(30, t + 0.08);
  const thumpGain = _audioCtx.createGain();
  thumpGain.gain.setValueAtTime(0.3 * sv, t);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  thump.connect(thumpGain);
  thumpGain.connect(_masterGain);
  thump.start(t);
  thump.stop(t + 0.12);

  // Component 2: Air burst (white noise → highpass 2kHz, 120ms decay)
  const burstLen = Math.floor(_audioCtx.sampleRate * 0.12);
  const burstBuf = _audioCtx.createBuffer(1, burstLen, _audioCtx.sampleRate);
  const burstData = burstBuf.getChannelData(0);
  for (let i = 0; i < burstLen; i++) {
    burstData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (burstLen * 0.25));
  }
  const burstSrc = _audioCtx.createBufferSource();
  burstSrc.buffer = burstBuf;
  const burstFilter = _audioCtx.createBiquadFilter();
  burstFilter.type = 'highpass';
  burstFilter.frequency.value = 2000;
  const burstGain = _audioCtx.createGain();
  burstGain.gain.setValueAtTime(0.15 * sv, t);
  burstGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  burstSrc.connect(burstFilter);
  burstFilter.connect(burstGain);
  burstGain.connect(_masterGain);
  burstSrc.start(t);

  // Component 3: Metallic ping (1800Hz sine, 40ms — "valve opening" character)
  const ping = _audioCtx.createOscillator();
  ping.type = 'sine';
  ping.frequency.value = 1800;
  const pingGain = _audioCtx.createGain();
  pingGain.gain.setValueAtTime(0.06 * sv, t);
  pingGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  ping.connect(pingGain);
  pingGain.connect(_masterGain);
  ping.start(t);
  ping.stop(t + 0.05);
}

/**
 * SFX 2+3: Start sustained NOS burn hiss + surge whistle.
 * Continuous pressurized gas release with LFO modulation and rising pitch whine.
 */
export function startNitroBurn() {
  if (!_audioCtx || !_masterGain) return;
  stopNitroBurn(); // clean up any previous instance
  const sv = getSettings().sfxVolume;
  const t = _audioCtx.currentTime;

  // ── Burn hiss: white noise → bandpass (3kHz) ──
  const hissLen = _audioCtx.sampleRate * 2;
  const hissBuf = _audioCtx.createBuffer(1, hissLen, _audioCtx.sampleRate);
  const hissData = hissBuf.getChannelData(0);
  for (let i = 0; i < hissLen; i++) hissData[i] = Math.random() * 2 - 1;

  nitroHissSource = _audioCtx.createBufferSource();
  nitroHissSource.buffer = hissBuf;
  nitroHissSource.loop = true;

  nitroHissFilter = _audioCtx.createBiquadFilter();
  nitroHissFilter.type = 'bandpass';
  nitroHissFilter.frequency.value = 3000;
  nitroHissFilter.Q.value = 1.5;

  // LFO modulates bandpass center ±300Hz at 6Hz
  nitroHissLFO = _audioCtx.createOscillator();
  nitroHissLFO.type = 'sine';
  nitroHissLFO.frequency.value = 6;
  nitroHissLFOGain = _audioCtx.createGain();
  nitroHissLFOGain.gain.value = 300;
  nitroHissLFO.connect(nitroHissLFOGain);
  nitroHissLFOGain.connect(nitroHissFilter.frequency);
  nitroHissLFO.start(t);

  nitroHissGain = _audioCtx.createGain();
  nitroHissGain.gain.setValueAtTime(0, t);
  nitroHissGain.gain.linearRampToValueAtTime(0.04 * sv, t + 0.2); // fade in 0.2s

  nitroHissSource.connect(nitroHissFilter);
  nitroHissFilter.connect(nitroHissGain);
  nitroHissGain.connect(_masterGain);
  nitroHissSource.start(t);

  // ── Surge whistle: rising sine 800→2400Hz ──
  nitroWhistleOsc = _audioCtx.createOscillator();
  nitroWhistleOsc.type = 'sine';
  nitroWhistleOsc.frequency.setValueAtTime(800, t);
  // Ramp to 2400Hz over ~5 seconds (full NOS tank duration)
  nitroWhistleOsc.frequency.linearRampToValueAtTime(2400, t + 5);

  nitroWhistleGain = _audioCtx.createGain();
  nitroWhistleGain.gain.setValueAtTime(0, t);
  nitroWhistleGain.gain.linearRampToValueAtTime(0.015 * sv, t + 0.5); // slow fade-in

  nitroWhistleOsc.connect(nitroWhistleGain);
  nitroWhistleGain.connect(_masterGain);
  nitroWhistleOsc.start(t);
}

/**
 * Update NOS burn intensity (call each frame while NOS is active).
 * Volume increases as nitro depletes (more pressure = louder hiss).
 * @param nitroPct 0–100
 */
export function updateNitroBurnIntensity(nitroPct: number) {
  if (!_audioCtx || !nitroHissGain || !nitroWhistleGain) return;
  const sv = getSettings().sfxVolume;
  const t = _audioCtx.currentTime;
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
  if (!_audioCtx || !_masterGain) return;

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
    if (!_audioCtx || !_masterGain) return;
    const sv = getSettings().sfxVolume;
    const osc = _audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 2000;
    const gain = _audioCtx.createGain();
    gain.gain.setValueAtTime(0.06 * sv, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.01);
    osc.connect(gain);
    gain.connect(_masterGain!);
    osc.start();
    osc.stop(_audioCtx.currentTime + 0.015);
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
  if (!_audioCtx || !_masterGain) return;
  const t = _audioCtx.currentTime;
  const sv = getSettings().sfxVolume;

  // Component 1: Blow-off "pssh" (white noise → bandpass 1.5kHz, 150ms decay)
  const pssLen = Math.floor(_audioCtx.sampleRate * 0.15);
  const pssBuf = _audioCtx.createBuffer(1, pssLen, _audioCtx.sampleRate);
  const pssData = pssBuf.getChannelData(0);
  for (let i = 0; i < pssLen; i++) {
    pssData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (pssLen * 0.2));
  }
  const pssSrc = _audioCtx.createBufferSource();
  pssSrc.buffer = pssBuf;
  const pssFilter = _audioCtx.createBiquadFilter();
  pssFilter.type = 'bandpass';
  pssFilter.frequency.value = 1500;
  pssFilter.Q.value = 2;
  const pssGain = _audioCtx.createGain();
  pssGain.gain.setValueAtTime(0.08 * sv, t);
  pssGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  pssSrc.connect(pssFilter);
  pssFilter.connect(pssGain);
  pssGain.connect(_masterGain);
  pssSrc.start(t);

  // Component 2: Flutter — rapid sine pulses (400Hz, 4 × 10ms on/off)
  for (let i = 0; i < 4; i++) {
    const pulseStart = t + 0.06 + i * 0.02;
    const flutter = _audioCtx.createOscillator();
    flutter.type = 'sine';
    flutter.frequency.value = 400 - i * 30; // descending pitch
    const flutterGain = _audioCtx.createGain();
    flutterGain.gain.setValueAtTime(0.04 * sv * (1 - i * 0.2), pulseStart);
    flutterGain.gain.exponentialRampToValueAtTime(0.001, pulseStart + 0.01);
    flutter.connect(flutterGain);
    flutterGain.connect(_masterGain);
    flutter.start(pulseStart);
    flutter.stop(pulseStart + 0.012);
  }
}
