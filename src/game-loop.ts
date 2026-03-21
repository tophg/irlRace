/* ── IRL Race — Game Loop (extracted from main.ts) ──
 *
 * Contains: gameLoop, flashDamage, showDraftingIndicator,
 * updateLeaderboard, destroyLeaderboard.
 *
 * Call initGameLoop(deps) once at boot, then startGameLoop() to begin rAF.
 */

import * as THREE from 'three/webgpu';
import { GameState } from './types';
import { G, PHYSICS_DT, MAX_FRAME_DT, LB_UPDATE_INTERVAL } from './game-context';
import { getInput } from './input';
import { getScene, getDirLight, updateSkyTime } from './scene';
import { getClosestSplinePoint, updateSceneryWind, updateCheckpointHighlight } from './track';
import { updateBuildingCulling } from './track-scenery';
import { resolvePlayerName } from './results-screen';
import { updateDebugOverlay } from './ui-screens';
import { rollbackManager, packInput } from './rollback-netcode';
import { updateGarage } from './garage';
import { bus } from './event-bus';

// VFX imports
import {
  spawnTireSmoke, updateVFX,
  updateSpeedLines,
  updateBoostFlame,
  updateNameTag,
  spawnDamageSmoke, updateSkidMarks, updateSkidGlowTime,
  spawnFlameParticle, spawnDamageZoneSmoke,
  updateRainDroplets,
  updateImpactFlash,
  updateUnderglow,
  triggerBoostShockwave, updateBoostShockwave,
  triggerBoostBurst, triggerBackfireSequence,
  updateHeatShimmer,
  updateLensFlares,
  updateLightning,
  triggerNearMiss, updateNearMissStreaks,
  triggerNearMissWhoosh, updateNearMissWhoosh,
  updateVictoryConfetti,
  spawnDebris,
} from './vfx';
import {
  updateGPUParticles,
  spawnGPUExplosion, spawnGPUFireballWave, spawnGPUEmberRain,
  spawnGPUSecondaryExplosion, spawnGPUDamageSmoke, spawnGPUFlame,
  spawnGPUGlassShards, spawnGPUShoulderDust,
  spawnGPUNitroTrail, spawnGPURimSparks, spawnGPUBackfire,
  spawnGPUSlipstream, flushToGPU,
} from './gpu-particles';
import { updateTrackRadar } from './minimap';
import { updateDestructionFragments, triggerVehicleDestruction, isDestructionActive } from './vehicle-destruction';
import { updateWeather, getCurrentWeather, getPrecipMesh, getWeatherPhysics } from './weather';
import { updatePostFX, setImpactIntensity, setBoostActive, setExplosionMode, updateAfterimage } from './post-fx';
import { showExplosionFlash, showDamageFlash, showLetterbox, hideLetterbox, showEngineDestroyedText } from './screen-effects';
import {
  updateEngineAudio, playDriftSFX,
  playNitroActivate, startNitroBurn, stopNitroBurn,
  updateNitroBurnIntensity, updateDepletionWarning, stopDepletionWarning,
  playNitroRelease, playRumbleStrip, playFinishFanfare, setMusicTimeScale, setSfxTimeScale,
  playWrongWayBeep,
} from './audio';
import {
  updateHUD, updateDamageHUD,
  updateGapHUD, updateNitroHUD, updateHeatHUD,
} from './hud';
import { sampleGhostFrame, updateGhostPlayback, finalizeGhostLap, startGhostRecording } from './ghost';

import { stepPhysics, initPhysicsStep } from './physics-step';
import { stopReplayPlayback as stopReplayUI } from './replay-ui';
import { updateTimeScale, applyTimeScale, getTimeScale, triggerSlowMo, resetTimeScale } from './time-scale';

// ── Dependency injection ──

export interface GameLoopDeps {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  uiOverlay: HTMLElement;
  callShowResults: () => void;
  startRace: () => void;
  showTitleScreen: () => void;
  clearRaceObjects: () => void;
}

let _deps: GameLoopDeps;

// ── Reusable temps (moved from main.ts) ──
const _rPos = new THREE.Vector3();
const _hoodExplosionPos = new THREE.Vector3();
const _nitroTrailOffset = new THREE.Vector3();
const _swayQuat = new THREE.Quaternion();
const _swayAxis = new THREE.Vector3(0, 0, 1); // roll axis (camera forward)
let _racingElapsed = 0;
let _perfectStartChecked = false;
let _drsLastWallTime = 0;

// Race generation counter — incremented on reset, checked by deferred callbacks
let _explosionRaceGen = 0;

// First-boost-per-race tracker
let _firstBoostFired = false;

// Speed lines overlay (nitro)
let _speedLinesEl: HTMLDivElement | null = null;
function _ensureSpeedLines(): HTMLDivElement {
  if (!_speedLinesEl) {
    _speedLinesEl = document.createElement('div');
    _speedLinesEl.className = 'speed-lines-overlay';
    document.body.appendChild(_speedLinesEl);
  }
  return _speedLinesEl;
}

// Wrong-way audio cooldown
let _wrongWayBeepTimer = 0;

// Explosion cinematic timer IDs (cleared on race restart to prevent stale callbacks)
let _explosionTimers: number[] = [];

// ── Damage flash overlay ──
let _damageFlashEl: HTMLDivElement | null = null;
let _damageFlashTimer = 0;

