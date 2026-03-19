/* ── IRL Race — Input Handler (v2 — Analog + Tilt) ── */

import { InputState } from './types';
import { getSettings } from './settings';

/** Fire haptic feedback if enabled and available. */
export function haptic(pattern: number | number[]) {
  if (!getSettings().hapticEnabled) return;
  if (navigator.vibrate) navigator.vibrate(pattern);
}

const state: InputState = {
  up: false,
  down: false,
  left: false,
  right: false,
  boost: false,
  steerAnalog: 0,
};

// Tilt steering state
let tiltEnabled = false;
let tiltSmoothed = 0;
let tiltHandler: ((e: DeviceOrientationEvent) => void) | null = null;

// Analog steering zone state
let steerTouchId: number | null = null;
let steerOriginX = 0;
const STEER_RADIUS = 80; // pixels for full deflection
const WHEEL_MAX_ROTATION = 90; // degrees visual rotation at full lock

// Steering wheel elements
let wheelEl: HTMLElement | null = null;
let steerZoneEl: HTMLElement | null = null;

// Haptic tick tracking
let lastHapticTick = 0;

export function initInput(): InputState {
  // Keyboard — Left/Right are intentionally swapped here to compensate
  // for the heading-to-rotation convention used in vehicle.ts physics.
  window.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'ArrowUp':    case 'KeyW': state.up = true;    break;
      case 'ArrowDown':  case 'KeyS': state.down = true;  break;
      case 'ArrowLeft':  case 'KeyA': state.right = true;  break;
      case 'ArrowRight': case 'KeyD': state.left = true; break;
      case 'ShiftLeft':  case 'Space': state.boost = true; break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowUp':    case 'KeyW': state.up = false;    break;
      case 'ArrowDown':  case 'KeyS': state.down = false;  break;
      case 'ArrowLeft':  case 'KeyA': state.right = false;  break;
      case 'ArrowRight': case 'KeyD': state.left = false; break;
      case 'ShiftLeft':  case 'Space': state.boost = false; break;
    }
  });

  setupTouchControls();

  return state;
}

