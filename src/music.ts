/* ── Hood Racer — Procedural Background Music ── */

import { getSettings } from './settings';

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

// Bass synth
let bassOsc: OscillatorNode | null = null;
let bassGain: GainNode | null = null;

// Pad synth (chord)
let padOscs: OscillatorNode[] = [];
let padGain: GainNode | null = null;

// Arp synth
let arpOsc: OscillatorNode | null = null;
let arpGain: GainNode | null = null;

// Kick drum (procedural)
let kickInterval: number | null = null;

// State
let isPlaying = false;
let arpStep = 0;
let arpInterval: number | null = null;
let currentIntensity = 0.5;

// ── Musical Scale (E minor pentatonic — fits synthwave perfectly) ──
const BASS_NOTES = [82.41, 98.0, 110.0, 130.81]; // E2, G2, A2, C3
const ARP_NOTES = [329.63, 392.0, 440.0, 493.88, 523.25, 587.33, 659.25, 783.99]; // E4-E5

// ── BPM ──
const BASE_BPM = 128;

export function initMusic() {
  if (isPlaying) return;

  audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

  const s = getSettings();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = s.musicVolume * 0.5; // Music level from settings
  masterGain.connect(audioCtx.destination);

  // ── Bass Synth (sawtooth through lowpass) ──
  bassOsc = audioCtx.createOscillator();
  bassOsc.type = 'sawtooth';
  bassOsc.frequency.value = BASS_NOTES[0];
  const bassFilter = audioCtx.createBiquadFilter();
  bassFilter.type = 'lowpass';
  bassFilter.frequency.value = 200;
  bassFilter.Q.value = 2;
  bassGain = audioCtx.createGain();
  bassGain.gain.value = 0.12;
  bassOsc.connect(bassFilter);
  bassFilter.connect(bassGain);
  bassGain.connect(masterGain);
  bassOsc.start();

  // ── Pad Synth (stacked detuned saws for warmth) ──
  padGain = audioCtx.createGain();
  padGain.gain.value = 0.04;
  const padFilter = audioCtx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 1200;
  padGain.connect(padFilter);
  padFilter.connect(masterGain);

  // E minor chord: E4, G4, B4
  const chordFreqs = [329.63, 392.0, 493.88];
  for (const freq of chordFreqs) {
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() - 0.5) * 12; // Subtle detune for width
    osc.connect(padGain);
    osc.start();
    padOscs.push(osc);
  }

  // ── Arp Synth (square wave arpeggiation) ──
  arpOsc = audioCtx.createOscillator();
  arpOsc.type = 'square';
  arpOsc.frequency.value = ARP_NOTES[0];
  const arpFilter = audioCtx.createBiquadFilter();
  arpFilter.type = 'bandpass';
  arpFilter.frequency.value = 2000;
  arpFilter.Q.value = 1;
  arpGain = audioCtx.createGain();
  arpGain.gain.value = 0.03;
  arpOsc.connect(arpFilter);
  arpFilter.connect(arpGain);
  arpGain.connect(masterGain);
  arpOsc.start();

  // ── Sequencer: 16th-note arp + bass pattern ──
  const stepMs = (60 / BASE_BPM / 4) * 1000; // 16th note interval
  let beatCount = 0;

  arpInterval = window.setInterval(() => {
    if (!audioCtx || !arpOsc || !bassOsc) return;
    const t = audioCtx.currentTime;

    // Arp: cycle through notes
    arpStep = (arpStep + 1) % ARP_NOTES.length;
    arpOsc.frequency.setTargetAtTime(ARP_NOTES[arpStep], t, 0.01);

    // Arp envelope: short pluck
    if (arpGain) {
      arpGain.gain.setValueAtTime(0.025 + currentIntensity * 0.025, t);
      arpGain.gain.exponentialRampToValueAtTime(0.005, t + 0.08);
    }

    // Bass: change note every 4 beats (quarter note)
    beatCount++;
    if (beatCount % 4 === 0) {
      const bassIdx = Math.floor(beatCount / 4) % BASS_NOTES.length;
      bassOsc.frequency.setTargetAtTime(BASS_NOTES[bassIdx], t, 0.02);
    }

    // Kick drum on every 4th 16th note (quarter note)
    if (beatCount % 4 === 0) {
      playKick(t);
    }
  }, stepMs);

  isPlaying = true;
}

/** Play a procedural kick drum. */
function playKick(time: number) {
  if (!audioCtx || !masterGain) return;

  const osc = audioCtx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, time);
  osc.frequency.exponentialRampToValueAtTime(40, time + 0.08);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.1 + currentIntensity * 0.05, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(time);
  osc.stop(time + 0.15);
}

/** Update music intensity (0–1). Higher values = louder, faster arp. */
export function updateMusicIntensity(intensity: number) {
  currentIntensity = Math.max(0, Math.min(1, intensity));

  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const s = getSettings();
  const vol = s.musicVolume * 0.5;

  // Master volume scales with intensity
  if (masterGain) {
    masterGain.gain.setTargetAtTime(vol * (0.6 + currentIntensity * 0.4), t, 0.5);
  }

  // Bass gets louder in intense moments
  if (bassGain) {
    bassGain.gain.setTargetAtTime(0.08 + currentIntensity * 0.08, t, 0.3);
  }

  // Pad swells with intensity
  if (padGain) {
    padGain.gain.setTargetAtTime(0.02 + currentIntensity * 0.04, t, 0.3);
  }
}

/** Pause music (e.g., pause menu). */
export function pauseMusic() {
  if (masterGain && audioCtx) {
    masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
  }
}

/** Resume music after pause. */
export function resumeMusic() {
  if (masterGain && audioCtx) {
    const s = getSettings();
    masterGain.gain.setTargetAtTime(s.musicVolume * 0.5, audioCtx.currentTime, 0.1);
  }
}

/** Destroy music (end of race). */
export function stopMusic() {
  if (arpInterval) { clearInterval(arpInterval); arpInterval = null; }
  if (kickInterval) { clearInterval(kickInterval); kickInterval = null; }

  try { bassOsc?.stop(); } catch {}
  try { arpOsc?.stop(); } catch {}
  for (const osc of padOscs) { try { osc.stop(); } catch {} }

  bassOsc = null;
  bassGain = null;
  arpOsc = null;
  arpGain = null;
  padOscs = [];
  padGain = null;
  masterGain = null;
  arpStep = 0;
  currentIntensity = 0.5;

  if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
  isPlaying = false;
}
