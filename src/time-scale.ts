/* ── IRL Race — Time Scale System ──
 *
 * Global time-scale for dramatic slow-motion effects.
 * Supports configurable presets for different gameplay moments.
 *
 * Usage:
 *   triggerSlowMo('overtake');        // trigger a preset
 *   updateTimeScale(wallDt);          // advance state machine (wall-clock dt)
 *   const scaled = applyTimeScale(dt);// returns dt * current timeScale
 *   getTimeScale();                   // 0..1 for audio pitch etc.
 */

// ── Preset definitions ──
export interface SlowMoPreset {
  scale: number;     // target time-scale (0.2=very slow, 0.6=moderate)
  rampDown: number;  // seconds to reach target
  hold: number;      // seconds to hold at target
  rampUp: number;    // seconds to return to 1.0
  priority: number;  // higher = can override lower-priority active slow-mo
}

const PRESETS: Record<string, SlowMoPreset> = {
  finish:    { scale: 0.3,  rampDown: 0.2,  hold: 2.0, rampUp: 0.6, priority: 10 },
  explosion: { scale: 0.2,  rampDown: 0.3,  hold: 2.5, rampUp: 0.5, priority: 9  },
  lastLap:   { scale: 0.4,  rampDown: 0.2,  hold: 0.8, rampUp: 0.4, priority: 7  },
  overtake:  { scale: 0.5,  rampDown: 0.15, hold: 0.6, rampUp: 0.3, priority: 6  },
  collision: { scale: 0.35, rampDown: 0.08, hold: 0.5, rampUp: 0.3, priority: 5  },
  nearMiss:  { scale: 0.4,  rampDown: 0.1,  hold: 0.4, rampUp: 0.25, priority: 4 },
  boost:     { scale: 0.6,  rampDown: 0.1,  hold: 0.3, rampUp: 0.2, priority: 3  },
};

// ── State ──
let _timeScale = 1.0;
let _active = false;
let _currentPriority = 0;

// State machine
type Phase = 'idle' | 'ramp-down' | 'hold' | 'ramp-up';
let _phase: Phase = 'idle';
let _targetScale = 1.0;
let _rampSpeed = 0;
let _holdTimer = 0;
let _currentRampUp = 0.5; // stored from preset for ramp-up phase

// Cooldown: minimum gap between triggers (seconds)
const COOLDOWN_DURATION = 3.0;
let _cooldownTimer = 0;

/**
 * Trigger a slow-motion effect by preset name.
 * Respects cooldown and priority (higher priority can override active slow-mo).
 */
export function triggerSlowMo(presetName: string) {
  const preset = PRESETS[presetName];
  if (!preset) return;

  // Cooldown check (explosion bypasses cooldown)
  if (_cooldownTimer > 0 && presetName !== 'explosion' && presetName !== 'finish') return;

  // Priority check: can only trigger if higher priority than current
  if (_active && preset.priority <= _currentPriority) return;

  _active = true;
  _phase = 'ramp-down';
  _targetScale = preset.scale;
  _rampSpeed = (1.0 - preset.scale) / Math.max(preset.rampDown, 0.01);
  _holdTimer = preset.hold;
  _currentRampUp = preset.rampUp;
  _currentPriority = preset.priority;
  _cooldownTimer = 0; // reset cooldown, it starts after slow-mo ends
}

/**
 * Update the time-scale state machine.
 * MUST be called with wall-clock dt (not scaled dt).
 */
export function updateTimeScale(wallDt: number) {
  // Tick cooldown (even when not active)
  if (_cooldownTimer > 0) _cooldownTimer -= wallDt;

  if (!_active) return;

  switch (_phase) {
    case 'ramp-down':
      _timeScale -= _rampSpeed * wallDt;
      if (_timeScale <= _targetScale) {
        _timeScale = _targetScale;
        _phase = 'hold';
      }
      break;

    case 'hold':
      _holdTimer -= wallDt;
      if (_holdTimer <= 0) {
        _phase = 'ramp-up';
        _rampSpeed = (1.0 - _targetScale) / Math.max(_currentRampUp, 0.01);
      }
      break;

    case 'ramp-up':
      _timeScale += _rampSpeed * wallDt;
      if (_timeScale >= 1.0) {
        _timeScale = 1.0;
        _phase = 'idle';
        _active = false;
        _currentPriority = 0;
        _cooldownTimer = COOLDOWN_DURATION;
      }
      break;
  }
}

/** Apply time scale to a delta time value. */
export function applyTimeScale(dt: number): number {
  return dt * _timeScale;
}

/** Get the current time scale (0.0–1.0). Use for audio pitch etc. */
export function getTimeScale(): number {
  return _timeScale;
}

/** Check if slow-motion is currently active. */
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
  _currentPriority = 0;
  _cooldownTimer = 0;
  _currentRampUp = 0.5;
}
