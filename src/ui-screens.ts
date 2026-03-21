/* ── IRL Race — UI Screen Modules ──
 *
 * Extracted from main.ts. Contains all overlay/screen UI:
 * title screen, pause menu, loading overlay, race config, controls reference,
 * confetti, emote bubbles, position callout, and debug overlay.
 */

import { G } from './game-context';
import { GameState } from './types';
import { showTouchControls } from './input';
import { showSettings } from './settings';
import * as THREE from 'three/webgpu';
import { ENVIRONMENTS, EnvironmentPreset } from './scene';
import { getDailyChallenges, getWeeklyChallenges, getChallengeProgress } from './progression';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POSITION CALLOUT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let posCalloutTimer: number | null = null;

export function showPositionCallout(gained: boolean, newRank: number) {
  const uiOverlay = document.getElementById('ui-overlay')!;
  if (posCalloutTimer) clearTimeout(posCalloutTimer);
  // Haptic feedback for position change
  if (navigator.vibrate) navigator.vibrate(gained ? [30, 20, 30] : 25);
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
// FULLSCREEN API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Attempt to lock orientation to landscape via Screen Orientation API. Fails silently. */
export function lockLandscape() {
  try {
    const so = screen.orientation as any;
    if (so?.lock) so.lock('landscape').catch(() => {});
  } catch { /* not supported */ }
}

/** Toggle browser fullscreen mode (hides address bar on Android). */
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen().then(() => {
      lockLandscape();
    }).catch(() => {});
  }
}

