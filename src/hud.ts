/* ── Hood Racer — HUD Proxy (Solid.js Adapter) ── */

import * as THREE from 'three';
import { render } from 'solid-js/web';
import {
  RacingHUD,
  setSpeedMPH,
  setLapInfo,
  setPositionInfo,
  setIsWrongWay,
  setTimerText,
  setIsBoostActive,
  setNitroPct,
  setIsNitroActive,
  setDamageState,
  setGapInfo,
  minimapCtx,
  minimapCanvasEl,
} from './HUDUI';
import type { DamageState } from './types';
import { RaceEngine } from './race-engine';

let hudContainer: HTMLElement | null = null;
let disposeSolid: (() => void) | null = null;
let hudWrapperEl: HTMLElement | null = null;

let cachedMinimapPoints: THREE.Vector3[] | null = null;
let cachedMinimapSpline: THREE.CatmullRomCurve3 | null = null;
let cachedMinX = 0, cachedMaxX = 0, cachedMinZ = 0, cachedMaxZ = 0;

export function createHUD(overlay: HTMLElement): HTMLElement {
  hudWrapperEl = document.createElement('div');
  hudWrapperEl.style.display = 'block'; // for showHUD support
  overlay.appendChild(hudWrapperEl);

  hudContainer = document.createElement('div');
  hudWrapperEl.appendChild(hudContainer);

  disposeSolid = render(() => RacingHUD(), hudContainer);

  return hudWrapperEl;
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
  if (!disposeSolid) return;

  const mph = Math.floor(Math.abs(speed) * 2.5);
  setSpeedMPH(mph);

  setLapInfo({ current: Math.min(lapIndex + 1, totalLaps), total: totalLaps });

  const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
  setPositionInfo({ rank, suffix });

  setIsWrongWay(wrongWay);

  setTimerText(RaceEngine.formatTime(elapsedMs));

  setIsBoostActive(boostActive);
}

export function updateNitroHUD(nitro: number, isActive: boolean) {
  if (!disposeSolid) return;
  setNitroPct(nitro);
  setIsNitroActive(isActive);
}

export function updateDamageHUD(damage: DamageState) {
  if (!disposeSolid) return;
  setDamageState({
    front: damage.front.hp,
    rear: damage.rear.hp,
    left: damage.left.hp,
    right: damage.right.hp,
  });
}

export function showHUD(visible: boolean) {
  if (hudWrapperEl) {
    hudWrapperEl.style.display = visible ? 'block' : 'none';
  }
}

export function updateGapHUD(ahead: number | null, behind: number | null) {
  if (!disposeSolid) return;

  let aheadH = '';
  let behindH = '';
  if (ahead !== null && ahead > 0) aheadH = `<div class="hud-gap-ahead">+${(ahead / 1000).toFixed(1)}s</div>`;
  if (behind !== null && behind > 0) behindH = `<div class="hud-gap-behind">-${(behind / 1000).toFixed(1)}s</div>`;

  setGapInfo({ ahead: aheadH, behind: behindH });
}

export function updateMinimap(
  spline: THREE.CatmullRomCurve3,
  playerPos: THREE.Vector3,
  otherPositions: { pos: THREE.Vector3; color?: string }[],
) {
  if (!minimapCtx || !minimapCanvasEl) return;

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
  const w = minimapCanvasEl.width;
  const h = minimapCanvasEl.height;
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

  for (const other of otherPositions) {
    minimapCtx.fillStyle = other.color || '#ff6600';
    const m = toMap(other.pos);
    minimapCtx.beginPath();
    minimapCtx.arc(m.x, m.y, 3, 0, Math.PI * 2);
    minimapCtx.fill();
  }

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

// ── Lap completion overlay ──

let lapOverlayTimeout: number | null = null;

export function showLapOverlay(overlay: HTMLElement, lapNum: number, lapTimeMs: number, isBestLap: boolean) {
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
export function destroyHUD() {
  if (disposeSolid) {
    disposeSolid();
    disposeSolid = null;
  }
  if (hudWrapperEl) {
    hudWrapperEl.remove();
    hudWrapperEl = null;
  }
  hudContainer = null;
  if (lapOverlayTimeout) { clearTimeout(lapOverlayTimeout); lapOverlayTimeout = null; }
  cachedMinimapPoints = null;
  cachedMinimapSpline = null;
}