function setupTouchControls() {
  const container = document.createElement('div');
  container.className = 'touch-controls';
  container.id = 'touch-controls';
  container.innerHTML = `
    <div class="touch-steer" id="touch-steer-zone">
      <div class="steering-wheel" id="steering-wheel">
        <div class="wheel-spoke wheel-spoke-top"></div>
        <div class="wheel-spoke wheel-spoke-left"></div>
        <div class="wheel-spoke wheel-spoke-right"></div>
        <div class="wheel-hub"></div>
        <div class="wheel-notch"></div>
      </div>
    </div>
    <div class="touch-pedals">
      <div class="touch-brake" id="touch-brake">BRAKE</div>
      <div class="touch-gas" id="touch-gas">
        <span class="gas-label">GAS</span>
        <span class="gas-nitro-hint">⇧ NITRO</span>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  // Get steering wheel element
  steerZoneEl = container.querySelector('#touch-steer-zone') as HTMLElement;
  wheelEl = container.querySelector('#steering-wheel') as HTMLElement;

  // ── Steering wheel (left side) — horizontal drag rotates wheel ──
  if (steerZoneEl) {
    steerZoneEl.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (steerTouchId !== null) return;
      const touch = e.changedTouches[0];
      steerTouchId = touch.identifier;
      steerOriginX = touch.clientX;
      lastHapticTick = 0;

      // Remove spring transition while dragging
      if (wheelEl) {
        wheelEl.style.transition = 'none';
        wheelEl.classList.add('active');
      }

      haptic(10);
    }, { passive: false });

    steerZoneEl.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === steerTouchId) {
          const dx = touch.clientX - steerOriginX;
          const raw = dx / STEER_RADIUS;
          const clamped = Math.max(-1, Math.min(1, raw));

          // Dead zone: 12% of radius
          const DEAD_ZONE = 0.12;
          let output = 0;
          if (Math.abs(clamped) > DEAD_ZONE) {
            output = (clamped - Math.sign(clamped) * DEAD_ZONE) / (1 - DEAD_ZONE);
          }

          state.steerAnalog = -output;
          state.left = output > 0.15;
          state.right = output < -0.15;

          // Rotate wheel visually
          const rotation = clamped * WHEEL_MAX_ROTATION;
          if (wheelEl) {
            wheelEl.style.transform = `rotate(${rotation}deg)`;

            // Glow escalation — border glows hotter at higher steering
            const intensity = Math.abs(clamped);
            const r = Math.floor(255);
            const g = Math.floor(77 + (180 - 77) * (1 - intensity));
            const b = Math.floor(intensity * 30);
            const alpha = 0.15 + intensity * 0.45;
            wheelEl.style.borderColor = `rgba(${r},${g},${b},${alpha})`;
            wheelEl.style.boxShadow = intensity > 0.2
              ? `0 0 ${12 + intensity * 20}px rgba(255,77,0,${intensity * 0.3})`
              : 'none';
          }

          // Haptic ticks at 25%, 50%, 75% thresholds
          const absOutput = Math.abs(output);
          const tick = absOutput >= 0.75 ? 3 : absOutput >= 0.5 ? 2 : absOutput >= 0.25 ? 1 : 0;
          if (tick > lastHapticTick) {
            haptic(tick === 3 ? [10, 20, 10] : 8);
            lastHapticTick = tick;
          } else if (tick < lastHapticTick) {
            lastHapticTick = tick;
          }

          // Follow mode: if past radius, drag origin
          if (Math.abs(dx) > STEER_RADIUS) {
            const overflow = dx - Math.sign(dx) * STEER_RADIUS;
            steerOriginX += overflow;
          }
          break;
        }
      }
    }, { passive: false });

    const endSteer = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === steerTouchId) {
          steerTouchId = null;
          state.steerAnalog = 0;
          state.left = false;
          state.right = false;
          lastHapticTick = 0;

          // Spring return with transition
          if (wheelEl) {
            wheelEl.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.3s, box-shadow 0.3s';
            wheelEl.style.transform = 'rotate(0deg)';
            wheelEl.style.borderColor = '';
            wheelEl.style.boxShadow = '';
            wheelEl.classList.remove('active');
          }
          break;
        }
      }
    };
    steerZoneEl.addEventListener('touchend', endSteer);
    steerZoneEl.addEventListener('touchcancel', endSteer);
  }

  // ── Brake button (simple press) ──
  const brakeEl = document.getElementById('touch-brake');
  if (brakeEl) {
    brakeEl.addEventListener('touchstart', (e) => {
      e.preventDefault();
      state.down = true;
      brakeEl.classList.add('pressed');
      haptic(15);
    }, { passive: false });
    brakeEl.addEventListener('touchend', () => {
      state.down = false;
      brakeEl.classList.remove('pressed');
    });
    brakeEl.addEventListener('touchcancel', () => {
      state.down = false;
      brakeEl.classList.remove('pressed');
    });
  }

  // ── GAS button with swipe-up boost & double-tap toggle ──
  const gasEl = document.getElementById('touch-gas');
  if (gasEl) {
    let gasTouchId: number | null = null;
    let gasTouchStartY = 0;
    let boostFromSwipe = false;
    let lastGasTapTime = 0;
    const SWIPE_THRESHOLD = 30; // px upward to activate boost
    const DOUBLE_TAP_MS = 300;
    let boostToggled = false; // double-tap toggle state

    gasEl.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      gasTouchId = touch.identifier;
      gasTouchStartY = touch.clientY;
      state.up = true;
      gasEl.classList.add('pressed');
      haptic(10);

      // Double-tap detection
      const now = performance.now();
      if (now - lastGasTapTime < DOUBLE_TAP_MS) {
        boostToggled = !boostToggled;
        state.boost = boostToggled;
        if (boostToggled) {
          gasEl.classList.add('boost-active');
          haptic([15, 30, 15]);
        } else {
          gasEl.classList.remove('boost-active');
          haptic(10);
        }
      }
      lastGasTapTime = now;
    }, { passive: false });

    gasEl.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === gasTouchId) {
          const dy = gasTouchStartY - touch.clientY; // positive = swiped up

          if (dy >= SWIPE_THRESHOLD && !boostFromSwipe) {
            // Swipe up → activate boost
            boostFromSwipe = true;
            boostToggled = false; // cancel any double-tap toggle
            state.boost = true;
            gasEl.classList.add('boost-active');
            haptic([15, 30, 15]); // triple-pulse for boost
          } else if (dy < SWIPE_THRESHOLD * 0.5 && boostFromSwipe) {
            // Swiped back down → deactivate swipe boost
            boostFromSwipe = false;
            state.boost = false;
            gasEl.classList.remove('boost-active');
          }
          break;
        }
      }
    }, { passive: false });

    const endGas = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === gasTouchId) {
          gasTouchId = null;
          state.up = false;
          state.boost = false;
          boostFromSwipe = false;
          boostToggled = false;
          gasEl.classList.remove('pressed', 'boost-active');
          break;
        }
      }
    };
    gasEl.addEventListener('touchend', endGas);
    gasEl.addEventListener('touchcancel', endGas);
  }
}


// ── Tilt Steering ──

export async function enableTiltSteering(): Promise<boolean> {
  if (tiltEnabled) return true;

  // iOS requires explicit permission
  const DOE = DeviceOrientationEvent as any;
  if (typeof DOE.requestPermission === 'function') {
    try {
      const perm = await DOE.requestPermission();
      if (perm !== 'granted') return false;
    } catch {
      return false;
    }
  }


  tiltEnabled = true;

  tiltHandler = (e: DeviceOrientationEvent) => {
    if (!tiltEnabled || e.gamma === null) return;

    const gamma = e.gamma;
    const deadZone = 5;
    const sensitivity = getSettings().steerSensitivity;

    let raw = 0;
    if (Math.abs(gamma) > deadZone) {
      raw = (gamma - Math.sign(gamma) * deadZone) / (45 - deadZone);
      raw = Math.max(-1, Math.min(1, raw * sensitivity));
    }

    tiltSmoothed += (raw - tiltSmoothed) * 0.15;
    state.steerAnalog = -tiltSmoothed;
    state.left = tiltSmoothed > 0.15;
    state.right = tiltSmoothed < -0.15;
  };
  window.addEventListener('deviceorientation', tiltHandler);

  return true;
}

export function disableTiltSteering() {
  tiltEnabled = false;
  tiltSmoothed = 0;
  state.steerAnalog = 0;
  if (tiltHandler) {
    window.removeEventListener('deviceorientation', tiltHandler);
    tiltHandler = null;
  }
}

export function isTiltAvailable(): boolean {
  return 'DeviceOrientationEvent' in window;
}

export function isTiltEnabled(): boolean {
  return tiltEnabled;
}

// ── Control scheme switching ──

export function applyControlScheme() {
  const scheme = getSettings().controlScheme;
  if (scheme === 'tilt' && !tiltEnabled) {
    enableTiltSteering();
  } else if (scheme !== 'tilt' && tiltEnabled) {
    disableTiltSteering();
  }

  // Apply touch opacity and scale from settings
  const el = document.getElementById('touch-controls');
  if (el) {
    const s = getSettings();
    el.style.opacity = String(s.touchOpacity);
    el.style.transform = `scale(${s.touchScale})`;
    el.style.transformOrigin = 'bottom center';
  }

  // Auto-gas: visually activate gas button when enabled
  const gasEl = document.getElementById('touch-gas');
  if (gasEl) {
    if (getSettings().autoGas) {
      gasEl.classList.add('auto-gas-active');
    } else {
      gasEl.classList.remove('auto-gas-active');
    }
  }
}

export function showTouchControls(visible: boolean) {
  const el = document.getElementById('touch-controls');
  if (el) {
    el.style.display = visible ? 'flex' : 'none';
    if (visible) applyControlScheme();
  }
}

export function resetInput() {
  state.up = false;
  state.down = false;
  state.left = false;
  state.right = false;
  state.boost = false;
  state.steerAnalog = 0;
}

export function getInput(): InputState {
  // Auto-gas: force acceleration when enabled
  if (getSettings().autoGas) state.up = true;
  return state;
}
