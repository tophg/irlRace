/* ── Hood Racer — Countdown Overlay ── */

let overlayEl: HTMLElement | null = null;

/** Run the 3-2-1-GO countdown sequence. Returns a promise that resolves on GO. */
export function runCountdown(uiOverlay: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    overlayEl = document.createElement('div');
    overlayEl.className = 'countdown-overlay';
    uiOverlay.appendChild(overlayEl);

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

    const playBeep = (freq: number, duration: number) => {
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

    sequence.forEach(({ text, css, delay }) => {
      setTimeout(() => {
        if (!overlayEl) return;
        overlayEl.innerHTML = `<div class="${css}">${text}</div>`;

        if (text === 'GO!') {
          playBeep(1760, 0.4);
        } else {
          playBeep(880, 0.15);
        }
      }, delay);
    });

    // Auto-remove and resolve after sequence
    setTimeout(() => {
      if (overlayEl) {
        overlayEl.remove();
        overlayEl = null;
      }
      resolve();
    }, 3400);
  });
}

export function forceStopCountdown() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}
