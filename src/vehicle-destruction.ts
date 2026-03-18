/* ── Hood Racer — Vehicle Destruction Animation ── */

import * as THREE from 'three';
import { spawnGPUExplosion, spawnGPUFlame, spawnGPUDamageSmoke, spawnExplosionDust, spawnGPUSparks } from './gpu-particles';
import { fractureMesh, type MeshFragment } from './mesh-fracture';

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

let activeFragCount = 0;  // how many pool slots are active this explosion
let destructionScene: THREE.Scene | null = null;
const _wreckPos = new THREE.Vector3();   // reusable — no .clone() at detonation
let wreckPosition: THREE.Vector3 | null = null;
let destructionTime = 0;
let destructionActive = false;
let _destructionFrame = 0;

// ── Pre-allocated fragment/wheel mesh pool ──
const FRAG_POOL_SIZE = 12;
const WHEEL_POOL_SIZE = 4;
const TOTAL_POOL = FRAG_POOL_SIZE + WHEEL_POOL_SIZE;
const _fragPool: DestructionFragment[] = [];  // pre-allocated, reused each explosion
const _poolMeshes: THREE.Mesh[] = [];         // pre-created mesh shells (stay in scene)
let _poolReady = false;
let _poolPreWarmed = false; // true if pool meshes already have real fragment geometry
const _dummyGeo = new THREE.BufferGeometry(); // placeholder for idle pool meshes
const _lastEmissive = new Float32Array(FRAG_POOL_SIZE + WHEEL_POOL_SIZE); // cached emissive per fragment (Fix E)

// ── Pre-allocated explosion assets (created once, recycled across explosions) ──
let _ringGeo: THREE.RingGeometry | null = null;
let _ringMat: THREE.MeshBasicMaterial | null = null;
let _ringMesh: THREE.Mesh | null = null;
let _scorchGeo: THREE.PlaneGeometry | null = null;
let _scorchMat: THREE.MeshBasicMaterial | null = null;
let _scorchMesh: THREE.Mesh | null = null;
let _expLight: THREE.PointLight | null = null;
let _assetsWarmed = false;

// Runtime references (point to pre-allocated objects during active destruction)
let shockwaveRing: THREE.Mesh | null = null;
let explosionLight: THREE.PointLight | null = null;
let scorchMark: THREE.Mesh | null = null;

// Temps to avoid allocs
const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _center = new THREE.Vector3();
const _outward = new THREE.Vector3();
const _firePos = new THREE.Vector3();
const _dustPos = new THREE.Vector3(); // reusable temp for deferred dust spawn

// Pre-built scorch texture (created once at module load, not at explosion time)
const _scorchCanvas = document.createElement('canvas');
_scorchCanvas.width = 64;
_scorchCanvas.height = 64;
const _sctx = _scorchCanvas.getContext('2d')!;
const _sgrad = _sctx.createRadialGradient(32, 32, 2, 32, 32, 30);
_sgrad.addColorStop(0, 'rgba(0,0,0,0.8)');
_sgrad.addColorStop(0.5, 'rgba(20,15,10,0.5)');
_sgrad.addColorStop(1, 'rgba(0,0,0,0)');
_sctx.fillStyle = _sgrad;
_sctx.fillRect(0, 0, 64, 64);
const _scorchTexture = new THREE.CanvasTexture(_scorchCanvas);

/**
 * Pre-allocate and shader-warm all explosion assets.
 * Call once at race init (after scene + renderer + camera are ready).
 * This eliminates the WebGPU pipeline compilation stall at detonation time.
 */
