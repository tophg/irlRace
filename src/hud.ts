/* ── Hood Racer — HUD ── */

import * as THREE from 'three';
import type { DamageState } from './types';
import { RaceEngine } from './race-engine';

let hudEl: HTMLElement;
let speedEl: HTMLElement;
let lapEl: HTMLElement;
let positionEl: HTMLElement;
let wrongWayEl: HTMLElement;
let timerEl: HTMLElement;
let boostEl: HTMLElement;
let gapEl: HTMLElement;
let nitroFillEl: HTMLElement;
let minimapCanvas: HTMLCanvasElement;
let minimapCtx: CanvasRenderingContext2D;

let cachedMinimapPoints: THREE.Vector3[] | null = null;
let cachedMinimapSpline: THREE.CatmullRomCurve3 | null = null;
let cachedMinX = 0, cachedMaxX = 0, cachedMinZ = 0, cachedMaxZ = 0;

export function createHUD(overlay: HTMLElement): HTMLElement {
  hudEl = document.createElement('div');
  hudEl.className = 'hud';
  hudEl.innerHTML = `
    <div class="hud-timer" id="hud-timer">0:00.000</div>
    <div class="hud-speed" id="hud-speed">0<span>MPH</span></div>
    <div class="hud-lap" id="hud-lap">LAP 1/3</div>
    <div class="hud-position" id="hud-position">1<sup>st</sup></div>
    <div class="hud-wrong-way" id="hud-wrong-way">WRONG WAY</div>
    <div class="hud-boost" id="hud-boost">BOOST</div>
    <div class="hud-nitro" id="hud-nitro">
      <div class="hud-nitro-label">NITRO</div>
      <div class="hud-nitro-track">
        <div class="hud-nitro-fill" id="hud-nitro-fill"></div>
      </div>
    </div>
    <canvas class="hud-minimap" id="hud-minimap" width="160" height="160"></canvas>
    <div class="hud-damage" id="hud-damage">
      <div class="dmg-zone dmg-front" id="dmg-front"></div>
      <div class="dmg-zone dmg-rear" id="dmg-rear"></div>
      <div class="dmg-zone dmg-left" id="dmg-left"></div>
      <div class="dmg-zone dmg-right" id="dmg-right"></div>
      <div class="dmg-body"></div>
    </div>
    <div class="hud-gap" id="hud-gap"></div>
  `;
  overlay.appendChild(hudEl);

  speedEl = hudEl.querySelector('#hud-speed')!;
  lapEl = hudEl.querySelector('#hud-lap')!;
  positionEl = hudEl.querySelector('#hud-position')!;
  wrongWayEl = hudEl.querySelector('#hud-wrong-way')!;
  timerEl = hudEl.querySelector('#hud-timer')!;
  boostEl = hudEl.querySelector('#hud-boost')!;
  gapEl = hudEl.querySelector('#hud-gap')!;
  nitroFillEl = hudEl.querySelector('#hud-nitro-fill')!;
  minimapCanvas = hudEl.querySelector('#hud-minimap') as HTMLCanvasElement;
  minimapCtx = minimapCanvas.getContext('2d')!;

  return hudEl;
}

export function updateHUD(
  speed: number,
  lapIndex: number,
  totalLaps: number,
  rank: number,
  totalRacers: number,
  wrongWay: boolean,
  elapsedMs: number,
  boostActive: boolean,
) {
  if (!hudEl) return;

  const mph = Math.floor(Math.abs(speed) * 2.5);
  speedEl.innerHTML = `${mph}<span>MPH</span>`;

  lapEl.textContent = `LAP ${Math.min(lapIndex + 1, totalLaps)}/${totalLaps}`;

  const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
  positionEl.innerHTML = `${rank}<sup>${suffix}</sup>`;

  wrongWayEl.style.display = wrongWay ? 'block' : 'none';

  timerEl.textContent = RaceEngine.formatTime(elapsedMs);

  boostEl.classList.toggle('boost-active', boostActive);
}

export function updateNitroHUD(nitro: number, isActive: boolean) {
  if (!nitroFillEl) return;
  const pct = Math.max(0, Math.min(100, nitro));
  nitroFillEl.style.width = `${pct}%`;
  // Color gradient: low=blue, mid=orange, full=red
  if (pct > 70) {
    nitroFillEl.style.background = 'linear-gradient(90deg, #ff6600, #ff2200)';
  } else if (pct > 30) {
    nitroFillEl.style.background = 'linear-gradient(90deg, #0088ff, #ff6600)';
  } else {
    nitroFillEl.style.background = 'linear-gradient(90deg, #0044aa, #0088ff)';
  }
  if (isActive) {
    nitroFillEl.style.boxShadow = '0 0 12px rgba(255, 100, 0, 0.8)';
  } else {
    nitroFillEl.style.boxShadow = 'none';
  }
}

// ── Lap completion overlay ──

let lapOverlayTimeout: number | null = null;

