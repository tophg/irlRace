/* ── IRL Race — Game Loop (extracted from main.ts) ──
 *
 * Contains: gameLoop, updateLeaderboard, destroyLeaderboard.
 * VFX, damage, weather, near-miss, and render-pass code has been
 * extracted to loop-vfx.ts.
 *
 * Call initGameLoop(deps) once at boot, then startGameLoop() to begin rAF.
 */

import * as THREE from 'three/webgpu';
import { GameState } from './types';
import { G, PHYSICS_DT, MAX_FRAME_DT, LB_UPDATE_INTERVAL } from './game-context';
import { getInput } from './input';
import { getDirLight, updateSkyTime } from './scene';
import { getClosestSplinePoint, updateSceneryWind } from './track';
import { updateBuildingCulling } from './track-scenery';
import { resolvePlayerName } from './results-screen';
import { updateDebugOverlay } from './ui-screens';
import { rollbackManager, packInput } from './rollback-netcode';
import { updateGarage } from './garage';

// VFX subsystem (extracted)
import {
  flashDamage,
  updateSlipstream,
  updateExplosionVFX,
  updateLandingVFX,
  updateHoodSmoke,
  updateTireAndSkidVFX,
  updateDamageZoneSmoke,
  updateParticles,
  updateWeatherEffects,
  updateNitroVFX,
  updateNearMissDetection,
  updateMiscVFX,
  updateDamageAndParts,
  updateDetachedPartsPhysics,
  updateRenderPass,
  updateDestructionFragments,
  resetVFXState,
  cleanupVFXDOM, cleanupDraftingDOM, cleanupDamageFlashDOM,
} from './loop-vfx';
import { updateNameTag, spawnDamageSmoke, spawnTireSmoke } from './vfx';
import { updateGPUParticles, flushToGPU } from './gpu-particles';
import { updatePostFX } from './post-fx';
import { getPrecipMesh } from './weather';
import {
  updateRaceStats, updateMinimap, updateCheckpointsAndHUD,
  resetRaceEventsState,
} from './loop-race-events';
import {
  updateEngineAudio, playDriftSFX,
  playNitroActivate, startNitroBurn, stopNitroBurn,
  updateNitroBurnIntensity, updateDepletionWarning, stopDepletionWarning,
  playNitroRelease, setMusicTimeScale, setSfxTimeScale,
} from './audio';
import { updateNitroHUD, updateHeatHUD } from './hud';

import { stepPhysics, initPhysicsStep } from './physics-step';
import { stopReplayPlayback as stopReplayUI } from './replay-ui';

import { updateTimeScale, applyTimeScale, getTimeScale } from './time-scale';
import { COLORS } from './colors';

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

// ── Per-race state ──
let _perfectStartChecked = false;
let _drsLastWallTime = 0;
let _racingElapsed = 0;

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
    const color = rtt < 80 ? '#4caf50' : rtt < 150 ? COLORS.YELLOW : COLORS.RED;
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
  _racingElapsed = 0;
  _perfectStartChecked = false;
  _drsLastWallTime = 0;
  G._nearMissCooldowns.clear();
  resetVFXState();
  resetRaceEventsState();
}

/** Remove DOM elements created by the game loop between races. */
export function cleanupGameLoopDOM() {
  cleanupVFXDOM();
  cleanupDraftingDOM();
  cleanupDamageFlashDOM();
}

/** Start the rAF loop. Should be called once after initGameLoop(). */
export function startGameLoop() {
  requestAnimationFrame(gameLoop);
}

function stopReplay() {
  stopReplayUI();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REAR-VIEW MIRROR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DRS (Dynamic Resolution Scaling)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function updateDRS(renderer: THREE.WebGPURenderer, _frameDt: number) {
  const now = performance.now();
  const wallDt = _drsLastWallTime > 0 ? (now - _drsLastWallTime) / 1000 : 0;
  _drsLastWallTime = now;
  if (wallDt <= 0 || wallDt > 0.5) return;
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN GAME LOOP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _drsPendingPR = 0;
const _rPos = new THREE.Vector3();

function gameLoop(timestamp: number) {
  requestAnimationFrame(gameLoop);

  const { renderer, scene, camera, uiOverlay } = _deps;

  // Apply pending DRS resize BEFORE any rendering
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
  if (s === GameState.TITLE) return;
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

      // Perfect start detection
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
    updateSlipstream(gameDt, uiOverlay);

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

    // ── VFX SUBSYSTEM ──
    updateExplosionVFX(s, frameDt, _deps.callShowResults);
    updateLandingVFX();
    updateHoodSmoke(frameDt);

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

    // VFX — tire smoke, skid marks, ghost
    updateTireAndSkidVFX(s, frameDt);

    // Per-frame damage zone smoke
    updateDamageZoneSmoke(s, frameDt);

    // GPU particles
    updateParticles(renderer, gameDt);

    // Weather
    updateWeatherEffects(renderer, camera, gameDt, frameDt, s);

    // Nitro VFX (underglow, boost flame, shockwave, camera shake, trails, sparks)
    updateNitroVFX(s, camera, gameDt, frameDt, timestamp);

    // Nitro audio (activation/deactivation sounds)
    const isNitroNow = s === GameState.RACING && G.playerVehicle.isNitroActive;
    if (isNitroNow && !G._wasNitroActive) {
      playNitroActivate();
      startNitroBurn();
    }
    if (isNitroNow) {
      updateNitroBurnIntensity(G.playerVehicle.nitro);
      updateDepletionWarning(G.playerVehicle.nitro);
    }
    if (!isNitroNow && G._wasNitroActive) {
      stopNitroBurn();
      stopDepletionWarning();
      playNitroRelease();
    }
    G._wasNitroActive = isNitroNow;

    // Minimap + checkpoint highlights
    updateMinimap(timestamp);

    // Near-miss detection
    updateNearMissDetection(camera, timestamp, frameDt, s);

    // Misc VFX (lens flares, lightning, confetti, speed lines)
    updateMiscVFX(camera, timestamp, frameDt);

    // Race stats
    updateRaceStats(gameDt);

    // Audio
    const ts = getTimeScale();
    updateEngineAudio(
      G.playerVehicle.speed, G.selectedCar.maxSpeed, ts,
      G.playerVehicle.isNitroActive, G.playerVehicle.throttle,
    );
    setMusicTimeScale(ts);
    setSfxTimeScale(ts);
    G.driftSfxCooldown -= frameDt;
    if (s === GameState.RACING && Math.abs(G.playerVehicle.driftAngle) > 0.3 && G.driftSfxCooldown <= 0) {
      playDriftSFX(Math.abs(G.playerVehicle.driftAngle));
      G.driftSfxCooldown = 0.12;
    }

    // Damage smoke + flames
    updateDamageAndParts(scene, frameDt);
    updateDetachedPartsPhysics(scene, frameDt);

    // Checkpoint detection, lap/finish events, HUD
    updateCheckpointsAndHUD(uiOverlay, frameDt, updateLeaderboard);

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
    updateRenderPass(renderer, scene, camera, gameDt);

    updateRearMirror(renderer, scene, frameDt);

    updateDRS(renderer, frameDt);

    // Restore physics state after interpolated rendering
    G.playerVehicle.restoreFromRender();
    for (const ai of G.aiRacers) ai.vehicle.restoreFromRender();
  }
}

// Re-export for external callers that still reference these
export { flashDamage };
