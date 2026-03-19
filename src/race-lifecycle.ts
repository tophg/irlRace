/* ── IRL Race — Race Lifecycle (extracted from main.ts) ──
 *
 * Contains: startRace, spawnAI, spawnRemoteVehicles,
 * clearRaceObjects, disposeMaterial, disposeMesh.
 *
 * Call initRaceLifecycle(deps) once at boot.
 */

import * as THREE from 'three/webgpu';
import { GameState, CAR_ROSTER, EventType, type TrackData } from './types';
import { G, resetRaceStats } from './game-context';
import { getScene, applyEnvironment, getEnvironmentForSeed, getEnvironmentByName } from './scene';
import { loadCarModel } from './loaders';
import { generateTrack, buildCheckpointMarkers } from './track';
import { destroyScenery } from './track-scenery';
import { Vehicle } from './vehicle';
import { VehicleCamera } from './vehicle-camera';
import { RaceEngine } from './race-engine';
import { createHUD, showHUD, destroyHUD } from './hud';
import { runCountdown } from './countdown';
import { initAudio, stopAudio, playCountdownRevs, stopCountdownRevs, playGameMusic } from './audio';
import { AIRacer } from './ai-racer';
import {
  initVFX, destroyVFX, warmupVFX,
  initBoostFlame, initSpeedLines, initSkidMarks, destroySkidMarks,
  initRainDroplets, initImpactFlash, initBoostShockwave, initNitroFlash,
  initHeatShimmer, initLensFlares, initLightning, setLightningEnabled,
  initNearMissStreaks, initNearMissWhoosh, initVictoryConfetti,
  createUnderglow, createNameTag,
} from './vfx';
import { initGPUParticles, destroyGPUParticles } from './gpu-particles';
import { initTrackRadar, destroyTrackRadar } from './minimap';
import { warmupDestruction, warmupFragmentMaterials, cleanupDestruction, disposeDestructionAssets } from './vehicle-destruction';
import { resetTimeScale } from './time-scale';
import { cleanupScreenEffects } from './screen-effects';
import { setExplosionMode, initPostFX } from './post-fx';
import { loadGhostForSeed, startGhostPlayback, startGhostRecording, destroyGhost } from './ghost';
import { initRapierWorld, addBarrierCollider, addCarBody, destroyRapierWorld } from './rapier-world';
import { rollbackManager } from './rollback-netcode';
import { showTouchControls, resetInput } from './input';
import { getSettings } from './settings';
import { ReplayRecorder } from './replay';
import { getWeatherForSeed, initWeather, applyWetRoad, destroyWeather, getCurrentWeather } from './weather';
import { showLoading, hideLoading } from './ui-screens';
import { destroyLeaderboard } from './game-loop';
import { destroySpectateHUD } from './spectator';

// ── Dependency injection ──

export interface RaceLifecycleDeps {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  uiOverlay: HTMLElement;
  container: HTMLElement;
}

let _deps: RaceLifecycleDeps;

/** Call once at boot to inject renderer/scene/camera references. */
export function initRaceLifecycle(deps: RaceLifecycleDeps) {
  _deps = deps;
}

// ── Disposal helpers ──

function disposeMaterial(mat: THREE.Material) {
  const std = mat as THREE.MeshStandardMaterial;
  if (std.map) std.map.dispose();
  if (std.normalMap) std.normalMap.dispose();
  if (std.aoMap) std.aoMap.dispose();
  if (std.emissiveMap) std.emissiveMap.dispose();
  if (std.envMap) std.envMap.dispose();
  if (std.roughnessMap) std.roughnessMap.dispose();
  if (std.metalnessMap) std.metalnessMap.dispose();
  if (std.alphaMap) std.alphaMap.dispose();
  mat.dispose();
}

function disposeMesh(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(m => disposeMaterial(m));
      else if (mat) disposeMaterial(mat as THREE.Material);
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
        (mesh as THREE.InstancedMesh).dispose();
      }
    }
  });
}

// ── Clear Race Objects ──

