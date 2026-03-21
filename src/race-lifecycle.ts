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
import { getScene, applyEnvironment, getEnvironmentForSeed, getEnvironmentByName, applyWeatherSkyDarkening, isWebGPUBackend, updateGroundDistanceField } from './scene';
import { loadCarModel } from './loaders';
import { generateTrack, buildCheckpointMarkers } from './track';
import { destroyScenery } from './track-scenery';
import { Vehicle } from './vehicle';
import { VehicleCamera, setCameraControlsActive } from './vehicle-camera';
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
import { resetGameLoopState } from './game-loop';
import { cleanupScreenEffects } from './screen-effects';
import { setExplosionMode, initPostFX, initAfterimage } from './post-fx';
import { loadGhostForSeed, startGhostPlayback, startGhostRecording, destroyGhost } from './ghost';
import { initRapierWorld, addBarrierCollider, addCarBody, destroyRapierWorld } from './rapier-world';
import { rollbackManager } from './rollback-netcode';
import { resetResultsShowing } from './results-screen';
import { showTouchControls, resetInput } from './input';
import { getSettings } from './settings';
import { ReplayRecorder } from './replay';
import { getWeatherForSeed, initWeather, applyWetRoad, destroyWeather, getCurrentWeather } from './weather';
import { showLoading, hideLoading, updateLoadingProgress } from './ui-screens';
import { destroyLeaderboard, cleanupGameLoopDOM } from './game-loop';
import { destroySpectateHUD } from './spectator';
import { raceTracker } from './resource-tracker';

/** F1-style staggered starting grid — slot 0 = pole (player / host) */
const GRID_SLOTS: ReadonlyArray<{ t: number; lane: number }> = [
  { t: 0.000, lane: -3.0 },   // P1 — pole
  { t: 0.006, lane:  3.0 },   // P2
  { t: 0.012, lane: -3.0 },   // P3
  { t: 0.018, lane:  3.0 },   // P4
  { t: 0.024, lane: -3.0 },   // P5
  { t: 0.030, lane:  3.0 },   // P6
];

function gridSlot(index: number) {
  return GRID_SLOTS[index] ?? { t: 0.006 * index, lane: index % 2 === 0 ? -3.0 : 3.0 };
}

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

// Export for use in other modules
export { disposeMesh, disposeMaterial };

// Bug #6 fix: AbortController for startRace() cancellation
let _raceAbort: AbortController | null = null;