export function warmupDestruction(
  scene: THREE.Scene,
  renderer: { compile: (scene: THREE.Scene, camera: THREE.Camera) => void },
  camera: THREE.Camera,
) {
  if (_assetsWarmed) return;

  // Shockwave ring — pre-create geometry + material
  _ringGeo = new THREE.RingGeometry(0.5, 1.5, 32);
  _ringMat = new THREE.MeshBasicMaterial({
    color: 0xFFCC66,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  _ringMesh = new THREE.Mesh(_ringGeo, _ringMat);
  _ringMesh.rotation.x = -Math.PI / 2;
  _ringMesh.visible = false;
  scene.add(_ringMesh);

  // Scorch mark — pre-create geometry + material
  _scorchGeo = new THREE.PlaneGeometry(7, 7);
  _scorchMat = new THREE.MeshBasicMaterial({
    map: _scorchTexture,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  _scorchMesh = new THREE.Mesh(_scorchGeo, _scorchMat);
  _scorchMesh.rotation.x = -Math.PI / 2;
  _scorchMesh.visible = false;
  scene.add(_scorchMesh);

  // Explosion point light — pre-create with zero intensity
  _expLight = new THREE.PointLight(0xFF8800, 0, 30, 2);
  _expLight.visible = false;
  scene.add(_expLight);

  // ── Pre-allocate fragment/wheel mesh pool ──
  if (!_poolReady) {
    const placeholderMat = new THREE.MeshBasicMaterial({ visible: false });
    for (let i = 0; i < TOTAL_POOL; i++) {
      const mesh = new THREE.Mesh(_dummyGeo, placeholderMat);
      mesh.visible = false;
      mesh.frustumCulled = false; // fragments move fast, don't cull
      scene.add(mesh);
      _poolMeshes.push(mesh);
      _fragPool.push({
        mesh,
        velocity: new THREE.Vector3(),
        angularVel: new THREE.Vector3(),
        grounded: false,
        lifetime: 0,
        maxLife: 5,
        originalOpacity: 1.0,
      });
    }
    // Keep placeholder material alive (don't dispose — used for pool resets)
    _poolReady = true;
  }

  // Warm GPU pipelines for these materials in the ACTUAL scene
  renderer.compile(scene, camera as THREE.PerspectiveCamera);

  // Hide until needed
  _ringMesh.visible = false;
  _scorchMesh.visible = false;
  _expLight.visible = false;

  _assetsWarmed = true;
}

/**
 * Pre-warm pool meshes with REAL fragment materials in the real scene.
 * Call after vehicles load so the WebGPU pipelines for explosion fragments
 * are compiled with the exact render state (lights, env map, fog, tone mapping).
 */
export function warmupFragmentMaterials(
  fragments: { mesh: THREE.Mesh }[],
  renderer: { compile: (scene: THREE.Scene, camera: THREE.Camera) => void },
  camera: THREE.Camera,
  scene: THREE.Scene,
) {
  if (!_poolReady || fragments.length === 0) return;
  const count = Math.min(fragments.length, FRAG_POOL_SIZE);
  // Assign real fragment geometry+material to pool meshes PERMANENTLY.
  // This ensures the WebGPU pipeline compiled here matches exactly what's used
  // at explosion time — preventing synchronous pipeline recompilation (2s+ stall).
  for (let i = 0; i < count; i++) {
    _poolMeshes[i].geometry = fragments[i].mesh.geometry;
    _poolMeshes[i].material = fragments[i].mesh.material;
    _poolMeshes[i].visible = true;
    _poolMeshes[i].position.set(0, -100, 0);
    _poolMeshes[i].frustumCulled = false;
  }
  renderer.compile(scene, camera);
  // Keep fragment geometry+material on pool meshes (hidden off-screen).
  // Do NOT revert to _dummyGeo — that would change the attribute layout and
  // invalidate the compiled WebGPU pipeline, forcing recompilation at explosion.
  for (let i = 0; i < count; i++) {
    _poolMeshes[i].visible = false;
    // Keep position off-screen until explosion activates them
  }
  _poolPreWarmed = true;
}

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
  cachedFragments?: MeshFragment[],
) {
  // Guard against re-triggering
  if (destructionActive) return;

  destructionScene = scene;
  destructionTime = 0;
  destructionActive = true;
  _destructionFrame = 0;
  activeFragCount = 0;
  _lastEmissive.fill(0.6); // reset cached emissive for delta-gating

  // Wreck center (for fire/smoke spawning)
  vehicleGroup.getWorldPosition(_center);
  _wreckPos.copy(_center);
  wreckPosition = _wreckPos;

  // ── Phase 1: Assign cached fragments to pool meshes (zero alloc) ──
  if (cachedFragments && cachedFragments.length > 0 && _poolReady) {
    vehicleGroup.getWorldQuaternion(_worldQuat);
    const count = Math.min(cachedFragments.length, FRAG_POOL_SIZE);
    // Stagger visibility: first 6 immediately, rest on next frame (Fix D)
    const FIRST_BATCH = Math.min(6, count);
    for (let i = 0; i < count; i++) {
      const src = cachedFragments[i];
      const frag = _fragPool[i];
      const mesh = _poolMeshes[i];

      // Only swap geometry+material if pool wasn't pre-warmed with real fragments.
      // When pre-warmed, pool meshes already have the correct geometry+material,
      // so skip reassignment to avoid WebGPU pipeline recompilation.
      if (!_poolPreWarmed) {
        mesh.geometry = src.mesh.geometry;
        mesh.material = src.mesh.material;
      }
      mesh.position.copy(_center);
      mesh.quaternion.copy(_worldQuat);
      mesh.scale.setScalar(1);
      mesh.visible = i < FIRST_BATCH; // deferred batch stays hidden

      // Compute blast velocity into pre-allocated vectors
      _outward.copy(src.center).sub(_center);
      const dist = _outward.length();
      _outward.normalize();
      const proximity = Math.max(0.3, 1.0 - dist / 4);
      const blastForce = 4 + proximity * 10 + Math.random() * 4;

      frag.velocity.set(
        carVelX * 0.015 + _outward.x * blastForce + (Math.random() - 0.5) * 3,
        2 + proximity * 5 + Math.random() * 3,
        carVelZ * 0.015 + _outward.z * blastForce + (Math.random() - 0.5) * 3,
      );
      const tumbleScale = 4 + proximity * 6;
      frag.angularVel.set(
        (Math.random() - 0.5) * tumbleScale,
        (Math.random() - 0.5) * tumbleScale * 0.7,
        (Math.random() - 0.5) * tumbleScale,
      );
      frag.grounded = false;
      frag.lifetime = 0;
      frag.maxLife = 5 + Math.random() * 3;
      frag.originalOpacity = 1.0;
      activeFragCount++;
    }
    // Show deferred batch on next frame
    if (count > FIRST_BATCH) {
      requestAnimationFrame(() => {
        for (let i = FIRST_BATCH; i < count; i++) {
          _poolMeshes[i].visible = true;
        }
      });
    }
  } else {
    // Fallback: compute at runtime (no pool available)
    const meshes: THREE.Mesh[] = [];
    bodyGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry && child.visible) {
        meshes.push(child);
      }
    });
    let fractured: MeshFragment[] = [];
    for (const srcMesh of meshes) {
      fractured.push(...fractureMesh(srcMesh, 2, 1, 1));
    }
    if (fractured.length > FRAG_POOL_SIZE) fractured.length = FRAG_POOL_SIZE;
    for (let i = 0; i < fractured.length; i++) {
      const src = fractured[i];
      if (_poolReady) {
        const mesh = _poolMeshes[i];
        mesh.geometry = src.mesh.geometry;
        mesh.material = src.mesh.material;
        mesh.position.copy(_center);
        mesh.scale.setScalar(1);
        mesh.visible = true;
      } else {
        scene.add(src.mesh);
        _fragPool.push({
          mesh: src.mesh,
          velocity: new THREE.Vector3(),
          angularVel: new THREE.Vector3(),
          grounded: false, lifetime: 0, maxLife: 5, originalOpacity: 1.0,
        });
      }
      const frag = _fragPool[i];
      _outward.copy(src.center).sub(_center);
      const dist = _outward.length();
      _outward.normalize();
      const proximity = Math.max(0.3, 1.0 - dist / 4);
      const blastForce = 4 + proximity * 10 + Math.random() * 4;
      frag.velocity.set(
        carVelX * 0.015 + _outward.x * blastForce + (Math.random() - 0.5) * 3,
        2 + proximity * 5 + Math.random() * 3,
        carVelZ * 0.015 + _outward.z * blastForce + (Math.random() - 0.5) * 3,
      );
      const tumbleScale = 4 + proximity * 6;
      frag.angularVel.set(
        (Math.random() - 0.5) * tumbleScale,
        (Math.random() - 0.5) * tumbleScale * 0.7,
        (Math.random() - 0.5) * tumbleScale,
      );
      frag.grounded = false;
      frag.lifetime = 0;
      frag.maxLife = 5 + Math.random() * 3;
      frag.originalOpacity = 1.0;
      activeFragCount++;
    }
  }

  // ── Phase 2: Detach wheels into pool slots [12..15] ──
  let wheelIdx = 0;
  for (const wheel of wheels) {
    if (!wheel || wheelIdx >= WHEEL_POOL_SIZE) continue;
    wheel.getWorldPosition(_worldPos);

    const poolSlot = FRAG_POOL_SIZE + wheelIdx;
    const frag = _fragPool[poolSlot];

    if (_poolReady) {
      const mesh = _poolMeshes[poolSlot];
      // Copy geometry + material from the wheel (always a Mesh)
      mesh.geometry = wheel.geometry;
      mesh.material = wheel.material;
      mesh.position.copy(_worldPos);
      mesh.quaternion.identity();
      mesh.scale.setScalar(1);
      mesh.visible = true;
    }

    // Wheels fly outward and upward
    _outward.copy(_worldPos).sub(_center).normalize();
    frag.velocity.set(
      carVelX * 0.015 + _outward.x * 10 + (Math.random() - 0.5) * 2,
      4 + Math.random() * 5,
      carVelZ * 0.015 + _outward.z * 10 + (Math.random() - 0.5) * 2,
    );
    frag.angularVel.set(
      (Math.random() - 0.5) * 15,
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 15,
    );
    frag.grounded = false;
    frag.lifetime = 0;
    frag.maxLife = 7;
    frag.originalOpacity = 1.0;
    activeFragCount++;
    wheelIdx++;

    // Hide original wheel
    wheel.visible = false;
  }

  // Hide the original body
  bodyGroup.visible = false;

  // ── Phase 3a: Shockwave ring (reuse pre-allocated) ──
  if (_ringMesh && _ringMat) {
    shockwaveRing = _ringMesh;
    shockwaveRing.position.copy(wreckPosition!);
    shockwaveRing.position.y += 0.3;
    shockwaveRing.scale.set(1, 1, 1);
    _ringMat.opacity = 0.7;
    shockwaveRing.visible = true;
  }

  // ── Phase 3b: Dynamic explosion point light (reuse pre-allocated) ──
  if (_expLight) {
    explosionLight = _expLight;
    explosionLight.position.copy(wreckPosition!);
    explosionLight.position.y += 1.5;
    explosionLight.intensity = 8;
    explosionLight.visible = true;
  }

  // ── Phase 3c: Ground scorch mark (reuse pre-allocated) ──
  if (_scorchMesh && _scorchMat) {
    scorchMark = _scorchMesh;
    scorchMark.position.copy(wreckPosition!);
    scorchMark.position.y = 0.02;
    _scorchMat.opacity = 0;
    scorchMark.visible = true;
  }

  // ── Phase 3d: Dust kick-up wave (deferred to next frame — reduces trigger frame particle budget) ──
  _dustPos.copy(wreckPosition!);
  requestAnimationFrame(() => spawnExplosionDust(_dustPos, 30));
}

