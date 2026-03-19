/* ── IRL Race — Explosion Screen Effects ──
 *
 * CSS-based screen overlays for the explosion cinematic:
 *   • White flash — full-screen additive, fades 0.3s
 *   • Letterbox bars — cinematic top/bottom bars slide in/out
 *   • "ENGINE DESTROYED" text — dramatic scale-up at t=1s
 *
 * PERF: flash + letterbox elements are pre-created (hidden) to avoid
 * createElement/appendChild on the explosion frame.
 */

let flashEl: HTMLDivElement | null = null;
let letterboxTop: HTMLDivElement | null = null;
let letterboxBottom: HTMLDivElement | null = null;
let textEl: HTMLDivElement | null = null;

// Pre-create DOM elements once (avoids createElement on the explosion frame)
function ensureElements() {
  if (!flashEl) {
    flashEl = document.createElement('div');
    flashEl.style.cssText = `
      position: fixed; inset: 0; z-index: 9998;
      background: white; opacity: 0;
      pointer-events: none;
      transition: opacity 0.4s ease-out;
    `;
    document.body.appendChild(flashEl);
  }
  if (!letterboxTop) {
    const barCSS = `
      position: fixed; left: 0; right: 0; z-index: 9997;
      height: 0px; background: black;
      pointer-events: none;
      transition: height 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    letterboxTop = document.createElement('div');
    letterboxTop.style.cssText = barCSS + 'top: 0;';
    document.body.appendChild(letterboxTop);

    letterboxBottom = document.createElement('div');
    letterboxBottom.style.cssText = barCSS + 'bottom: 0;';
    document.body.appendChild(letterboxBottom);
  }
}

/** Show the white flash overlay (fades via CSS transition). */
export function showExplosionFlash() {
  ensureElements();
  flashEl!.style.opacity = '0.9';

  // Fade out on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (flashEl) flashEl.style.opacity = '0';
    });
  });
}

/** Show cinematic letterbox bars. */
export function showLetterbox() {
  ensureElements();

  // Slide in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (letterboxTop) letterboxTop.style.height = '60px';
      if (letterboxBottom) letterboxBottom.style.height = '60px';
    });
  });
}

/** Hide letterbox bars. */
export function hideLetterbox() {
  if (letterboxTop) letterboxTop.style.height = '0px';
  if (letterboxBottom) letterboxBottom.style.height = '0px';
}

/** Show "ENGINE DESTROYED" text overlay with dramatic scale animation. */
export function showEngineDestroyedText() {
  if (textEl) return;
  textEl = document.createElement('div');
  textEl.textContent = 'ENGINE DESTROYED';
  textEl.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Rajdhani', 'Impact', sans-serif;
    font-size: 64px; font-weight: 900;
    color: #FF4400;
    text-shadow: 0 0 30px rgba(255, 68, 0, 0.8), 0 0 60px rgba(255, 0, 0, 0.4),
                 2px 2px 0 #000, -2px -2px 0 #000;
    letter-spacing: 8px;
    pointer-events: none;
    opacity: 0; transform: scale(2.5);
    transition: opacity 0.4s ease-out, transform 0.5s cubic-bezier(0.2, 0.8, 0.3, 1);
  `;
  document.body.appendChild(textEl);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (textEl) {
        textEl.style.opacity = '1';
        textEl.style.transform = 'scale(1)';
      }
    });
  });

  // Fade out after 2s
  setTimeout(() => {
    if (textEl) {
      textEl.style.opacity = '0';
      textEl.style.transform = 'scale(0.8)';
    }
    setTimeout(() => {
      textEl?.remove();
      textEl = null;
    }, 500);
  }, 2000);
}

/** Clean up all screen effects (call on race restart). */
export function cleanupScreenEffects() {
  // Reset to hidden state (don't remove — keep pre-created)
  if (flashEl) flashEl.style.opacity = '0';
  if (letterboxTop) letterboxTop.style.height = '0px';
  if (letterboxBottom) letterboxBottom.style.height = '0px';
  textEl?.remove(); textEl = null;
}
