/* ── Hood Racer — Rapier Physics World ──
 *
 * Provides collision detection via Rapier3D WASM physics.
 * The arcade vehicle model (Vehicle.update) still handles driving
 * dynamics — this module adds:
 *   1. Static trimesh colliders for track barriers
 *   2. Dynamic rigid bodies for each car (synced from arcade state)
 *   3. Contact event detection for car-car and car-wall collisions
 *   4. Rigid-body collision response (push-apart + velocity exchange)
 *
 * Usage:
 *   await initRapierWorld();
 *   addBarrierCollider(barrierMesh);
 *   const handle = addCarBody(position, heading, halfExtents);
 *   syncCarToRapier(handle, position, heading);
 *   stepRapierWorld(dt);
 *   const { pos, vel } = readCarFromRapier(handle);
 */

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';

// ── Module state ──
let rapier: typeof RAPIER | null = null;
let world: RAPIER.World | null = null;
let eventQueue: RAPIER.EventQueue | null = null;

// Lookup: Rapier collider handle → car ID string
const colliderToCarId = new Map<number, string>();
const carIdToBody = new Map<string, RAPIER.RigidBody>();

// Barrier collider handles (for car-vs-wall detection)
const barrierHandles = new Set<number>();

export interface RapierCollisionEvent {
  type: 'car-car' | 'car-wall';
  carIdA: string;
  carIdB?: string;       // only for car-car
  normalX: number;
  normalZ: number;
  impactForce: number;
}

// ── Init ──

export async function initRapierWorld(): Promise<void> {
  rapier = await import('@dimforge/rapier3d-compat');
  await rapier.init();

  // Gravity: standard Earth gravity pointing down
  const gravity = new rapier.Vector3(0.0, -9.81, 0.0);
  world = new rapier.World(gravity);
  eventQueue = new rapier.EventQueue(true);

  // Clear any previous state
  colliderToCarId.clear();
  carIdToBody.clear();
  barrierHandles.clear();
}

// ── Static barrier colliders ──

/**
 * Add a static trimesh collider from a Three.js barrier mesh.
 * Call once per barrier (left + right) after track generation.
 */
export function addBarrierCollider(mesh: THREE.Mesh): void {
  if (!world || !rapier) return;

  const geo = mesh.geometry;
  const posAttr = geo.attributes.position;
  const index = geo.index;

  if (!posAttr || !index) return;

  // Extract vertices (applying mesh world matrix)
  mesh.updateMatrixWorld(true);
  const vertices = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    // Apply world transform
    const wx = mesh.matrixWorld.elements[0] * x + mesh.matrixWorld.elements[4] * y + mesh.matrixWorld.elements[8] * z + mesh.matrixWorld.elements[12];
    const wy = mesh.matrixWorld.elements[1] * x + mesh.matrixWorld.elements[5] * y + mesh.matrixWorld.elements[9] * z + mesh.matrixWorld.elements[13];
    const wz = mesh.matrixWorld.elements[2] * x + mesh.matrixWorld.elements[6] * y + mesh.matrixWorld.elements[10] * z + mesh.matrixWorld.elements[14];
    vertices[i * 3] = wx;
    vertices[i * 3 + 1] = wy;
    vertices[i * 3 + 2] = wz;
  }

  // Extract indices
  const indices = new Uint32Array(index.count);
  for (let i = 0; i < index.count; i++) {
    indices[i] = index.getX(i);
  }

  const bodyDesc = rapier.RigidBodyDesc.fixed();
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = rapier.ColliderDesc.trimesh(vertices, indices)
    .setRestitution(0.3)
    .setFriction(0.8);
  const collider = world.createCollider(colliderDesc, body);

  barrierHandles.add(collider.handle);
}

// ── Dynamic car bodies ──

/**
 * Add a dynamic rigid body for a car.
 * Returns the car ID used for lookups.
 */
export function addCarBody(
  carId: string,
  x: number, y: number, z: number,
  heading: number,
  halfW = 1.0, halfH = 0.6, halfL = 2.2,
): string {
  if (!world || !rapier) return carId;

  const bodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setRotation(quaternionFromHeading(heading))
    .setLinearDamping(0.5)
    .setAngularDamping(2.0)
    .setCcdEnabled(true);  // Continuous collision detection

  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = rapier.ColliderDesc.cuboid(halfW, halfH, halfL)
    .setRestitution(0.2)
    .setFriction(0.6)
    .setMass(1200)                    // ~1200 kg car
    .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);

  const collider = world.createCollider(colliderDesc, body);

  colliderToCarId.set(collider.handle, carId);
  carIdToBody.set(carId, body);

  return carId;
}

