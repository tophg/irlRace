/* ── Hood Racer — Vehicle Destruction Animation ── */

import * as THREE from 'three';
import { spawnGPUExplosion, spawnGPUFlame, spawnGPUDamageSmoke } from './gpu-particles';
import { fractureMesh } from './mesh-fracture';

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

// Shockwave ring + dynamic light
let shockwaveRing: THREE.Mesh | null = null;
let explosionLight: THREE.PointLight | null = null;
let scorchMark: THREE.Mesh | null = null;

// Temps to avoid allocs
const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _center = new THREE.Vector3();
const _outward = new THREE.Vector3();

/**
 * Trigger vehicle destruction — fracture model into flying fragments.
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
  // Guard against re-triggering
  if (destructionActive) return;

  destructionScene = scene;
  destructionTime = 0;
  destructionActive = true;

  // Wreck center (for fire/smoke spawning)
  vehicleGroup.getWorldPosition(_center);
  wreckPosition = _center.clone();

  // ── Phase 1: Fracture body mesh into spatial fragments ──
  const meshes: THREE.Mesh[] = [];
  bodyGroup.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry && child.visible) {
      meshes.push(child);
    }
  });

  for (const srcMesh of meshes) {
    // Use runtime fracture to split single mesh into 12 fragments (3×2×2 grid)
    const fractured = fractureMesh(srcMesh, 3, 2, 2);

    for (const frag of fractured) {
      scene.add(frag.mesh);

      // Outward blast velocity — direction from wreck center to fragment center
      _outward.copy(frag.center).sub(_center);
      const dist = _outward.length();
      _outward.normalize();

      // Close fragments (near engine) get higher blast force
      const proximity = Math.max(0.3, 1.0 - dist / 4);
      const blastForce = 4 + proximity * 10 + Math.random() * 4;

      const velocity = new THREE.Vector3(
        carVelX * 0.015 + _outward.x * blastForce + (Math.random() - 0.5) * 3,
        2 + proximity * 5 + Math.random() * 3,
        carVelZ * 0.015 + _outward.z * blastForce + (Math.random() - 0.5) * 3,
      );

      // Tumble intensity based on proximity
      const tumbleScale = 4 + proximity * 6;
      const angularVel = new THREE.Vector3(
        (Math.random() - 0.5) * tumbleScale,
        (Math.random() - 0.5) * tumbleScale * 0.7,
        (Math.random() - 0.5) * tumbleScale,
      );

      fragments.push({
        mesh: frag.mesh,
        velocity,
        angularVel,
        grounded: false,
        lifetime: 0,
        maxLife: 5 + Math.random() * 3,
        originalOpacity: 1.0,
      });
    }
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

  // ── Phase 3a: Shockwave ring (expanding transparent ring) ──
  const ringGeo = new THREE.RingGeometry(0.5, 1.5, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xFFCC66,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  shockwaveRing = new THREE.Mesh(ringGeo, ringMat);
  shockwaveRing.position.copy(wreckPosition!);
  shockwaveRing.position.y += 0.3;
  shockwaveRing.rotation.x = -Math.PI / 2; // flat on ground
  scene.add(shockwaveRing);

  // ── Phase 3b: Dynamic explosion point light ──
  explosionLight = new THREE.PointLight(0xFF8800, 8, 30, 2);
  explosionLight.position.copy(wreckPosition!);
  explosionLight.position.y += 1.5;
  scene.add(explosionLight);

  // ── Phase 3c: Ground scorch mark (procedural) ──
  const scorchCanvas = document.createElement('canvas');
  scorchCanvas.width = 64;
  scorchCanvas.height = 64;
  const ctx = scorchCanvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0,0,0,0.8)');
  grad.addColorStop(0.5, 'rgba(20,15,10,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const scorchTex = new THREE.CanvasTexture(scorchCanvas);
  const scorchGeo = new THREE.PlaneGeometry(7, 7);
  const scorchMat = new THREE.MeshBasicMaterial({
    map: scorchTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  scorchMark = new THREE.Mesh(scorchGeo, scorchMat);
  scorchMark.position.copy(wreckPosition!);
  scorchMark.position.y = 0.02; // just above road
  scorchMark.rotation.x = -Math.PI / 2;
  scene.add(scorchMark);
}

/**
 * Update destruction fragments — gravity, bounce, fade.
 * Also spawns sustained fire/smoke and secondary explosions.
 * Returns true if destruction is still active.
 */
