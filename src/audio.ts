/* ── Hood Racer — Procedural Audio ── */

let audioCtx: AudioContext | null = null;
let engineOsc: OscillatorNode | null = null;
let engineGain: GainNode | null = null;

export function initAudio() {
  // Clean up previous audio context to prevent resource leak on rematch/replay
  if (engineOsc) { try { engineOsc.stop(); } catch {} engineOsc = null; }
  if (engineGain) { engineGain = null; }
  if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }

  audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

  // Engine drone
  engineOsc = audioCtx.createOscillator();
  engineGain = audioCtx.createGain();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 80;
  engineGain.gain.value = 0;

  // Low-pass filter for muffled engine sound
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 600;

  engineOsc.connect(filter);
  filter.connect(engineGain);
  engineGain.connect(audioCtx.destination);
  engineOsc.start();
}

/** Update engine pitch based on speed and gear. */
export function updateEngineAudio(speed: number, maxSpeed: number) {
  if (!audioCtx || !engineOsc || !engineGain) return;

  const ratio = Math.abs(speed) / maxSpeed;

  // Simple 4-gear simulation
  const gearCount = 4;
  const gearRatio = ratio * gearCount;
  const gear = Math.min(Math.floor(gearRatio), gearCount - 1);
  const rpmInGear = gearRatio - gear; // 0-1 within current gear

  // Map RPM to frequency: idle ~80Hz, max ~350Hz per gear
  const freq = 80 + rpmInGear * 270;
  engineOsc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);

  // Volume scales with speed
  const vol = 0.02 + ratio * 0.08;
  engineGain.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.05);
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

export function stopAudio() {
  if (engineOsc) {
    engineOsc.stop();
    engineOsc = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
}