export function clearRaceObjects() {
  const { scene } = _deps;

  G.netPeer?.stopBroadcasting();
  G.netPeer?.stopPinging();
  G.netPeer?.clearBuffers();

  G.replayRecorder?.stop();
  G.replayRecorder = null;

  if (G.trackData) {
    destroyWeather();
    scene.remove(G.trackData.roadMesh);
    scene.remove(G.trackData.barrierLeft);
    scene.remove(G.trackData.barrierRight);
    scene.remove(G.trackData.shoulderMesh);
    scene.remove(G.trackData.kerbGroup);
    scene.remove(G.trackData.sceneryGroup);
    scene.remove(G.trackData.rampGroup);
    disposeMesh(G.trackData.roadMesh);
    disposeMesh(G.trackData.barrierLeft);
    disposeMesh(G.trackData.barrierRight);
    disposeMesh(G.trackData.shoulderMesh);
    disposeMesh(G.trackData.kerbGroup);
    destroyScenery(G.trackData.sceneryGroup);
    disposeMesh(G.trackData.rampGroup);
    G.trackData = null;
  }
  if (G.checkpointMarkers) {
    scene.remove(G.checkpointMarkers);
    disposeMesh(G.checkpointMarkers);
    G.checkpointMarkers = null;
  }

  if (G.mirrorBorder) { G.mirrorBorder.remove(); G.mirrorBorder = null; }
  G.mirrorCamera = null;

  if (G.playerVehicle) {
    scene.remove(G.playerVehicle.group);
    disposeMesh(G.playerVehicle.group);
    G.playerVehicle = null;
  }

  for (const ai of G.aiRacers) {
    scene.remove(ai.vehicle.group);
    disposeMesh(ai.vehicle.group);
  }
  G.aiRacers.length = 0;

  for (const mesh of G.remoteMeshes.values()) {
    scene.remove(mesh);
    disposeMesh(mesh);
  }
  G.remoteMeshes.clear();
  for (const tag of G.remoteNameTags.values()) {
    scene.remove(tag);
    if ((tag as THREE.Sprite).material) {
      const spMat = (tag as THREE.Sprite).material as THREE.SpriteMaterial;
      spMat.map?.dispose();
      spMat.dispose();
    }
  }
  G.remoteNameTags.clear();
  G.remotePrevPos.clear();
  G._nearMissCooldowns.clear();

  for (const dp of G.detachedParts) {
    scene.remove(dp.mesh);
    dp.mesh.geometry?.dispose();
    (dp.mesh.material as THREE.Material)?.dispose();
  }
  G.detachedParts.length = 0;

  G._leftTireBlown = false;
  G._rightTireBlown = false;

  destroyVFX();
  destroySkidMarks();
  destroyGPUParticles();
  destroyRapierWorld();
  rollbackManager.reset();
  cleanupDestruction();
  disposeDestructionAssets();
  resetTimeScale();
  cleanupScreenEffects();
  setExplosionMode(false);

  stopAudio();

  destroyHUD();
  destroyTrackRadar();
  destroyGhost(getScene());
  destroyLeaderboard();

  if (G.debugEl) { G.debugEl.remove(); G.debugEl = null; }

  G.driftSfxCooldown = 0;
  G.lbLastUpdate = 0;
  G.spectateTargetId = null;
  G.prevMyRank = 0;
  destroySpectateHUD();
}

// ── Spawn AI ──

export async function spawnAI(td: TrackData) {
  const { scene, renderer, camera } = _deps;

  for (const ai of G.aiRacers) {
    scene.remove(ai.vehicle.group);
  }
  G.aiRacers.length = 0;

  const available = CAR_ROSTER.filter(c => c.id !== G.selectedCar.id);
  const count = Math.min(G.aiCount, available.length);
  const aiCars = available.slice(0, count);
  const laneOffsets = [3.5, -3.5, 3.5, -3.5, 3.5, -3.5];
  const startTs = [0.005, 0.005, 0.012, 0.012, 0.019, 0.019];

  console.log(`[spawnAI] G.aiCount=${G.aiCount}, spawning ${aiCars.length} AI racers`);

  for (let i = 0; i < aiCars.length; i++) {
    const def = aiCars[i];
    const ai = new AIRacer(`ai_${i}`, { ...def }, i);
    ai.applyDifficulty(G.aiDifficulty);
    G.raceEngine!.addRacer(`ai_${i}`, startTs[i] ?? 0.02);

    try {
      const model = await loadCarModel(def.file);
      model.position.set(0, 0, 0);
      model.scale.setScalar(1);
      model.rotation.set(0, 0, 0);
      ai.vehicle.setModel(model, renderer, camera, scene);
    } catch (err) { console.warn('[race-lifecycle] Failed to load AI model:', def.file, err); }

    ai.vehicle.setRoadMesh(G.trackData!.roadMesh, [G.trackData!.rampGroup]);
    ai.place(G.trackData!.spline, startTs[i] ?? 0.02, laneOffsets[i] ?? 0, G.trackData!.bvh);
    ai.setSpeedProfile(G.trackData!.speedProfile);
    scene.add(ai.vehicle.group);
    createUnderglow(ai.vehicle.group, i + 1);

    const AI_NAMES = ['SHADOW', 'BLAZE', 'NITRO', 'GHOST', 'VIPER', 'STORM', 'RAZOR', 'DRIFT', 'FURY', 'ACE', 'NOVA'];
    const nameTag = createNameTag(AI_NAMES[i % AI_NAMES.length], scene);
    ai.nameTag = nameTag;

    G.aiRacers.push(ai);
  }
}

