/* ── Hood Racer — Arcade Vehicle Physics (v3 — Pacejka + Bicycle Model) ── */

import * as THREE from 'three';
import { CarDef, InputState, VehicleState, DamageState, createDamageState } from './types';
import { getSettings } from './settings';
import { getClosestSplinePoint } from './track';
import type { SplineBVH } from './bvh';

// Reusable temps to avoid GC
const _carForward = new THREE.Vector3();
const _carRight = new THREE.Vector3();
const _temp = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _rayOrigin = new THREE.Vector3();
const _rayDown = new THREE.Vector3(0, -1, 0);

// Wheel attachment geometry (local frame)
const WHEEL_SIDE_X = 0.85;
const WHEEL_FRONT_Z = -1.3;
const WHEEL_REAR_Z = 1.3;
const WHEELBASE = 2.6;    // |frontZ - rearZ|
const TRACK_WIDTH = 1.7;  // sideX * 2
const AXLE_FRONT = 1.3;   // CG to front axle
const AXLE_REAR = 1.3;    // CG to rear axle

/** Simplified Pacejka Magic Formula (E=0): D·sin(C·atan(B·x)) */
function pacejka(slip: number, B: number, C: number, D: number): number {
  const Bx = B * slip;
  return D * Math.sin(C * Math.atan(Bx));
}

export class Vehicle {
  readonly group: THREE.Group;
  readonly def: CarDef;

  // Physics state — heading-based, but velocity is a 2D vector (XZ plane)
  heading = 0;
  speed = 0;           // scalar projection of velocity on carForward (for HUD / API)
  steer = 0;           // -1..1 current steering amount
  throttle = 0;
  brake = 0;
  driftAngle = 0;      // visual drift, for VFX / audio
  nitro = 50;          // 0–100 nitro meter
  private _nitroActive = false; // actual nitro burn state (requires nitro > 0)

  /** Whether nitro is currently being burned (read-only) */
  get nitroActive(): boolean { return this._nitroActive; }

  /** Barrier impact info — polled by main loop for sparks/shake. Cleared each frame. */
  lastBarrierImpact: { force: number; posX: number; posY: number; posZ: number; normalX: number; normalZ: number } | null = null;

  // Internal velocity vector on XZ plane
  private _velX = 0;
  private _velZ = 0;
  private angularVel = 0;  // heading rate of change (rad/s)

  /** Expose velocity for car-to-car collision damping */
  get velX() { return this._velX; }
  set velX(v: number) { this._velX = v; }
  get velZ() { return this._velZ; }
  set velZ(v: number) { this._velZ = v; }

  // Smooth steer interpolation
  private steerTarget = 0;

  // Visuals
  private bodyGroup: THREE.Group;
  private model: THREE.Group | null = null;
  private wheelFL: THREE.Mesh | null = null;
  private wheelFR: THREE.Mesh | null = null;
  private wheelRL: THREE.Mesh | null = null;
  private wheelRR: THREE.Mesh | null = null;
  private wheelSpin = 0;

  // Road-mesh raycast state
  private roadMesh: THREE.Mesh | null = null;
  private raycaster = new THREE.Raycaster();
  private _roadPitch = 0;
  private _roadRoll = 0;

  // Damage
  damage: DamageState = createDamageState();
  detachedZones = new Set<string>();

  // ── Fixed-timestep interpolation ──
  // _prev: snapshot BEFORE all physics steps. _curr: snapshot AFTER all physics steps.
  // lerpToRender modifies Three.js visuals to _prev + alpha * (_curr - _prev).
  // restoreFromRender puts _curr back so the next frame's physics is correct.
  private _prev = { px: 0, py: 0, pz: 0, heading: 0, roadPitch: 0, roadRoll: 0, bodyPX: 0, bodyRZ: 0, bodyYY: 0 };
  private _curr = { px: 0, py: 0, pz: 0, heading: 0, roadPitch: 0, roadRoll: 0, bodyPX: 0, bodyRZ: 0, bodyYY: 0 };
  private _snapValid = false;

  /** Save current state as "previous". Call ONCE before the first physics sub-step. */
  saveSnapshot() {
    const p = this.group.position;
    this._prev.px = p.x; this._prev.py = p.y; this._prev.pz = p.z;
    this._prev.heading = this.heading;
    this._prev.roadPitch = this._roadPitch;
    this._prev.roadRoll = this._roadRoll;
    this._prev.bodyPX = this.bodyGroup.rotation.x;
    this._prev.bodyRZ = this.bodyGroup.rotation.z;
    this._prev.bodyYY = this.bodyGroup.rotation.y;
    this._snapValid = true;
  }