/**
 * Update destruction fragments — gravity, bounce, fade.
 * Also spawns sustained fire/smoke and secondary explosions.
 * Returns true if destruction is still active.
 */
export function updateDestructionFragments(dt: number): boolean {
  if (!destructionActive || activeFragCount === 0) return false;

  destructionTime += dt;

  // ── Shockwave ring animation (0–0.4s) ──
  if (shockwaveRing) {
    const ringT = destructionTime / 0.4;
    if (ringT < 1) {
      const s = 1 + ringT * 29; // scale 1→30
      shockwaveRing.scale.set(s, s, 1);
      (shockwaveRing.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - ringT);
    } else {
      // Hide — DON'T dispose. Preserves warm WebGPU pipeline for next explosion.
      shockwaveRing.visible = false;
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
      // Hide — DON'T dispose. Preserves warm pipeline for next explosion.
      explosionLight.visible = false;
      explosionLight.intensity = 0;
      explosionLight = null;
    }
  }

  // ── Scorch mark fade-in ──
  if (scorchMark && destructionTime < 0.6) {
    const scorchT = Math.min(1, destructionTime / 0.5);
    (scorchMark.material as THREE.MeshBasicMaterial).opacity = scorchT * 0.7;
  }

  // ── Update fragment physics ──
  for (let i = 0; i < TOTAL_POOL; i++) {
    const f = _fragPool[i];
    if (!f.mesh.visible) continue; // skip inactive pool slots
    f.lifetime += dt;

    if (f.lifetime >= f.maxLife) {
      // Hide pool mesh (don't remove from scene)
      f.mesh.visible = false;
      activeFragCount--;
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

      // Trail sparks (4% chance per frame while airborne, first 2s — throttled from 15%)
      if (f.lifetime < 2.0 && Math.random() < 0.04) {
        spawnGPUSparks(f.mesh.position, 2);
      }

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

        // Impact sparks on bounce (50% chance)
        if (Math.random() < 0.5) {
          spawnGPUSparks(f.mesh.position, 4);
        }
      }
    }

    // Fade out + charring/heat cooling in last 3 seconds of life
    const fadeStart = f.maxLife - 2;
    const heatCoolStart = 1.5; // emissive starts cooling after 1.5s
    if (f.lifetime > heatCoolStart) {
      const coolT = Math.min(1, (f.lifetime - heatCoolStart) / 3);
      const newEmissive = 0.6 * (1 - coolT);
      // Delta-gate: only write if changed significantly (avoids redundant uniform uploads)
      if (Math.abs(newEmissive - _lastEmissive[i]) > 0.01) {
        _lastEmissive[i] = newEmissive;
        if (Array.isArray(f.mesh.material)) {
          for (const m of f.mesh.material) {
            if ('emissiveIntensity' in m) {
              (m as THREE.MeshStandardMaterial).emissiveIntensity = newEmissive;
            }
          }
        } else if ('emissiveIntensity' in (f.mesh.material as THREE.MeshStandardMaterial)) {
          (f.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = newEmissive;
        }
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

  // ── Phase 3: Enhanced fire system (throttled to prevent lag) ──
  // Use frame counter to stagger spawns: only 1-2 particle calls per frame
  _destructionFrame++;
  if (wreckPosition) {
    // Initial fireball (first 0.5s — reduced from 3 flames/frame to 1 per ~3 frames)
    if (destructionTime < 0.5) {
      if (Math.random() < 0.33) {
        _firePos.copy(wreckPosition);
        _firePos.y += 0.3 + Math.random() * 0.8;
        _firePos.x += (Math.random() - 0.5) * 1.5;
        _firePos.z += (Math.random() - 0.5) * 1.5;
        spawnGPUFlame(_firePos, 1.0, dt);
      }
      // Single burst at start only (not every frame)
      if (destructionTime < dt * 2) spawnGPUExplosion(wreckPosition, 8);
    }

    // Mushroom plume (0.3–3s) — throttled to every 3rd frame
    if (destructionTime > 0.3 && destructionTime < 3.0 && _destructionFrame % 3 === 0) {
      _firePos.copy(wreckPosition);
      _firePos.y += 1.0 + destructionTime * 1.5; // rises over time
      _firePos.x += (Math.random() - 0.5) * 0.8;
      _firePos.z += (Math.random() - 0.5) * 0.8;
      spawnGPUDamageSmoke(_firePos, 0.9, dt);
      if (destructionTime < 2.0) {
        spawnGPUFlame(_firePos, 0.5, dt);
      }
    }

    // Ground fire pool (0.5–5s) — throttled to every 2nd frame
    if (destructionTime > 0.5 && destructionTime < 5.0 && _destructionFrame % 2 === 0) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 2.0;
      _firePos.copy(wreckPosition);
      _firePos.x += Math.cos(angle) * dist;
      _firePos.z += Math.sin(angle) * dist;
      _firePos.y += 0.1;
      spawnGPUFlame(_firePos, 0.6 + Math.random() * 0.3, dt);
      spawnGPUDamageSmoke(_firePos, 0.4, dt);
    }

    // Ember rain (1–6s) — throttled to every 4th frame
    if (destructionTime > 1.0 && destructionTime < 6.0 && _destructionFrame % 4 === 0) {
      _firePos.copy(wreckPosition);
      _firePos.y += 2 + Math.random() * 3;
      _firePos.x += (Math.random() - 0.5) * 4;
      _firePos.z += (Math.random() - 0.5) * 4;
      spawnGPUFlame(_firePos, 0.2, dt); // tiny ember
    }
  }

  // Secondary explosions (larger, more dramatic)
  if (wreckPosition) {
    if (destructionTime >= 1.0 && destructionTime < 1.0 + dt * 2) {
      _firePos.copy(wreckPosition);
      _firePos.x += (Math.random() - 0.5) * 3;
      _firePos.y += 0.8;
      spawnGPUExplosion(_firePos, 25);
    }
    if (destructionTime >= 2.5 && destructionTime < 2.5 + dt * 2) {
      _firePos.copy(wreckPosition);
      _firePos.z += (Math.random() - 0.5) * 3;
      _firePos.y += 0.5;
      spawnGPUExplosion(_firePos, 18);
    }
  }

  // Destruction complete when all fragments removed
  if (activeFragCount === 0) {
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
  // Hide all pool meshes (don't dispose — they're reused)
  for (let i = 0; i < _fragPool.length; i++) {
    _fragPool[i].mesh.visible = false;
    _fragPool[i].lifetime = 0;
    _fragPool[i].grounded = false;
  }
  activeFragCount = 0;

  // Hide pre-allocated assets (don't dispose — they're reused)
  if (shockwaveRing) {
    shockwaveRing.visible = false;
    shockwaveRing.scale.set(1, 1, 1);
    shockwaveRing = null;
  }
  if (explosionLight) {
    explosionLight.visible = false;
    explosionLight.intensity = 0;
    explosionLight = null;
  }
  if (scorchMark) {
    scorchMark.visible = false;
    if (_scorchMat) _scorchMat.opacity = 0;
    scorchMark = null;
  }

  destructionActive = false;
  destructionTime = 0;
  _destructionFrame = 0;
  wreckPosition = null;
  destructionScene = null;
}

/** Full disposal — call when leaving the race entirely (not between explosions). */
export function disposeDestructionAssets() {
  // Dispose fragment/wheel pool meshes
  for (const mesh of _poolMeshes) {
    mesh.removeFromParent();
    // Note: geometry/material are shared refs from cachedFragments — don't dispose here
  }
  _poolMeshes.length = 0;
  _fragPool.length = 0;
  _poolReady = false;
  activeFragCount = 0;

  if (_ringMesh) {
    _ringMesh.removeFromParent();
    _ringGeo?.dispose();
    _ringMat?.dispose();
    _ringMesh = null; _ringGeo = null; _ringMat = null;
  }
  if (_scorchMesh) {
    _scorchMesh.removeFromParent();
    _scorchGeo?.dispose();
    _scorchMat?.dispose();
    // Note: _scorchTexture is module-level singleton, don't dispose
    _scorchMesh = null; _scorchGeo = null; _scorchMat = null;
  }
  if (_expLight) {
    _expLight.removeFromParent();
    _expLight.dispose();
    _expLight = null;
  }
  _assetsWarmed = false;
}
