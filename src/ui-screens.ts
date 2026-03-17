/* ── Hood Racer — UI Screen Modules ──
 *
 * Extracted from main.ts. Contains all overlay/screen UI:
 * title screen, pause menu, loading overlay, race config, controls reference,
 * confetti, emote bubbles, position callout, and debug overlay.
 */

import { G } from './game-context';
import { GameState } from './types';
import { showTouchControls } from './input';
import { showSettings } from './settings';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POSITION CALLOUT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let posCalloutTimer: number | null = null;

export function showPositionCallout(gained: boolean, newRank: number) {
  const uiOverlay = document.getElementById('ui-overlay')!;
  if (posCalloutTimer) clearTimeout(posCalloutTimer);
  let el = document.getElementById('pos-callout');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pos-callout';
    uiOverlay.appendChild(el);
  }
  const suffix = newRank === 1 ? 'st' : newRank === 2 ? 'nd' : newRank === 3 ? 'rd' : 'th';
  const arrow = gained ? '▲' : '▼';
  el.className = `pos-callout ${gained ? 'pos-up' : 'pos-down'}`;
  el.innerHTML = `<span class="pos-arrow">${arrow}</span> ${newRank}<sup>${suffix}</sup>`;
  el.style.display = 'block';
  posCalloutTimer = window.setTimeout(() => {
    el!.style.display = 'none';
    posCalloutTimer = null;
  }, 1500);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EMOTE BUBBLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function showEmoteBubble(emoji: string, screenX?: number) {
  const uiOverlay = document.getElementById('ui-overlay')!;
  const el = document.createElement('div');
  el.className = 'emote-bubble';
  el.textContent = emoji;
  el.style.left = `${screenX ?? window.innerWidth / 2}px`;
  el.style.top = `${window.innerHeight * 0.3}px`;
  uiOverlay.appendChild(el);
  setTimeout(() => el.remove(), 2100);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFETTI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function spawnConfetti() {
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:100;pointer-events:none;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const particles: { x: number; y: number; vx: number; vy: number; color: string; size: number; rot: number; rv: number; }[] = [];
  const colors = ['#ff6600', '#00e5ff', '#ffcc00', '#ff1744', '#76ff03', '#e040fb', '#ffffff'];
  for (let i = 0; i < 120; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -Math.random() * canvas.height * 0.3,
      vx: (Math.random() - 0.5) * 6,
      vy: Math.random() * 4 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 8 + 4,
      rot: Math.random() * Math.PI * 2,
      rv: (Math.random() - 0.5) * 0.2,
    });
  }

  let frame = 0;
  const animate = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06;
      p.rot += p.rv;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.4);
      ctx.restore();
    }
    frame++;
    if (frame < 180) requestAnimationFrame(animate);
    else canvas.remove();
  };
  requestAnimationFrame(animate);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEBUG OVERLAY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function updateDebugOverlay() {
  if (!G.debugVisible || !G.playerVehicle) return;

  let el = G.debugEl;
  if (!el) {
    el = document.createElement('pre');
    el.id = 'debug-overlay';
    el.style.cssText = `
      position:fixed; top:70px; left:24px; z-index:999;
      background:rgba(0,0,0,0.75); color:#0f0; font:12px/1.5 monospace;
      padding:10px 14px; border-radius:6px; pointer-events:none;
      min-width:260px; white-space:pre;
    `;
    document.body.appendChild(el);
    G.debugEl = el;
  }

  const pv = G.playerVehicle;
  const t = pv.telemetry;
  const d = pv.damage;
  const deg = (r: number) => (r * 180 / Math.PI).toFixed(1);
  const f1 = (v: number) => v.toFixed(1);
  const f2 = (v: number) => v.toFixed(2);
  const pct = (v: number) => Math.round(v) + '%';

  el.textContent =
`== PHYSICS TELEMETRY ==
Speed:      ${f1(pv.speed)} u/s  (${Math.floor(Math.abs(pv.speed) * 2.5)} MPH)
Steer:      ${f2(pv.steer)}
AngVel:     ${f2(pv.driftAngle)} rad/s
SlipAngle:  ${deg(t.slipAngle)}°

-- AXLE SLIP --
Front α:    ${deg(t.alphaFront)}°
Rear  α:    ${deg(t.alphaRear)}°

-- LATERAL FORCES --
Front Lat:  ${f1(t.frontLatF)}
Rear  Lat:  ${f1(t.rearLatF)}
Yaw Torque: ${f1(t.yawTorque)}
Long Force: ${f1(t.longForce)}

-- WEIGHT DIST --
Front Grip: ${f2(t.frontGrip)}
Rear  Grip: ${f2(t.rearGrip)}
Kin Blend:  ${pct(t.kinBlend * 100)}

-- DAMAGE --
Front HP:   ${pct(d.front.hp)}
Rear  HP:   ${pct(d.rear.hp)}
Left  HP:   ${pct(d.left.hp)}
Right HP:   ${pct(d.right.hp)}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAUSE MENU
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function togglePause(callbacks: {
  onRestart: () => void;
  onQuit: () => void;
}) {
  const uiOverlay = document.getElementById('ui-overlay')!;

  if (G.gameState === GameState.RACING) {
    G.gameState = GameState.PAUSED;
    const overlay = document.createElement('div');
    overlay.className = 'pause-overlay';
    overlay.innerHTML = `
      <div class="pause-title">PAUSED</div>
      <div class="menu-buttons" style="width:240px;">
        <button class="menu-btn" id="btn-resume">RESUME</button>
        <button class="menu-btn" id="btn-restart">RESTART</button>
        <button class="menu-btn" id="btn-quit">MAIN MENU</button>
      </div>
    `;
    uiOverlay.appendChild(overlay);
    G.pauseOverlay = overlay;

    document.getElementById('btn-resume')!.addEventListener('click', () => togglePause(callbacks));
    document.getElementById('btn-restart')!.addEventListener('click', () => {
      destroyPause();
      callbacks.onRestart();
    });
    document.getElementById('btn-quit')!.addEventListener('click', () => {
      destroyPause();
      callbacks.onQuit();
    });
  } else if (G.gameState === GameState.PAUSED) {
    destroyPause();
    G.gameState = GameState.RACING;
  }
}

export function destroyPause() {
  if (G.pauseOverlay) { G.pauseOverlay.remove(); G.pauseOverlay = null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOADING SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function showLoading() {
  const uiOverlay = document.getElementById('ui-overlay')!;
  const el = document.createElement('div');
  el.className = 'loading-overlay';
  el.innerHTML = `
    <div class="title-logo" style="font-size:clamp(36px,8vw,72px);margin-bottom:12px;">HOOD RACER</div>
    <div class="title-subtitle" style="margin-bottom:40px;">Street Legends Never Stop</div>
    <div class="loading-text">GENERATING TRACK<span class="loading-dots"></span></div>
  `;
  uiOverlay.appendChild(el);
  G.loadingEl = el;
}

export function hideLoading() {
  if (G.loadingEl) { G.loadingEl.remove(); G.loadingEl = null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RACE CONFIGURATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function showRaceConfig(
  onStart: (laps: number, ai: number, difficulty: 'easy' | 'medium' | 'hard', seed: string, weather: string, environment: string) => void,
  onBack: () => void,
) {
  const uiOverlay = document.getElementById('ui-overlay')!;
  const el = document.createElement('div');
  el.className = 'race-config-overlay';
  el.innerHTML = `
    <div class="settings-panel" style="max-width:360px;">
      <div class="settings-title">RACE SETUP</div>
      <label class="settings-row">
        <span>Laps</span>
        <select id="cfg-laps">
          <option value="1">1</option>
          <option value="3" selected>3</option>
          <option value="5">5</option>
          <option value="10">10</option>
        </select>
      </label>
      <label class="settings-row">
        <span>AI Opponents</span>
        <select id="cfg-ai">
          <option value="0">None</option>
          <option value="2">2</option>
          <option value="4" selected>4</option>
        </select>
      </label>
      <label class="settings-row">
        <span>AI Difficulty</span>
        <select id="cfg-difficulty">
          <option value="easy">Easy</option>
          <option value="medium" selected>Medium</option>
          <option value="hard">Hard</option>
        </select>
      </label>
      <label class="settings-row">
        <span>Weather</span>
        <select id="cfg-weather">
          <option value="random" selected>Random</option>
          <option value="clear">☀️ Clear</option>
          <option value="light_rain">🌦️ Light Rain</option>
          <option value="heavy_rain">🌧️ Heavy Rain</option>
          <option value="snow">❄️ Snow</option>
          <option value="blizzard">🌨️ Blizzard</option>
          <option value="ice">🧊 Ice</option>
        </select>
      </label>
      <label class="settings-row">
        <span>Track Seed</span>
        <input type="text" id="cfg-seed" placeholder="Random" maxlength="5"
               class="lobby-input" style="width:100px;font-size:14px;padding:4px 8px;letter-spacing:2px;">
      </label>
      <label class="settings-row">
        <span>Environment</span>
        <select id="cfg-env">
          <option value="random" selected>Random</option>
          <option value="Urban Night">🌃 Urban Night</option>
          <option value="Desert Dawn">🏜️ Desert Dawn</option>
          <option value="Coastal Sunset">🌅 Coastal Sunset</option>
          <option value="Neon City">🌆 Neon City</option>
          <option value="Thunder Storm">⛈️ Thunder Storm</option>
          <option value="Alpine Snow">🏔️ Alpine Snow</option>
          <option value="Blizzard">🌨️ Blizzard</option>
          <option value="Black Ice">🧊 Black Ice</option>
        </select>
      </label>
      <div style="display:flex;gap:12px;justify-content:center;margin-top:16px;">
        <button class="select-btn" id="cfg-go">START RACE</button>
        <button class="menu-btn" id="cfg-back" style="padding:10px 24px;">BACK</button>
      </div>
    </div>
  `;
  uiOverlay.appendChild(el);

  document.getElementById('cfg-back')!.addEventListener('click', () => {
    el.remove();
    onBack();
  });

  document.getElementById('cfg-go')!.addEventListener('click', () => {
    const laps = parseInt((el.querySelector('#cfg-laps') as HTMLSelectElement).value);
    const ai = parseInt((el.querySelector('#cfg-ai') as HTMLSelectElement).value);
    const difficulty = (el.querySelector('#cfg-difficulty') as HTMLSelectElement).value as 'easy' | 'medium' | 'hard';
    const seed = (el.querySelector('#cfg-seed') as HTMLInputElement).value.trim();
    const weather = (el.querySelector('#cfg-weather') as HTMLSelectElement).value;
    const environment = (el.querySelector('#cfg-env') as HTMLSelectElement).value;
    el.remove();
    onStart(laps, ai, difficulty, seed, weather, environment);
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONTROLS REFERENCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function showControlsRef() {
  const uiOverlay = document.getElementById('ui-overlay')!;
  if (uiOverlay.querySelector('.controls-overlay')) return;
  const el = document.createElement('div');
  el.className = 'controls-overlay';
  el.innerHTML = `
    <div class="settings-panel" style="max-width:400px;">
      <div class="settings-title">CONTROLS</div>
      <div class="controls-section">
        <div class="controls-heading">KEYBOARD</div>
        <div class="controls-row"><span>Steer</span><span>WASD / Arrow Keys</span></div>
        <div class="controls-row"><span>Boost</span><span>Shift / Space</span></div>
        <div class="controls-row"><span>Pause</span><span>Escape</span></div>
        <div class="controls-row"><span>Debug</span><span>Backtick (\`)</span></div>
      </div>
      <div class="controls-section">
        <div class="controls-heading">MOBILE</div>
        <div class="controls-row"><span>Steer</span><span>Drag left side of screen</span></div>
        <div class="controls-row"><span>Gas / Brake / Boost</span><span>Right side buttons</span></div>
        <div class="controls-row"><span>Tilt steering</span><span>Enable in Settings</span></div>
      </div>
      <button class="select-btn" id="ctrl-close" style="margin-top:16px;">CLOSE</button>
    </div>
  `;
  uiOverlay.appendChild(el);
  document.getElementById('ctrl-close')!.addEventListener('click', () => el.remove());
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TITLE SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function showTitleScreen(callbacks: {
  onSingleplayer: () => void;
  onMultiplayer: () => void;
  onTrackEditor: () => void;
  onApplySettings: () => void;
}) {
  const uiOverlay = document.getElementById('ui-overlay')!;
  G.gameState = GameState.TITLE;
  showTouchControls(false);

  const titleEl = document.createElement('div');
  titleEl.className = 'title-screen';
  titleEl.id = 'title-screen';
  titleEl.innerHTML = `
    <div class="title-logo">HOOD RACER</div>
    <div class="title-subtitle">Street Legends Never Stop</div>
    <div class="menu-buttons">
      <button class="menu-btn" id="btn-singleplayer">SINGLEPLAYER</button>
      <button class="menu-btn" id="btn-multiplayer">MULTIPLAYER</button>
      <button class="menu-btn" id="btn-track-editor" style="border-color:#ff6600;color:#ff8833;">🏁 TRACK EDITOR</button>
      <button class="menu-btn" id="btn-calibrate" style="border-color:#00ffff;color:#00ffff;">✨ CALIBRATION STUDIO</button>
      <button class="menu-btn" id="btn-controls" style="border-color:var(--col-text-dim);font-size:16px;">CONTROLS</button>
      <button class="menu-btn" id="btn-settings" style="border-color:var(--col-text-dim);font-size:16px;">SETTINGS</button>
    </div>
  `;
  uiOverlay.appendChild(titleEl);

  document.getElementById('btn-singleplayer')!.addEventListener('click', () => {
    titleEl.remove();
    callbacks.onSingleplayer();
  });

  document.getElementById('btn-multiplayer')!.addEventListener('click', () => {
    titleEl.remove();
    callbacks.onMultiplayer();
  });

  document.getElementById('btn-track-editor')!.addEventListener('click', () => {
    titleEl.remove();
    callbacks.onTrackEditor();
  });

  document.getElementById('btn-calibrate')!.addEventListener('click', () => {
    window.location.href = '?calibrate=1';
  });

  document.getElementById('btn-controls')!.addEventListener('click', showControlsRef);

  document.getElementById('btn-settings')!.addEventListener('click', () => {
    showSettings(uiOverlay, callbacks.onApplySettings);
  });
}