/**
 * Sync arcade physics state → Rapier body (kinematic-style positioning).
 * Call before stepRapierWorld() each frame.
 */
export function syncCarToRapier(
  carId: string,
  x: number, y: number, z: number,
  heading: number,
  velX: number, velZ: number,
): void {
  if (!rapier) return;
  const body = carIdToBody.get(carId);
  if (!body) return;

  // Set position and rotation from arcade physics
  body.setTranslation(new rapier!.Vector3(x, y, z), true);
  body.setRotation(quaternionFromHeading(heading), true);

  // Set linear velocity from arcade physics
  body.setLinvel(new rapier!.Vector3(velX, 0, velZ), true);
}

/**
 * Read Rapier body state back (after collision resolution).
 */
export function readCarFromRapier(carId: string): {
  x: number; y: number; z: number;
  velX: number; velZ: number;
} | null {
  const body = carIdToBody.get(carId);
  if (!body) return null;

  const pos = body.translation();
  const vel = body.linvel();

  return {
    x: pos.x, y: pos.y, z: pos.z,
    velX: vel.x, velZ: vel.z,
  };
}

// ── Step + collision events ──

/**
 * Step the Rapier world and return collision events.
 */
export function stepRapierWorld(dt: number): RapierCollisionEvent[] {
  if (!world || !eventQueue || !rapier) return [];

  world.timestep = dt;
  world.step(eventQueue);

  const events: RapierCollisionEvent[] = [];

  eventQueue.drainCollisionEvents((handle1, handle2, started) => {
    if (!started) return; // Only care about contact start

    const id1 = colliderToCarId.get(handle1);
    const id2 = colliderToCarId.get(handle2);
    const isBarrier1 = barrierHandles.has(handle1);
    const isBarrier2 = barrierHandles.has(handle2);

    if (id1 && id2) {
      // Car-car collision
      const bodyA = carIdToBody.get(id1);
      const bodyB = carIdToBody.get(id2);
      if (bodyA && bodyB) {
        const velA = bodyA.linvel();
        const velB = bodyB.linvel();
        const relVelX = velB.x - velA.x;
        const relVelZ = velB.z - velA.z;
        const impactForce = Math.sqrt(relVelX * relVelX + relVelZ * relVelZ);

        const posA = bodyA.translation();
        const posB = bodyB.translation();
        const dx = posB.x - posA.x;
        const dz = posB.z - posA.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 1;

        events.push({
          type: 'car-car',
          carIdA: id1,
          carIdB: id2,
          normalX: dx / dist,
          normalZ: dz / dist,
          impactForce,
        });
      }
    } else if ((id1 && isBarrier2) || (id2 && isBarrier1)) {
      // Car-wall collision
      const carId = id1 || id2;
      if (carId) {
        const body = carIdToBody.get(carId);
        if (body) {
          const vel = body.linvel();
          const impactForce = Math.sqrt(vel.x * vel.x + vel.z * vel.z) * 0.3;

          // Estimate wall normal from the car's velocity direction
          // (points opposite to travel — the wall pushes back against motion)
          const velMag = Math.sqrt(vel.x * vel.x + vel.z * vel.z) || 1;
          const nx = -vel.x / velMag;
          const nz = -vel.z / velMag;

          events.push({
            type: 'car-wall',
            carIdA: carId!,
            normalX: nx, normalZ: nz,
            impactForce,
          });
        }
      }
    }
  });

  return events;
}

// ── Cleanup ──

export function destroyRapierWorld(): void {
  if (world) {
    world.free();
    world = null;
  }
  if (eventQueue) {
    eventQueue.free();
    eventQueue = null;
  }
  colliderToCarId.clear();
  carIdToBody.clear();
  barrierHandles.clear();
}

// ── Helpers ──

function quaternionFromHeading(heading: number): { x: number; y: number; z: number; w: number } {
  // Y-axis rotation quaternion
  const halfAngle = heading / 2;
  return {
    x: 0,
    y: Math.sin(halfAngle),
    z: 0,
    w: Math.cos(halfAngle),
  };
}
