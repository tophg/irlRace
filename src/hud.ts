/* ── Hood Racer — HUD ── */

import * as THREE from 'three';
import type { DamageState } from './types';

let hudEl: HTMLElement;
let speedEl: HTMLElement;
let lapEl: HTMLElement;
let positionEl: HTMLElement;
let wrongWayEl: HTMLElement;
let minimapCanvas: HTMLCanvasElement;
let minimapCtx: CanvasRenderingContext2D;

// Cached minimap data (computed once per track)
let cachedMinimapPoints: THREE.Vector3[] | null = null;
let cachedMinimapSpline: THREE.CatmullRomCurve3 | null = null;
let cachedMinX = 0, cachedMaxX = 0, cachedMinZ = 0, cachedMaxZ = 0;

export function createHUD(overlay: HTMLElement): HTMLElement {
  hudEl = document.createElement('div');
  hudEl.className = 'hud';
  hudEl.innerHTML = `
    <div class="hud-speed" id="hud-speed">0<span>MPH</span></div>
    <div class="hud-lap" id="hud-lap">LAP 1/3</div>
    <div class="hud-position" id="hud-position">1<sup>st</sup></div>
    <div class="hud-wrong-way" id="hud-wrong-way">⚠ WRONG WAY</div>
    <canvas class="hud-minimap" id="hud-minimap" width="160" height="160"></canvas>
    <div class="hud-damage" id="hud-damage">
      <div class="dmg-zone dmg-front" id="dmg-front"></div>
      <div class="dmg-zone dmg-rear" id="dmg-rear"></div>
      <div class="dmg-zone dmg-left" id="dmg-left"></div>
      <div class="dmg-zone dmg-right" id="dmg-right"></div>
      <div class="dmg-body"></div>
    </div>
  `;
  overlay.appendChild(hudEl);

  speedEl = hudEl.querySelector('#hud-speed')!;
  lapEl = hudEl.querySelector('#hud-lap')!;
  positionEl = hudEl.querySelector('#hud-position')!;
  wrongWayEl = hudEl.querySelector('#hud-wrong-way')!;
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
) {
  if (!hudEl) return;

  const mph = Math.floor(Math.abs(speed) * 2.5); // convert to display MPH
  speedEl.innerHTML = `${mph}<span>MPH</span>`;

  lapEl.textContent = `LAP ${Math.min(lapIndex + 1, totalLaps)}/${totalLaps}`;

  const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
  positionEl.innerHTML = `${rank}<sup>${suffix}</sup>`;

  wrongWayEl.style.display = wrongWay ? 'block' : 'none';
}

export function updateMinimap(
  spline: THREE.CatmullRomCurve3,
  playerPos: THREE.Vector3,
  otherPositions: THREE.Vector3[],
) {
  if (!minimapCtx) return;

  // Cache spline points and bounds (recompute only when spline changes)
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

  // Background
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

  // Draw track line
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

  // Draw other racers
  minimapCtx.fillStyle = '#ff6600';
  for (const pos of otherPositions) {
    const m = toMap(pos);
    minimapCtx.beginPath();
    minimapCtx.arc(m.x, m.y, 3, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  // Draw player
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

export function destroyHUD() {
  if (hudEl) hudEl.remove();
  cachedMinimapPoints = null;
  cachedMinimapSpline = null;
}
