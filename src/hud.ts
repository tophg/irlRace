/* ── Hood Racer — HUD ── */

import { RaceEngine } from './race-engine';
import { getClosestSplinePoint } from './track';
import * as THREE from 'three';

let hudEl: HTMLElement;
let speedEl: HTMLElement;
let lapEl: HTMLElement;
let positionEl: HTMLElement;
let wrongWayEl: HTMLElement;
let minimapCanvas: HTMLCanvasElement;
let minimapCtx: CanvasRenderingContext2D;

export function createHUD(overlay: HTMLElement): HTMLElement {
  hudEl = document.createElement('div');
  hudEl.className = 'hud';
  hudEl.innerHTML = `
    <div class="hud-speed" id="hud-speed">0<span>MPH</span></div>
    <div class="hud-lap" id="hud-lap">LAP 1/3</div>
    <div class="hud-position" id="hud-position">1<sup>st</sup></div>
    <div class="hud-wrong-way" id="hud-wrong-way">⚠ WRONG WAY</div>
    <canvas class="hud-minimap" id="hud-minimap" width="160" height="160"></canvas>
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

  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  minimapCtx.clearRect(0, 0, w, h);

  // Background
  minimapCtx.fillStyle = 'rgba(10,10,15,0.7)';
  minimapCtx.fillRect(0, 0, w, h);

  // Find bounds from spline
  const points = spline.getSpacedPoints(100);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;
  const margin = 12;
  const scaleX = (w - margin * 2) / rangeX;
  const scaleZ = (h - margin * 2) / rangeZ;
  const scale = Math.min(scaleX, scaleZ);

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

export function showHUD(visible: boolean) {
  if (hudEl) hudEl.style.display = visible ? 'block' : 'none';
}

export function destroyHUD() {
  if (hudEl) hudEl.remove();
}
