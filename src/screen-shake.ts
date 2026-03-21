/* ── Screen Shake Utility ──
 *
 * Applies CSS transform jitter to the game container for
 * high-impact moments (jackpot, combo break, level-up).
 *
 * Psychology: physical feedback amplifies dopamine prediction error.
 * Screen shake makes rare events feel "real" and consequential.
 */

let _shakeTimer = 0;
let _shakeIntensity = 0;
let _shakeRafId = 0;
let _target: HTMLElement | null = null;

/**
 * Trigger a screen shake on the game container.
 * @param intensity Max pixel displacement (e.g. 4 = ±4px)
 * @param durationMs How long the shake lasts
 * @param targetEl Element to shake (defaults to #ui-overlay parent)
 */
export function screenShake(intensity: number, durationMs: number, targetEl?: HTMLElement) {
  _target = targetEl || document.getElementById('ui-overlay')?.parentElement || document.body;
  _shakeIntensity = intensity;
  _shakeTimer = durationMs;

  if (_shakeRafId) cancelAnimationFrame(_shakeRafId);

  let last = performance.now();

  function frame(now: number) {
    const dt = now - last;
    last = now;
    _shakeTimer -= dt;

    if (_shakeTimer <= 0) {
      // Reset transform
      if (_target) _target.style.transform = '';
      _shakeRafId = 0;
      return;
    }

    // Exponential decay
    const progress = _shakeTimer / durationMs;
    const currentIntensity = _shakeIntensity * progress;
    const dx = (Math.random() * 2 - 1) * currentIntensity;
    const dy = (Math.random() * 2 - 1) * currentIntensity;
    if (_target) _target.style.transform = `translate(${dx}px, ${dy}px)`;

    _shakeRafId = requestAnimationFrame(frame);
  }

  _shakeRafId = requestAnimationFrame(frame);
}

/** Presets for common scenarios. */
export const SHAKE = {
  /** Jackpot — strong shake, 300ms */
  jackpot: () => screenShake(5, 300),
  /** Combo ×4+ reward — medium shake, 200ms */
  comboHigh: () => screenShake(3, 200),
  /** Level up — medium shake, 250ms */
  levelUp: () => screenShake(3, 250),
  /** Combo break at ×3+ — mild shake, 150ms (loss aversion) */
  comboBreak: () => screenShake(2, 150),
};
