/* ── Hood Racer — Game Loop (extracted from main.ts) ──
 *
 * Contains: gameLoop, stepPhysics, flashDamage, showDraftingIndicator,
 * updateLeaderboard, destroyLeaderboard.
 *
 * Call initGameLoop(deps) once at boot, then startGameLoop() to begin rAF.
 */

import * as THREE from 'three';
import { GameState, EventType } from './types';
import type { InputState } from './types';
import { G, PHYSICS_DT, PHYSICS_HZ, MAX_FRAME_DT, LB_UPDATE_INTERVAL } from './game-context';
import { getInput } from './input';
import { getScene, getDirLight, updateSkyTime } from './scene';
import { getClosestSplinePoint, updateSceneryWind, updateCheckpointHighlight } from './track';
import { resolvePlayerName } from './results-screen';
import { updateDebugOverlay } from './ui-screens';
import { rollbackManager, packInput } from './rollback-netcode';
import { updateGarage } from './garage';
import { cycleSpectateTarget } from './spectator';
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
  triggerImpactFlash, updateImpactFlash,
  updateUnderglow,
  triggerBoostShockwave, updateBoostShockwave,
  triggerBoostBurst, triggerBackfireSequence,
  updateBrakeDiscs,
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
  spawnGPUSparks, spawnGPUExplosion, spawnGPUDamageSmoke, spawnGPUFlame,
  spawnGPUScrapeSparks, spawnGPUGlassShards, spawnGPUShoulderDust,
  spawnGPUNitroTrail, spawnGPURimSparks, spawnGPUBackfire,
  spawnGPUSlipstream, flushToGPU,
} from './gpu-particles';
import { updateTrackRadar } from './minimap';
import { updateDestructionFragments } from './vehicle-destruction';
import { updateWeather, getCurrentWeather, getWeatherPhysics, getPrecipMesh } from './weather';
import { updatePostFX, setImpactIntensity, setBoostActive, setExplosionMode } from './post-fx';
import { showExplosionFlash, showLetterbox, hideLetterbox, showEngineDestroyedText } from './screen-effects';
import { triggerVehicleDestruction } from './vehicle-destruction';
import {
  updateEngineAudio, playDriftSFX, playCollisionSFX,
  playNitroActivate, startNitroBurn, stopNitroBurn,
  updateNitroBurnIntensity, updateDepletionWarning, stopDepletionWarning,
  playNitroRelease, playRumbleStrip, playFinishFanfare,
} from './audio';
import {
  createHUD, updateHUD, updateMinimap, updateDamageHUD,
  updateGapHUD, updateNitroHUD, updateHeatHUD,
} from './hud';
import { resolveCarCollisions, type CarCollider } from './bvh';
import { sampleGhostFrame, updateGhostPlayback, finalizeGhostLap, startGhostRecording } from './ghost';
import { enterSpectatorMode } from './spectator';
import type { OpponentInfo } from './ai-racer';
import { startReplayPlayback as startReplayUI, stopReplayPlayback as stopReplayUI } from './replay-ui';

// ── Dependency injection ──

