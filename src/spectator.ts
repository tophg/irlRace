/* ── Hood Racer — Spectator Mode ── */

import { G } from './game-context';
import { resolvePlayerName } from './results-screen';

const uiOverlay = () => document.getElementById('ui-overlay')!;

/** Enter spectator mode — follow the nearest unfinished racer. */
export function enterSpectatorMode() {
  if (!G.vehicleCamera || !G.raceEngine) return;

  const rankings = G.raceEngine.getRankings();
  const unfinished = rankings.filter(r => !r.finished && !r.dnf && r.id !== 'local');

  if (unfinished.length > 0) {
    G.spectateTargetId = unfinished[0].id;
    G.vehicleCamera.startFollow();
    showSpectateHUD();
  } else {
    G.spectateTargetId = null;
    if (G.playerVehicle) {
      G.vehicleCamera.startOrbit(G.playerVehicle.group.position);
    }
  }
}

/** Cycle the spectator target forward or backward through active racers. */
export function cycleSpectateTarget(direction: 1 | -1) {
  if (!G.raceEngine || !G.vehicleCamera) return;
  const rankings = G.raceEngine.getRankings();
  const targets = rankings.filter(r => !r.finished && !r.dnf && r.id !== 'local');
  if (targets.length === 0) {
    G.spectateTargetId = null;
    G.vehicleCamera.startOrbit(G.playerVehicle!.group.position);
    destroySpectateHUD();
    return;
  }

  const curIdx = targets.findIndex(r => r.id === G.spectateTargetId);
  let nextIdx = curIdx + direction;
  if (nextIdx < 0) nextIdx = targets.length - 1;
  if (nextIdx >= targets.length) nextIdx = 0;
  G.spectateTargetId = targets[nextIdx].id;
  G.vehicleCamera.startFollow();
  updateSpectateHUD();
}

function showSpectateHUD() {
  destroySpectateHUD();
  G.spectateHudEl = document.createElement('div');
  G.spectateHudEl.className = 'spectate-hud';
  uiOverlay().appendChild(G.spectateHudEl);

  G.spectateHudEl.querySelector('.arrow-left')?.addEventListener('click', () => cycleSpectateTarget(-1));
  G.spectateHudEl.querySelector('.arrow-right')?.addEventListener('click', () => cycleSpectateTarget(1));

  updateSpectateHUD();
}

function updateSpectateHUD() {
  if (!G.spectateHudEl || !G.spectateTargetId) return;
  const name = resolvePlayerName(G.spectateTargetId, G);
  G.spectateHudEl.innerHTML = `
    <span class="spectate-label">SPECTATING</span>
    <span class="arrow arrow-left" id="spec-left">◀</span>
    <span class="spectate-name">${name}</span>
    <span class="arrow arrow-right" id="spec-right">▶</span>
  `;
  G.spectateHudEl.querySelector('#spec-left')?.addEventListener('click', () => cycleSpectateTarget(-1));
  G.spectateHudEl.querySelector('#spec-right')?.addEventListener('click', () => cycleSpectateTarget(1));
}

/** Remove the spectator HUD overlay. */
export function destroySpectateHUD() {
  if (G.spectateHudEl) { G.spectateHudEl.remove(); G.spectateHudEl = null; }
}
