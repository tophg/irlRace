/* ── Hood Racer — Input Handler ── */

import { InputState } from './types';

const state: InputState = {
  up: false,
  down: false,
  left: false,
  right: false,
  boost: false,
};

export function initInput(): InputState {
  window.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'ArrowUp':    case 'KeyW': state.up = true;    break;
      case 'ArrowDown':  case 'KeyS': state.down = true;  break;
      case 'ArrowLeft':  case 'KeyA': state.left = true;  break;
      case 'ArrowRight': case 'KeyD': state.right = true; break;
      case 'ShiftLeft':  case 'Space': state.boost = true; break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowUp':    case 'KeyW': state.up = false;    break;
      case 'ArrowDown':  case 'KeyS': state.down = false;  break;
      case 'ArrowLeft':  case 'KeyA': state.left = false;  break;
      case 'ArrowRight': case 'KeyD': state.right = false; break;
      case 'ShiftLeft':  case 'Space': state.boost = false; break;
    }
  });

  // Mobile touch controls
  setupTouchControls();

  return state;
}

function setupTouchControls() {
  const container = document.createElement('div');
  container.className = 'touch-controls';
  container.id = 'touch-controls';
  container.innerHTML = `
    <div class="touch-steer">
      <div class="touch-steer-left" id="touch-left">◀</div>
      <div class="touch-steer-right" id="touch-right">▶</div>
    </div>
    <div class="touch-pedals">
      <div class="touch-gas" id="touch-gas">GAS</div>
      <div class="touch-brake" id="touch-brake">BRAKE</div>
    </div>
  `;
  document.body.appendChild(container);

  const bind = (id: string, startKey: keyof InputState, endKey?: keyof InputState) => {
    const el = document.getElementById(id);
    if (!el) return;
    const key = endKey ?? startKey;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); state[startKey] = true; }, { passive: false });
    el.addEventListener('touchend', () => { state[startKey] = false; });
  };

  bind('touch-left', 'left');
  bind('touch-right', 'right');
  bind('touch-gas', 'up');
  bind('touch-brake', 'down');
}

export function showTouchControls(visible: boolean) {
  const el = document.getElementById('touch-controls');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

export function getInput(): InputState { return state; }