export function updateDestructionFragments(dt: number): boolean {
  if (!destructionActive || fragments.length === 0) return false;

  destructionTime += dt;

  // ── Shockwave ring animation (0–0.4s) ──
  if (shockwaveRing) {
    const ringT = destructionTime / 0.4;
    if (ringT < 1) {
      const s = 1 + ringT * 29; // scale 1→30
      shockwaveRing.scale.set(s, s, 1);
      (shockwaveRing.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - ringT);
    } else {
      destructionScene?.remove(shockwaveRing);
      shockwaveRing.geometry.dispose();
      (shockwaveRing.material as THREE.Material).dispose();
      shockwaveRing = null;
    }
  }

  // ── Dynamic explosion light (flicker + decay) ──
  if (explosionLight) {
    if (destructionTime < 0.3) {
      // Initial flash decay: 8→3
      explosionLight.intensity = 8 - (destructionTime / 0.3) * 5;
    } else if (destructionTime < 4.0) {
      // Fire flicker
      explosionLight.intensity = 2.5 + Math.random() * 1.5;
      // Color cools over time: orange → deep red
      const cool = (destructionTime - 0.3) / 3.7;
      explosionLight.color.setRGB(1.0, 0.53 - cool * 0.3, 0.0);
    } else {
      destructionScene?.remove(explosionLight);
      explosionLight.dispose();
      explosionLight = null;
    }
  }

  // ── Scorch mark fade-in ──
  if (scorchMark && destructionTime < 0.6) {
    const scorchT = Math.min(1, destructionTime / 0.5);
    (scorchMark.material as THREE.MeshBasicMaterial).opacity = scorchT * 0.7;
  }

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

    // Fade out + charring/heat cooling in last 3 seconds of life
    const fadeStart = f.maxLife - 2;
    const heatCoolStart = 1.5; // emissive starts cooling after 1.5s
    if (f.lifetime > heatCoolStart) {
      const coolT = Math.min(1, (f.lifetime - heatCoolStart) / 3);
      // Cool the emissive glow
      if (Array.isArray(f.mesh.material)) {
        for (const m of f.mesh.material) {
          if ('emissiveIntensity' in m) {
            (m as any).emissiveIntensity = 0.6 * (1 - coolT);
          }
        }
      } else if ('emissiveIntensity' in (f.mesh.material as any)) {
        (f.mesh.material as any).emissiveIntensity = 0.6 * (1 - coolT);
      }
    }
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

  // ── Phase 3: Enhanced fire system ──
  if (wreckPosition) {
    // Initial fireball (first 0.5s — intense burst)
    if (destructionTime < 0.5) {
      for (let i = 0; i < 3; i++) {
        const fp = wreckPosition.clone();
        fp.y += 0.3 + Math.random() * 0.8;
        fp.x += (Math.random() - 0.5) * 1.5;
        fp.z += (Math.random() - 0.5) * 1.5;
        spawnGPUFlame(fp, 1.0, dt);
      }
      spawnGPUExplosion(wreckPosition.clone(), 8); // burst VFX
    }

    // Mushroom plume (0.3–3s — upward rising thick smoke with fire)
    if (destructionTime > 0.3 && destructionTime < 3.0) {
      const plumePos = wreckPosition.clone();
      plumePos.y += 1.0 + destructionTime * 1.5; // rises over time
      plumePos.x += (Math.random() - 0.5) * 0.8;
      plumePos.z += (Math.random() - 0.5) * 0.8;
      spawnGPUDamageSmoke(plumePos, 0.9, dt);
      if (destructionTime < 2.0) {
        spawnGPUFlame(plumePos, 0.5, dt);
      }
    }

    // Ground fire pool (0.5–5s — radial flickering flames at road level)
    if (destructionTime > 0.5 && destructionTime < 5.0) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 2.0;
      const gfp = wreckPosition.clone();
      gfp.x += Math.cos(angle) * dist;
      gfp.z += Math.sin(angle) * dist;
      gfp.y += 0.1;
      spawnGPUFlame(gfp, 0.6 + Math.random() * 0.3, dt);
      spawnGPUDamageSmoke(gfp, 0.4, dt);
    }

    // Ember rain (1–6s — slow-falling tiny glowing particles)
    if (destructionTime > 1.0 && destructionTime < 6.0) {
      const ep = wreckPosition.clone();
      ep.y += 2 + Math.random() * 3;
      ep.x += (Math.random() - 0.5) * 4;
      ep.z += (Math.random() - 0.5) * 4;
      spawnGPUFlame(ep, 0.2, dt); // tiny ember
    }
  }

  // Secondary explosions (larger, more dramatic)
  if (wreckPosition) {
    if (destructionTime >= 1.0 && destructionTime < 1.0 + dt * 2) {
      const p = wreckPosition.clone();
      p.x += (Math.random() - 0.5) * 3;
      p.y += 0.8;
      spawnGPUExplosion(p, 25);
    }
    if (destructionTime >= 2.5 && destructionTime < 2.5 + dt * 2) {
      const p = wreckPosition.clone();
      p.z += (Math.random() - 0.5) * 3;
      p.y += 0.5;
      spawnGPUExplosion(p, 18);
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

  // Clean up shockwave ring
  if (shockwaveRing) {
    destructionScene?.remove(shockwaveRing);
    shockwaveRing.geometry.dispose();
    (shockwaveRing.material as THREE.Material).dispose();
    shockwaveRing = null;
  }

  // Clean up explosion light
  if (explosionLight) {
    destructionScene?.remove(explosionLight);
    explosionLight.dispose();
    explosionLight = null;
  }

  // Clean up scorch mark
  if (scorchMark) {
    destructionScene?.remove(scorchMark);
    scorchMark.geometry.dispose();
    const mat = scorchMark.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    scorchMark = null;
  }

  destructionActive = false;
  destructionTime = 0;
  wreckPosition = null;
  destructionScene = null;
}
