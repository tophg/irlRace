/* ── IRL Race — Time Scale System ──
 *
 * Global time-scale for dramatic slow-motion effects.
 * Used during explosion cinematic: ramps down to 0.25× then back to 1.0×.
 *
 * Usage:
 *   triggerSlowMotion();           // start the slow-mo sequence
 *   const scaled = applyTimeScale(dt); // returns dt * current timeScale
 *   updateTimeScale(wallDt);       // advance the ramp (uses wall-clock dt)
 */

let _timeScale = 1.0;
let _targetScale = 1.0;
let _rampSpeed = 0; // units/sec toward target
let _holdTimer = 0; // seconds remaining at target before ramping back
let _active = false;

// Slow-motion profile (mutable for finish variant)
let SLOW_SCALE = 0.25;
const RAMP_DOWN_DURATION = 0.4; // seconds to reach slow-mo
let HOLD_DURATION = 2.5;        // seconds to hold slow-mo
const RAMP_UP_DURATION = 0.5;   // seconds to return to normal

type SlowMotionPhase = 'idle' | 'ramp-down' | 'hold' | 'ramp-up';
let _phase: SlowMotionPhase = 'idle';

/**
 * Trigger the slow-motion sequence.
 * Timeline: ramp down → hold → ramp up → idle
 */
export function triggerSlowMotion() {
  _active = true;
  _phase = 'ramp-down';
  _targetScale = SLOW_SCALE;
  _rampSpeed = (1.0 - SLOW_SCALE) / RAMP_DOWN_DURATION;
  _holdTimer = 0;
}

/**
 * Update the time-scale state machine.
 * MUST be called with wall-clock dt (not scaled dt).
 */
export function updateTimeScale(wallDt: number) {
  if (!_active) return;

  switch (_phase) {
    case 'ramp-down':
      _timeScale -= _rampSpeed * wallDt;
      if (_timeScale <= SLOW_SCALE) {
        _timeScale = SLOW_SCALE;
        _phase = 'hold';
        _holdTimer = HOLD_DURATION;
      }
      break;

    case 'hold':
      _holdTimer -= wallDt;
      if (_holdTimer <= 0) {
        _phase = 'ramp-up';
        _rampSpeed = (1.0 - SLOW_SCALE) / RAMP_UP_DURATION;
      }
      break;

    case 'ramp-up':
      _timeScale += _rampSpeed * wallDt;
      if (_timeScale >= 1.0) {
        _timeScale = 1.0;
        _phase = 'idle';
        _active = false;
      }
      break;
  }
}

/** Apply time scale to a delta time value. */
export function applyTimeScale(dt: number): number {
  return dt * _timeScale;
}

/** Get the current time scale (0.25–1.0). */
export function getTimeScale(): number {
  return _timeScale;
}

/** Check if slow-motion is active. */
export function isSlowMotionActive(): boolean {
  return _active;
}

/** Reset time scale (call on race restart). */
export function resetTimeScale() {
  _timeScale = 1.0;
  _targetScale = 1.0;
  _phase = 'idle';
  _active = false;
  _holdTimer = 0;
  _rampSpeed = 0;
}

/**
 * Trigger a lighter slow-motion for race finish.
 * Ramps to 0.4× for 1.5s then back to normal.
 */
export function triggerFinishSlowMo() {
  SLOW_SCALE = 0.4;
  HOLD_DURATION = 1.5;
  _active = true;
  _phase = 'ramp-down';
  _targetScale = 0.4;
  _rampSpeed = (1.0 - 0.4) / 0.3;
  _holdTimer = 0;
}