export function flashDamage(intensity: number) {
  if (!_damageFlashEl) {
    _damageFlashEl = document.createElement('div');
    _damageFlashEl.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      pointer-events:none; z-index:9999; opacity:0;
      transition: opacity 0.3s ease-out;
    `;
    document.body.appendChild(_damageFlashEl);
  }
  const alpha = Math.min(intensity, 0.7);
  _damageFlashEl.style.background = `radial-gradient(ellipse at center, transparent 40%, rgba(255,20,0,${alpha}) 100%)`;
  _damageFlashEl.style.opacity = '1';
  clearTimeout(_damageFlashTimer);
  _damageFlashTimer = window.setTimeout(() => {
    if (_damageFlashEl) _damageFlashEl.style.opacity = '0';
  }, 80);
}

// ── Drafting indicator ──
let _draftingEl: HTMLDivElement | null = null;
let _draftingTimer = 0;

function showDraftingIndicator() {
  if (!_draftingEl) {
    _draftingEl = document.createElement('div');
    _draftingEl.className = 'drafting-indicator';
    _draftingEl.textContent = 'DRAFTING';
    _deps.uiOverlay.appendChild(_draftingEl);
  }
  _draftingEl.style.opacity = '1';
  clearTimeout(_draftingTimer);
  _draftingTimer = window.setTimeout(() => {
    if (_draftingEl) _draftingEl.style.opacity = '0';
  }, 300);
}

/** Remove damage flash + drafting indicator DOM nodes between races. */
export function cleanupGameLoopDOM() {
  // Cancel any in-flight explosion timers (Bug #3 fix)
  for (const id of _explosionTimers) clearTimeout(id);
  _explosionTimers = [];
  clearTimeout(_damageFlashTimer);
  if (_damageFlashEl) { _damageFlashEl.remove(); _damageFlashEl = null; }
  clearTimeout(_draftingTimer);
  if (_draftingEl) { _draftingEl.remove(); _draftingEl = null; }
}

// ── Leaderboard ──

export function updateLeaderboard() {
  if (!G.raceEngine) return;
  const now = performance.now();
  if (now - G.lbLastUpdate < LB_UPDATE_INTERVAL) return;
  G.lbLastUpdate = now;

  if (!G.lbEl) {
    G.lbEl = document.createElement('div');
    G.lbEl.className = 'leaderboard';
    G.lbEl.id = 'leaderboard';
    _deps.uiOverlay.appendChild(G.lbEl);
  }

  const rankings = G.raceEngine.getRankings();
  const escHtml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  G.lbEl.innerHTML = rankings.map((r, i) => {
    const name = escHtml(r.id === 'local' ? 'YOU' : resolvePlayerName(r.id, G));
    const isSelf = r.id === 'local';
    let rttDot = '';
    if (G.netPeer && !isSelf && !r.id.startsWith('ai_')) {
      const peerRtt = G.netPeer.getPeerRtt(r.id);
      const dotClass = peerRtt < 80 ? 'ping-good' : peerRtt < 150 ? 'ping-mid' : 'ping-bad';
      rttDot = `<span class="ping-dot ${dotClass}" style="margin-left:4px;"></span>`;
    }
    return `
      <div class="lb-row${isSelf ? ' self' : ''}${r.dnf ? ' dnf' : ''}">
        <span class="lb-pos">${r.dnf ? '\u2014' : i + 1}</span>
        <span class="lb-name">${name}${rttDot}${r.dnf ? ' DNF' : ''}</span>
        <span class="lb-progress">${r.finished ? 'FIN' : `L${r.lapIndex + 1}`}</span>
      </div>
    `;
  }).join('');

  if (G.netPeer) {
    const rtt = G.netPeer.getRtt();
    const color = rtt < 80 ? '#4caf50' : rtt < 150 ? '#ffcc00' : '#ff4444';
    G.lbEl.innerHTML += `<div style="text-align:right;font-size:11px;color:${color};margin-top:4px;">${rtt}ms</div>`;
  }
}

export function destroyLeaderboard() {
  if (G.lbEl) { G.lbEl.remove(); G.lbEl = null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INIT + START
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Call once at boot to inject renderer/scene/camera references. */
export function initGameLoop(deps: GameLoopDeps) {
  _deps = deps;
  initPhysicsStep({ uiOverlay: deps.uiOverlay, flashDamage });
}

/** Reset per-race state in the game loop. */
export function resetGameLoopState() {
  _firstBoostFired = false;
  _wrongWayBeepTimer = 0; // Bug #7 fix
  _racingElapsed = 0;
  _perfectStartChecked = false;
  _explosionRaceGen++; // Bug #3 fix: invalidate any in-flight explosion callbacks
  _drsLastWallTime = 0; // Bug #10 fix: reset DRS wall-clock baseline
  G._nearMissCooldowns.clear(); // Bug #5 fix
  if (_speedLinesEl) { _speedLinesEl.remove(); _speedLinesEl = null; }
}

/** Start the rAF loop. Should be called once after initGameLoop(). */
export function startGameLoop() {
  requestAnimationFrame(gameLoop);
}

function stopReplay() {
  stopReplayUI();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXTRACTED SUBSYSTEMS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Render the rear-view mirror inset (scissored render pass). */
function updateRearMirror(renderer: THREE.WebGPURenderer, scene: THREE.Scene, frameDt: number) {
  if (!G.mirrorCamera || !G.playerVehicle || G.gameState !== GameState.RACING) return;
  if (G.mirrorBorder) G.mirrorBorder.style.display = 'block';
  const sinH = Math.sin(G.playerVehicle.heading);
  const cosH = Math.cos(G.playerVehicle.heading);
  const pp = G.playerVehicle.group.position;
  G.mirrorCamera.position.set(pp.x, pp.y + 2.5, pp.z);
  G.mirrorCamera.lookAt(pp.x - sinH * 20, pp.y + 1.5, pp.z - cosH * 20);

  G.mirrorCamera.updateMatrixWorld();
  G.mirrorCamera.updateProjectionMatrix();
  G.mirrorCamera.projectionMatrix.elements[0] *= -1;

  const precip = getPrecipMesh();
  if (precip) precip.visible = false;
  const godrays = scene.getObjectByName('godrays');
  if (godrays) godrays.visible = false;

  const w = 320, h = 120;
  const x = Math.floor(window.innerWidth / 2 - w / 2);
  const y = 14;

  renderer.setScissorTest(true);
  renderer.setScissor(x, y, w, h);
  renderer.setViewport(x, y, w, h);

  const oldAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.clearColor();
  renderer.clearDepth();
  renderer.render(scene, G.mirrorCamera);

  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.autoClear = oldAutoClear;

  if (precip) precip.visible = true;
  if (godrays) godrays.visible = true;
}

/** Dynamic Resolution Scaling — evaluate every 30 frames, schedule resize for next frame. */
function updateDRS(renderer: THREE.WebGPURenderer, _frameDt: number) {
  // Bug #10 fix: measure wall-clock time, not gameDt (which includes physics sub-steps)
  const now = performance.now();
  const wallDt = _drsLastWallTime > 0 ? (now - _drsLastWallTime) / 1000 : 0;
  _drsLastWallTime = now;
  if (wallDt <= 0 || wallDt > 0.5) return; // skip first frame / tab-out spikes
  G._drsFrameTimes[G._drsWriteIdx % 30] = wallDt;
  G._drsWriteIdx++;
  if (G._drsWriteIdx >= 30) {
    G._drsWriteIdx = 0;
    let sum = 0;
    for (let i = 0; i < 30; i++) sum += G._drsFrameTimes[i];
    const avgDt = sum / 30;
    if (!isFinite(avgDt) || avgDt <= 0) return;
    const avgFps = 1 / avgDt;
    const currentPR = renderer.getPixelRatio();
    const basePR = Math.min(window.devicePixelRatio, 2);
    let newPR = currentPR;
    if (avgFps < 45 && currentPR > 0.5) {
      newPR = Math.max(currentPR - 0.15, 0.5);
    } else if (avgFps > 56 && currentPR < basePR) {
      newPR = Math.min(currentPR + 0.05, basePR);
    }
    if (newPR !== currentPR) _drsPendingPR = newPR;
  }
}

/** Update damage smoke, flames, detached parts physics. */
function updateDamageAndParts(scene: THREE.Scene, frameDt: number) {
  if (G.gameState !== GameState.RACING || !G.playerVehicle) return;

  const dmg = G.playerVehicle.damage;
  const worstHp = Math.min(dmg.front.hp, dmg.rear.hp, dmg.left.hp, dmg.right.hp);
  if (worstHp < 50) spawnDamageSmoke(G.playerVehicle.group.position, 1 - worstHp / 50, frameDt);

  const sinH = Math.sin(G.playerVehicle.heading);
  const cosH = Math.cos(G.playerVehicle.heading);
  const pp = G.playerVehicle.group.position;
  const zoneOffsets: [string, number, number, number][] = [
    ['front', 0, 1.0, -2.0],
    ['rear', 0, 0.8, 1.8],
    ['left', -1.0, 0.7, 0],
    ['right', 1.0, 0.7, 0],
  ];
  for (const [zone, lx, ly, lz] of zoneOffsets) {
    const hp = dmg[zone as keyof typeof dmg].hp;
    if (hp < 20) {
      G._flamePos.set(
        pp.x + cosH * lx + sinH * lz,
        pp.y + ly,
        pp.z - sinH * lx + cosH * lz,
      );
      spawnFlameParticle(G._flamePos, 1 - hp / 20, frameDt);
    }
  }

  // Detached parts
  for (const zone of ['front', 'rear', 'left', 'right'] as const) {
    if (G.playerVehicle.detachedZones.has(zone) && !G.detachedParts.some(dp => dp.zone === zone && dp.owner === 'local')) {
      const partMesh = G.playerVehicle.createDetachedPart(zone);
      if (partMesh) {
        scene.add(partMesh);
        G.detachedParts.push({
          mesh: partMesh,
          vx: G.playerVehicle.velX + (Math.random() - 0.5) * 8,
          vy: 3 + Math.random() * 5,
          vz: G.playerVehicle.velZ + (Math.random() - 0.5) * 8,
          ax: (Math.random() - 0.5) * 10,
          ay: (Math.random() - 0.5) * 10,
          az: (Math.random() - 0.5) * 10,
          life: 4.0,
          zone,
          owner: 'local',
        });
        spawnGPUExplosion(partMesh.position, 30);
      }
    }
  }
}

/** Physics for flying detached body panels. */
function updateDetachedPartsPhysics(scene: THREE.Scene, frameDt: number) {
  for (let i = G.detachedParts.length - 1; i >= 0; i--) {
    const dp = G.detachedParts[i];
    dp.life -= frameDt;
    if (dp.life <= 0 || dp.mesh.position.y < -10) {
      scene.remove(dp.mesh);
      dp.mesh.geometry?.dispose();
      (dp.mesh.material as THREE.Material)?.dispose();
      G.detachedParts[i] = G.detachedParts[G.detachedParts.length - 1];
      G.detachedParts.pop();
      continue;
    }
    dp.mesh.position.x += dp.vx * frameDt;
    dp.mesh.position.y += dp.vy * frameDt;
    dp.mesh.position.z += dp.vz * frameDt;
    dp.vy -= 15 * frameDt;
    dp.mesh.rotation.x += dp.ax * frameDt;
    dp.mesh.rotation.y += dp.ay * frameDt;
    dp.mesh.rotation.z += dp.az * frameDt;

    if (dp.mesh.position.y < 0.1) {
      dp.mesh.position.y = 0.1;
      dp.vy = Math.abs(dp.vy) * 0.3;
      dp.vx *= 0.6; dp.vz *= 0.6;
      dp.ax *= 0.4; dp.ay *= 0.4; dp.az *= 0.4;
    }

    if (dp.life < 1.5) {
      const mat = dp.mesh.material as THREE.MeshStandardMaterial;
      if (mat.transparent !== undefined) {
        mat.transparent = true;
        mat.opacity = dp.life / 1.5;
      }
    }
  }
}

/** Weather VFX: rain droplets, wet tire spray (player + AI), wind camera sway. */
function updateWeatherEffects(
  renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera,
  gameDt: number, frameDt: number, s: GameState,
) {
  if (!G.playerVehicle) return;
  updateWeather(gameDt, G.playerVehicle.group.position);

  const weatherType = getCurrentWeather();
  const rainIntensity = weatherType === 'heavy_rain' ? 0.5 : weatherType === 'light_rain' ? 0.25 : 0;
  updateRainDroplets(rainIntensity, frameDt);

  // Wet tire spray (NFS-style rooster tail)
  const wp = getWeatherPhysics();
  if (wp.sprayDensity > 0 && G.playerVehicle.speed > 30) {
    const sprayChance = wp.sprayDensity * Math.min(G.playerVehicle.speed / 120, 1) * 0.5;
    if (Math.random() < sprayChance) {
      const cosH = Math.cos(G.playerVehicle.heading);
      const sinH = Math.sin(G.playerVehicle.heading);
      const pp = G.playerVehicle.group.position;
      _rPos.set(pp.x - sinH * 2 - cosH * 0.6, pp.y + 0.1, pp.z - cosH * 2 + sinH * 0.6);
      spawnGPUShoulderDust(_rPos, G.playerVehicle.speed * 0.3, G.playerVehicle.heading);
      _rPos.set(pp.x - sinH * 2 + cosH * 0.6, pp.y + 0.1, pp.z - cosH * 2 - sinH * 0.6);
      spawnGPUShoulderDust(_rPos, G.playerVehicle.speed * 0.3, G.playerVehicle.heading);
    }
  }

  // Wind camera sway (heavy rain / blizzard)
  // Applied via quaternion multiply to compose with VehicleCamera's lookAt + drift tilt
  if ((weatherType === 'heavy_rain' || weatherType === 'blizzard') && s === GameState.RACING) {
    const swayAmp = weatherType === 'blizzard' ? 0.005 : 0.003;
    const swayFreq = weatherType === 'blizzard' ? 1.5 : 2.0;
    const t = performance.now() * 0.001;
    const swayAngle = Math.sin(t * swayFreq * Math.PI * 2) * swayAmp;
    _swayQuat.setFromAxisAngle(_swayAxis, swayAngle);
    camera.quaternion.multiply(_swayQuat);
  }

  // AI tire spray in rain
  if (wp.sprayDensity > 0) {
    for (const ai of G.aiRacers) {
      if (ai.vehicle.speed > 25 && Math.random() < wp.sprayDensity * 0.3) {
        const aP = ai.vehicle.group.position;
        const cosA = Math.cos(ai.vehicle.heading);
        const sinA = Math.sin(ai.vehicle.heading);
        _rPos.set(aP.x - sinA * 2, aP.y + 0.1, aP.z - cosA * 2);
        spawnGPUShoulderDust(_rPos, ai.vehicle.speed * 0.2, ai.vehicle.heading);
      }
    }
  }
}

/** Near-miss detection against AI vehicles. Triggers VFX, slow-mo, nitro reward. */
function updateNearMissDetection(
  camera: THREE.PerspectiveCamera, timestamp: number, frameDt: number, s: GameState,
) {
  if (!G.playerVehicle) return;
  if (s === GameState.RACING && Math.abs(G.playerVehicle.speed) > 15) {
    const pPos = G.playerVehicle.group.position;
    const now = timestamp / 1000;
    for (const ai of G.aiRacers) {
      const aPos = ai.vehicle.group.position;
      const dx = pPos.x - aPos.x;
      const dz = pPos.z - aPos.z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 < 3.5 * 3.5 && dist2 > 1.5 * 1.5) {
        const lastMiss = G._nearMissCooldowns.get(ai.id) ?? 0;
        if (now - lastMiss > 1.0) {
          G._nearMissCooldowns.set(ai.id, now);
          const cosH = Math.cos(G.playerVehicle.heading);
          const sinH = Math.sin(G.playerVehicle.heading);
          const cross = dx * cosH - dz * sinH;
          triggerNearMiss(cross > 0 ? 'right' : 'left');
          triggerNearMissWhoosh(cross > 0 ? 'right' : 'left', camera.position, G.playerVehicle.heading);
          G.playerVehicle.addNitro(5);
          G.raceStats.nearMissCount++;
        }
      }
    }
  }
  updateNearMissStreaks(frameDt);
  updateNearMissWhoosh(frameDt, camera.position, G.playerVehicle.heading);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN GAME LOOP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _drsPendingPR = 0; // >0 means a DRS resize is pending

function gameLoop(timestamp: number) {
  requestAnimationFrame(gameLoop);

  const { renderer, scene, camera, uiOverlay } = _deps;

  // Apply pending DRS resize BEFORE any rendering to prevent
  // framebuffer invalidation mid-render (which causes black frames on WebGPU).
  if (_drsPendingPR > 0) {
    renderer.setPixelRatio(_drsPendingPR);
    renderer.setSize(window.innerWidth, window.innerHeight);
    _drsPendingPR = 0;
  }

  const frameDt = Math.min((timestamp - G.lastTime) / 1000, MAX_FRAME_DT);
  G.lastTime = timestamp;

  // ── Time-scale: slow-motion system ──
  updateTimeScale(frameDt);
  const gameDt = applyTimeScale(frameDt);

  // Animate sky + tree wind sway
  updateSkyTime(timestamp);
  if (G.trackData) updateSceneryWind(G.trackData.sceneryGroup, timestamp);
  updateBuildingCulling(camera.position);

  const s = G.gameState;

  // ── Garage render ──
  if (s === GameState.GARAGE) {
    updateGarage();
    return;
  }

  // ── Title / Lobby ──
  if (s === GameState.TITLE) {
    // Title screen has its own render loop (titleLoop in main.ts) — don't overwrite it
    return;
  }
  if (s === GameState.LOBBY) {
    renderer.render(scene, camera);
    return;
  }

  // ── Replay playback ──
  if (G.replayPlayer) {
    if (G.replayPlayer.isPlaying()) {
      G.replayPlayer.update(frameDt);
      updateDestructionFragments(frameDt);
      flushToGPU();
      updateGPUParticles(renderer, gameDt);
      updateVFX(gameDt);
      updatePostFX(0, false, gameDt);
      const replayHud = document.getElementById('replay-hud') as (HTMLElement & { _updateHUD?: () => void }) | null;
      if (replayHud?._updateHUD) replayHud._updateHUD();
      renderer.render(scene, camera);
      return;
    } else {
      stopReplay();
    }
  }

  // ── Paused ──
  if (s === GameState.PAUSED) {
    renderer.render(scene, camera);
    return;
  }

  if (s === GameState.FLYOVER || s === GameState.COUNTDOWN || s === GameState.RACING || s === GameState.RESULTS) {
    if (!G.playerVehicle || !G.trackData) {
      renderer.render(scene, camera);
      return;
    }

    // ── Flyover camera ──
    if (s === GameState.FLYOVER && G.vehicleCamera) {
      G.vehicleCamera.updateFlyover(frameDt);
    }

    // ── FIXED-TIMESTEP PHYSICS ──
    G.physicsAccumulator += gameDt;

    let physicsStepsThisFrame = 0;
    while (G.physicsAccumulator >= PHYSICS_DT && physicsStepsThisFrame < 4) {
      if (G.playerVehicle) G.playerVehicle.saveSnapshot();
      for (const ai of G.aiRacers) ai.vehicle.saveSnapshot();

      const currentInput = s === GameState.RACING ? getInput() : { up: false, down: false, left: false, right: false, boost: false, steerAnalog: 0 };

      // Perfect start detection: gas pressed in first physics frame of racing
      if (s === GameState.RACING && !_perfectStartChecked) {
        _perfectStartChecked = true;
        if (currentInput.up) G.raceStats.perfectStart = true;
      }

      if (G.playerVehicle) {
        rollbackManager.recordLocalFrame(currentInput, G.playerVehicle.serializeState());
      }

      if (G.netPeer && s === GameState.RACING) {
        const packed = packInput(currentInput);
        G.netPeer.broadcastInput(rollbackManager.frame, packed.bits, packed.steerI16);
      }

      stepPhysics(PHYSICS_DT, s);
      rollbackManager.advanceFrame();
      G.physicsAccumulator -= PHYSICS_DT;
      physicsStepsThisFrame++;
    }

    if (G.physicsAccumulator > PHYSICS_DT) G.physicsAccumulator = PHYSICS_DT;

    // Interpolate
    const alpha = G.physicsAccumulator / PHYSICS_DT;
    G.playerVehicle.lerpToRender(alpha);
    for (const ai of G.aiRacers) ai.vehicle.lerpToRender(alpha);

    // AI name tags
    for (const ai of G.aiRacers) {
      const tag = ai.nameTag;
      if (tag) updateNameTag(tag, ai.vehicle.group.position);
    }

    // ── RENDERING-RATE CODE ──

    // Slipstream detection
    if (s === GameState.RACING && G.vehicleCamera?.mode === 'chase') {
      const pp = G.playerVehicle.group.position;
      const pH = G.playerVehicle.heading;
      for (const ai of G.aiRacers) {
        const aPos = ai.vehicle.group.position;
        const dx = aPos.x - pp.x;
        const dz = aPos.z - pp.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 15 && dist > 2) {
          const toAiAngle = Math.atan2(dx, dz);
          let angleDiff = Math.abs(toAiAngle - pH);
          if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
          if (angleDiff < 0.52) {
            const draftStrength = (1 - dist / 15) * 20;
            G.playerVehicle.addNitro(draftStrength * gameDt);
            spawnGPUSlipstream(aPos, ai.vehicle.heading, G.playerVehicle.speed);
            showDraftingIndicator();
          }
        }
      }
    }

    updateNitroHUD(G.playerVehicle.nitro, G.playerVehicle.isNitroActive);
    updateHeatHUD(G.playerVehicle.engineHeat, G.playerVehicle.engineDead);

    // Record replay frames
    if (G.replayRecorder) {
      const pv = G.playerVehicle;
      G.replayRecorder.record('local', pv.group.position, pv.heading, pv.speed,
        pv.steer, pv.currentWheelSpin, pv.driftAngle, pv.bodyPitchX, pv.bodyRollZ,
        pv.isNitroActive, pv.engineHeat, pv.engineDead, pv.engineJustExploded);
      for (const ai of G.aiRacers) {
        const v = ai.vehicle;
        G.replayRecorder.record(ai.id, v.group.position, v.heading, v.speed,
          v.steer, v.currentWheelSpin, v.driftAngle, v.bodyPitchX, v.bodyRollZ,
          v.isNitroActive, v.engineHeat, v.engineDead, v.engineJustExploded);
      }
    }

    // ── Engine overheat explosion VFX ──
    if (G.playerVehicle.engineJustExploded) {
      const gen = _explosionRaceGen; // Bug #3 fix: capture generation for staleness checks
      const sinH = Math.sin(G.playerVehicle.heading);
      const cosH = Math.cos(G.playerVehicle.heading);
      _hoodExplosionPos.copy(G.playerVehicle.group.position);
      _hoodExplosionPos.y += 1.0;
      _hoodExplosionPos.x += sinH * 2.2;
      _hoodExplosionPos.z += cosH * 2.2;

      spawnGPUExplosion(_hoodExplosionPos, 40);
      flashDamage(0.9);
      setImpactIntensity(1.5);

      const pvx = G.playerVehicle.velX, pvz = G.playerVehicle.velZ;
      const isRacing = G.raceEngine && s === GameState.RACING;
      const bodyRef = G.playerVehicle.bodyGroupRef;
      const vGroup = G.playerVehicle.group;
      const wheelRefs = G.playerVehicle.wheelRefs;
      const cachedFrags = G.playerVehicle.cachedFragments;
      const expPos = _hoodExplosionPos.clone();

      // ── Phase 2 (frame +1): Fireball wave + vehicle destruction ──
      requestAnimationFrame(() => {
        if (gen !== _explosionRaceGen) return; // Bug #3: stale — race restarted
        spawnGPUFireballWave(expPos);
        if (isRacing) {
          triggerVehicleDestruction(bodyRef, vGroup, getScene(), pvx, pvz, wheelRefs, cachedFrags);
          if (G.playerVehicle) G.playerVehicle.destroyed = true;
        }

        // ── Phase 3 (frame +2): Cinematic + ember rain + glass ──
        requestAnimationFrame(() => {
          if (gen !== _explosionRaceGen) return; // Bug #3: stale — race restarted
          spawnGPUEmberRain(expPos);
          spawnGPUGlassShards(expPos);
          if (isRacing) {
            showExplosionFlash();
            showLetterbox();
            setExplosionMode(true);
            if (G.vehicleCamera) {
              G.vehicleCamera.startExplosionOrbit(expPos);
            }
            _explosionTimers.push(window.setTimeout(() => {
              if (gen !== _explosionRaceGen) return; // stale — race restarted
              showEngineDestroyedText();
            }, 800));
            _explosionTimers.push(window.setTimeout(() => {
              if (gen !== _explosionRaceGen) return;
              hideLetterbox(); setExplosionMode(false);
            }, 3500));
            _explosionTimers.push(window.setTimeout(() => {
              if (gen !== _explosionRaceGen) return;
              _deps.callShowResults();
            }, 4000));
          }

          // ── Phase 4 (frame +3): Ground debris ──
          requestAnimationFrame(() => {
            if (gen !== _explosionRaceGen) return; // Bug #3: stale — race restarted
            spawnDebris(expPos, 35, pvx, pvz);
          });
        });
      });

      // ── Delayed secondary explosions (fuel line / electrical fires) ──
      _explosionTimers.push(window.setTimeout(() => spawnGPUSecondaryExplosion(expPos), 300));
      _explosionTimers.push(window.setTimeout(() => spawnGPUSecondaryExplosion(expPos), 800));

      if (isRacing) {
        G.raceEngine!.markDnf('local');
      }
    }

    // NOTE: clearExplosionFlag() is called AFTER the camera shake block below
    // (line ~601) so that engineJustExploded is still true for the shake boost.

    // ── Landing VFX ──
    if (G.playerVehicle.justLanded) {
      const impact = G.playerVehicle.landingImpact;
      if (impact > 0.2) {
        spawnGPUShoulderDust(
          G.playerVehicle.group.position,
          G.playerVehicle.speed * 0.5 + impact * 20,
          G.playerVehicle.heading,
        );
      }
      if (impact > 0.3) {
        setImpactIntensity(impact * 0.6);
        if (impact > 0.5) showDamageFlash();
      }
      G.playerVehicle.clearLandingFlag();
    }

    // ── Hood smoke/flames at high engine heat ──
    // Skip if destruction is active (destruction system handles its own fire)
    const heat = G.playerVehicle.engineHeat;
    if (heat > 60 && !isDestructionActive()) {
      const sinH = Math.sin(G.playerVehicle.heading);
      const cosH = Math.cos(G.playerVehicle.heading);
      _hoodExplosionPos.copy(G.playerVehicle.group.position);
      _hoodExplosionPos.y += 1.0;
      _hoodExplosionPos.x += sinH * 2.2;
      _hoodExplosionPos.z += cosH * 2.2;
      const smokeIntensity = (heat - 60) / 40;
      if (heat > 90) {
        spawnGPUFlame(_hoodExplosionPos, smokeIntensity, frameDt);
      }
      spawnGPUDamageSmoke(_hoodExplosionPos, smokeIntensity * 0.8, frameDt);
    }

    // AI race progress
    if (s === GameState.RACING) {
      for (const ai of G.aiRacers) {
        G.raceEngine?.updateRacer(ai.id, ai.vehicle.group.position, ai.getCurrentT(), ai.vehicle.heading);
      }
    }

    // Spectator orbit camera
    if (s === GameState.RESULTS && G.vehicleCamera?.mode === 'orbit') {
      G.vehicleCamera.updateOrbit(frameDt);
    }

    // Explosion orbit cinematic
    if (G.vehicleCamera?.mode === 'explosion-orbit') {
      G.vehicleCamera.updateExplosionOrbit(frameDt);
    }

    updateDestructionFragments(frameDt);

    // Camera
    if (G.vehicleCamera && G.vehicleCamera.mode !== 'orbit' && G.vehicleCamera.mode !== 'explosion-orbit') {
      let camTarget = G.playerVehicle.group.position;
      let camHeading = G.playerVehicle.heading;
      let camSpeed = G.playerVehicle.speed;
      let camMaxSpeed = G.selectedCar.maxSpeed;

      if (G.vehicleCamera.mode === 'follow' && G.spectateTargetId) {
        const targetMesh = G.remoteMeshes.get(G.spectateTargetId);
        const aiTarget = G.aiRacers.find(a => a.id === G.spectateTargetId);
        if (targetMesh) {
          camTarget = targetMesh.position;
          camHeading = targetMesh.rotation.y;
          const snap = G.netPeer?.getInterpolatedState(G.spectateTargetId);
          camSpeed = snap?.speed ?? 30;
          camMaxSpeed = 70;
        } else if (aiTarget) {
          camTarget = aiTarget.vehicle.group.position;
          camHeading = aiTarget.vehicle.heading;
          camSpeed = aiTarget.vehicle.speed;
          camMaxSpeed = aiTarget.vehicle.def.maxSpeed;
        }
      }

      G.vehicleCamera.update(camTarget, camHeading, camSpeed, camMaxSpeed, G.playerVehicle.driftAngle, gameDt);
    }

    // VFX
    const driftAbs = Math.abs(G.playerVehicle.driftAngle);
    if (driftAbs > 0.15 && s === GameState.RACING) {
      spawnTireSmoke(G.playerVehicle.group.position, driftAbs, G.playerVehicle.isNitroActive);
    }
    if (s === GameState.RACING) {
      updateSkidGlowTime();
      updateSkidMarks(G.playerVehicle.group.position, G.playerVehicle.heading, driftAbs, G.playerVehicle.group.position.y);
      sampleGhostFrame(G.playerVehicle.group.position, G.playerVehicle.heading);
      updateGhostPlayback();
    }
    updateVFX(gameDt);

    // Per-frame damage zone smoke
    if (s === GameState.RACING && G.playerVehicle) {
      const pp = G.playerVehicle.group.position;
      const sinH = Math.sin(G.playerVehicle.heading);
      const cosH = Math.cos(G.playerVehicle.heading);
      const zones: Array<{ zone: 'front' | 'rear' | 'left' | 'right'; ox: number; oz: number }> = [
        { zone: 'front', ox: 0, oz: -2.2 },
        { zone: 'rear', ox: 0, oz: 2.0 },
        { zone: 'left', ox: -1.0, oz: 0 },
        { zone: 'right', ox: 1.0, oz: 0 },
      ];
      for (const z of zones) {
        const dmg = G.playerVehicle.damage[z.zone];
        const severity = 1 - dmg.hp / 100;
        if (severity > 0.7) {
          G._sparkPos.set(
            pp.x + cosH * z.ox + sinH * z.oz,
            pp.y + 0.6,
            pp.z - sinH * z.ox + cosH * z.oz,
          );
          spawnDamageZoneSmoke(G._sparkPos, severity, frameDt);
        }
      }

      // Tire blowout
      const leftHP = G.playerVehicle.damage.left.hp;
      const rightHP = G.playerVehicle.damage.right.hp;

      if (leftHP <= 0 && !G._leftTireBlown) {
        G._leftTireBlown = true;
        G._sparkPos.set(pp.x + cosH * (-1.0), pp.y + 0.2, pp.z - sinH * (-1.0));
        spawnGPUExplosion(G._sparkPos, 25);
      }
      if (rightHP <= 0 && !G._rightTireBlown) {
        G._rightTireBlown = true;
        G._sparkPos.set(pp.x + cosH * 1.0, pp.y + 0.2, pp.z - sinH * 1.0);
        spawnGPUExplosion(G._sparkPos, 25);
      }
    }
    flushToGPU();
    updateGPUParticles(renderer, gameDt);
    updateWeatherEffects(renderer, camera, gameDt, frameDt, s);

    updateImpactFlash(frameDt);

    // Underglow
    if (G._playerUnderglow) {
      updateUnderglow(G._playerUnderglow, G.playerVehicle.speed, timestamp / 1000, G.playerVehicle.isNitroActive);
    }
    updateBoostFlame(s === GameState.RACING && G.playerVehicle.isNitroActive, G.playerVehicle.group.position, G.playerVehicle.heading, timestamp / 1000, G.playerVehicle.engineHeat, gameDt);

    // Nitro activation
    const isNitroNow = s === GameState.RACING && G.playerVehicle.isNitroActive;
    if (isNitroNow && !G._wasNitroActive) {
      triggerBoostShockwave(G.playerVehicle.group.position, G.playerVehicle.heading);
      triggerBoostBurst();
      playNitroActivate();
      startNitroBurn();
      _ensureSpeedLines()?.classList.add('active');
    }
    if (isNitroNow) {
      updateNitroBurnIntensity(G.playerVehicle.nitro);
      updateDepletionWarning(G.playerVehicle.nitro);
    }
    if (!isNitroNow && G._wasNitroActive) {
      triggerBackfireSequence(G.playerVehicle.group.position, G.playerVehicle.heading);
      stopNitroBurn();
      stopDepletionWarning();
      playNitroRelease();
      _ensureSpeedLines()?.classList.remove('active');
    }
    G._wasNitroActive = isNitroNow;
    updateBoostShockwave(frameDt);

    // Nitro FOV punch — additive on top of VehicleCamera's speed-based FOV.
    // VehicleCamera sets FOV in range [FOV_MIN..FOV_MAX] based on speed.
    // We just bump it a bit more during nitro for the rush effect.
    if (isNitroNow) {
      camera.fov = Math.min(camera.fov + 5, 83);
      camera.updateProjectionMatrix();
    }

    // Camera shake
    if (isNitroNow) {
      const t = timestamp / 1000;
      camera.position.x += Math.sin(t * 47) * 0.012 + Math.sin(t * 73) * 0.008;
      camera.position.y += Math.sin(t * 53) * 0.006;
    }
    if (G.playerVehicle.engineDead) {
      const shakeDecay = G.playerVehicle.engineJustExploded ? 0.15 : 0.03;
      const t = timestamp / 1000;
      camera.position.x += Math.sin(t * 90) * shakeDecay;
      camera.position.y += Math.sin(t * 110) * shakeDecay * 0.7;
    }
    // Clear explosion flag AFTER shake read (BUG-3 fix)
    if (G.playerVehicle.engineJustExploded) {
      G.playerVehicle.clearExplosionFlag();
    }

    // Nitro exhaust trail
    if (s === GameState.RACING && G.playerVehicle.isNitroActive) {
      spawnGPUNitroTrail(G.playerVehicle.group.position, G.playerVehicle.heading, G.playerVehicle.speed);
      const cosH2 = Math.cos(G.playerVehicle.heading);
      _nitroTrailOffset.copy(G.playerVehicle.group.position);
      _nitroTrailOffset.x += cosH2 * 0.15;
      spawnGPUNitroTrail(_nitroTrailOffset, G.playerVehicle.heading, G.playerVehicle.speed);
    }

    // Rim sparks on blown tires
    if (G._leftTireBlown && Math.abs(G.playerVehicle.speed) > 3) {
      const cosH = Math.cos(G.playerVehicle.heading);
      const sinH = Math.sin(G.playerVehicle.heading);
      const pos = G.playerVehicle.group.position;
      G._sparkPos.set(pos.x + cosH * (-1.0), pos.y + 0.1, pos.z - sinH * (-1.0));
      spawnGPURimSparks(G._sparkPos, G.playerVehicle.speed);
    }
    if (G._rightTireBlown && Math.abs(G.playerVehicle.speed) > 3) {
      const cosH = Math.cos(G.playerVehicle.heading);
      const sinH = Math.sin(G.playerVehicle.heading);
      const pos = G.playerVehicle.group.position;
      G._sparkPos.set(pos.x + cosH * 1.0, pos.y + 0.1, pos.z - sinH * 1.0);
      spawnGPURimSparks(G._sparkPos, G.playerVehicle.speed);
    }

    // Exhaust backfire
    const currentSpeedRatio = Math.abs(G.playerVehicle.speed) / G.selectedCar.maxSpeed;
    if (G._prevSpeedRatio - currentSpeedRatio > 0.15 && Math.abs(G.playerVehicle.speed) > 15) {
      spawnGPUBackfire(G.playerVehicle.group.position, G.playerVehicle.heading);
    }
    G._prevSpeedRatio = currentSpeedRatio;

    // Shoulder dust
    if (G.playerVehicle.lastBarrierImpact && Math.abs(G.playerVehicle.speed) > 8) {
      spawnGPUShoulderDust(G.playerVehicle.group.position, G.playerVehicle.speed, G.playerVehicle.heading);
    }

    // Heat shimmer
    const speedR = Math.abs(G.playerVehicle.speed) / G.selectedCar.maxSpeed;
    updateHeatShimmer(speedR, isNitroNow, G.playerVehicle.engineHeat);

    // Minimap
    if (G.playerVehicle) {
      const aiDots = G.aiRacers.map(a => ({ pos: a.vehicle.group.position, id: a.id }));
      updateTrackRadar(G.playerVehicle.group.position, G.playerVehicle.heading, aiDots);

      if (G.checkpointMarkers) {
        const localProgress = G.raceEngine?.getProgress('local');
        const nextCp = localProgress ? localProgress.checkpointIndex : 0;
        updateCheckpointHighlight(G.checkpointMarkers, nextCp, timestamp / 1000);
      }
    }

    updateLensFlares(camera.position, timestamp / 1000);
    updateLightning(frameDt);

    updateNearMissDetection(camera, timestamp, frameDt, s);

    updateVictoryConfetti(frameDt);

    const speedRatioForLines = Math.abs(G.playerVehicle.speed) / G.selectedCar.maxSpeed;
    const nitroForLines = G.playerVehicle.isNitroActive;
    if (speedRatioForLines > 0.3 || nitroForLines) updateSpeedLines(speedRatioForLines, nitroForLines);

    // Race stats
    if (s === GameState.RACING) {
      const speedMph = Math.abs(G.playerVehicle.speed) * 2.5;
      if (speedMph > G.raceStats.topSpeed) G.raceStats.topSpeed = speedMph;
      if (speedMph > 180) G.raceStats.speedDemonTime += gameDt;
      if (driftAbs > 0.15) G.raceStats.totalDriftTime += gameDt;
    }

    // Audio
    // Audio — pitch-shift during slow-mo for cinematic feel
    const ts = getTimeScale();
    updateEngineAudio(
      G.playerVehicle.speed, G.selectedCar.maxSpeed, ts,
      G.playerVehicle.isNitroActive, G.playerVehicle.throttle,
    );
    setMusicTimeScale(ts);
    setSfxTimeScale(ts);
    G.driftSfxCooldown -= frameDt;
    if (s === GameState.RACING && driftAbs > 0.3 && G.driftSfxCooldown <= 0) {
      playDriftSFX(driftAbs);
      G.driftSfxCooldown = 0.12;
    }

    // Damage smoke + flames
    updateDamageAndParts(scene, frameDt);
    updateDetachedPartsPhysics(scene, frameDt);

    // Checkpoint detection
    if (s === GameState.RACING && G.raceEngine) {
      const closestPt = getClosestSplinePoint(G.trackData.spline, G.playerVehicle.group.position, G.trackData.bvh);
      const localT = closestPt.t;

      // Rumble strip
      const lateralDist = G.playerVehicle.group.position.distanceTo(closestPt.point);
      if (lateralDist > 4.5 && G.playerVehicle.speed > 5) {
        playRumbleStrip();
      }

      const event = G.raceEngine.updateRacer('local', G.playerVehicle.group.position, localT, G.playerVehicle.heading);
      const progress = G.raceEngine.getProgress('local');

      if (event === 'checkpoint') {
        bus.emit('checkpoint', {
          racerId: 'local',
          index: progress?.checkpointIndex ?? 0,
          lap: progress?.lapIndex ?? 0,
        });
      } else if (event === 'lap') {
        const lastLapTime = progress?.lapTimes[progress.lapTimes.length - 1] ?? 0;
        const bestLap = G.raceEngine.getBestLap('local');
        if ((progress?.lapIndex ?? 0) === G.totalLaps - 1) {
          // Last lap — no slow-mo, just a marker for HUD
        }
        finalizeGhostLap(lastLapTime, G.currentRaceSeed, G.selectedCar?.id ?? '');
        startGhostRecording(G.playerVehicle.group.position, G.playerVehicle.heading);
        bus.emit('lap', {
          racerId: 'local',
          lapIndex: progress?.lapIndex ?? 0,
          lapTime: lastLapTime,
          isBest: bestLap !== null && lastLapTime <= bestLap,
        });
      } else if (event === 'finish') {
        playFinishFanfare();
        triggerSlowMo('finish');
        const finishTime = G.raceEngine.getProgress('local')?.finishTime ?? 0;
        bus.emit('finish', { racerId: 'local', finishTime });
      }

      // HUD update
      const rankings = G.raceEngine.getRankings();
      const myRank = rankings.findIndex(r => r.id === 'local') + 1;

      if (myRank > 0) {
        G.raceStats.avgPosition += myRank;
        G.raceStats.positionSampleCount++;
      }

      if (G.prevMyRank > 0 && myRank !== G.prevMyRank && myRank > 0) {
        const gained = myRank < G.prevMyRank;
        if (gained) G.raceStats.overtakeCount += (G.prevMyRank - myRank);
        bus.emit('position_change', {
          racerId: 'local', oldRank: G.prevMyRank, newRank: myRank, gained,
        });
      }
      G.prevMyRank = myRank;
      const wrongWay = G.raceEngine.isWrongWay(
        G.playerVehicle.heading,
        G.trackData.checkpoints[progress?.checkpointIndex ?? 0]?.tangent ?? G._defaultTangent,
      );
      uiOverlay.classList.toggle('wrong-way-flash', wrongWay);

      // Wrong-way audio warning beep
      if (wrongWay) {
        _wrongWayBeepTimer -= frameDt;
        if (_wrongWayBeepTimer <= 0) {
          playWrongWayBeep();
          _wrongWayBeepTimer = 0.5;
        }
      } else {
        _wrongWayBeepTimer = 0;
      }

      updateHUD(
        G.playerVehicle.speed,
        progress?.lapIndex ?? 0,
        G.totalLaps,
        myRank,
        rankings.length,
        wrongWay,
        G.raceEngine.getElapsedTime() * 1000,
        G.playerVehicle.isNitroActive,
        frameDt,
      );



      updateLeaderboard();

      if (G.raceEngine) {
        const gaps = G.raceEngine.getGaps('local');
        updateGapHUD(gaps.ahead, gaps.behind);
      }

      if (G.playerVehicle) updateDamageHUD(G.playerVehicle.damage);
    }

    // Remote vehicles
    if (G.netPeer) {
      for (const [id, mesh] of G.remoteMeshes) {
        const snap = G.netPeer.getInterpolatedState(id);
        if (snap) {
          G._remoteRayOrigin.set(snap.x, mesh.position.y + 15, snap.z);
          G._remoteRaycaster.set(G._remoteRayOrigin, G._remoteRayDir);
          G._remoteRaycaster.far = 30;
          const remoteHits = G._remoteRaycaster.intersectObject(G.trackData!.roadMesh, false);
          if (remoteHits.length > 0) {
            mesh.position.set(snap.x, remoteHits[0].point.y, snap.z);
          } else {
            _rPos.set(snap.x, 0, snap.z);
            const nearest = getClosestSplinePoint(G.trackData!.spline, _rPos, G.trackData!.bvh);
            mesh.position.set(snap.x, nearest.point.y, snap.z);
          }
          mesh.rotation.y = snap.heading;

          if (s === GameState.RACING) {
            const prev = G.remotePrevPos.get(id);
            if (prev) {
              const dx = snap.x - prev.x;
              const dz = snap.z - prev.z;
              if (dx * dx + dz * dz > 0.01) {
                const moveHeading = Math.atan2(dx, dz);
                let driftApprox = Math.abs(snap.heading - moveHeading);
                if (driftApprox > Math.PI) driftApprox = Math.PI * 2 - driftApprox;
                if (driftApprox > 0.2) {
                  spawnTireSmoke(mesh.position, driftApprox * 0.5);
                }
              }
            }
            G.remotePrevPos.set(id, { x: snap.x, z: snap.z });

            const worstHp = Math.min(
              snap.dmgFront ?? 100, snap.dmgRear ?? 100,
              snap.dmgLeft ?? 100, snap.dmgRight ?? 100,
            );
            if (worstHp < 50) {
              spawnDamageSmoke(mesh.position, 1 - worstHp / 50, frameDt);
            }
          }
        }

        const tag = G.remoteNameTags.get(id);
        if (tag) updateNameTag(tag, mesh.position);
      }
    }

    // Shadow camera
    if (G.playerVehicle) {
      const dl = getDirLight();
      const pp = G.playerVehicle.group.position;
      dl.position.set(pp.x + 50, 80, pp.z + 30);
      dl.target.position.set(pp.x, pp.y, pp.z);
      dl.target.updateMatrixWorld();
      const dx = pp.x - (G._lastShadowX ?? -999);
      const dz = pp.z - (G._lastShadowZ ?? -999);
      if (dx * dx + dz * dz > 64) {
        dl.shadow.camera.left = -40;
        dl.shadow.camera.right = 40;
        dl.shadow.camera.top = 40;
        dl.shadow.camera.bottom = -40;
        dl.shadow.camera.updateProjectionMatrix();
        G._lastShadowX = pp.x;
        G._lastShadowZ = pp.z;
      }
    }

    updateDebugOverlay();

    // Render
    if (G.postFXPipeline) {
      const speedRatio = G.playerVehicle ? Math.abs(G.playerVehicle.speed) / G.playerVehicle.def.maxSpeed : 0;
      const isNitro = G.playerVehicle?.isNitroActive ?? false;
      updatePostFX(Math.min(speedRatio, 1), isNitro, gameDt);
      if (isNitro) setBoostActive(true);
      else setBoostActive(false);
      G.postFXPipeline.render();
    } else {
      renderer.render(scene, camera);
    }
    updateAfterimage();

    updateRearMirror(renderer, scene, frameDt);

    updateDRS(renderer, frameDt);

    // Restore physics state after interpolated rendering
    G.playerVehicle.restoreFromRender();
    for (const ai of G.aiRacers) ai.vehicle.restoreFromRender();
  }
}
