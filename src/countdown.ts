/* ── Hood Racer — Countdown Overlay ── */

let overlayEl: HTMLElement | null = null;
let countdownTimers: number[] = [];
let countdownAudioCtx: AudioContext | null = null;

/** Run the 3-2-1-GO countdown sequence. Returns a promise that resolves on GO. */
export function runCountdown(uiOverlay: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    forceStopCountdown();

    overlayEl = document.createElement('div');
    overlayEl.className = 'countdown-overlay';
    uiOverlay.appendChild(overlayEl);

    countdownAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioCtx = countdownAudioCtx;

    const playBeep = (freq: number, duration: number) => {
      if (!audioCtx || audioCtx.state === 'closed') return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    };

    const sequence = [
      { text: '3', css: 'countdown-number', delay: 0 },
      { text: '2', css: 'countdown-number', delay: 900 },
      { text: '1', css: 'countdown-number', delay: 1800 },
      { text: 'GO!', css: 'countdown-go', delay: 2700 },
    ];

    countdownTimers = [];

    sequence.forEach(({ text, css, delay }) => {
      const id = window.setTimeout(() => {
        if (!overlayEl) return;
        overlayEl.innerHTML = `<div class="${css}">${text}</div>`;

        if (text === 'GO!') {
          playBeep(1760, 0.4);
        } else {
          playBeep(880, 0.15);
        }
      }, delay);
      countdownTimers.push(id);
    });

    const finishId = window.setTimeout(() => {
      cleanupCountdown();
      resolve();
    }, 3400);
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