// ── Spawn Remote Vehicles ──

export async function spawnRemoteVehicles() {
  const { scene } = _deps;

  if (!G.netPeer || !G.trackData) return;

  const localId = G.netPeer.getLocalId();
  const allPlayers = G.mpPlayersList.length > 0
    ? G.mpPlayersList.filter(p => p.id !== localId)
    : G.netPeer.getRemotePlayers().map(r => ({ id: r.id, name: r.name, carId: r.carId }));

  const laneOffsets = [3.5, -3.5, 3.5, -3.5, 3.5, -3.5];

  for (let ri = 0; ri < allPlayers.length; ri++) {
    const player = allPlayers[ri];
    if (G.remoteMeshes.has(player.id)) continue;

    const def = CAR_ROSTER.find(c => c.id === player.carId) ?? CAR_ROSTER[0];
    try {
      const model = await loadCarModel(def.file);
      const startT = 0.02 + ri * 0.02;
      const pt = G.trackData.spline.getPointAt(startT);
      const tangent = G.trackData.spline.getTangentAt(startT).normalize();
      const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      const lane = laneOffsets[ri % laneOffsets.length];
      model.position.copy(pt);
      model.position.x += right.x * lane;
      model.position.z += right.z * lane;

      const rayOrigin = new THREE.Vector3(model.position.x, model.position.y + 10, model.position.z);
      const rc = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, 25);
      const hits = rc.intersectObject(G.trackData.roadMesh, false);
      if (hits.length > 0) {
        model.position.y = hits[0].point.y;
      } else {
        model.position.y += 0.05;
      }

      model.rotation.y = Math.atan2(tangent.x, tangent.z);
      scene.add(model);
      G.remoteMeshes.set(player.id, model);

      const tag = createNameTag(player.name || 'Racer', scene);
      G.remoteNameTags.set(player.id, tag);
    } catch (err) { console.warn('[race-lifecycle] Failed to load remote player model:', player.id, err); }

    G.raceEngine!.addRacer(player.id, 0);
  }
}

// ── Start Race ──

