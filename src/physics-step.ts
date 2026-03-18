/* ── Hood Racer — Fixed-Timestep Physics Step ──
 *
 * Extracted from game-loop.ts. Contains the deterministic 60Hz physics
 * sub-step: vehicle updates, AI pathfinding, car-to-car and barrier
 * collision resolution, and collision VFX spawning.
 *
 * Called by gameLoop() in game-loop.ts via stepPhysics(dt, state).
 */

import * as THREE from 'three';
import { GameState } from './types';
import { G } from './game-context';
import { getInput } from './input';
import { getClosestSplinePoint } from './track';
import { getWeatherPhysics } from './weather';
import { resolveCarCollisions, type CarCollider } from './bvh';
import { triggerImpactFlash } from './vfx';
import { setImpactIntensity } from './post-fx';
import { playCollisionSFX } from './audio';
import {
  spawnGPUSparks, spawnGPUExplosion, spawnGPUGlassShards, spawnGPUDamageSmoke,
} from './gpu-particles';
import type { OpponentInfo } from './ai-racer';

// ── Injected dependencies (set by initPhysicsStep) ──
interface PhysicsStepDeps {
  uiOverlay: HTMLElement;
  flashDamage: (intensity: number) => void;
}

let _deps: PhysicsStepDeps;

export function initPhysicsStep(deps: PhysicsStepDeps) {
  _deps = deps;
}

/** One deterministic physics sub-step at fixed dt. Contains all gameplay simulation. */
export function stepPhysics(dt: number, s: GameState) {
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
      _deps.flashDamage(evt.impactForce / 40);
      setImpactIntensity(evt.impactForce / 40);
    }
    if (evt.idB === 'local' && G.playerVehicle) {
      G._impactDir.set(-evt.normalX, 0, -evt.normalZ);
      G.playerVehicle.applyDamage(G._impactDir, evt.impactForce);
      G.raceStats.collisionCount++;
      G.vehicleCamera?.shake(Math.min(evt.impactForce / 40, 1));
      _deps.flashDamage(evt.impactForce / 40);
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
    _deps.flashDamage(b.force / 25);
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
