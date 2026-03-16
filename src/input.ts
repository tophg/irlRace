/* ── Hood Racer — Input Handler (v2 — Analog + Tilt) ── */

import { InputState } from './types';
import { getSettings } from './settings';

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
let tiltPermissionGranted = false;
let tiltSmoothed = 0;
let tiltHandler: ((e: DeviceOrientationEvent) => void) | null = null;

// Analog steering zone state
let steerTouchId: number | null = null;
let steerOriginX = 0;
const STEER_RADIUS = 80; // pixels for full deflection

// Steering indicator element
let steerIndicator: HTMLElement | null = null;

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
      <div class="steer-indicator" id="steer-indicator"></div>
      <div class="steer-label">STEER</div>
    </div>
    <div class="touch-pedals">
      <div class="touch-gas" id="touch-gas">GAS</div>
      <div class="touch-brake" id="touch-brake">BRAKE</div>
      <div class="touch-boost" id="touch-boost">BOOST</div>
    </div>
  `;
  document.body.appendChild(container);
  steerIndicator = container.querySelector('#steer-indicator');

  // ── Analog steering zone (left side) ──
  const steerZone = container.querySelector('#touch-steer-zone') as HTMLElement;
  if (steerZone) {
    steerZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (steerTouchId !== null) return;
      const touch = e.changedTouches[0];
      steerTouchId = touch.identifier;
      steerOriginX = touch.clientX;
      updateSteerIndicator(0);
      if (steerIndicator) {
        steerIndicator.style.opacity = '1';
        steerIndicator.style.left = `${touch.clientX - steerZone.getBoundingClientRect().left}px`;
        steerIndicator.style.top = `${touch.clientY - steerZone.getBoundingClientRect().top}px`;
      }
    }, { passive: false });

    steerZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === steerTouchId) {
          const dx = touch.clientX - steerOriginX;
          const normalized = Math.max(-1, Math.min(1, dx / STEER_RADIUS));
          state.steerAnalog = -normalized;
          state.left = normalized > 0.15;
          state.right = normalized < -0.15;
          updateSteerIndicator(normalized);
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
          if (steerIndicator) steerIndicator.style.opacity = '0';
          break;
        }
      }
    };
    steerZone.addEventListener('touchend', endSteer);
    steerZone.addEventListener('touchcancel', endSteer);
  }

  // ── Pedal buttons (right side) ──
  const bindBtn = (id: string, key: 'up' | 'down' | 'boost') => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      state[key] = true;
      el.classList.add('pressed');
    }, { passive: false });
    el.addEventListener('touchend', () => {
      state[key] = false;
      el.classList.remove('pressed');
    });
    el.addEventListener('touchcancel', () => {
      state[key] = false;
      el.classList.remove('pressed');
    });
  };

  bindBtn('touch-gas', 'up');
  bindBtn('touch-brake', 'down');
  bindBtn('touch-boost', 'boost');
}

function updateSteerIndicator(value: number) {
  if (!steerIndicator) return;
  const offsetPx = value * 30;
  steerIndicator.style.transform = `translate(${offsetPx}px, -50%)`;
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

  tiltPermissionGranted = true;
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
}

export function showTouchControls(visible: boolean) {
  const el = document.getElementById('touch-controls');
  if (el) {
    el.style.display = visible ? 'flex' : 'none';
    if (visible) applyControlScheme();
  }
}

export function getInput(): InputState { return state; }