/** Returns true if the browser supports the Fullscreen API (excludes iOS). */
export function isFullscreenSupported(): boolean {
  return !!document.documentElement.requestFullscreen
    && !/iPad|iPhone|iPod/.test(navigator.userAgent);
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
  if (G.pauseOverlay) {
    const el = G.pauseOverlay;
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 200);
    G.pauseOverlay = null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOADING SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _loadingTipTimer: number | null = null;

export function showLoading(envName?: string) {
  const uiOverlay = document.getElementById('ui-overlay')!;
  const el = document.createElement('div');
  el.className = 'loading-overlay';

  const tips = [
    'Drift through corners to build boost meter',
    'Watch your engine heat — overheating means explosion',
    'Use nitrous wisely — supplies are limited',
    'Near misses with AI cars give bonus speed',
    'Heavy collisions damage your car zones',
    'Tap BRAKE before corners for tighter turns',
    'Each environment changes grip and visibility',
    'Replay your best laps from the results screen',
    'Scroll wheel adjusts camera distance',
    'Custom paint jobs cost 100 credits in the garage',
  ];
  const tipIdx = Math.floor(Math.random() * tips.length);
  const emoji = envName ? (ENV_EMOJI[envName] || '') : '';
  const envLabel = envName ? `${emoji} ${envName}` : '';

  el.innerHTML = `
    <div class="title-logo" style="font-size:clamp(36px,8vw,72px);margin-bottom:12px;">IRL RACE</div>
    <div class="title-subtitle" style="margin-bottom:24px;">Street Legends Never Stop</div>
    ${envLabel ? `<div class="loading-env-name">${envLabel}</div>` : ''}
    <div class="loading-bar-container">
      <div class="loading-bar-fill" id="loading-bar-fill"></div>
    </div>
    <div class="loading-status" id="loading-status">GENERATING TRACK<span class="loading-dots"></span></div>
    <div class="loading-tip" style="margin-top:20px;font-size:13px;color:rgba(255,255,255,0.5);font-style:italic;transition:opacity 0.4s;max-width:360px;text-align:center;">${tips[tipIdx]}</div>
  `;
  uiOverlay.appendChild(el);
  G.loadingEl = el;

  // Rotate tips every 3s
  let currentTip = tipIdx;
  const tipEl = el.querySelector('.loading-tip') as HTMLElement;
  _loadingTipTimer = window.setInterval(() => {
    if (!tipEl) return;
    tipEl.style.opacity = '0';
    setTimeout(() => {
      currentTip = (currentTip + 1) % tips.length;
      tipEl.textContent = tips[currentTip];
      tipEl.style.opacity = '1';
    }, 400);
  }, 3000);
}

/** Update loading progress bar (0–100) and optional status label. */
export function updateLoadingProgress(pct: number, label?: string) {
  const bar = document.getElementById('loading-bar-fill');
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  if (label) {
    const status = document.getElementById('loading-status');
    if (status) status.innerHTML = `${label}<span class="loading-dots"></span>`;
  }
}

export function hideLoading() {
  if (G.loadingEl) { G.loadingEl.remove(); G.loadingEl = null; }
  if (_loadingTipTimer) { clearInterval(_loadingTipTimer); _loadingTipTimer = null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RACE CONFIGURATION — Split-panel with 3D preview
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━



// Environment flavor text
const ENV_FLAVOR: Record<string, string> = {
  'Random': 'Let fate decide your track',
  'Washington D.C.': 'Monuments, marble, government district nightlife',
  'Mojave': 'Sun-scorched highway, endless horizon',
  'Havana': 'Tropical heat, golden hour, palm shadows',
  'Shibuya': 'Neon-drenched megacity, wet reflections',
  'Zermatt': 'Frozen mountain pass, icy curves',
  'Gaza City': 'Dense Levantine streets, dusty Mediterranean dusk',
  'Kiev': 'Soviet facades, golden domes, chestnut-lined boulevards',
  'Baghdad': 'Ancient Mesopotamian capital, golden dust haze',
  'Damascus': 'World\'s oldest city, ablaq stone and jasmine',
  'Beirut': 'Mediterranean jewel, scarred resilience',
  'Tripoli': 'North African coast, Italian-Ottoman crossroads',
  'Mogadishu': 'Indian Ocean port, coral stone and sea breeze',
  'Tehran': 'Persian capital, Alborz mountain backdrop',
  'Khartoum': 'Nile confluence, red brick and white dust',
};

const ENV_EMOJI: Record<string, string> = {
  'Random': '🎲',
  'Washington D.C.': '🏛️',
  'Mojave': '🏜️',
  'Havana': '🌴',
  'Shibuya': '🌆',
  'Zermatt': '🏔️',
  'Gaza City': '🕌',
  'Kiev': '🇺🇦',
  'Baghdad': '🏻',
  'Damascus': '🕌',
  'Beirut': '🌊',
  'Tripoli': '🏠',
  'Mogadishu': '☀️',
  'Tehran': '⛰️',
  'Khartoum': '🏜️',
};

// Preview state (Canvas 2D gradient)
let _previewCanvas: HTMLCanvasElement | null = null;
let _previewCtx: CanvasRenderingContext2D | null = null;
let _previewRAF = 0;
let _previewWeather = 'clear'; // tracks weather for preview particles

// Target colors (hex)
let _tgtSkyTop = { r: 0, g: 0, b: 0 };
let _tgtSkyMid = { r: 0, g: 0, b: 0 };
let _tgtSkyBot = { r: 0, g: 0, b: 0 };
let _tgtGround = { r: 0, g: 0, b: 0 };
let _tgtFog = { r: 0, g: 0, b: 0 };
let _tgtDir = { r: 0, g: 0, b: 0 };
// Current interpolated colors
let _curSkyTopC = { r: 0, g: 0, b: 0 };
let _curSkyMidC = { r: 0, g: 0, b: 0 };
let _curSkyBotC = { r: 0, g: 0, b: 0 };
let _curGroundC = { r: 0, g: 0, b: 0 };
let _curFogC = { r: 0, g: 0, b: 0 };
let _curDirC = { r: 0, g: 0, b: 0 };

function hexToRgb(hex: number) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}
function lerpC(cur: { r: number; g: number; b: number }, tgt: { r: number; g: number; b: number }, t: number) {
  cur.r += (tgt.r - cur.r) * t;
  cur.g += (tgt.g - cur.g) * t;
  cur.b += (tgt.b - cur.b) * t;
}
function rgbStr(c: { r: number; g: number; b: number }, a = 1) {
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${a})`;
}

function createPreviewScene(canvas: HTMLCanvasElement) {
  _previewCanvas = canvas;
  _previewCtx = canvas.getContext('2d')!;
  startPreviewLoop();
}

function setPreviewEnvironment(preset: EnvironmentPreset) {
  _tgtSkyTop = hexToRgb(preset.skyTop);
  _tgtSkyMid = preset.skyHorizon ? hexToRgb(preset.skyHorizon) : hexToRgb(preset.skyBottom);
  _tgtSkyBot = hexToRgb(preset.skyBottom);
  _tgtGround = hexToRgb(preset.groundColor);
  _tgtFog = hexToRgb(preset.fogColor);
  _tgtDir = hexToRgb(preset.dirColor);

  // Update env name overlay
  const nameEl = document.getElementById('preview-env-name');
  const descEl = document.getElementById('preview-env-desc');
  if (nameEl) nameEl.textContent = `${ENV_EMOJI[preset.name] || ''} ${preset.name}`;
  if (descEl) descEl.textContent = ENV_FLAVOR[preset.name] || '';
}

let _previewLastTime = 0;
function previewLoop(time: number) {
  const dt = Math.min(0.1, (time - _previewLastTime) / 1000);
  _previewLastTime = time;

  if (!_previewCtx || !_previewCanvas) return;
  const w = _previewCanvas.width;
  const h = _previewCanvas.height;
  const t = Math.min(1, dt * 4); // ~0.25s blend

  // Interpolate colors
  lerpC(_curSkyTopC, _tgtSkyTop, t);
  lerpC(_curSkyMidC, _tgtSkyMid, t);
  lerpC(_curSkyBotC, _tgtSkyBot, t);
  lerpC(_curGroundC, _tgtGround, t);
  lerpC(_curFogC, _tgtFog, t);
  lerpC(_curDirC, _tgtDir, t);

  const ctx = _previewCtx;
  ctx.clearRect(0, 0, w, h);

  // ── Sky gradient (top 60% of canvas) ──
  const skyH = h * 0.6;
  const skyGrad = ctx.createLinearGradient(0, 0, 0, skyH);
  skyGrad.addColorStop(0, rgbStr(_curSkyTopC));
  skyGrad.addColorStop(0.6, rgbStr(_curSkyMidC));
  skyGrad.addColorStop(1, rgbStr(_curSkyBotC));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, skyH);

  // ── Horizon glow ──
  const glowGrad = ctx.createRadialGradient(w * 0.5, skyH, 0, w * 0.5, skyH, w * 0.5);
  glowGrad.addColorStop(0, rgbStr(_curDirC, 0.2));
  glowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, skyH * 0.5, w, skyH * 0.6);

  // ── Ground plane (bottom 40%) ──
  const groundY = skyH;
  const groundH = h - skyH;
  // Perspective gradient for ground
  const gGrad = ctx.createLinearGradient(0, groundY, 0, h);
  gGrad.addColorStop(0, rgbStr(_curFogC, 0.8));
  gGrad.addColorStop(0.3, rgbStr(_curGroundC));
  gGrad.addColorStop(1, rgbStr(_curGroundC));
  ctx.fillStyle = gGrad;
  ctx.fillRect(0, groundY, w, groundH);

  // ── Road strip (center, perspective convergence) ──
  const roadTopW = w * 0.02;
  const roadBotW = w * 0.25;
  const roadCx = w * 0.5;
  ctx.beginPath();
  ctx.moveTo(roadCx - roadTopW / 2, groundY);
  ctx.lineTo(roadCx - roadBotW / 2, h);
  ctx.lineTo(roadCx + roadBotW / 2, h);
  ctx.lineTo(roadCx + roadTopW / 2, groundY);
  ctx.closePath();
  // Darken road
  ctx.fillStyle = `rgba(${Math.max(0, _curGroundC.r - 20)},${Math.max(0, _curGroundC.g - 20)},${Math.max(0, _curGroundC.b - 15)},0.8)`;
  ctx.fill();

  // ── Center lane line ──
  ctx.beginPath();
  ctx.moveTo(roadCx, groundY);
  ctx.lineTo(roadCx, h);
  ctx.strokeStyle = rgbStr(_curDirC, 0.25);
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 12]);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Stars (only if sky is dark enough) ──
  const brightness = (_curSkyTopC.r + _curSkyTopC.g + _curSkyTopC.b) / 3;
  if (brightness < 80) {
    const starTime = time * 0.00005;
    for (let i = 0; i < 30; i++) {
      const sx = ((Math.sin(i * 127.1 + starTime) * 0.5 + 0.5) * w) % w;
      const sy = ((Math.cos(i * 311.7) * 0.5 + 0.5) * skyH * 0.7);
      const sa = 0.3 + Math.sin(time * 0.001 + i * 1.7) * 0.2;
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, sa)})`;
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }
  }

  // ── Car silhouette on road ──
  drawCarSilhouette(ctx, w, h, groundY);

  // ── Atmospheric fog wash ──
  const fogWash = ctx.createLinearGradient(0, skyH - 20, 0, skyH + groundH * 0.3);
  fogWash.addColorStop(0, rgbStr(_curFogC, 0.4));
  fogWash.addColorStop(1, 'transparent');
  ctx.fillStyle = fogWash;
  ctx.fillRect(0, skyH - 20, w, groundH * 0.3 + 20);

  // ── Weather particles ──
  drawWeatherParticles(ctx, w, h, time);

  _previewRAF = requestAnimationFrame(previewLoop);
}