export async function startRace() {
  if (G.raceStarting) return;
  G.raceStarting = true;

  const { renderer, scene, camera, uiOverlay, container } = _deps;

  try {
    G.gameState = GameState.TITLE;
    renderer.clearColor();
    showLoading();

    clearRaceObjects();
    resetInput(); // BUG-11 fix: zero out any stuck keys from previous race
    G.physicsAccumulator = 0;
    G._drsFrameTimes = new Array(30).fill(0);
    G._drsWriteIdx = 0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    let seed = G.trackSeed ?? Math.floor(Math.random() * 99999);

    // ── Resolve environment + weather BEFORE generating track ──
    // generateTrack → generateScenery → getCurrentTheme(), so the theme
    // must be applied before the track is built.
    const selectedEnv = G._selectedEnvironment;
    const envPreset = (selectedEnv && selectedEnv !== 'random')
      ? getEnvironmentByName(selectedEnv)
      : getEnvironmentForSeed(seed);
    applyEnvironment(envPreset);

    const selectedW = G._selectedWeather;
    const weatherType = (selectedW && selectedW !== 'random')
      ? selectedW as any
      : getWeatherForSeed(seed);
    initWeather(scene, weatherType);

    // Weather can override the environment (snow → Alpine Snow, etc.)
    const w = getCurrentWeather();
    if (w === 'snow') applyEnvironment(getEnvironmentByName('Alpine Snow'));
    else if (w === 'blizzard') applyEnvironment(getEnvironmentByName('Blizzard'));
    else if (w === 'ice') applyEnvironment(getEnvironmentByName('Black Ice'));

    // ── Now generate the track (scenery will use the correct theme) ──
    if (G._customTrack) {
      G.trackData = G._customTrack;
      G._customTrack = null;
      G.currentRaceSeed = 0;
    } else {
      G.currentRaceSeed = seed;
      G.trackSeed = null;
      G.trackData = generateTrack(seed);
    }
    const trackData = G.trackData!;

    if (w !== 'clear') applyWetRoad(trackData.roadMesh);
    scene.add(trackData.roadMesh);
    scene.add(trackData.barrierLeft);
    scene.add(trackData.barrierRight);
    scene.add(trackData.shoulderMesh);
    scene.add(trackData.kerbGroup);
    scene.add(trackData.sceneryGroup);
    scene.add(trackData.rampGroup);

    G.checkpointMarkers = buildCheckpointMarkers(trackData.checkpoints);
    scene.add(G.checkpointMarkers);

    G.raceEngine = new RaceEngine(trackData.checkpoints, G.totalLaps, trackData.totalLength);

    const playerModel = await loadCarModel(G.selectedCar.file);
    playerModel.position.set(0, 0, 0);
    playerModel.scale.setScalar(1);
    playerModel.rotation.set(0, 0, 0);
    G.playerVehicle = new Vehicle(G.selectedCar);
    G.playerVehicle.setModel(playerModel, renderer, camera, scene);
    const paintHue = getSettings().paintHue;
    if (paintHue >= 0) G.playerVehicle.setPaintColor(paintHue);
    scene.add(G.playerVehicle.group);
    G.playerVehicle.setRoadMesh(trackData.roadMesh, [trackData.rampGroup]);
    G.playerVehicle.placeOnTrack(trackData.spline, 0, -3.5);
    G._playerUnderglow = createUnderglow(G.playerVehicle.group, 0);
    G.raceEngine.addRacer('local', 0);

    G.vehicleCamera = new VehicleCamera(camera);

    initVFX(scene);
    warmupVFX();
    initBoostFlame(scene);
    initSpeedLines(container);
    initSkidMarks(scene);

    warmupDestruction(scene, renderer, camera);
    warmupFragmentMaterials(G.playerVehicle.cachedFragments, renderer, camera, scene, G.playerVehicle.wheelRefs);

    initRainDroplets(container);
    initImpactFlash(container);
    initBoostShockwave(scene);
    initNitroFlash(container);
    initHeatShimmer(container);

    initTrackRadar(trackData.spline, document.getElementById('ui-overlay')!);

    const lightPositions: THREE.Vector3[] = [];
    trackData.sceneryGroup.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.PointLight) {
        lightPositions.push(child.position.clone());
      }
    });
    initLensFlares(scene, lightPositions);
    initLightning(container);
    initNearMissStreaks(container);
    initNearMissWhoosh(scene);
    initVictoryConfetti(scene);

    setLightningEnabled(getCurrentWeather() === 'heavy_rain');
    await initGPUParticles(renderer, scene);

    try {
      G.postFXPipeline = initPostFX(renderer, scene, camera);
      // Force ONE render through the postFX pipeline to compile shaders
      // for ALL currently visible objects (including pool meshes at y=-100).
      // renderer.compile() in warmupDestruction only builds node trees for
      // the BASE renderer, but the game renders through the postFX pipeline
      // which has its own render targets + node graph. Without this render,
      // pool meshes are "new" to the postFX pipeline at explosion time,
      // triggering 1.8s of lazy shader compilation.
      G.postFXPipeline.render();
    } catch (e) {
      console.warn('[PostFX] Pipeline init failed, rendering without post-processing:', e);
      G.postFXPipeline = null;
    }
    try {
      await initRapierWorld();
      addBarrierCollider(trackData.barrierLeft);
      addBarrierCollider(trackData.barrierRight);
      const playerPos = G.playerVehicle.group.position;
      addCarBody('local', playerPos.x, playerPos.y, playerPos.z, G.playerVehicle.heading);
    } catch (e) {
      console.warn('[Rapier] WASM init failed, running without enhanced collision:', e);
    }

    if (!G.netPeer) await spawnAI(trackData);

    if (G.netPeer) {
      await spawnRemoteVehicles();

      G.netPeer.startBroadcasting(() => ({
        x: G.playerVehicle!.group.position.x,
        z: G.playerVehicle!.group.position.z,
        heading: G.playerVehicle!.heading,
        speed: G.playerVehicle!.speed,
        dmgFront: G.playerVehicle!.damage.front.hp,
        dmgRear: G.playerVehicle!.damage.rear.hp,
        dmgLeft: G.playerVehicle!.damage.left.hp,
        dmgRight: G.playerVehicle!.damage.right.hp,
      }));

      G.netPeer.startPinging();
      G.netPeer.startHeartbeat();
    }

    createHUD(uiOverlay);
    showHUD(true);

    G.mirrorCamera = new THREE.PerspectiveCamera(50, 320 / 120, 0.5, 500);
    G.mirrorBorder = document.createElement('div');
    G.mirrorBorder.style.cssText = `
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
      width: 320px; height: 120px;
      border: 2px solid rgba(255,255,255,0.2); border-radius: 6px;
      pointer-events: none; z-index: 20; opacity: 0.85;
      overflow: hidden; display: none;
    `;
    uiOverlay.appendChild(G.mirrorBorder);
    if (window.matchMedia('(pointer: coarse)').matches) showTouchControls(true);
    initAudio();

    renderer.render(scene, camera);

    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));

    hideLoading();

    G.gameState = GameState.FLYOVER;
    G.vehicleCamera!.startFlyover(trackData.spline, 10);
    showHUD(false);

    const flyoverLabel = document.createElement('div');
    flyoverLabel.className = 'flyover-label';
    flyoverLabel.textContent = 'TRACK PREVIEW';
    uiOverlay.appendChild(flyoverLabel);

    await new Promise<void>((resolve) => {
      let resolved = false;
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('keydown', keyHandler);
        window.removeEventListener('pointerdown', pointerHandler);
        resolve();
      };
      const keyHandler = (e: KeyboardEvent) => { if (e.key !== 'F11') { G.vehicleCamera?.skipFlyover(); cleanup(); } };
      const pointerHandler = () => { G.vehicleCamera?.skipFlyover(); cleanup(); };
      window.addEventListener('keydown', keyHandler);
      window.addEventListener('pointerdown', pointerHandler);

      const poll = () => {
        if (resolved) return; // stop polling after resolution
        if (G.vehicleCamera?.isFlyoverComplete()) {
          cleanup();
        } else {
          requestAnimationFrame(poll);
        }
      };
      requestAnimationFrame(poll);
    });

    flyoverLabel.remove();
    showHUD(true);

    G.gameState = GameState.COUNTDOWN;

    if (G.netPeer) {
      if (G.netPeer.getIsHost()) {
        const guestCount = G.netPeer.getConnectionCount();
        if (guestCount > 0 && G.raceReadyCount < guestCount) {
          await Promise.race([
            new Promise<void>(resolve => {
              G.raceGoResolve = resolve;
              if (G.raceReadyCount >= guestCount) resolve();
            }),
            new Promise<void>(resolve => setTimeout(resolve, 10000)),
          ]);
          G.raceGoResolve = null;
        }
        G.netPeer.broadcastEvent(EventType.RACE_GO, {});
      } else {
        G.netPeer.broadcastEvent(EventType.RACE_READY, {});
        await Promise.race([
          new Promise<void>(resolve => { G.raceGoResolve = resolve; }),
          new Promise<void>(resolve => setTimeout(resolve, 10000)),
        ]);
        G.raceGoResolve = null;
      }
    }

    playCountdownRevs();
    await runCountdown(uiOverlay);
    stopCountdownRevs();
    playGameMusic();

    resetRaceStats();
    G.raceEngine.start();
    G.replayRecorder = new ReplayRecorder();
    G.replayRecorder.start();
    G.gameState = GameState.RACING;

    const ghostData = loadGhostForSeed(G.currentRaceSeed);
    if (ghostData) {
      startGhostPlayback(getScene(), ghostData);
    }
    startGhostRecording(G.playerVehicle.group.position, G.playerVehicle.heading);
  } finally {
    G.raceStarting = false;
  }
}
