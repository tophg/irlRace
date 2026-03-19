/* ── IRL Race — Countdown Overlay ──
 * Note: Uses its own AudioContext (not audio.ts) because the countdown
 * runs before initAudio() is called. The context is closed after use. */

let overlayEl: HTMLElement | null = null;
let countdownTimers: number[] = [];
let countdownAudioCtx: AudioContext | null = null;

/**
 * Run the 3-2-1-GO countdown sequence. Returns a promise that resolves on GO.
 * @param durationMs Total countdown duration (default 3400ms). Used for network sync —
 *                   guests shorten their countdown by estimated network delay.
 */
export function runCountdown(uiOverlay: HTMLElement, durationMs = 3400): Promise<void> {
  return new Promise((resolve) => {
    forceStopCountdown();

    overlayEl = document.createElement('div');
    overlayEl.className = 'countdown-overlay';
    uiOverlay.appendChild(overlayEl);

    countdownAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioCtx = countdownAudioCtx;

    const playBeep = (freq: number, duration: number, vol = 0.3) => {
      if (!audioCtx || audioCtx.state === 'closed') return;
      // Dual oscillators for richer tone
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.value = freq;
      osc2.type = 'triangle';
      osc2.frequency.value = freq;
      gain.gain.setValueAtTime(vol, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(audioCtx.destination);
      osc1.start();
      osc2.start();
      osc1.stop(audioCtx.currentTime + duration);
      osc2.stop(audioCtx.currentTime + duration);
    };

    const playGoChord = () => {
      if (!audioCtx || audioCtx.state === 'closed') return;
      // C5-E5-G5 major chord with staggered starts
      const notes = [523, 659, 784];
      notes.forEach((freq, i) => {
        const osc = audioCtx!.createOscillator();
        const gain = audioCtx!.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = audioCtx!.currentTime + i * 0.03;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.25, start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
        osc.connect(gain);
        gain.connect(audioCtx!.destination);
        osc.start(start);
        osc.stop(start + 0.5);
      });
    };

    // Scale step delays proportionally to the total duration
    const scale = durationMs / 3400;
    // Ascending frequencies: 3→440Hz, 2→660Hz, 1→880Hz
    const sequence = [
      { text: '3', css: 'countdown-number', delay: 0,            freq: 440 },
      { text: '2', css: 'countdown-number', delay: 900 * scale,  freq: 660 },
      { text: '1', css: 'countdown-number', delay: 1800 * scale, freq: 880 },
      { text: 'GO!', css: 'countdown-go',   delay: 2700 * scale, freq: 0 },
    ];

    countdownTimers = [];

    sequence.forEach(({ text, css, delay, freq }) => {
      const id = window.setTimeout(() => {
        if (!overlayEl) return;
        overlayEl.innerHTML = `<div class="${css}">${text}</div>`;

        if (text === 'GO!') {
          playGoChord();
        } else {
          playBeep(freq, 0.2);
        }
      }, delay);
      countdownTimers.push(id);
    });

    const finishId = window.setTimeout(() => {
      cleanupCountdown();
      resolve();
    }, durationMs);
    countdownTimers.push(finishId);
  });
}

function cleanupCountdown() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  if (countdownAudioCtx) {
    try { countdownAudioCtx.close(); } catch {}
    countdownAudioCtx = null;
  }
}

export function forceStopCountdown() {
  for (const id of countdownTimers) clearTimeout(id);
  countdownTimers = [];
  cleanupCountdown();
}