export interface GameLoopDeps {
  renderer: any; // WebGPURenderer — type stubs unavailable
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
  G.lbEl.innerHTML = rankings.map((r, i) => {
    const name = r.id === 'local' ? 'YOU' : resolvePlayerName(r.id, G);
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
// FIXED-TIMESTEP PHYSICS (60Hz)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** One deterministic physics sub-step at fixed dt. Contains all gameplay simulation. */
function stepPhysics(dt: number, s: GameState) {
  if (!G.playerVehicle || !G.trackData) return;

  // ── Countdown / Flyover: zero-input physics so cars settle on road surface ──
  if (s === GameState.COUNTDOWN || s === GameState.FLYOVER) {
    const neutralInput = { up: false, down: false, left: false, right: false, boost: false, steerAnalog: 0 };
    G.playerVehicle.update(dt, neutralInput, G.trackData.spline, G.trackData.bvh);
    for (const ai of G.aiRacers) {
      ai.vehicle.update(dt, neutralInput, G.trackData.spline, G.trackData.bvh);
    }
    return;
  }

  if (s !== GameState.RACING) return;

  // ── Player vehicle physics ──
  if (G.vehicleCamera?.mode === 'chase') {
    const wp = getWeatherPhysics();
    G.playerVehicle.update(dt, getInput(), G.trackData.spline, G.trackData.bvh, wp);
  }

  // ── AI vehicle physics ──
  const playerT = getClosestSplinePoint(G.trackData.spline, G.playerVehicle.group.position, G.trackData.bvh).t;
  const allOpponents: OpponentInfo[] = [
    { position: G.playerVehicle.group.position, t: playerT, id: 'local' },
  ];
  for (const ai of G.aiRacers) {
    allOpponents.push({ position: ai.vehicle.group.position, t: ai.getCurrentT(), id: ai.id });
  }

  for (const ai of G.aiRacers) {
    const opponents = allOpponents.filter(o => o.id !== ai.id);
    const wp = getWeatherPhysics();
    ai.update(dt, opponents, wp);
  }

  // ── Car-to-car collision (BVH broadphase + push-apart) ──
  const colliders: CarCollider[] = [];
  const velocities: { velX: number; velZ: number }[] = [];

  colliders.push({
    id: 'local',
    position: G.playerVehicle.group.position,
    halfExtents: G.carHalf,
    heading: G.playerVehicle.heading,
  });
  velocities.push(G.playerVehicle);

  for (const ai of G.aiRacers) {
    colliders.push({
      id: ai.id,
      position: ai.vehicle.group.position,
      halfExtents: G.carHalf,
      heading: ai.vehicle.heading,
    });
    velocities.push(ai.vehicle);
  }

  for (const [id, mesh] of G.remoteMeshes) {
    colliders.push({
      id,
      position: mesh.position,
      halfExtents: G.carHalf,
      heading: mesh.rotation.y,
    });
    velocities.push({ velX: 0, velZ: 0 });
  }

  const collisionEvents = resolveCarCollisions(colliders, velocities);

  for (const evt of collisionEvents) {
    if (evt.idA === 'local' && G.playerVehicle) {
      G._impactDir.set(evt.normalX, 0, evt.normalZ);
      G.playerVehicle.applyDamage(G._impactDir, evt.impactForce);
      G.raceStats.collisionCount++;
      G.vehicleCamera?.shake(Math.min(evt.impactForce / 40, 1));
      flashDamage(evt.impactForce / 40);
      setImpactIntensity(evt.impactForce / 40);
    }
    if (evt.idB === 'local' && G.playerVehicle) {
      G._impactDir.set(-evt.normalX, 0, -evt.normalZ);
      G.playerVehicle.applyDamage(G._impactDir, evt.impactForce);
      G.raceStats.collisionCount++;
      G.vehicleCamera?.shake(Math.min(evt.impactForce / 40, 1));
      flashDamage(evt.impactForce / 40);
      setImpactIntensity(evt.impactForce / 40);
    }
    for (const ai of G.aiRacers) {
      if (evt.idA === ai.id) {
        G._impactDir.set(evt.normalX, 0, evt.normalZ);
        ai.vehicle.applyDamage(G._impactDir, evt.impactForce);
      }
      if (evt.idB === ai.id) {
        G._impactDir.set(-evt.normalX, 0, -evt.normalZ);
        ai.vehicle.applyDamage(G._impactDir, evt.impactForce);
      }
    }

    if (evt.impactForce > 5) {
      const cA = colliders.find(c => c.id === evt.idA)!;
      const cB = colliders.find(c => c.id === evt.idB)!;
      G._sparkPos.set(
        (cA.position.x + cB.position.x) / 2,
        (cA.position.y + cB.position.y) / 2 + 0.5,
        (cA.position.z + cB.position.z) / 2,
      );
      spawnGPUSparks(G._sparkPos, evt.impactForce);
      if (evt.impactForce > 20) spawnGPUExplosion(G._sparkPos, evt.impactForce);
      playCollisionSFX(Math.min(evt.impactForce / 30, 1));
      if (navigator.vibrate) navigator.vibrate(Math.min(Math.floor(evt.impactForce * 3), 150));
    }
  }

  // ── Barrier collision effects ──
  if (G.playerVehicle?.lastBarrierImpact) {
    const b = G.playerVehicle.lastBarrierImpact;
    G._sparkPos.set(b.posX, b.posY, b.posZ);
    spawnGPUSparks(G._sparkPos, b.force);
    if (b.force > 20) spawnGPUExplosion(G._sparkPos, b.force);
    G.vehicleCamera?.shake(Math.min(b.force / 30, 0.8));
    flashDamage(b.force / 25);
    setImpactIntensity(b.force / 25);
    triggerImpactFlash(b.force / 30);
    G._impactDir.set(b.normalX, 0, b.normalZ);
    G.playerVehicle.applyDamage(G._impactDir, b.force * 0.7);
    G.raceStats.collisionCount++;
    playCollisionSFX(Math.min(b.force / 25, 1));
    if (navigator.vibrate) navigator.vibrate(Math.min(Math.floor(b.force * 4), 200));
    _deps.uiOverlay.classList.add('impact-vignette');
    setTimeout(() => _deps.uiOverlay.classList.remove('impact-vignette'), 250);

    const zones: Array<'front' | 'rear' | 'left' | 'right'> = ['front', 'rear', 'left', 'right'];
    for (const zone of zones) {
      const z = G.playerVehicle.damage[zone];
      if (z.hp < 40 && !z.glassBroken) {
        z.glassBroken = true;
        G._sparkPos.set(b.posX, b.posY, b.posZ);
        spawnGPUGlassShards(G._sparkPos);
      }
    }
  }
  // AI barrier hits
  for (const ai of G.aiRacers) {
    if (ai.vehicle.lastBarrierImpact) {
      const b = ai.vehicle.lastBarrierImpact;
      G._sparkPos.set(b.posX, b.posY, b.posZ);
      spawnGPUSparks(G._sparkPos, b.force * 0.5);
    }
  }

  // Engine smoke via GPU particles
  if (G.playerVehicle && G.playerVehicle.damage.front.hp < 30) {
    const p = G.playerVehicle.group.position;
    const sinH = Math.sin(G.playerVehicle.heading);
    const cosH = Math.cos(G.playerVehicle.heading);
    G._sparkPos.set(p.x + sinH * 1.5, p.y + 1.0, p.z + cosH * 1.5);
    spawnGPUDamageSmoke(G._sparkPos, 1 - G.playerVehicle.damage.front.hp / 30, dt);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INIT + START
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Call once at boot to inject renderer/scene/camera references. */
export function initGameLoop(deps: GameLoopDeps) {
  _deps = deps;
}

/** Start the rAF loop. Should be called once after initGameLoop(). */
export function startGameLoop() {
  requestAnimationFrame(gameLoop);
}

function stopReplay() {
  stopReplayUI();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN GAME LOOP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function gameLoop(timestamp: number) {
  requestAnimationFrame(gameLoop);

  const { renderer, scene, camera, uiOverlay } = _deps;

  const frameDt = Math.min((timestamp - G.lastTime) / 1000, MAX_FRAME_DT);
  G.lastTime = timestamp;

  // Animate sky + tree wind sway
  updateSkyTime(timestamp);
  if (G.trackData) updateSceneryWind(G.trackData.sceneryGroup, timestamp);

  const s = G.gameState;

  // ── Garage render ──
  if (s === GameState.GARAGE) {
    updateGarage();
    return;
  }

  // ── Title / Lobby ──
  if (s === GameState.TITLE || s === GameState.LOBBY) {
    renderer.render(scene, camera);
    return;
  }

  // ── Replay playback ──
  if (G.replayPlayer) {
    if (G.replayPlayer.isPlaying()) {
      G.replayPlayer.update(frameDt);
      updateDestructionFragments(frameDt);
      flushToGPU();
      updateGPUParticles(renderer as any, frameDt);
      updateVFX(frameDt);
      updatePostFX(0, false, frameDt);
      const hud = document.getElementById('replay-hud');
      if (hud && (hud as any)._updateHUD) (hud as any)._updateHUD();
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
    G.physicsAccumulator += frameDt;

    let physicsStepsThisFrame = 0;
    while (G.physicsAccumulator >= PHYSICS_DT && physicsStepsThisFrame < 4) {
      if (G.playerVehicle) G.playerVehicle.saveSnapshot();
      for (const ai of G.aiRacers) ai.vehicle.saveSnapshot();

      const currentInput = s === GameState.RACING ? getInput() : { up: false, down: false, left: false, right: false, boost: false, steerAnalog: 0 };
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
      const tag = (ai as any)._nameTag as THREE.Sprite | undefined;
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
            G.playerVehicle.addNitro(draftStrength * frameDt);
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
      const sinH = Math.sin(G.playerVehicle.heading);
      const cosH = Math.cos(G.playerVehicle.heading);
      _hoodExplosionPos.copy(G.playerVehicle.group.position);
      _hoodExplosionPos.y += 1.0;
      _hoodExplosionPos.x += sinH * 2.2;
      _hoodExplosionPos.z += cosH * 2.2;

      spawnGPUExplosion(_hoodExplosionPos, 40);
      flashDamage(0.9);
      setImpactIntensity(1.0);

      const pvx = G.playerVehicle.velX, pvz = G.playerVehicle.velZ;
      const isRacing = G.raceEngine && s === GameState.RACING;
      const bodyRef = G.playerVehicle.bodyGroupRef;
      const vGroup = G.playerVehicle.group;
      const wheelRefs = G.playerVehicle.wheelRefs;
      const cachedFrags = G.playerVehicle.cachedFragments;
      const expPos = _hoodExplosionPos.clone();

      requestAnimationFrame(() => {
        if (isRacing) {
          triggerVehicleDestruction(bodyRef, vGroup, getScene(), pvx, pvz, wheelRefs, cachedFrags);
          if (G.playerVehicle) G.playerVehicle.destroyed = true;
        }
        requestAnimationFrame(() => {
          if (isRacing) {
            showExplosionFlash();
            showLetterbox();
            setExplosionMode(true);
            if (G.vehicleCamera) {
              G.vehicleCamera.startExplosionOrbit(expPos);
            }
            setTimeout(() => showEngineDestroyedText(), 800);
            setTimeout(() => { hideLetterbox(); setExplosionMode(false); }, 3500);
            setTimeout(() => _deps.callShowResults(), 4000);
          }
          requestAnimationFrame(() => {
            spawnGPUGlassShards(expPos);
            requestAnimationFrame(() => {
              spawnDebris(expPos, 35, pvx, pvz);
            });
          });
        });
      });

      if (isRacing) {
        G.raceEngine!.markDnf('local');
      }
    }

    if (G.playerVehicle.engineJustExploded) {
      G.playerVehicle.clearExplosionFlag();
    }

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
      }
      G.playerVehicle.clearLandingFlag();
    }

    // ── Hood smoke/flames at high engine heat ──
    const heat = G.playerVehicle.engineHeat;
    if (heat > 60) {
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

      G.vehicleCamera.update(camTarget, camHeading, camSpeed, camMaxSpeed, G.playerVehicle.driftAngle, frameDt);
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
    updateVFX(frameDt);

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
    updateGPUParticles(renderer, frameDt);
    updateWeather(frameDt, G.playerVehicle.group.position);

    // Rain droplets
    const weatherType = getCurrentWeather();
    const rainIntensity = weatherType === 'heavy_rain' ? 0.5 : weatherType === 'light_rain' ? 0.25 : 0;
    updateRainDroplets(rainIntensity, frameDt);

    updateImpactFlash(frameDt);

    // Underglow
    if (G._playerUnderglow) {
      updateUnderglow(G._playerUnderglow, G.playerVehicle.speed, timestamp / 1000, G.playerVehicle.isNitroActive);
    }
    updateBoostFlame(s === GameState.RACING && G.playerVehicle.isNitroActive, G.playerVehicle.group.position, G.playerVehicle.heading, timestamp / 1000, G.playerVehicle.engineHeat);

    // Nitro activation
    const isNitroNow = s === GameState.RACING && G.playerVehicle.isNitroActive;
    if (isNitroNow && !G._wasNitroActive) {
      triggerBoostShockwave(G.playerVehicle.group.position, G.playerVehicle.heading);
      triggerBoostBurst();
      playNitroActivate();
      startNitroBurn();
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
    }
    G._wasNitroActive = isNitroNow;
    updateBoostShockwave(frameDt);

    // FOV punch
    const baseFOV = 75;
    const targetFOV = isNitroNow ? baseFOV + 8 : baseFOV;
    camera.fov += (targetFOV - camera.fov) * (1 - Math.exp(-(isNitroNow ? 12 : 5) * frameDt));
    camera.updateProjectionMatrix();

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

    // Near-miss detection
    if (s === GameState.RACING && Math.abs(G.playerVehicle.speed) > 15) {
      const pPos = G.playerVehicle.group.position;
      const now = timestamp / 1000;
      for (const ai of G.aiRacers) {
        const aPos = ai.vehicle.group.position;
        const dx = pPos.x - aPos.x;
        const dz = pPos.z - aPos.z;
        const dist2 = dx * dx + dz * dz;
        if (dist2 < 3.5 * 3.5 && dist2 > 1.5 * 1.5) {
          const lastMiss = G._nearMissCooldowns?.get(ai.id) ?? 0;
          if (now - lastMiss > 1.0) {
            if (!G._nearMissCooldowns) G._nearMissCooldowns = new Map();
            G._nearMissCooldowns.set(ai.id, now);
            const cosH = Math.cos(G.playerVehicle.heading);
            const sinH = Math.sin(G.playerVehicle.heading);
            const cross = dx * cosH - dz * sinH;
            triggerNearMiss(cross > 0 ? 'right' : 'left');
            triggerNearMissWhoosh(cross > 0 ? 'right' : 'left', camera.position, G.playerVehicle.heading);
            G.playerVehicle.addNitro(5);
            G.raceStats.nearMissCount = (G.raceStats.nearMissCount ?? 0) + 1;
          }
        }
      }
    }
    updateNearMissStreaks(frameDt);
    updateNearMissWhoosh(frameDt, camera.position, G.playerVehicle.heading);

    updateVictoryConfetti(frameDt);

    const speedRatioForLines = Math.abs(G.playerVehicle.speed) / G.selectedCar.maxSpeed;
    const nitroForLines = G.playerVehicle.isNitroActive;
    if (speedRatioForLines > 0.3 || nitroForLines) updateSpeedLines(speedRatioForLines, nitroForLines);

    // Race stats
    if (s === GameState.RACING) {
      const speedMph = Math.abs(G.playerVehicle.speed) * 2.5;
      if (speedMph > G.raceStats.topSpeed) G.raceStats.topSpeed = speedMph;
      if (driftAbs > 0.15) G.raceStats.totalDriftTime += frameDt;
    }

    // Audio
    updateEngineAudio(G.playerVehicle.speed, G.selectedCar.maxSpeed);
    G.driftSfxCooldown -= frameDt;
    if (s === GameState.RACING && driftAbs > 0.3 && G.driftSfxCooldown <= 0) {
      playDriftSFX(driftAbs);
      G.driftSfxCooldown = 0.12;
    }

    // Damage smoke + flames
    if (s === GameState.RACING && G.playerVehicle) {
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
        if (G.playerVehicle.detachedZones.has(zone) && !G.detachedParts.some(dp => (dp as any).zone === zone && (dp as any).owner === 'local')) {
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
            });
            spawnGPUExplosion(partMesh.position, 30);
          }
        }
      }
    }

    // Detached parts physics
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

      updateHUD(
        G.playerVehicle.speed,
        progress?.lapIndex ?? 0,
        G.totalLaps,
        myRank,
        rankings.length,
        wrongWay,
        G.raceEngine.getElapsedTime() * 1000,
        G.playerVehicle.isNitroActive,
      );

      const PEER_COLORS = ['#ff6600', '#e040fb', '#ffcc00', '#76ff03', '#ff1744', '#00bcd4'];
      const minimapDots: { pos: THREE.Vector3; color?: string }[] = [];
      G.aiRacers.forEach(ai => minimapDots.push({ pos: ai.vehicle.group.position, color: '#ff6600' }));
      let peerIdx = 0;
      for (const mesh of G.remoteMeshes.values()) {
        minimapDots.push({ pos: mesh.position, color: PEER_COLORS[peerIdx % PEER_COLORS.length] });
        peerIdx++;
      }
      updateMinimap(G.trackData.spline, G.playerVehicle.group.position, minimapDots);

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
      updatePostFX(Math.min(speedRatio, 1), isNitro, frameDt);
      if (isNitro) setBoostActive(true);
      G.postFXPipeline.render();
    } else {
      renderer.render(scene, camera);
    }

    // Rear-view mirror
    if (G.mirrorCamera && G.playerVehicle && s === GameState.RACING) {
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

      const gl = (renderer as any).getContext?.() as WebGLRenderingContext | undefined;
      if (gl?.frontFace) gl.frontFace(gl.CW);

      const w = 320, h = 120;
      const x = Math.floor(window.innerWidth / 2 - w / 2);
      const isWebGL = !!(renderer as any).isWebGLRenderer;
      const y = isWebGL ? Math.floor(window.innerHeight - h - 14) : 14;

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

      if (gl?.frontFace) gl.frontFace(gl.CCW);

      if (precip) precip.visible = true;
      if (godrays) godrays.visible = true;
    }

    // DRS
    G._drsFrameTimes[G._drsWriteIdx % 30] = frameDt;
    G._drsWriteIdx++;
    if (G._drsWriteIdx >= 30) {
      let sum = 0;
      for (let drsI = 0; drsI < 30; drsI++) sum += G._drsFrameTimes[drsI];
      const avgDt = sum / 30;
      const avgFps = 1 / avgDt;
      const currentPR = renderer.getPixelRatio();
      const basePR = Math.min(window.devicePixelRatio, 2);
      let newPR = currentPR;
      if (avgFps < 45 && currentPR > 0.5) {
        newPR = Math.max(currentPR - 0.15, 0.5);
      } else if (avgFps > 56 && currentPR < basePR) {
        newPR = Math.min(currentPR + 0.05, basePR);
      }
      if (newPR !== currentPR) {
        renderer.setPixelRatio(newPR);
        renderer.setSize(window.innerWidth, window.innerHeight);
      }
    }

    // Restore physics state after interpolated rendering
    G.playerVehicle.restoreFromRender();
    for (const ai of G.aiRacers) ai.vehicle.restoreFromRender();
  }
}