export function clearRaceObjects() {
  _raceAbort?.abort(); // Bug #6: cancel any in-flight startRace() promises
  setCameraControlsActive(false); // Bug #23: disable chase camera controls outside race
  resetResultsShowing(); // Audit fix #10: clear re-entry guard for next race
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
    G.playerVehicle.dispose(); // Bug #9: dispose wheel/fragment GPU resources
    scene.remove(G.playerVehicle.group);
    disposeMesh(G.playerVehicle.group);
    G.playerVehicle = null;
  }

  for (const ai of G.aiRacers) {
    ai.vehicle.dispose(); // Bug #9: dispose wheel/fragment GPU resources
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
  cleanupGameLoopDOM();

  if (G.debugEl) { G.debugEl.remove(); G.debugEl = null; }

  G.driftSfxCooldown = 0;
  G.lbLastUpdate = 0;
  G.spectateTargetId = null;
  destroySpectateHUD();

  // Safety-net: dispose any tracked GPU resources that individual cleanup missed
  raceTracker.disposeAll(scene);
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
  // AI racers fill grid slots 1..N (slot 0 = player)

  console.log(`[spawnAI] G.aiCount=${G.aiCount}, spawning ${aiCars.length} AI racers`);

  // Download all AI car models in parallel (was sequential — 3-4× faster)
  const aiModels = await Promise.all(
    aiCars.map(def =>
      loadCarModel(def.file).catch(err => {
        console.warn('[race-lifecycle] Failed to load AI model:', def.file, err);
        return null;
      })
    )
  );

  const AI_NAMES = ['SHADOW', 'BLAZE', 'NITRO', 'GHOST', 'VIPER', 'STORM', 'RAZOR', 'DRIFT', 'FURY', 'ACE', 'NOVA'];

  for (let i = 0; i < aiCars.length; i++) {
    const model = aiModels[i];
    if (!model) continue; // skip failed loads

    const def = aiCars[i];
    const ai = new AIRacer(`ai_${i}`, { ...def }, i);
    ai.applyDifficulty(G.aiDifficulty);
    const slot = gridSlot(i + 1);
    G.raceEngine!.addRacer(`ai_${i}`, slot.t);

    model.position.set(0, 0, 0);
    model.scale.setScalar(1);
    model.rotation.set(0, 0, 0);
    ai.vehicle.setModel(model, renderer, camera, scene);

    ai.vehicle.setRoadMesh(G.trackData!.roadMesh, [G.trackData!.rampGroup]);
    ai.place(G.trackData!.spline, slot.t, slot.lane, G.trackData!.bvh);
    ai.setSpeedProfile(G.trackData!.speedProfile);
    scene.add(ai.vehicle.group);
    createUnderglow(ai.vehicle.group, i + 1);

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

  for (let ri = 0; ri < allPlayers.length; ri++) {
    const player = allPlayers[ri];
    if (G.remoteMeshes.has(player.id)) continue;

    // Place remote car at its correct grid slot (host=0, guests=1..N)
    const remoteSlotIdx = G.mpPlayersList.findIndex(p => p.id === player.id);
    const slot = gridSlot(remoteSlotIdx >= 0 ? remoteSlotIdx : ri + 1);

    const def = CAR_ROSTER.find(c => c.id === player.carId) ?? CAR_ROSTER[0];
    try {
      const model = await loadCarModel(def.file);
      const pt = G.trackData.spline.getPointAt(slot.t);
      const tangent = G.trackData.spline.getTangentAt(slot.t).normalize();
      const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      model.position.copy(pt);
      model.position.x += right.x * slot.lane;
      model.position.z += right.z * slot.lane;

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
    const envName = G._selectedEnvironment && G._selectedEnvironment !== 'random'
      ? G._selectedEnvironment : undefined;
    showLoading(envName);

    clearRaceObjects();

    // Bug #6 fix: create AbortController AFTER clearRaceObjects()
    // (clearRaceObjects aborts the previous controller, so we must create ours after)
    _raceAbort = new AbortController();
    const signal = _raceAbort.signal;
    const checkAbort = () => {
      if (signal.aborted) throw new DOMException('Race cancelled', 'AbortError');
    };
    resetInput(); // BUG-11 fix: zero out any stuck keys from previous race
    G.physicsAccumulator = 0;
    resetTimeScale();
    resetGameLoopState();
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
    updateLoadingProgress(10, 'BUILDING WORLD');

    const selectedW = G._selectedWeather;
    const weatherType = (selectedW && selectedW !== 'random')
      ? selectedW as any
      : getWeatherForSeed(seed, envPreset.name);
    initWeather(scene, weatherType);

    // Weather darkening (applied to whatever environment the player chose)
    const w = getCurrentWeather();
    applyWeatherSkyDarkening(w);

    // ── Now generate the track (scenery will use the correct theme) ──
    if (G._customTrack) {
      G.trackData = G._customTrack;
      G._customTrack = null;
      G.currentRaceSeed = 0;
    } else {
      G.currentRaceSeed = seed;
      G.trackSeed = null;
      G.trackData = generateTrack(seed);
      updateLoadingProgress(25, 'LOADING VEHICLES');
    }
    checkAbort(); // Bug #6: bail if cancelled during track gen
    const trackData = G.trackData!;

    // Bind distance field for ground zone blending
    if (trackData.distanceField) {
      updateGroundDistanceField(trackData.distanceField);
    }

    if (w !== 'clear') applyWetRoad(trackData.roadMesh);
    // Track all major scene objects for safety-net disposal
    raceTracker.track(trackData.roadMesh);
    raceTracker.track(trackData.barrierLeft);
    raceTracker.track(trackData.barrierRight);
    raceTracker.track(trackData.shoulderMesh);
    raceTracker.track(trackData.kerbGroup);
    raceTracker.track(trackData.sceneryGroup);
    raceTracker.track(trackData.rampGroup);
    scene.add(trackData.roadMesh);
    scene.add(trackData.barrierLeft);
    scene.add(trackData.barrierRight);
    scene.add(trackData.shoulderMesh);
    scene.add(trackData.kerbGroup);
    scene.add(trackData.sceneryGroup);
    scene.add(trackData.rampGroup);

    G.checkpointMarkers = buildCheckpointMarkers(trackData.checkpoints);
    raceTracker.track(G.checkpointMarkers);
    scene.add(G.checkpointMarkers);

    G.raceEngine = new RaceEngine(trackData.checkpoints, G.totalLaps, trackData.totalLength);

    // ── Parallel init: kick off independent async work simultaneously ──
    // Player model download, Rapier WASM init, and GPU particles have zero
    // cross-dependencies — run them all at once instead of sequentially.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const useWebGPU = isWebGPUBackend();

    updateLoadingProgress(35, 'LOADING VEHICLES');
    const [playerModel, rapierReady] = await Promise.all([
      loadCarModel(G.selectedCar.file),
      // Rapier WASM init runs in parallel with model download
      (!isIOS ? initRapierWorld().catch(e => {
        console.warn('[Rapier] WASM init failed, running without enhanced collision:', e);
        return null;
      }) : Promise.resolve(null)),
    ]);
    checkAbort(); // Bug #6: bail if cancelled during model load
    playerModel.position.set(0, 0, 0);
    playerModel.scale.setScalar(1);
    playerModel.rotation.set(0, 0, 0);
    G.playerVehicle = new Vehicle(G.selectedCar);
    G.playerVehicle.setModel(playerModel, renderer, camera, scene);
    const paintHue = getSettings().paintHue;
    if (paintHue >= 0) G.playerVehicle.setPaintColor(paintHue);
    scene.add(G.playerVehicle.group);
    G.playerVehicle.setRoadMesh(trackData.roadMesh, [trackData.rampGroup]);
    // Compute this player's grid slot: host/SP = 0 (pole), guest = list index
    let mySlotIdx = 0;
    if (G.netPeer && !G.netPeer.getIsHost()) {
      const localId = G.netPeer.getLocalId();
      mySlotIdx = G.mpPlayersList.findIndex(p => p.id === localId);
      if (mySlotIdx < 0) mySlotIdx = 1;
    }
    const mySlot = gridSlot(mySlotIdx);
    G.playerVehicle.placeOnTrack(trackData.spline, mySlot.t, mySlot.lane);
    G._playerUnderglow = createUnderglow(G.playerVehicle.group, 0);
    G.raceEngine.addRacer('local', mySlot.t);

    G.vehicleCamera = new VehicleCamera(camera);

    // ── Kick off AI spawn early so model downloads overlap with VFX init ──
    updateLoadingProgress(50, 'INITIALIZING VFX');
    const aiSpawnPromise = !G.netPeer ? spawnAI(trackData) : Promise.resolve();
    // GPU particles can also init in parallel with VFX warmup
    const gpuParticlesPromise = useWebGPU
      ? initGPUParticles(renderer, scene).catch(e => { console.warn('[GPU Particles] Init failed:', e); })
      : Promise.resolve();

    // ── Sync VFX inits (CPU-only, ~instant) — run while downloads happen ──
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

    // PostFX (sync — doesn't need await)
    if (useWebGPU) {
      try {
        G.postFXPipeline = initPostFX(renderer, scene, camera);
        initAfterimage(renderer.domElement as HTMLCanvasElement);
        G.postFXPipeline.render();
      } catch (e) {
        console.warn('[PostFX] Pipeline init failed, rendering without post-processing:', e);
        G.postFXPipeline = null;
      }
    } else {
      console.log('[PostFX] Skipped — WebGL2 fallback mode');
      G.postFXPipeline = null;
    }

    // ── Wait for parallel work to finish ──
    updateLoadingProgress(70, 'PHYSICS ENGINE');
    await gpuParticlesPromise;

    // Rapier: add colliders now that both Rapier and player vehicle are ready
    if (rapierReady !== null && !isIOS) {
      try {
        addBarrierCollider(trackData.barrierLeft);
        addBarrierCollider(trackData.barrierRight);
        const playerPos = G.playerVehicle.group.position;
        addCarBody('local', playerPos.x, playerPos.y, playerPos.z, G.playerVehicle.heading);
      } catch (e) {
        console.warn('[Rapier] Collider setup failed:', e);
      }
    }

    updateLoadingProgress(80, 'SPAWNING RACERS');
    await aiSpawnPromise;
    checkAbort(); // Bug #6: bail if cancelled during AI spawn

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

    updateLoadingProgress(95, 'READY');
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
    setCameraControlsActive(true); // Bug #23: enable chase camera scroll/tilt controls
    initAudio();

    renderer.render(scene, camera);

    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));

    // Wait for all async scenery loads (tree GLBs, grandstand) to complete
    // before showing the scene — prevents props popping in during flyover.
    // Note: with GLB memory cache, repeat races complete this step instantly.
    const sceneryLoads = trackData.sceneryGroup.userData._asyncLoads as Promise<void>[] | undefined;
    if (sceneryLoads?.length) {
      updateLoadingProgress(98, 'FINISHING SCENERY');
      await Promise.all(sceneryLoads);
    }

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
