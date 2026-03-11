/* ── Hood Racer — Settings Menu ── */

export interface GameSettings {
  masterVolume: number;    // 0–1
  engineVolume: number;    // 0–1
  sfxVolume: number;       // 0–1
  shadowQuality: number;   // 0=off, 1=low, 2=high
  particles: number;       // 0.25–1.0 (multiplier on pool sizes)
  steerSensitivity: number; // 0.5–2.0
  playerName: string;
}

const STORAGE_KEY = 'hr-settings';

const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 0.8,
  engineVolume: 0.7,
  sfxVolume: 0.9,
  shadowQuality: 2,
  particles: 1.0,
  steerSensitivity: 1.0,
  playerName: '',
};

let current: GameSettings = { ...DEFAULT_SETTINGS };

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      current = { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {}
  // Migrate legacy player name
  if (!current.playerName) {
    current.playerName = localStorage.getItem('hr-player-name') || '';
  }
  return current;
}

export function saveSettings(s: GameSettings) {
  current = { ...s };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  if (current.playerName) {
    localStorage.setItem('hr-player-name', current.playerName);
  }
}

export function getSettings(): GameSettings {
  return current;
}

let settingsEl: HTMLElement | null = null;
let onCloseCallback: (() => void) | null = null;

export function showSettings(overlay: HTMLElement, onClose: () => void) {
  if (settingsEl) return;
  onCloseCallback = onClose;
  const s = current;

  settingsEl = document.createElement('div');
  settingsEl.className = 'settings-overlay';
  settingsEl.innerHTML = `
    <div class="settings-panel">
      <div class="settings-title">SETTINGS</div>

      <div class="settings-section">AUDIO</div>
      <label class="settings-row">
        <span>Master Volume</span>
        <input type="range" min="0" max="100" value="${Math.round(s.masterVolume * 100)}" id="set-master">
        <span class="set-val" id="set-master-val">${Math.round(s.masterVolume * 100)}%</span>
      </label>
      <label class="settings-row">
        <span>Engine</span>
        <input type="range" min="0" max="100" value="${Math.round(s.engineVolume * 100)}" id="set-engine">
        <span class="set-val" id="set-engine-val">${Math.round(s.engineVolume * 100)}%</span>
      </label>
      <label class="settings-row">
        <span>SFX</span>
        <input type="range" min="0" max="100" value="${Math.round(s.sfxVolume * 100)}" id="set-sfx">
        <span class="set-val" id="set-sfx-val">${Math.round(s.sfxVolume * 100)}%</span>
      </label>

      <div class="settings-section">GRAPHICS</div>
      <label class="settings-row">
        <span>Shadows</span>
        <select id="set-shadows">
          <option value="0" ${s.shadowQuality === 0 ? 'selected' : ''}>Off</option>
          <option value="1" ${s.shadowQuality === 1 ? 'selected' : ''}>Low</option>
          <option value="2" ${s.shadowQuality === 2 ? 'selected' : ''}>High</option>
        </select>
      </label>
      <label class="settings-row">
        <span>Particles</span>
        <input type="range" min="25" max="100" value="${Math.round(s.particles * 100)}" id="set-particles">
        <span class="set-val" id="set-particles-val">${Math.round(s.particles * 100)}%</span>
      </label>

      <div class="settings-section">CONTROLS</div>
      <label class="settings-row">
        <span>Steer Sensitivity</span>
        <input type="range" min="50" max="200" value="${Math.round(s.steerSensitivity * 100)}" id="set-steer">
        <span class="set-val" id="set-steer-val">${Math.round(s.steerSensitivity * 100)}%</span>
      </label>

      <div class="settings-section">PLAYER</div>
      <label class="settings-row">
        <span>Name</span>
        <input type="text" maxlength="12" value="${s.playerName}" id="set-name" class="lobby-input" style="width:140px;letter-spacing:3px;font-size:16px;padding:6px 12px;">
      </label>

      <div style="display:flex;gap:12px;justify-content:center;margin-top:20px;">
        <button class="select-btn" id="set-save">SAVE</button>
        <button class="menu-btn" id="set-cancel" style="padding:10px 24px;">CANCEL</button>
      </div>
    </div>
  `;
  overlay.appendChild(settingsEl);

  // Wire sliders to display values
  const wireSlider = (id: string) => {
    const input = settingsEl!.querySelector(`#${id}`) as HTMLInputElement;
    const valEl = settingsEl!.querySelector(`#${id}-val`) as HTMLElement;
    if (input && valEl) {
      input.addEventListener('input', () => { valEl.textContent = input.value + '%'; });
    }
  };
  wireSlider('set-master');
  wireSlider('set-engine');
  wireSlider('set-sfx');
  wireSlider('set-particles');
  wireSlider('set-steer');

  settingsEl.querySelector('#set-save')!.addEventListener('click', () => {
    const get = (id: string) => parseInt((settingsEl!.querySelector(`#${id}`) as HTMLInputElement).value);
    saveSettings({
      masterVolume: get('set-master') / 100,
      engineVolume: get('set-engine') / 100,
      sfxVolume: get('set-sfx') / 100,
      shadowQuality: parseInt((settingsEl!.querySelector('#set-shadows') as HTMLSelectElement).value),
      particles: get('set-particles') / 100,
      steerSensitivity: get('set-steer') / 100,
      playerName: ((settingsEl!.querySelector('#set-name') as HTMLInputElement).value || '').trim().toUpperCase(),
    });
    destroySettings();
  });

  settingsEl.querySelector('#set-cancel')!.addEventListener('click', destroySettings);
}

function destroySettings() {
  if (settingsEl) { settingsEl.remove(); settingsEl = null; }
  onCloseCallback?.();
  onCloseCallback = null;
}