/** Draw a simple car silhouette centered on the road. */
function drawCarSilhouette(ctx: CanvasRenderingContext2D, w: number, h: number, groundY: number) {
  const cx = w * 0.5;
  const carY = groundY + (h - groundY) * 0.55; // 55% into the ground area
  const carW = w * 0.08;
  const carH = carW * 0.35;
  const cabH = carW * 0.22;

  ctx.save();
  ctx.fillStyle = 'rgba(5,5,15,0.85)';
  ctx.beginPath();
  // Body
  ctx.moveTo(cx - carW / 2, carY);
  ctx.lineTo(cx + carW / 2, carY);
  ctx.lineTo(cx + carW / 2, carY - carH);
  ctx.lineTo(cx + carW * 0.35, carY - carH);
  // Roof
  ctx.lineTo(cx + carW * 0.25, carY - carH - cabH);
  ctx.lineTo(cx - carW * 0.2, carY - carH - cabH);
  // Windshield
  ctx.lineTo(cx - carW * 0.3, carY - carH);
  ctx.lineTo(cx - carW / 2, carY - carH);
  ctx.closePath();
  ctx.fill();

  // Headlights (two small glowing dots)
  const hlY = carY - carH * 0.5;
  const hlR = carW * 0.04;
  for (const side of [-1, 1]) {
    const hlX = cx + side * carW * 0.42;
    const hlGrad = ctx.createRadialGradient(hlX, hlY, 0, hlX, hlY, hlR * 6);
    hlGrad.addColorStop(0, rgbStr(_curDirC, 0.6));
    hlGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = hlGrad;
    ctx.fillRect(hlX - hlR * 6, hlY - hlR * 6, hlR * 12, hlR * 12);
    ctx.fillStyle = `rgba(255,255,240,0.9)`;
    ctx.beginPath();
    ctx.arc(hlX, hlY, hlR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Draw weather particles based on _previewWeather. */
function drawWeatherParticles(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  if (_previewWeather === 'clear' || _previewWeather === 'random') return;

  const isRain = _previewWeather === 'light_rain' || _previewWeather === 'heavy_rain';
  const isSnow = _previewWeather === 'snow';
  const isBlizzard = _previewWeather === 'blizzard';
  const isIce = _previewWeather === 'ice';

  ctx.save();

  if (isRain) {
    const count = _previewWeather === 'heavy_rain' ? 60 : 30;
    ctx.strokeStyle = 'rgba(180,200,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < count; i++) {
      const seed = i * 73.13;
      const x = ((Math.sin(seed) * 0.5 + 0.5) * w + time * 0.05 * (i % 3 + 1)) % w;
      const y = ((Math.cos(seed * 1.7) * 0.5 + 0.5) * h + time * 0.4 * (1 + (i % 3) * 0.3)) % h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 12);
      ctx.stroke();
    }
  }

  if (isSnow || isBlizzard) {
    const count = isBlizzard ? 50 : 25;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < count; i++) {
      const seed = i * 47.91;
      const drift = Math.sin(time * 0.001 + i * 2.1) * 15;
      const windDrift = isBlizzard ? time * 0.08 * (i % 2 + 1) : 0;
      const x = ((Math.sin(seed) * 0.5 + 0.5) * w + drift + windDrift) % w;
      const y = ((Math.cos(seed * 2.3) * 0.5 + 0.5) * h + time * 0.08 * (1 + (i % 4) * 0.2)) % h;
      const r = 1.5 + (i % 3) * 0.8;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (isBlizzard) {
      // Reduced visibility overlay
      ctx.fillStyle = 'rgba(200,210,230,0.15)';
      ctx.fillRect(0, 0, w, h);
    }
  }

  if (isIce) {
    // Blue-tinted vignette
    const vigGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.2, w * 0.5, h * 0.5, w * 0.7);
    vigGrad.addColorStop(0, 'transparent');
    vigGrad.addColorStop(1, 'rgba(100,140,255,0.2)');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, w, h);
    // Frost sparkle dots
    ctx.fillStyle = 'rgba(200,220,255,0.4)';
    for (let i = 0; i < 15; i++) {
      const fx = (Math.sin(i * 83.7) * 0.5 + 0.5) * w;
      const fy = (Math.cos(i * 127.3) * 0.5 + 0.5) * h;
      const fa = 0.2 + Math.sin(time * 0.002 + i * 3.1) * 0.2;
      ctx.globalAlpha = Math.max(0, fa);
      ctx.fillRect(fx, fy, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function startPreviewLoop() {
  _previewLastTime = performance.now();
  _previewRAF = requestAnimationFrame(previewLoop);
}

function destroyPreview() {
  cancelAnimationFrame(_previewRAF);
  _previewRAF = 0;
  _previewCanvas = null;
  _previewCtx = null;
  _previewWeather = 'clear';
}

/** Build compact challenge summary for race setup screen. */
function buildSetupChallengesHTML(): string {
  const daily = getDailyChallenges();
  const weekly = getWeeklyChallenges();
  const all = [...daily, ...weekly];
  let html = '';
  for (const ch of all) {
    const [cur, tgt, done] = getChallengeProgress(ch);
    const pct = Math.min(100, Math.round((cur / tgt) * 100));
    const typeLabel = ch.type === 'daily' ? '' : '<span style="color:var(--col-cyan);font-size:10px;margin-left:4px;">WEEKLY</span>';
    html += `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;color:${done ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.8)'};">`;
    html += `<span style="flex:1;">${ch.icon} ${ch.name}${typeLabel}</span>`;
    html += `<span style="min-width:40px;text-align:right;">${done ? '✅' : `${cur}/${tgt}`}</span>`;
    html += `</div>`;
    if (!done) {
      html += `<div style="background:rgba(255,255,255,0.08);border-radius:2px;height:2px;margin-bottom:2px;">`;
      html += `<div style="background:${ch.type === 'daily' ? 'var(--col-orange)' : 'var(--col-cyan)'};border-radius:2px;height:100%;width:${pct}%;"></div></div>`;
    }
  }
  return html;
}

export function showRaceConfig(
  onStart: (laps: number, ai: number, difficulty: 'easy' | 'medium' | 'hard', seed: string, weather: string, environment: string) => void,
  onBack: () => void,
) {
  const uiOverlay = document.getElementById('ui-overlay')!;
  const el = document.createElement('div');
  el.className = 'race-config-overlay';



  // Build environment card grid
  const envGridHtml = [
    `<button class="env-card env-card--active" data-env="random" style="--env-accent: #00e5ff">
      <span class="env-card-emoji">${ENV_EMOJI['Random']}</span>
      <span class="env-card-name">Random</span>
      <span class="env-card-desc">${ENV_FLAVOR['Random']}</span>
    </button>`,
    ...ENVIRONMENTS.map(e => {
      const skyHex = '#' + (e.skyTop & 0xFFFFFF).toString(16).padStart(6, '0');
      return `<button class="env-card" data-env="${e.name}" style="--env-accent: ${skyHex}">
        <span class="env-card-emoji">${ENV_EMOJI[e.name] || '🏁'}</span>
        <span class="env-card-name">${e.name}</span>
        <span class="env-card-desc">${ENV_FLAVOR[e.name] || ''}</span>
      </button>`;
    }),
  ].join('');

  el.innerHTML = `
    <div class="race-config-panel">
      <!-- Preview (moves to top on mobile) -->
      <div class="race-config-right">
        <div class="preview-container">
          <canvas id="env-preview-canvas" class="env-preview-canvas"></canvas>
          <div class="preview-overlay">
            <div class="preview-env-name" id="preview-env-name">🎲 Random</div>
            <div class="preview-env-desc" id="preview-env-desc">Let fate decide your track</div>
          </div>
        </div>
      </div>

      <!-- Controls (scrollable on mobile) -->
      <div class="race-config-left">
        <div class="race-config-title">RACE SETUP</div>

        <div class="race-config-section-label">⚡ RACE</div>

        <div class="rc-row-pair">
          <div class="rc-row">
            <span class="rc-label">Laps</span>
            <div class="rc-toggle-group" data-cfg="laps">
              <button class="rc-toggle" data-val="1">1</button>
              <button class="rc-toggle rc-toggle--active" data-val="3">3</button>
              <button class="rc-toggle" data-val="5">5</button>
              <button class="rc-toggle" data-val="10">10</button>
            </div>
          </div>
          <div class="rc-row">
            <span class="rc-label">AI</span>
            <div class="rc-toggle-group" data-cfg="ai">
              <button class="rc-toggle" data-val="0">None</button>
              <button class="rc-toggle" data-val="2">2</button>
              <button class="rc-toggle rc-toggle--active" data-val="4">4</button>
            </div>
          </div>
        </div>

        <div class="rc-row">
          <span class="rc-label">Difficulty</span>
          <div class="rc-toggle-group" data-cfg="difficulty">
            <button class="rc-toggle" data-val="easy">Easy</button>
            <button class="rc-toggle rc-toggle--active" data-val="medium">Medium</button>
            <button class="rc-toggle" data-val="hard">Hard</button>
          </div>
        </div>

        <div class="rc-row">
          <span class="rc-label">Weather</span>
          <div class="rc-toggle-group rc-toggle-group--wrap" data-cfg="weather">
            <button class="rc-toggle rc-toggle--active" data-val="random" title="Random">🎲</button>
            <button class="rc-toggle" data-val="clear" title="Clear">☀️</button>
            <button class="rc-toggle" data-val="light_rain" title="Light Rain">🌦️</button>
            <button class="rc-toggle" data-val="heavy_rain" title="Heavy Rain">🌧️</button>
            <button class="rc-toggle" data-val="snow" title="Snow">❄️</button>
            <button class="rc-toggle" data-val="blizzard" title="Blizzard">🌨️</button>
            <button class="rc-toggle" data-val="ice" title="Ice">🧊</button>
          </div>
        </div>

        <div class="rc-row">
          <span class="rc-label">Track Seed</span>
          <input type="text" id="cfg-seed" placeholder="Random" maxlength="5" class="rc-input">
        </div>

        <div class="race-config-section-label" style="margin-top:12px;">🌍 ENVIRONMENT</div>
        <div class="env-card-grid" id="env-card-grid">
          ${envGridHtml}
        </div>

        <!-- Challenges summary -->
        <div class="race-config-section-label" style="margin-top:8px;">🎯 TODAY'S CHALLENGES</div>
        <div class="rc-challenges-summary" id="rc-challenges">
          ${buildSetupChallengesHTML()}
        </div>

        <!-- Actions at bottom of controls -->
        <div class="race-config-actions">
          <button class="rc-start-btn" id="cfg-go">START RACE<span class="rc-start-sub" id="rc-start-sub"></span></button>
          <button class="rc-back-btn" id="cfg-back">BACK</button>
        </div>
      </div>
    </div>
  `;
  uiOverlay.appendChild(el);

  // Initialize preview
  const canvas = document.getElementById('env-preview-canvas') as HTMLCanvasElement;
  if (canvas) {
    // Size the canvas to match its CSS container
    const rect = canvas.parentElement!.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * Math.min(window.devicePixelRatio, 2));
    canvas.height = Math.floor(rect.height * Math.min(window.devicePixelRatio, 2));
    createPreviewScene(canvas);
    // Set initial environment (random → first env as default look)
    const initialEnv = ENVIRONMENTS[Math.floor(Math.random() * ENVIRONMENTS.length)];
    // Initialize colors immediately (no transition)
    const initRgb = hexToRgb(initialEnv.skyTop);
    Object.assign(_curSkyTopC, initRgb);
    Object.assign(_curSkyMidC, hexToRgb(initialEnv.skyHorizon ?? initialEnv.skyBottom));
    Object.assign(_curSkyBotC, hexToRgb(initialEnv.skyBottom));
    Object.assign(_curGroundC, hexToRgb(initialEnv.groundColor));
    Object.assign(_curFogC, hexToRgb(initialEnv.fogColor));
    Object.assign(_curDirC, hexToRgb(initialEnv.dirColor));
    setPreviewEnvironment(initialEnv);
  }

  // Wire toggle groups (generic: works for laps, ai, difficulty, weather)
  el.querySelectorAll('.rc-toggle-group').forEach(group => {
    group.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.rc-toggle') as HTMLElement;
      if (!btn) return;
      group.querySelectorAll('.rc-toggle').forEach(t => t.classList.remove('rc-toggle--active'));
      btn.classList.add('rc-toggle--active');

      // Weather: update preview weather
      if ((group as HTMLElement).dataset.cfg === 'weather') {
        _previewWeather = btn.dataset.val || 'random';
      }
      updateStartSub(el);
    });
  });

  // Wire environment card grid
  const envGrid = document.getElementById('env-card-grid')!;
  envGrid.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest('.env-card') as HTMLElement;
    if (!card) return;

    // Update selected visual
    envGrid.querySelectorAll('.env-card').forEach(c => c.classList.remove('env-card--active'));
    card.classList.add('env-card--active');

    const val = card.dataset.env || 'random';
    if (val === 'random') {
      const randEnv = ENVIRONMENTS[Math.floor(Math.random() * ENVIRONMENTS.length)];
      setPreviewEnvironment(randEnv);
      const nameEl = document.getElementById('preview-env-name');
      const descEl = document.getElementById('preview-env-desc');
      if (nameEl) nameEl.textContent = '🎲 Random';
      if (descEl) descEl.textContent = 'Let fate decide your track';
    } else {
      const preset = ENVIRONMENTS.find(env => env.name === val);
      if (preset) setPreviewEnvironment(preset);
    }
    updateStartSub(el);
  });

  // Initial subtitle
  updateStartSub(el);

  // Keyboard navigation
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('cfg-go')?.click();
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const cards = Array.from(envGrid.querySelectorAll('.env-card')) as HTMLElement[];
      const activeIdx = cards.findIndex(c => c.classList.contains('env-card--active'));
      const next = e.key === 'ArrowRight'
        ? Math.min(activeIdx + 1, cards.length - 1)
        : Math.max(activeIdx - 1, 0);
      if (next !== activeIdx) cards[next].click();
    }
  });

  // Wire buttons
  document.getElementById('cfg-back')!.addEventListener('click', () => {
    destroyPreview();
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 200);
    onBack();
  });

  // Helper: get active toggle value
  const getToggleVal = (cfgName: string): string => {
    const active = el.querySelector(`.rc-toggle-group[data-cfg="${cfgName}"] .rc-toggle--active`) as HTMLElement;
    return active?.dataset.val || '';
  };

  document.getElementById('cfg-go')!.addEventListener('click', () => {
    const laps = parseInt(getToggleVal('laps') || '3');
    const ai = parseInt(getToggleVal('ai') || '4');
    const difficulty = (getToggleVal('difficulty') || 'medium') as 'easy' | 'medium' | 'hard';
    const seed = (el.querySelector('#cfg-seed') as HTMLInputElement).value.trim();
    const weather = getToggleVal('weather') || 'random';
    const activeEnv = envGrid.querySelector('.env-card--active') as HTMLElement;
    const environment = activeEnv?.dataset.env || 'random';
    destroyPreview();
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 200);
    onStart(laps, ai, difficulty, seed, weather, environment);
  });
}