  /**
   * Interpolate Three.js visual state between _prev and current physics state.
   * Saves the actual physics state into _curr first so restoreFromRender can put it back.
   * alpha ∈ [0,1]:  0 → show prev,  1 → show current.
   */
  lerpToRender(alpha: number) {
    if (!this._snapValid) return;
    const p = this.group.position;

    // Save current (physics-authoritative) state
    this._curr.px = p.x; this._curr.py = p.y; this._curr.pz = p.z;
    this._curr.heading = this.heading;
    this._curr.roadPitch = this._roadPitch;
    this._curr.roadRoll = this._roadRoll;
    this._curr.bodyPX = this.bodyGroup.rotation.x;
    this._curr.bodyRZ = this.bodyGroup.rotation.z;
    this._curr.bodyYY = this.bodyGroup.rotation.y;

    const prev = this._prev;
    const curr = this._curr;

    // Interpolate position
    p.x = prev.px + (curr.px - prev.px) * alpha;
    p.y = prev.py + (curr.py - prev.py) * alpha;
    p.z = prev.pz + (curr.pz - prev.pz) * alpha;

    // Interpolate heading (with angle wrapping)
    let dh = curr.heading - prev.heading;
    if (dh > Math.PI) dh -= Math.PI * 2;
    if (dh < -Math.PI) dh += Math.PI * 2;
    this.group.rotation.y = prev.heading + dh * alpha;

    // Interpolate road surface alignment
    this.group.rotation.x = prev.roadPitch + (curr.roadPitch - prev.roadPitch) * alpha;
    this.group.rotation.z = prev.roadRoll + (curr.roadRoll - prev.roadRoll) * alpha;

    // Interpolate body cosmetic rotations
    this.bodyGroup.rotation.x = prev.bodyPX + (curr.bodyPX - prev.bodyPX) * alpha;
    this.bodyGroup.rotation.z = prev.bodyRZ + (curr.bodyRZ - prev.bodyRZ) * alpha;
    this.bodyGroup.rotation.y = prev.bodyYY + (curr.bodyYY - prev.bodyYY) * alpha;
  }

  /** Restore physics-authoritative state after rendering, so next physics step is correct. */
  restoreFromRender() {
    if (!this._snapValid) return;
    const c = this._curr;
    const p = this.group.position;
    p.x = c.px; p.y = c.py; p.z = c.pz;
    this.group.rotation.y = c.heading;
    this.group.rotation.x = c.roadPitch;
    this.group.rotation.z = c.roadRoll;
    this.bodyGroup.rotation.x = c.bodyPX;
    this.bodyGroup.rotation.z = c.bodyRZ;
    this.bodyGroup.rotation.y = c.bodyYY;
  }


  // Debug telemetry (populated each frame for debug overlay)
  telemetry = {
    alphaFront: 0, alphaRear: 0,
    frontLatF: 0, rearLatF: 0,
    frontGrip: 0.5, rearGrip: 0.5,
    yawTorque: 0, kinBlend: 0,
    slipAngle: 0, longForce: 0,
  };

  constructor(def: CarDef) {
    this.def = def;
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.bodyGroup = new THREE.Group();
    this.group.add(this.bodyGroup);
  }

  /** Attach a loaded GLB model to this vehicle. */
  setModel(model: THREE.Group) {
    this.model = model;
    this.bodyGroup.add(model);
    this.buildWheels();
    this.buildLights();
  }

  /** Set the road mesh used for per-wheel raycasting. */
  setRoadMesh(mesh: THREE.Mesh) {
    this.roadMesh = mesh;
  }

  /** Cast a single ray downward from a wheel's world position and return the hit Y, or null. */
  private castWheelRay(sinH: number, cosH: number, localX: number, localZ: number): number | null {
    if (!this.roadMesh) return null;
    const wx = this.group.position.x + cosH * localX + sinH * localZ;
    const wz = this.group.position.z - sinH * localX + cosH * localZ;
    _rayOrigin.set(wx, this.group.position.y + 15, wz);
    this.raycaster.set(_rayOrigin, _rayDown);
    this.raycaster.far = 30;
    const hits = this.raycaster.intersectObject(this.roadMesh, false);
    return hits.length > 0 ? hits[0].point.y : null;
  }

