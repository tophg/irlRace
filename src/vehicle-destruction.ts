/* ── Hood Racer — Vehicle Destruction Animation ── */

import * as THREE from 'three';
import { spawnGPUExplosion, spawnGPUFlame, spawnGPUDamageSmoke } from './gpu-particles';

// ── Fragment System ──

interface DestructionFragment {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  angularVel: THREE.Vector3;
  grounded: boolean;
  lifetime: number;
  maxLife: number;
  originalOpacity: number;
}

const fragments: DestructionFragment[] = [];
let destructionScene: THREE.Scene | null = null;
let wreckPosition: THREE.Vector3 | null = null;
let destructionTime = 0;
let destructionActive = false;

// Temps to avoid allocs
const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _center = new THREE.Vector3();
const _outward = new THREE.Vector3();

/**
 * Trigger vehicle destruction — decompose model into flying fragments.
 * Call once when engine explodes.
 */
export function triggerVehicleDestruction(
  bodyGroup: THREE.Group,
  vehicleGroup: THREE.Group,
  scene: THREE.Scene,
  carVelX: number,
  carVelZ: number,
  wheels: (THREE.Mesh | null)[],
) {
  destructionScene = scene;
  destructionTime = 0;
  destructionActive = true;

  // Wreck center (for fire/smoke spawning)
  vehicleGroup.getWorldPosition(_center);
  wreckPosition = _center.clone();

  // ── Phase 1: Decompose body model into fragments ──
  const meshes: THREE.Mesh[] = [];
  bodyGroup.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      meshes.push(child);
    }
  });

  for (const srcMesh of meshes) {
    // Get world transform
    srcMesh.getWorldPosition(_worldPos);
    srcMesh.getWorldQuaternion(_worldQuat);

    // Clone mesh for independent scene-level fragment
    const frag = srcMesh.clone();
    frag.position.copy(_worldPos);
    frag.quaternion.copy(_worldQuat);

    // Make material transparent for fade-out later
    if (Array.isArray(frag.material)) {
      frag.material = frag.material.map(m => {
        const c = m.clone();
        c.transparent = true;
        return c;
      });
    } else {
      frag.material = frag.material.clone();
      (frag.material as THREE.Material).transparent = true;
    }

    scene.add(frag);

    // Outward blast velocity
    _outward.copy(_worldPos).sub(_center).normalize();
    const blastForce = 6 + Math.random() * 8;
    const velocity = new THREE.Vector3(
      carVelX * 0.015 + _outward.x * blastForce + (Math.random() - 0.5) * 3,
      3 + Math.random() * 6,
      carVelZ * 0.015 + _outward.z * blastForce + (Math.random() - 0.5) * 3,
    );

    // Random tumble
    const angularVel = new THREE.Vector3(
      (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 8,
    );

    fragments.push({
      mesh: frag,
      velocity,
      angularVel,
      grounded: false,
      lifetime: 0,
      maxLife: 6 + Math.random() * 3,
      originalOpacity: 1.0,
    });
  }

  // ── Phase 2: Detach wheels ──
  for (const wheel of wheels) {
    if (!wheel) continue;
    wheel.getWorldPosition(_worldPos);

    // Clone wheel into scene
    const wheelFrag = wheel.clone();
    wheelFrag.position.copy(_worldPos);

    // Make transparent for later fade
    wheelFrag.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material = child.material.map(m => {
            const c = m.clone();
            c.transparent = true;
            return c;
          });
        } else {
          child.material = child.material.clone();
          (child.material as THREE.Material).transparent = true;
        }
      }
    });

    scene.add(wheelFrag);

    // Wheels fly outward and upward
    _outward.copy(_worldPos).sub(_center).normalize();
    const velocity = new THREE.Vector3(
      carVelX * 0.015 + _outward.x * 10 + (Math.random() - 0.5) * 2,
      4 + Math.random() * 5,
      carVelZ * 0.015 + _outward.z * 10 + (Math.random() - 0.5) * 2,
    );

    fragments.push({
      mesh: wheelFrag,
      velocity,
      angularVel: new THREE.Vector3(
        (Math.random() - 0.5) * 15, // fast spin
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 15,
      ),
      grounded: false,
      lifetime: 0,
      maxLife: 7,
      originalOpacity: 1.0,
    });

    // Hide original wheel
    wheel.visible = false;
  }

  // Hide the original body
  bodyGroup.visible = false;
}