export function showLapOverlay(overlay: HTMLElement, lapNum: number, lapTimeMs: number, isBestLap: boolean) {
  // Remove any existing
  overlay.querySelector('.lap-overlay')?.remove();
  if (lapOverlayTimeout) clearTimeout(lapOverlayTimeout);

  const el = document.createElement('div');
  el.className = `lap-overlay${isBestLap ? ' best-lap' : ''}`;
  el.innerHTML = `
    <div class="lap-overlay-title">LAP ${lapNum} COMPLETE</div>
    <div class="lap-overlay-time">${RaceEngine.formatTime(lapTimeMs)}</div>
    ${isBestLap ? '<div class="lap-overlay-best">BEST LAP</div>' : ''}
  `;
  overlay.appendChild(el);

  lapOverlayTimeout = window.setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 500);
    lapOverlayTimeout = null;
  }, 2000);
}

// ── Minimap ──

export function updateMinimap(
  spline: THREE.CatmullRomCurve3,
  playerPos: THREE.Vector3,
  otherPositions: { pos: THREE.Vector3; color?: string }[],
) {
  if (!minimapCtx) return;

  if (cachedMinimapSpline !== spline) {
    cachedMinimapSpline = spline;
    cachedMinimapPoints = spline.getSpacedPoints(100);
    cachedMinX = Infinity; cachedMaxX = -Infinity;
    cachedMinZ = Infinity; cachedMaxZ = -Infinity;
    for (const p of cachedMinimapPoints) {
      cachedMinX = Math.min(cachedMinX, p.x);
      cachedMaxX = Math.max(cachedMaxX, p.x);
      cachedMinZ = Math.min(cachedMinZ, p.z);
      cachedMaxZ = Math.max(cachedMaxZ, p.z);
    }
  }

  const points = cachedMinimapPoints!;
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  minimapCtx.clearRect(0, 0, w, h);

  minimapCtx.fillStyle = 'rgba(10,10,15,0.7)';
  minimapCtx.fillRect(0, 0, w, h);

  const rangeX = cachedMaxX - cachedMinX || 1;
  const rangeZ = cachedMaxZ - cachedMinZ || 1;
  const margin = 12;
  const scaleX = (w - margin * 2) / rangeX;
  const scaleZ = (h - margin * 2) / rangeZ;
  const scale = Math.min(scaleX, scaleZ);
  const minX = cachedMinX;
  const minZ = cachedMinZ;

  const toMap = (p: THREE.Vector3) => ({
    x: margin + (p.x - minX) * scale,
    y: margin + (p.z - minZ) * scale,
  });

  minimapCtx.strokeStyle = '#555566';
  minimapCtx.lineWidth = 3;
  minimapCtx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const m = toMap(points[i]);
    if (i === 0) minimapCtx.moveTo(m.x, m.y);
    else minimapCtx.lineTo(m.x, m.y);
  }
  minimapCtx.closePath();
  minimapCtx.stroke();

  // Other racers with individual colors
  for (const other of otherPositions) {
    minimapCtx.fillStyle = other.color || '#ff6600';
    const m = toMap(other.pos);
    minimapCtx.beginPath();
    minimapCtx.arc(m.x, m.y, 3, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  // Player dot
  const pm = toMap(playerPos);
  minimapCtx.fillStyle = '#00e5ff';
  minimapCtx.beginPath();
  minimapCtx.arc(pm.x, pm.y, 4, 0, Math.PI * 2);
  minimapCtx.fill();
  minimapCtx.strokeStyle = '#00e5ff';
  minimapCtx.lineWidth = 1;
  minimapCtx.beginPath();
  minimapCtx.arc(pm.x, pm.y, 7, 0, Math.PI * 2);
  minimapCtx.stroke();
}

// ── Damage ──

function dmgColor(hp: number): string {
  if (hp > 70) return '#4caf50';
  if (hp > 40) return '#ffcc00';
  if (hp > 15) return '#ff6600';
  return '#ff1744';
}

export function updateDamageHUD(damage: DamageState) {
  const set = (id: string, hp: number) => {
    const el = document.getElementById(id);
    if (el) el.style.backgroundColor = dmgColor(hp);
  };
  set('dmg-front', damage.front.hp);
  set('dmg-rear', damage.rear.hp);
  set('dmg-left', damage.left.hp);
  set('dmg-right', damage.right.hp);
}

export function showHUD(visible: boolean) {
  if (hudEl) hudEl.style.display = visible ? 'block' : 'none';
}

export function updateGapHUD(ahead: number | null, behind: number | null) {
  if (!gapEl) return;
  let html = '';
  if (ahead !== null && ahead > 0) {
    html += `<div class="hud-gap-ahead">+${(ahead / 1000).toFixed(1)}s</div>`;
  }
  if (behind !== null && behind > 0) {
    html += `<div class="hud-gap-behind">-${(behind / 1000).toFixed(1)}s</div>`;
  }
  gapEl.innerHTML = html;
}

export function destroyHUD() {
  if (hudEl) hudEl.remove();
  if (lapOverlayTimeout) { clearTimeout(lapOverlayTimeout); lapOverlayTimeout = null; }
  cachedMinimapPoints = null;
  cachedMinimapSpline = null;
}