/** Update the START RACE button subtitle with current selections. */
function updateStartSub(el: HTMLElement) {
  const sub = el.querySelector('#rc-start-sub');
  if (!sub) return;

  const getVal = (cfg: string) => {
    const active = el.querySelector(`.rc-toggle-group[data-cfg="${cfg}"] .rc-toggle--active`) as HTMLElement;
    return active?.dataset.val || '';
  };

  const laps = getVal('laps') || '3';
  const activeEnv = el.querySelector('.env-card--active') as HTMLElement;
  const envName = activeEnv?.dataset.env === 'random' ? 'Random' : (activeEnv?.dataset.env || 'Random');
  const weatherVal = getVal('weather');
  const weatherLabel = weatherVal === 'random' ? 'Random' : (el.querySelector(`.rc-toggle-group[data-cfg="weather"] .rc-toggle--active`) as HTMLElement)?.title || 'Random';
  sub.textContent = `${laps} Lap${laps === '1' ? '' : 's'} · ${envName} · ${weatherLabel}`;
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

let _titleEmberCanvas: HTMLCanvasElement | null = null;
let _titleEmberRAF = 0;

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
    <div class="title-content" id="title-content">
      <div class="title-logo"><span class="title-irl">IRL</span> <span class="title-race">RACE</span></div>
      <div class="title-subtitle">Street Legends Never Stop</div>
      <div class="menu-buttons">
        <button class="menu-btn menu-btn--accent" id="btn-singleplayer">SINGLEPLAYER</button>
        <button class="menu-btn menu-btn--cyan" id="btn-multiplayer">MULTIPLAYER</button>
        <button class="menu-btn" id="btn-track-editor" style="border-color:#ff6600;color:#ff8833;">🏁 TRACK EDITOR</button>
        <button class="menu-btn" id="btn-calibrate" style="border-color:#00ffff;color:#00ffff;">✨ CALIBRATION STUDIO</button>
        <button class="menu-btn menu-btn--small" id="btn-controls">CONTROLS</button>
        <button class="menu-btn menu-btn--small" id="btn-settings">SETTINGS</button>
      </div>
      <div class="title-version">v0.1.0 · EARLY ACCESS</div>
    </div>
  `;
  uiOverlay.appendChild(titleEl);

  // ── Falling ember particles ──
  startTitleEmbers(titleEl);

  // ── Trigger cinematic reveal (needs a frame for CSS transitions to fire) ──
  requestAnimationFrame(() => {
    document.getElementById('title-content')?.classList.add('title-content--revealed');
  });

  const removeTitleScreen = () => {
    stopTitleEmbers();
    // Fade out before removing
    titleEl.classList.add('fade-out');
    setTimeout(() => titleEl.remove(), 200);
  };

  document.getElementById('btn-singleplayer')!.addEventListener('click', () => {
    removeTitleScreen();
    callbacks.onSingleplayer();
  });

  document.getElementById('btn-multiplayer')!.addEventListener('click', () => {
    removeTitleScreen();
    callbacks.onMultiplayer();
  });

  document.getElementById('btn-track-editor')!.addEventListener('click', () => {
    removeTitleScreen();
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

function startTitleEmbers(container: HTMLElement) {
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0;';
  container.insertBefore(canvas, container.firstChild);
  _titleEmberCanvas = canvas;
  const ctx = canvas.getContext('2d')!;

  const embers: { x: number; y: number; vx: number; vy: number; size: number; alpha: number; hue: number; }[] = [];
  for (let i = 0; i < 60; i++) {
    embers.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: 0.3 + Math.random() * 0.8,
      size: 1 + Math.random() * 2.5,
      alpha: 0.3 + Math.random() * 0.5,
      hue: 15 + Math.random() * 25, // orange-amber range
    });
  }

  const animate = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const e of embers) {
      e.x += e.vx;
      e.y += e.vy;
      e.alpha *= 0.998;
      // Wrap
      if (e.y > canvas.height + 5) { e.y = -5; e.alpha = 0.3 + Math.random() * 0.5; }
      if (e.x < -5) e.x = canvas.width + 5;
      if (e.x > canvas.width + 5) e.x = -5;
      // Draw glow
      ctx.save();
      ctx.globalAlpha = e.alpha;
      ctx.fillStyle = `hsl(${e.hue}, 90%, 55%)`;
      ctx.shadowColor = `hsl(${e.hue}, 100%, 50%)`;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    _titleEmberRAF = requestAnimationFrame(animate);
  };
  _titleEmberRAF = requestAnimationFrame(animate);
}

function stopTitleEmbers() {
  if (_titleEmberRAF) cancelAnimationFrame(_titleEmberRAF);
  _titleEmberRAF = 0;
  if (_titleEmberCanvas) { _titleEmberCanvas.remove(); _titleEmberCanvas = null; }
}