  private buildWheels() {
    const wheelGeo = new THREE.TorusGeometry(0.35, 0.12, 8, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.3 });
    const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.08, 6);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x888899, metalness: 0.8, roughness: 0.2 });

    const createWheel = (): THREE.Mesh => {
      const wheelGroup = new THREE.Group();

      // Tire: default torus ring is flat in XZ. Rotate to stand upright (ring in YZ plane)
      // so the axle runs along X and the wheel spins correctly with rotation.x
      const tire = new THREE.Mesh(wheelGeo, wheelMat);
      tire.rotation.z = Math.PI / 2;
      wheelGroup.add(tire);

      // Hub: default cylinder axis is Y. Rotate so axle runs along X
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.rotation.z = Math.PI / 2;
      wheelGroup.add(hub);

      // Spokes: fan out in the YZ wheel plane (rotate around X axis)
      for (let i = 0; i < 5; i++) {
        const spokeGeo = new THREE.BoxGeometry(0.04, 0.3, 0.04);
        const spoke = new THREE.Mesh(spokeGeo, hubMat);
        spoke.rotation.x = (i / 5) * Math.PI;
        wheelGroup.add(spoke);
      }

      const container = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
      container.visible = false;
      container.add(wheelGroup);
      return container;
    };

    this.wheelFL = createWheel();
    this.wheelFR = createWheel();
    this.wheelRL = createWheel();
    this.wheelRR = createWheel();

    // wheelY = 0.47 matches torus outer radius (0.35 + 0.12 = 0.47)
    // so tire bottoms sit exactly at Y=0 — the road surface
    const wheelY = 0.47, frontZ = -1.3, rearZ = 1.3, sideX = 0.85;
    this.wheelFL.position.set(-sideX, wheelY, frontZ);
    this.wheelFR.position.set(sideX, wheelY, frontZ);
    this.wheelRL.position.set(-sideX, wheelY, rearZ);
    this.wheelRR.position.set(sideX, wheelY, rearZ);
    this.group.add(this.wheelFL, this.wheelFR, this.wheelRL, this.wheelRR);
  }

  // ── Car lights ──
  private taillightMatL: THREE.MeshStandardMaterial | null = null;
  private taillightMatR: THREE.MeshStandardMaterial | null = null;

  private buildLights() {
    // Compute bounding box in bodyGroup-local space (NOT world space)
    const box = new THREE.Box3();
    if (this.model) {
      // Temporarily reset model position to get accurate local bounds
      this.model.updateMatrixWorld(true);
      box.setFromObject(this.model);
      // Convert from world space to bodyGroup local space
      const invMatrix = new THREE.Matrix4().copy(this.bodyGroup.matrixWorld).invert();
      box.applyMatrix4(invMatrix);
    } else {
      // Fallback if no model loaded
      box.min.set(-0.9, 0, -2.2);
      box.max.set(0.9, 1.4, 2.2);
    }

    const frontZ = box.max.z;       // front face of the car (+Z forward)
    const rearZ = box.min.z;        // rear face of the car (-Z backward)
    const halfW = (box.max.x - box.min.x) * 0.35; // inset from edges
    const lightY = box.min.y + (box.max.y - box.min.y) * 0.35; // lower-mid height

    // ── Headlights (front, white, high emissive for bloom) ──
    const headlightGeo = new THREE.SphereGeometry(0.1, 8, 6);
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffeedd,
      emissiveIntensity: 3.0,
      roughness: 0.1,
      metalness: 0.0,
    });

    const hlL = new THREE.Mesh(headlightGeo, headlightMat);
    hlL.position.set(-halfW, lightY, frontZ - 0.05);
    this.bodyGroup.add(hlL);

    const hlR = new THREE.Mesh(headlightGeo, headlightMat);
    hlR.position.set(halfW, lightY, frontZ - 0.05);
    this.bodyGroup.add(hlR);

    // SpotLights aimed forward + downward to project headlight beams onto the road
    const hlSpotL = new THREE.SpotLight(0xffeedd, 8, 25, Math.PI / 5, 0.8, 2);
    hlSpotL.position.set(-halfW, lightY, frontZ);
    const targetL = new THREE.Object3D();
    targetL.position.set(-halfW * 0.5, lightY - 1, frontZ + 12);
    this.bodyGroup.add(targetL);
    hlSpotL.target = targetL;
    this.bodyGroup.add(hlSpotL);

    const hlSpotR = new THREE.SpotLight(0xffeedd, 8, 25, Math.PI / 5, 0.8, 2);
    hlSpotR.position.set(halfW, lightY, frontZ);
    const targetR = new THREE.Object3D();
    targetR.position.set(halfW * 0.5, lightY - 1, frontZ + 12);
    this.bodyGroup.add(targetR);
    hlSpotR.target = targetR;
    this.bodyGroup.add(hlSpotR);

    // ── Taillights (rear, red emissive, intensity boosts on brake) ──
    const taillightGeo = new THREE.BoxGeometry(0.25, 0.08, 0.06);

    this.taillightMatL = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff2200,
      emissiveIntensity: 1.5,
      roughness: 0.2,
      metalness: 0.0,
    });
    this.taillightMatR = this.taillightMatL.clone();

    const tlL = new THREE.Mesh(taillightGeo, this.taillightMatL);
    tlL.position.set(-halfW, lightY, rearZ + 0.05);
    this.bodyGroup.add(tlL);

    const tlR = new THREE.Mesh(taillightGeo, this.taillightMatR);
    tlR.position.set(halfW, lightY, rearZ + 0.05);
    this.bodyGroup.add(tlR);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHYSICS UPDATE — Friction Circle Model
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  update(dt: number, input: InputState, spline?: THREE.CatmullRomCurve3, bvh?: SplineBVH) {
    dt = Math.min(dt, 0.05);
    const { def } = this;

    // ── Input mapping ──
    this.throttle = input.up ? 1 : 0;
    this.brake = input.down ? 1 : 0;
    this.steerTarget = input.steerAnalog !== 0
      ? input.steerAnalog
      : (input.left ? -1 : 0) + (input.right ? 1 : 0);

    // Smooth steer interpolation (steerSpeed controls responsiveness)
    this.steer += (this.steerTarget - this.steer) * Math.min(1, def.steerSpeed * dt);

    // ── Compute car-local basis ──
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    _carForward.set(sinH, 0, cosH);
    _carRight.set(cosH, 0, -sinH);

    // ── Decompose velocity into car-local components ──
    const vForward = this._velX * sinH + this._velZ * cosH;
    const vLateral = this._velX * cosH - this._velZ * sinH;

    // ── Speed metrics ──
    const absSpeed = Math.abs(vForward);
    const speedRatio = Math.min(absSpeed / def.maxSpeed, 1);

    // ── Damage penalties ──
    const dmg = this.damage;
    const accelMult  = 1 - (1 - dmg.front.hp / 100) * 0.4;
    const maxSpdMult = 1 - (1 - dmg.rear.hp / 100) * 0.2;
    const steerBias  = ((1 - dmg.right.hp / 100) - (1 - dmg.left.hp / 100)) * 0.15;
    const severeAny  = Math.min(dmg.front.hp, dmg.rear.hp, dmg.left.hp, dmg.right.hp) < 30;
    const globalMult = severeAny ? 0.5 : 1;

    // ── Longitudinal forces ──
    // Tyre forces (throttle/brake) — used for friction circle
    let tyreForce = 0;
    if (this.throttle > 0) tyreForce += def.acceleration * this.throttle * accelMult * globalMult;
    if (this.brake > 0)    tyreForce -= def.braking * this.brake;
    // Aero/rolling resistance added separately (not part of tyre budget)
    const dragForce = vForward * Math.abs(vForward) * 0.002 + vForward * 0.8;
    const longForce = tyreForce - dragForce;

    // ── Per-axle slip angles (bicycle model) ──
    const vLatFront = vLateral + this.angularVel * AXLE_FRONT;
    const vLatRear  = vLateral - this.angularVel * AXLE_REAR;
    const vFwdClamped = Math.max(absSpeed, 1.5);

    const maxSteerAngle = 0.35 * getSettings().steerSensitivity;
    const steerAngle = (this.steer + steerBias) * maxSteerAngle / (1 + absSpeed * 0.025);
    const signFwd = vForward >= 0 ? 1 : -1;

    const alphaFront = Math.atan2(vLatFront, vFwdClamped) - steerAngle * signFwd;
    const alphaRear  = Math.atan2(vLatRear, vFwdClamped);

    // ── Weight transfer ──
    const totalGrip = Math.max(def.gripCoeff * 50, 1);
    // Only tyre forces count for friction circle, not drag
    const longUsage = Math.min(Math.abs(tyreForce) / totalGrip, 0.9);
    const weightShift = (tyreForce / totalGrip) * def.cgHeight;
    const frontGrip = Math.max(0.15, def.frontBias - weightShift);
    const rearGrip  = Math.max(0.15, (1 - def.frontBias) + weightShift);

    // Friction circle: lateral budget shrinks when longitudinal tyre force is saturated
    const latBudget = Math.sqrt(Math.max(0, 1 - longUsage * longUsage));

    // ── Pacejka lateral forces per axle ──
    const B = def.latFriction * 1.4;
    const C = 1.4;
    const frontPeak = totalGrip * frontGrip * 2 * latBudget * globalMult;
    const rearPeak  = totalGrip * rearGrip  * 2 * latBudget * globalMult;

    const frontLatF = -pacejka(alphaFront, B, C, frontPeak);
    const rearLatF  = -pacejka(alphaRear,  B, C, rearPeak);

    // ── Yaw torque from tyre forces ──
    const yawTorque = frontLatF * AXLE_FRONT - rearLatF * AXLE_REAR;
    const yawInertia = def.mass * 0.004;

    // ── Integrate velocity ──
    const newVForward = vForward + longForce * dt;

    // ── Nitro drain/recharge (must run before boostedMax) ──
    if (input.boost && this.nitro > 0) {
      this._nitroActive = true;
      this.nitro = Math.max(0, this.nitro - 40 * dt);
    } else {
      this._nitroActive = false;
    }
    // Drift recharge (stronger drift = faster recharge)
    if (Math.abs(this.driftAngle) > 0.15 && absSpeed > 5) {
      this.nitro = Math.min(100, this.nitro + Math.abs(this.driftAngle) * 25 * dt);
    }
    // Passive slow recharge
    if (!this._nitroActive && absSpeed > 2) {
      this.nitro = Math.min(100, this.nitro + 2 * dt);
    }

    const boostedMax = this._nitroActive ? def.maxSpeed * 1.4 * maxSpdMult : def.maxSpeed * maxSpdMult;
    const clampedFwd = Math.max(-def.maxSpeed * 0.3, Math.min(newVForward, boostedMax));

    const totalLatAccel = frontLatF + rearLatF;
    const newVLateral = vLateral + totalLatAccel * dt;

    this._velX = clampedFwd * sinH + newVLateral * cosH;
    this._velZ = clampedFwd * cosH - newVLateral * sinH;

    // ── Telemetry ──
    this.telemetry.alphaFront = alphaFront;
    this.telemetry.alphaRear = alphaRear;
    this.telemetry.frontLatF = frontLatF;
    this.telemetry.rearLatF = rearLatF;
    this.telemetry.frontGrip = frontGrip;
    this.telemetry.rearGrip = rearGrip;
    this.telemetry.yawTorque = yawTorque;
    this.telemetry.slipAngle = Math.atan2(Math.abs(vLateral), Math.max(absSpeed, 1));
    this.telemetry.longForce = longForce;

    // ── Steering: blend kinematic (snappy arcade) + physics (natural limits) ──
    const kinBlend = 1 / (1 + absSpeed * 0.05);
    this.telemetry.kinBlend = kinBlend;
    const kinSteer = this.steer * def.handling * dt / (1 + absSpeed * 0.035);
    if (absSpeed > 0.5) {
      this.angularVel += kinSteer * signFwd * kinBlend;
      this.angularVel += (yawTorque / yawInertia) * dt * (1 - kinBlend * 0.5);
    }

    // ── Auto-countersteer (reduced — tyre forces now provide natural correction) ──
    const slideAngle = Math.atan2(Math.abs(vLateral), Math.max(absSpeed, 0.5));
    const driftHeld = this._nitroActive ? 0.1 : 0.5;
    this.angularVel *= 1 - Math.min(1, 3.0 * driftHeld * slideAngle * dt);

    // Angular damping (frame-rate independent)
    this.angularVel *= Math.exp(-2.5 * dt);

    // Apply angular velocity to heading
    this.heading += this.angularVel * dt;
    // Keep heading in [0, 2π) to prevent accumulation overflow in network encoding
    this.heading = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    // ── Drift angle (for VFX / audio / visuals) ──
    this.driftAngle = Math.atan2(-vLateral, Math.max(absSpeed, 1)) * def.driftFactor * 5;

    // ── Scalar speed (for HUD, network, audio) ──
    this.speed = this._velX * sinH + this._velZ * cosH;

    // Stop threshold
    if (absSpeed < 0.1 && this.throttle === 0) {
      this._velX = 0;
      this._velZ = 0;
      this.speed = 0;
      this.angularVel = 0;
    }

    // ── Position update ──
    this.group.position.x += this._velX * dt;
    this.group.position.z += this._velZ * dt;

    // ── Keep on road surface (per-wheel raycast with spline fallback) ──
    let nearestSpline: { t: number; point: THREE.Vector3; distance: number } | null = null;
    let usedRaycast = false;

    if (this.roadMesh) {
      const flY = this.castWheelRay(sinH, cosH, -WHEEL_SIDE_X, WHEEL_FRONT_Z);
      const frY = this.castWheelRay(sinH, cosH, WHEEL_SIDE_X, WHEEL_FRONT_Z);
      const rlY = this.castWheelRay(sinH, cosH, -WHEEL_SIDE_X, WHEEL_REAR_Z);
      const rrY = this.castWheelRay(sinH, cosH, WHEEL_SIDE_X, WHEEL_REAR_Z);

      const hitCount = (flY !== null ? 1 : 0) + (frY !== null ? 1 : 0) +
                       (rlY !== null ? 1 : 0) + (rrY !== null ? 1 : 0);

      if (hitCount >= 3) {
        usedRaycast = true;
        // Approximate any single missing wheel from its neighbor
        const fl = flY ?? frY!;
        const fr = frY ?? flY!;
        const rl = rlY ?? rrY!;
        const rr = rrY ?? rlY!;

        // Car body height from 4 contact points
        this.group.position.y = (fl + fr + rl + rr) / 4;

        // Road surface pitch (positive = nose up)
        const frontAvgY = (fl + fr) / 2;
        const rearAvgY = (rl + rr) / 2;
        const targetPitchRoad = Math.atan2(frontAvgY - rearAvgY, WHEELBASE);

        // Road surface roll (positive = tilted right)
        const leftAvgY = (fl + rl) / 2;
        const rightAvgY = (fr + rr) / 2;
        const targetRollRoad = Math.atan2(rightAvgY - leftAvgY, TRACK_WIDTH);

        // Smooth alignment (frame-rate independent)
        const alignFactor = 1 - Math.exp(-10 * dt);
        this._roadPitch += (targetPitchRoad - this._roadPitch) * alignFactor;
        this._roadRoll += (targetRollRoad - this._roadRoll) * alignFactor;
      }
    }

    if (!usedRaycast && spline) {
      nearestSpline = bvh
        ? getClosestSplinePoint(spline, this.group.position, bvh)
        : getClosestSplinePoint(spline, this.group.position, 200);
      this.group.position.y = nearestSpline.point.y;

      // Decay road alignment toward neutral when off road mesh
      const decayFactor = 1 - Math.exp(-5 * dt);
      this._roadPitch *= (1 - decayFactor);
      this._roadRoll *= (1 - decayFactor);
    }

    // ── Barrier collision (hard clamp + velocity reflection) ──
    this.lastBarrierImpact = null; // Clear each frame
    if (spline) {
      if (!nearestSpline) {
        nearestSpline = bvh
          ? getClosestSplinePoint(spline, this.group.position, bvh)
          : getClosestSplinePoint(spline, this.group.position, 200);
      }
      const roadHalfWidth = 7;
      // XZ-only distance so road banking doesn't false-trigger
      _temp.set(
        this.group.position.x - nearestSpline.point.x,
        0,
        this.group.position.z - nearestSpline.point.z,
      );
      const xzDist = _temp.length();
      if (xzDist > roadHalfWidth) {
        // Barrier normal (pointing inward toward road center)
        _temp.normalize();
        const normalX = -_temp.x;
        const normalZ = -_temp.z;

        // How fast the car is approaching the barrier
        const approachSpeed = -(this._velX * normalX + this._velZ * normalZ);

        // Hard clamp: snap car back to road edge
        const overshoot = xzDist - roadHalfWidth;
        this.group.position.x += normalX * (overshoot + 0.05);
        this.group.position.z += normalZ * (overshoot + 0.05);

        if (approachSpeed > 0) {
          // Reflect velocity off barrier normal with restitution
          const restitution = 0.3;
          const impulse = approachSpeed * (1 + restitution);
          this._velX += normalX * impulse;
          this._velZ += normalZ * impulse;

          // Friction along the barrier wall (scraping)
          const tangentX = -normalZ;
          const tangentZ = normalX;
          const tangentSpeed = this._velX * tangentX + this._velZ * tangentZ;
          const frictionLoss = Math.min(Math.abs(tangentSpeed) * 0.15, Math.abs(approachSpeed) * 0.5);
          this._velX -= tangentX * frictionLoss * Math.sign(tangentSpeed);
          this._velZ -= tangentZ * frictionLoss * Math.sign(tangentSpeed);

          // Angular velocity kick (spin on impact)
          this.angularVel += (Math.random() - 0.5) * approachSpeed * 0.02;
        } else {
          // Sliding along barrier — gentle push + friction
          this._velX *= 0.95;
          this._velZ *= 0.95;
        }

        // Signal impact to main loop (for sparks, camera shake, damage)
        const impactForce = Math.abs(approachSpeed) * (def.mass / 1000);
        if (impactForce > 2) {
          this.lastBarrierImpact = {
            force: impactForce,
            posX: this.group.position.x - normalX * 0.5,
            posY: this.group.position.y + 0.5,
            posZ: this.group.position.z - normalZ * 0.5,
            normalX, normalZ,
          };
        }
      }
    }

    // ── Visual rotation (heading + road surface alignment) ──
    this.group.rotation.y = this.heading;
    this.group.rotation.x = this._roadPitch;
    this.group.rotation.z = this._roadRoll;

    // Cosmetic body pitch & roll (throttle squat, brake dive, drift lean)
    const targetPitch = -this.throttle * speedRatio * 0.04 + this.brake * speedRatio * 0.06;
    const targetRoll = this.driftAngle * def.suspStiffness * 3;
    const bodyLerp = 1 - Math.exp(-8 * dt);
    this.bodyGroup.rotation.x += (targetPitch - this.bodyGroup.rotation.x) * bodyLerp;
    this.bodyGroup.rotation.z += (targetRoll - this.bodyGroup.rotation.z) * bodyLerp;

    // Drift visual yaw offset
    this.bodyGroup.rotation.y = this.driftAngle * 0.03;

    // ── Wheel animation ──
    this.wheelSpin = (this.wheelSpin + this.speed * dt * 3) % (Math.PI * 2);
    if (this.wheelFL) {
      const steerRot = this.steer * 0.35;
      this.wheelFL.rotation.y = steerRot;
      if (this.wheelFR) this.wheelFR.rotation.y = steerRot;

      if (this.wheelFL.children[0]) this.wheelFL.children[0].rotation.x = this.wheelSpin;
      if (this.wheelFR?.children[0]) this.wheelFR.children[0].rotation.x = this.wheelSpin;
      if (this.wheelRL?.children[0]) this.wheelRL.children[0].rotation.x = this.wheelSpin;
      if (this.wheelRR?.children[0]) this.wheelRR.children[0].rotation.x = this.wheelSpin;
    }

    // ── Brake light intensity ──
    if (this.taillightMatL) {
      const brakeGlow = this.brake > 0 ? 5.0 : 1.5;
      this.taillightMatL.emissiveIntensity = brakeGlow;
      this.taillightMatR!.emissiveIntensity = brakeGlow;
    }
  }

  /** Add nitro from external source (slipstream, near-miss). */
  addNitro(amount: number) {
    this.nitro = Math.min(100, this.nitro + amount);
  }

  /** Whether nitro boost is currently firing. */
  get isNitroActive(): boolean { return this._nitroActive; }

  /** Serialize vehicle physics state for rollback snapshot. */
  serializeState(): {
    px: number; py: number; pz: number;
    velX: number; velZ: number;
    heading: number; angularVel: number;
    speed: number; steer: number;
    nitro: number; driftAngle: number;
  } {
    return {
      px: this.group.position.x,
      py: this.group.position.y,
      pz: this.group.position.z,
      velX: this._velX,
      velZ: this._velZ,
      heading: this.heading,
      angularVel: this.angularVel,
      speed: this.speed,
      steer: this.steer,
      nitro: this.nitro,
      driftAngle: this.driftAngle,
    };
  }

  /** Restore vehicle physics state from a rollback snapshot. */
  deserializeState(snap: {
    px: number; py: number; pz: number;
    velX: number; velZ: number;
    heading: number; angularVel: number;
    speed: number; steer: number;
    nitro: number; driftAngle: number;
  }) {
    this.group.position.set(snap.px, snap.py, snap.pz);
    this._velX = snap.velX;
    this._velZ = snap.velZ;
    this.heading = snap.heading;
    this.angularVel = snap.angularVel;
    this.speed = snap.speed;
    this.steer = snap.steer;
    this.nitro = snap.nitro;
    this.driftAngle = snap.driftAngle;
    this.group.rotation.y = snap.heading;
  }

  /** Get current state for network broadcasting. */
  getState(): VehicleState {
    return {
      position: this.group.position.clone(),
      heading: this.heading,
      speed: this.speed,
      steer: this.steer,
      throttle: this.throttle,
      brake: this.brake,
      driftAngle: this.driftAngle,
    };
  }

  /** Apply state from network. */
  applyState(state: VehicleState) {
    this.group.position.copy(state.position);
    this.heading = state.heading;
    this.speed = state.speed;
    this.steer = state.steer;
    this.driftAngle = state.driftAngle;
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    this._velX = state.speed * sinH;
    this._velZ = state.speed * cosH;
    this.group.rotation.y = this.heading;
  }

  /** Position the vehicle at a point on the spline, facing forward. */
  placeOnTrack(spline: THREE.CatmullRomCurve3, t: number, laneOffset = 0) {
    const pos = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();

    this.group.position.copy(pos);

    if (laneOffset !== 0) {
      _temp.crossVectors(tangent, _up).normalize();
      this.group.position.x += _temp.x * laneOffset;
      this.group.position.z += _temp.z * laneOffset;
    }

    // Snap to road mesh surface if available (avoids floating above road)
    if (this.roadMesh) {
      this.raycaster.set(
        _temp.set(this.group.position.x, this.group.position.y + 10, this.group.position.z),
        _rayDown,
      );
      this.raycaster.far = 25;
      const hits = this.raycaster.intersectObject(this.roadMesh, false);
      if (hits.length > 0) {
        this.group.position.y = hits[0].point.y;
      } else {
        this.group.position.y += 0.05;
      }
    } else {
      this.group.position.y += 0.05;
    }

    this.heading = Math.atan2(tangent.x, tangent.z);
    this.group.rotation.y = this.heading;
    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
    this.speed = 0;
    this._velX = 0;
    this._velZ = 0;
    this.angularVel = 0;
    this.steer = 0;
    this.driftAngle = 0;
    this._roadPitch = 0;
    this._roadRoll = 0;
    this.nitro = 50;
    this._nitroActive = false;
    this.damage = createDamageState();
    this.detachedZones.clear();
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DAMAGE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Apply collision damage. Determines the hit zone from the impact direction
   * relative to the car's heading, reduces zone HP, and deforms the mesh.
   */
  applyDamage(impactDir: THREE.Vector3, impactForce: number) {
    if (impactForce < 8) return;

    const localDirX = impactDir.x * Math.cos(this.heading) - impactDir.z * Math.sin(this.heading);
    const localDirZ = impactDir.x * Math.sin(this.heading) + impactDir.z * Math.cos(this.heading);

    let zone: 'front' | 'rear' | 'left' | 'right';
    if (Math.abs(localDirZ) > Math.abs(localDirX)) {
      zone = localDirZ > 0 ? 'front' : 'rear';
    } else {
      zone = localDirX > 0 ? 'right' : 'left';
    }

    const dmgAmount = Math.min((impactForce - 8) * 1.2, 35);
    this.damage[zone].hp = Math.max(0, this.damage[zone].hp - dmgAmount);
    this.damage[zone].deformAmount += dmgAmount;

    this.deformMesh(impactDir, impactForce);
    this.applyMaterialDamage(zone);

    // Detach a part when zone reaches 0 HP
    if (this.damage[zone].hp <= 0 && !this.detachedZones.has(zone)) {
      this.detachedZones.add(zone);
    }
  }

  /** Progressively darken and roughen materials on the damaged zone. */
  private applyMaterialDamage(zone: 'front' | 'rear' | 'left' | 'right') {
    if (!this.model) return;
    const severity = 1 - this.damage[zone].hp / 100; // 0 = pristine, 1 = destroyed

    this.model.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat.color) return;

      // Only affect meshes whose center falls in the damaged zone
      const localZ = mesh.position.z;
      const localX = mesh.position.x;
      let inZone = false;
      if (zone === 'front' && localZ < -0.5) inZone = true;
      else if (zone === 'rear' && localZ > 0.5) inZone = true;
      else if (zone === 'left' && localX < -0.3) inZone = true;
      else if (zone === 'right' && localX > 0.3) inZone = true;

      if (!inZone) return;

      // Darken color toward grey (simulates paint scraping to bare metal)
      const darkFactor = 1 - severity * 0.4;
      mat.color.multiplyScalar(Math.max(darkFactor, 0.5));

      // Increase roughness (fresh paint → scraped metal)
      mat.roughness = Math.min(0.3 + severity * 0.6, 0.9);

      // Reduce metalness slightly (paint loss)
      mat.metalness = Math.max(0.1, (mat.metalness || 0.5) - severity * 0.2);
    });
  }

  /** Create a detached part mesh for a destroyed zone. Returns null if already detached. */
  createDetachedPart(zone: string): THREE.Mesh | null {
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    const pos = this.group.position;

    // Part dimensions and offsets per zone
    const parts: Record<string, { w: number; h: number; d: number; ox: number; oy: number; oz: number; color: number }> = {
      front: { w: 2.0, h: 0.08, d: 1.2, ox: 0, oy: 0.8, oz: -2.2, color: 0x888899 },
      rear:  { w: 1.8, h: 0.3, d: 0.4, ox: 0, oy: 0.5, oz: 2.0, color: 0x666677 },
      left:  { w: 0.08, h: 0.8, d: 1.6, ox: -1.0, oy: 0.6, oz: 0, color: 0x777788 },
      right: { w: 0.08, h: 0.8, d: 1.6, ox: 1.0, oy: 0.6, oz: 0, color: 0x777788 },
    };

    const p = parts[zone];
    if (!p) return null;

    const geo = new THREE.BoxGeometry(p.w, p.h, p.d);
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.6, metalness: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);

    // World position from car position + rotated local offset
    mesh.position.set(
      pos.x + cosH * p.ox + sinH * p.oz,
      pos.y + p.oy,
      pos.z - sinH * p.ox + cosH * p.oz,
    );
    mesh.rotation.y = this.heading + (Math.random() - 0.5) * 0.5;

    return mesh;
  }

  // Pooled temps for deformMesh (avoid per-collision allocations)
  private static _deformInvMat = new THREE.Matrix4();
  private static _deformLocalImpact = new THREE.Vector3();
  private static _deformLocalDir = new THREE.Vector3();
  private static _deformWorldImpact = new THREE.Vector3();

  /** Displace mesh vertices near the impact for visual crumple.
   * Permanent CPU-side deformation — vertices are moved and never restored.
   * Uses quadratic falloff from impact point with randomized noise for
   * realistic crumple patterns.
   */
  private deformMesh(impactDir: THREE.Vector3, force: number) {
    if (!this.model) return;

    const radius = 2.5;
    const strength = force * 0.01;
    const maxDeformPerVertex = 0.8; // cap total displacement per vertex
    Vehicle._deformWorldImpact.copy(this.group.position).addScaledVector(impactDir, 2.5);

    this.model.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      const posAttr = mesh.geometry?.attributes?.position;
      if (!posAttr) return;

      const positions = posAttr.array as Float32Array;
      Vehicle._deformInvMat.copy(mesh.matrixWorld).invert();
      Vehicle._deformLocalImpact.copy(Vehicle._deformWorldImpact).applyMatrix4(Vehicle._deformInvMat);
      Vehicle._deformLocalDir.copy(impactDir).transformDirection(Vehicle._deformInvMat);
      const localImpact = Vehicle._deformLocalImpact;
      const localDir = Vehicle._deformLocalDir;

      let changed = false;
      const vertCount = positions.length / 3;
      for (let i = 0; i < vertCount; i++) {
        const idx = i * 3;
        const dx = positions[idx] - localImpact.x;
        const dy = positions[idx + 1] - localImpact.y;
        const dz = positions[idx + 2] - localImpact.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < radius) {
          const falloff = (1 - dist / radius) * (1 - dist / radius);
          const deform = Math.min(strength * falloff, maxDeformPerVertex);
          // Asymmetric noise for natural crumple
          const nx = (Math.random() - 0.5) * deform * 0.4;
          const ny = (Math.random() - 0.3) * deform * 0.25; // slightly downward bias
          const nz = (Math.random() - 0.5) * deform * 0.4;
          positions[idx]     += localDir.x * deform + nx;
          positions[idx + 1] += localDir.y * deform + ny;
          positions[idx + 2] += localDir.z * deform + nz;
          changed = true;
        }
      }

      if (changed) {
        posAttr.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
    });
  }
}
