/* ── Hood Racer — Arcade Vehicle Physics (v2 — Friction Circle) ── */

import * as THREE from 'three';
import { CarDef, InputState, VehicleState } from './types';
import { getClosestSplinePoint } from './track';
import type { SplineBVH } from './bvh';

// Reusable temps to avoid GC
const _carForward = new THREE.Vector3();
const _carRight = new THREE.Vector3();
const _temp = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

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

  constructor(def: CarDef) {
    this.def = def;
    this.group = new THREE.Group();
    this.bodyGroup = new THREE.Group();
    this.group.add(this.bodyGroup);
  }

  /** Attach a loaded GLB model to this vehicle. */
  setModel(model: THREE.Group) {
    this.model = model;
    this.bodyGroup.add(model);
    this.buildWheels();
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

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHYSICS UPDATE — Friction Circle Model
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  update(dt: number, input: InputState, spline?: THREE.CatmullRomCurve3, bvh?: SplineBVH) {
    dt = Math.min(dt, 0.05);
    const { def } = this;

    // ── Input mapping ──
    this.throttle = input.up ? 1 : 0;
    this.brake = input.down ? 1 : 0;
    this.steerTarget = (input.left ? 1 : 0) + (input.right ? -1 : 0);

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

    // ── Longitudinal forces ──
    let longForce = 0;
    if (this.throttle > 0) {
      longForce += def.acceleration * this.throttle;
    }
    if (this.brake > 0) {
      longForce -= def.braking * this.brake;
    }

    // Air drag (proportional to v²)
    const dragCoeff = 0.002;
    longForce -= vForward * Math.abs(vForward) * dragCoeff;

    // Rolling resistance
    longForce -= vForward * 0.8;

    // ── Lateral force (slip-angle lite) ──
    // lateralForce pulls the car sideways velocity back toward zero
    const latForce = -vLateral * def.latFriction;

    // ── FRICTION CIRCLE ──
    // Total grip available = gripCoeff × "weight" (simplified as constant)
    const frictionBudget = def.gripCoeff * 50; // normalised force units
    const combinedForce = Math.sqrt(longForce * longForce + latForce * latForce);

    let appliedLong = longForce;
    let appliedLat = latForce;

    if (combinedForce > frictionBudget) {
      // Exceeds grip budget — scale both forces down proportionally
      const scale = frictionBudget / combinedForce;
      appliedLong *= scale;
      appliedLat *= scale;
    }

    // ── Apply forces in car-local space, then convert back to world ──
    const newVForward = vForward + appliedLong * dt;
    const newVLateral = vLateral + appliedLat * dt;

    // Boost
    const boostedMax = input.boost ? def.maxSpeed * 1.4 : def.maxSpeed;

    // Clamp forward speed
    const clampedForward = Math.max(-def.maxSpeed * 0.3, Math.min(newVForward, boostedMax));

    // Convert back to world XZ
    this._velX = clampedForward * sinH + newVLateral * cosH;
    this._velZ = clampedForward * cosH - newVLateral * sinH;

    // ── Speed-sensitive steering ──
    const absSpeed = Math.abs(vForward);
    const speedRatio = Math.min(absSpeed / def.maxSpeed, 1);

    // Max steer angle decreases with speed
    const steerMax = def.handling / (1 + absSpeed * 0.04);
    const headingDelta = this.steer * steerMax * dt;

    if (absSpeed > 0.5) {
      this.angularVel += headingDelta * Math.sign(vForward);
    }

    // ── Auto-countersteer ──
    // When sliding, apply partial angular correction (reduced when drift button held)
    const slideAngle = Math.atan2(Math.abs(vLateral), Math.max(absSpeed, 0.5));
    const driftHeld = input.boost ? 0.15 : 1.0;
    const autoCorrect = -this.angularVel * 0.3 * driftHeld * slideAngle;
    this.angularVel += autoCorrect * dt;

    // Angular damping
    this.angularVel *= (1 - 2.5 * dt);

    // Apply angular velocity to heading
    this.heading += this.angularVel * dt;

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

    // ── Keep on road surface ──
    if (spline) {
      const nearest = bvh
        ? getClosestSplinePoint(spline, this.group.position, bvh)
        : getClosestSplinePoint(spline, this.group.position, 200);
      this.group.position.y = nearest.point.y;

      // Soft barrier — push car back if too far from road
      const roadHalfWidth = 7;
      if (nearest.distance > roadHalfWidth) {
        const pushStrength = (nearest.distance - roadHalfWidth) * 0.5;
        _temp.subVectors(nearest.point, this.group.position).normalize();
        this.group.position.x += _temp.x * pushStrength;
        this.group.position.z += _temp.z * pushStrength;
        // Friction penalty on velocity
        this._velX *= 0.92;
        this._velZ *= 0.92;
      }
    }

    // ── Visual rotation ──
    this.group.rotation.y = this.heading;

    // Body pitch & roll (uses suspStiffness for intensity)
    const targetPitch = -this.throttle * speedRatio * 0.04 + this.brake * speedRatio * 0.06;
    const targetRoll = this.driftAngle * def.suspStiffness * 3;
    this.bodyGroup.rotation.x += (targetPitch - this.bodyGroup.rotation.x) * 0.12;
    this.bodyGroup.rotation.z += (targetRoll - this.bodyGroup.rotation.z) * 0.12;

    // Drift visual yaw offset
    this.bodyGroup.rotation.y = this.driftAngle * 0.03;

    // ── Wheel animation ──
    this.wheelSpin += this.speed * dt * 3;
    if (this.wheelFL) {
      const steerRot = this.steer * 0.35;
      if (this.wheelFL) this.wheelFL.rotation.y = steerRot;
      if (this.wheelFR) this.wheelFR.rotation.y = steerRot;

      [this.wheelFL, this.wheelFR, this.wheelRL, this.wheelRR].forEach(w => {
        if (w && w.children[0]) {
          w.children[0].rotation.x = this.wheelSpin;
        }
      });
    }
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
    this.group.rotation.y = this.heading;
  }

  /** Position the vehicle at a point on the spline, facing forward. */
  placeOnTrack(spline: THREE.CatmullRomCurve3, t: number, laneOffset = 0) {
    const pos = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();

    this.group.position.copy(pos);
    this.group.position.y += 0.05;

    if (laneOffset !== 0) {
      _temp.crossVectors(tangent, _up).normalize();
      this.group.position.x += _temp.x * laneOffset;
      this.group.position.z += _temp.z * laneOffset;
    }

    this.heading = Math.atan2(tangent.x, tangent.z);
    this.group.rotation.y = this.heading;
    this.speed = 0;
    this._velX = 0;
    this._velZ = 0;
    this.angularVel = 0;
    this.steer = 0;
    this.driftAngle = 0;
  }
}