/**
 * Update destruction fragments — gravity, bounce, fade.
 * Also spawns sustained fire/smoke and secondary explosions.
 * Returns true if destruction is still active.
 */
export function updateDestructionFragments(dt: number): boolean {
  if (!destructionActive || fragments.length === 0) return false;

  destructionTime += dt;

  // ── Update fragment physics ──
  for (let i = fragments.length - 1; i >= 0; i--) {
    const f = fragments[i];
    f.lifetime += dt;

    if (f.lifetime >= f.maxLife) {
      // Remove fragment
      if (destructionScene) destructionScene.remove(f.mesh);
      f.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
        }
      });
      fragments.splice(i, 1);
      continue;
    }

    if (!f.grounded) {
      // Gravity
      f.velocity.y -= 9.8 * dt;

      // Move
      f.mesh.position.x += f.velocity.x * dt;
      f.mesh.position.y += f.velocity.y * dt;
      f.mesh.position.z += f.velocity.z * dt;

      // Tumble
      f.mesh.rotation.x += f.angularVel.x * dt;
      f.mesh.rotation.y += f.angularVel.y * dt;
      f.mesh.rotation.z += f.angularVel.z * dt;

      // Ground bounce
      if (f.mesh.position.y <= 0.15) {
        f.mesh.position.y = 0.15;
        f.velocity.y *= -0.25; // damped bounce
        f.velocity.x *= 0.7;
        f.velocity.z *= 0.7;
        f.angularVel.multiplyScalar(0.5);

        // Consider grounded if bounce is very small
        if (Math.abs(f.velocity.y) < 0.5) {
          f.grounded = true;
          f.velocity.set(0, 0, 0);
          f.angularVel.set(0, 0, 0);
        }
      }
    }

    // Fade out in last 2 seconds of life
    const fadeStart = f.maxLife - 2;
    if (f.lifetime > fadeStart) {
      const fadeT = 1 - (f.lifetime - fadeStart) / 2;
      const opacity = Math.max(0, fadeT * f.originalOpacity);
      if (Array.isArray(f.mesh.material)) {
        for (const m of f.mesh.material) {
          (m as THREE.Material).opacity = opacity;
        }
      } else {
        (f.mesh.material as THREE.Material).opacity = opacity;
      }
    }
  }

  // ── Phase 3: Sustained fire + smoke at wreck position ──
  if (wreckPosition && destructionTime < 5) {
    const firePos = wreckPosition.clone();
    firePos.y += 0.5 + Math.random() * 0.5;
    // Add slight random spread
    firePos.x += (Math.random() - 0.5) * 1.5;
    firePos.z += (Math.random() - 0.5) * 1.5;

    spawnGPUFlame(firePos, 0.8 + Math.random() * 0.2, dt);
    spawnGPUDamageSmoke(firePos, 0.6, dt);

    // Extra fire particles for intensity
    if (destructionTime < 3) {
      const firePos2 = wreckPosition.clone();
      firePos2.y += 0.3;
      firePos2.x += (Math.random() - 0.5) * 2;
      firePos2.z += (Math.random() - 0.5) * 2;
      spawnGPUFlame(firePos2, 0.6, dt);
    }
  }

  // Secondary explosions
  if (wreckPosition) {
    if (destructionTime >= 1.0 && destructionTime < 1.0 + dt * 2) {
      const p = wreckPosition.clone();
      p.x += (Math.random() - 0.5) * 2;
      p.y += 0.5;
      spawnGPUExplosion(p, 20);
    }
    if (destructionTime >= 2.5 && destructionTime < 2.5 + dt * 2) {
      const p = wreckPosition.clone();
      p.z += (Math.random() - 0.5) * 2;
      p.y += 0.3;
      spawnGPUExplosion(p, 15);
    }
  }

  // Destruction complete when all fragments removed
  if (fragments.length === 0) {
    destructionActive = false;
    return false;
  }

  return true;
}

/** Get the wreck position (for camera orbit target). */
export function getWreckPosition(): THREE.Vector3 | null {
  return wreckPosition;
}

/** Check if destruction animation is active. */
export function isDestructionActive(): boolean {
  return destructionActive;
}

/** Clean up all fragments (call before next race). */
export function cleanupDestruction() {
  for (const f of fragments) {
    if (destructionScene) destructionScene.remove(f.mesh);
    f.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
      }
    });
  }
  fragments.length = 0;
  destructionActive = false;
  destructionTime = 0;
  wreckPosition = null;
  destructionScene = null;
}
