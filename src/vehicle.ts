/* ── Hood Racer — Arcade Vehicle Physics ── */

import * as THREE from 'three';
import { CarDef, InputState, VehicleState } from './types';
import { getClosestSplinePoint } from './track';

export class Vehicle {
  readonly group: THREE.Group;
  readonly def: CarDef;

  // Physics state
  heading = 0;
  speed = 0;
  steer = 0;
  throttle = 0;
  brake = 0;
  driftAngle = 0;

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

    // Build procedural wheels (replace static ones for visible spin)
    this.buildWheels();
  }

  private buildWheels() {
    const wheelGeo = new THREE.TorusGeometry(0.35, 0.12, 8, 16);
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.6,
      metalness: 0.3,
    });

    // Hub cap / spokes
    const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.08, 6);
    const hubMat = new THREE.MeshStandardMaterial({
      color: 0x888899,
      metalness: 0.8,
      roughness: 0.2,
    });

    const createWheel = (): THREE.Mesh => {
      const wheelGroup = new THREE.Group();
      const tire = new THREE.Mesh(wheelGeo, wheelMat);
      tire.rotation.y = Math.PI / 2;
      wheelGroup.add(tire);

      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.rotation.x = Math.PI / 2;
      wheelGroup.add(hub);

      // Spokes
      for (let i = 0; i < 5; i++) {
        const spokeGeo = new THREE.BoxGeometry(0.04, 0.3, 0.04);
        const spoke = new THREE.Mesh(spokeGeo, hubMat);
        spoke.rotation.z = (i / 5) * Math.PI;
        wheelGroup.add(spoke);
      }

      // Use a dummy mesh to hold the group
      const container = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
      container.visible = false;
      container.add(wheelGroup);
      return container;
    };

    this.wheelFL = createWheel();
    this.wheelFR = createWheel();
    this.wheelRL = createWheel();
    this.wheelRR = createWheel();

    // Position wheels relative to car body
    const wheelY = 0.35;
    const frontZ = -1.3;
    const rearZ = 1.3;
    const sideX = 0.85;

    this.wheelFL.position.set(-sideX, wheelY, frontZ);
    this.wheelFR.position.set(sideX, wheelY, frontZ);
    this.wheelRL.position.set(-sideX, wheelY, rearZ);
    this.wheelRR.position.set(sideX, wheelY, rearZ);

    this.group.add(this.wheelFL, this.wheelFR, this.wheelRL, this.wheelRR);
  }

  /** Update physics + visual state each frame. */
  update(dt: number, input: InputState, spline?: THREE.CatmullRomCurve3) {
    // Clamp dt
    dt = Math.min(dt, 0.05);

    const { def } = this;

    // ── Input mapping ──
    this.throttle = input.up ? 1 : 0;
    this.brake = input.down ? 1 : 0;
    this.steer = (input.left ? 1 : 0) + (input.right ? -1 : 0);

    // ── Acceleration / deceleration ──
    if (this.throttle > 0) {
      this.speed += def.acceleration * this.throttle * dt;
    }
    if (this.brake > 0) {
      this.speed -= def.braking * this.brake * dt;
    }

    // Drag
    this.speed *= (1 - 0.015);

    // Clamp speed
    const boostedMax = input.boost ? def.maxSpeed * 1.4 : def.maxSpeed;
    this.speed = Math.max(-def.maxSpeed * 0.3, Math.min(this.speed, boostedMax));

    // Stop threshold
    if (Math.abs(this.speed) < 0.1) this.speed = 0;

    // ── Steering ──
    const speedFactor = Math.min(Math.abs(this.speed) / def.maxSpeed, 1);
    const steerAngle = this.steer * def.handling * dt * (0.3 + 0.7 * speedFactor);

    if (Math.abs(this.speed) > 0.5) {
      this.heading += steerAngle * Math.sign(this.speed);
    }

    // ── Drift ──
    const turnRate = Math.abs(steerAngle);
    const driftTarget = turnRate * speedFactor * def.driftFactor * 30;
    this.driftAngle += (driftTarget * -this.steer - this.driftAngle) * 0.1;

    // ── Position update ──
    const moveDir = this.heading;
    this.group.position.x += Math.sin(moveDir) * this.speed * dt;
    this.group.position.z += Math.cos(moveDir) * this.speed * dt;

    // ── Keep on road surface (Y from spline) ──
    if (spline) {
      const nearest = getClosestSplinePoint(spline, this.group.position, 200);
      this.group.position.y = nearest.point.y;

      // Soft barrier bouncing — push car back if too far from road
      const roadHalfWidth = 7;
      if (nearest.distance > roadHalfWidth) {
        const pushStrength = (nearest.distance - roadHalfWidth) * 0.5;
        const pushDir = new THREE.Vector3()
          .subVectors(nearest.point, this.group.position)
          .normalize();
        this.group.position.x += pushDir.x * pushStrength;
        this.group.position.z += pushDir.z * pushStrength;
        this.speed *= 0.92; // friction penalty
      }
    }

    // ── Visual rotation ──
    this.group.rotation.y = this.heading;

    // Body pitch & roll
    const targetPitch = -this.throttle * speedFactor * 0.03 + this.brake * speedFactor * 0.05;
    const targetRoll = this.driftAngle * 0.015;
    this.bodyGroup.rotation.x += (targetPitch - this.bodyGroup.rotation.x) * 0.1;
    this.bodyGroup.rotation.z += (targetRoll - this.bodyGroup.rotation.z) * 0.1;

    // Drift visual yaw offset
    this.bodyGroup.rotation.y = this.driftAngle * 0.02;

    // ── Wheel animation ──
    this.wheelSpin += this.speed * dt * 3;
    if (this.wheelFL) {
      // Front wheels steer
      const steerRot = this.steer * 0.35;
      if (this.wheelFL) this.wheelFL.rotation.y = steerRot;
      if (this.wheelFR) this.wheelFR.rotation.y = steerRot;

      // All wheels spin
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

    // Lane offset
    if (laneOffset !== 0) {
      const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      this.group.position.x += right.x * laneOffset;
      this.group.position.z += right.z * laneOffset;
    }

    // Face forward along the spline
    this.heading = Math.atan2(tangent.x, tangent.z);
    this.group.rotation.y = this.heading;
    this.speed = 0;
  }
}
