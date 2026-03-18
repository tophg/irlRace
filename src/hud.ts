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
  setHeatPct,
  setIsEngineDead,
} from './HUDUI';
import type { DamageState } from './types';
import { RaceEngine } from './race-engine';

let hudContainer: HTMLElement | null = null;
let disposeSolid: (() => void) | null = null;
let hudWrapperEl: HTMLElement | null = null;


let _smoothMph = 0;

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

  // Smooth the speedometer (lerp toward actual speed for analog feel)
  const rawMph = Math.abs(speed) * 2.5;
  _smoothMph += (rawMph - _smoothMph) * 0.15;
  setSpeedMPH(Math.floor(_smoothMph));

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

export function updateHeatHUD(heat: number, isDead: boolean) {
  if (!disposeSolid) return;
  setHeatPct(heat);
  setIsEngineDead(isDead);
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

}
