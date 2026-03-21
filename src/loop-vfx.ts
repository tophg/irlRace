/* ── IRL Race — Game Loop VFX Subsystem ──
 *
 * All per-frame visual effects extracted from game-loop.ts.
 * Called once per frame during RACING/FLYOVER/RESULTS states.
 */

import * as THREE from 'three/webgpu';
import { GameState } from './types';
import { G } from './game-context';
import { getScene } from './scene';

// VFX imports
import {
  spawnTireSmoke, updateVFX,
  updateSpeedLines,
  updateBoostFlame,
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
import { updateDestructionFragments, triggerVehicleDestruction, isDestructionActive } from './vehicle-destruction';
import { updateWeather, getCurrentWeather, getPrecipMesh, getWeatherPhysics } from './weather';
import { setImpactIntensity, setBoostActive, setExplosionMode, updateAfterimage, updatePostFX } from './post-fx';
import { showExplosionFlash, showDamageFlash, showLetterbox, hideLetterbox, showEngineDestroyedText } from './screen-effects';
import { sampleGhostFrame, updateGhostPlayback } from './ghost';

// ── Reusable temps ──
const _rPos = new THREE.Vector3();
const _hoodExplosionPos = new THREE.Vector3();
const _nitroTrailOffset = new THREE.Vector3();
const _swayQuat = new THREE.Quaternion();
const _swayAxis = new THREE.Vector3(0, 0, 1);

// ── Speed lines overlay ──
let _speedLinesEl: HTMLDivElement | null = null;
function _ensureSpeedLines(): HTMLDivElement {
  if (!_speedLinesEl) {
    _speedLinesEl = document.createElement('div');
    _speedLinesEl.className = 'speed-lines-overlay';
    document.body.appendChild(_speedLinesEl);
  }
  return _speedLinesEl;
}

// ── Explosion state ──
let _explosionRaceGen = 0;
let _explosionTimers: number[] = [];

// ── Nitro transition tracking ──
let _firstBoostFired = false;

/** Increment explosion generation to invalidate stale callbacks on race restart. */
export function resetVFXState() {
  _explosionRaceGen++;
  for (const id of _explosionTimers) clearTimeout(id);
  _explosionTimers = [];
  _firstBoostFired = false;
  if (_speedLinesEl) { _speedLinesEl.remove(); _speedLinesEl = null; }
}

/** Clean up speed lines DOM node. */
export function cleanupVFXDOM() {
  for (const id of _explosionTimers) clearTimeout(id);
  _explosionTimers = [];
  if (_speedLinesEl) { _speedLinesEl.remove(); _speedLinesEl = null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SLIPSTREAM DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Drafting indicator overlay. */
let _draftingEl: HTMLDivElement | null = null;
let _draftingTimer = 0;

function showDraftingIndicator(uiOverlay: HTMLElement) {
  if (!_draftingEl) {
    _draftingEl = document.createElement('div');
    _draftingEl.className = 'drafting-indicator';
    _draftingEl.textContent = 'DRAFTING';
    uiOverlay.appendChild(_draftingEl);
  }
  _draftingEl.style.opacity = '1';
  clearTimeout(_draftingTimer);
  _draftingTimer = window.setTimeout(() => {
    if (_draftingEl) _draftingEl.style.opacity = '0';
  }, 300);
}

export function cleanupDraftingDOM() {
  clearTimeout(_draftingTimer);
  if (_draftingEl) { _draftingEl.remove(); _draftingEl = null; }
}

export function updateSlipstream(gameDt: number, uiOverlay: HTMLElement) {
  if (!G.playerVehicle || !G.vehicleCamera) return;
  if (G.gameState !== GameState.RACING || G.vehicleCamera.mode !== 'chase') return;

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
        showDraftingIndicator(uiOverlay);
      }
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENGINE EXPLOSION CINEMATIC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function updateExplosionVFX(
  s: GameState, frameDt: number,
  callShowResults: () => void,
) {
  if (!G.playerVehicle?.engineJustExploded) return;

  const gen = _explosionRaceGen;
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

  // Phase 2
  requestAnimationFrame(() => {
    if (gen !== _explosionRaceGen) return;
    spawnGPUFireballWave(expPos);
    if (isRacing) {
      triggerVehicleDestruction(bodyRef, vGroup, getScene(), pvx, pvz, wheelRefs, cachedFrags);
      if (G.playerVehicle) G.playerVehicle.destroyed = true;
    }

    // Phase 3
    requestAnimationFrame(() => {
      if (gen !== _explosionRaceGen) return;
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
          if (gen !== _explosionRaceGen) return;
          showEngineDestroyedText();
        }, 800));
        _explosionTimers.push(window.setTimeout(() => {
          if (gen !== _explosionRaceGen) return;
          hideLetterbox(); setExplosionMode(false);
        }, 3500));
        _explosionTimers.push(window.setTimeout(() => {
          if (gen !== _explosionRaceGen) return;
          callShowResults();
        }, 4000));
      }

      // Phase 4
      requestAnimationFrame(() => {
        if (gen !== _explosionRaceGen) return;
        spawnDebris(expPos, 35, pvx, pvz);
      });
    });
  });

  // Delayed secondary explosions
  _explosionTimers.push(window.setTimeout(() => spawnGPUSecondaryExplosion(expPos), 300));
  _explosionTimers.push(window.setTimeout(() => spawnGPUSecondaryExplosion(expPos), 800));

  if (isRacing) {
    G.raceEngine!.markDnf('local');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DAMAGE FLASH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

export function cleanupDamageFlashDOM() {
  clearTimeout(_damageFlashTimer);
  if (_damageFlashEl) { _damageFlashEl.remove(); _damageFlashEl = null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PER-FRAME VFX
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Landing VFX — dust + camera impact. */
export function updateLandingVFX() {
  if (!G.playerVehicle?.justLanded) return;
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

/** Hood smoke/flames at high engine heat. */
export function updateHoodSmoke(frameDt: number) {
  if (!G.playerVehicle) return;
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
}

/** Tire smoke, skid marks, ghost recording/playback. */
export function updateTireAndSkidVFX(s: GameState, frameDt: number) {
  if (!G.playerVehicle) return;
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
}

/** Per-frame damage zone smoke + tire blowout detection. */
export function updateDamageZoneSmoke(s: GameState, frameDt: number) {
  if (s !== GameState.RACING || !G.playerVehicle) return;
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

/** GPU particle flush + update. */
export function updateParticles(renderer: THREE.WebGPURenderer, gameDt: number) {
  flushToGPU();
  updateGPUParticles(renderer, gameDt);
}

/** Weather VFX: rain droplets, wet tire spray (player + AI), wind camera sway. */
export function updateWeatherEffects(
  renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera,
  gameDt: number, frameDt: number, s: GameState,
) {
  if (!G.playerVehicle) return;
  updateWeather(gameDt, G.playerVehicle.group.position);

  const weatherType = getCurrentWeather();
  const rainIntensity = weatherType === 'heavy_rain' ? 0.5 : weatherType === 'light_rain' ? 0.25 : 0;
  updateRainDroplets(rainIntensity, frameDt);

  // Wet tire spray
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

/** Underglow, boost flame, nitro activation/deactivation VFX (NOT audio). */
export function updateNitroVFX(
  s: GameState, camera: THREE.PerspectiveCamera,
  gameDt: number, frameDt: number, timestamp: number,
) {
  if (!G.playerVehicle) return;

  updateImpactFlash(frameDt);

  // Underglow
  if (G._playerUnderglow) {
    updateUnderglow(G._playerUnderglow, G.playerVehicle.speed, timestamp / 1000, G.playerVehicle.isNitroActive);
  }
  updateBoostFlame(s === GameState.RACING && G.playerVehicle.isNitroActive, G.playerVehicle.group.position, G.playerVehicle.heading, timestamp / 1000, G.playerVehicle.engineHeat, gameDt);

  // Nitro activation VFX
  const isNitroNow = s === GameState.RACING && G.playerVehicle.isNitroActive;
  if (isNitroNow && !G._wasNitroActive) {
    triggerBoostShockwave(G.playerVehicle.group.position, G.playerVehicle.heading);
    triggerBoostBurst();
    _ensureSpeedLines()?.classList.add('active');
  }
  if (!isNitroNow && G._wasNitroActive) {
    triggerBackfireSequence(G.playerVehicle.group.position, G.playerVehicle.heading);
    _ensureSpeedLines()?.classList.remove('active');
  }
  // NOTE: G._wasNitroActive is set by the caller after audio update

  updateBoostShockwave(frameDt);

  // Nitro FOV punch
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
  // Clear explosion flag AFTER shake read
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
}

/** Near-miss detection against AI vehicles. */
export function updateNearMissDetection(
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

/** Miscellaneous per-frame VFX updates. */
export function updateMiscVFX(
  camera: THREE.PerspectiveCamera, timestamp: number, frameDt: number,
) {
  updateLensFlares(camera.position, timestamp / 1000);
  updateLightning(frameDt);
  updateVictoryConfetti(frameDt);

  if (!G.playerVehicle) return;
  const speedRatioForLines = Math.abs(G.playerVehicle.speed) / G.selectedCar.maxSpeed;
  const nitroForLines = G.playerVehicle.isNitroActive;
  if (speedRatioForLines > 0.3 || nitroForLines) updateSpeedLines(speedRatioForLines, nitroForLines);
}

/** Damage smoke + flames + detached parts. */
export function updateDamageAndParts(scene: THREE.Scene, frameDt: number) {
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
export function updateDetachedPartsPhysics(scene: THREE.Scene, frameDt: number) {
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

/** Post-FX render pass + afterimage. */
export function updateRenderPass(
  renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
  gameDt: number,
) {
  if (!G.playerVehicle) {
    renderer.render(scene, camera);
    return;
  }
  if (G.postFXPipeline) {
    const speedRatio = Math.abs(G.playerVehicle.speed) / G.playerVehicle.def.maxSpeed;
    const isNitro = G.playerVehicle.isNitroActive;
    updatePostFX(Math.min(speedRatio, 1), isNitro, gameDt);
    if (isNitro) setBoostActive(true);
    else setBoostActive(false);
    G.postFXPipeline.render();
  } else {
    renderer.render(scene, camera);
  }
  updateAfterimage();
}

export { updateDestructionFragments };
