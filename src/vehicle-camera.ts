/* ── Hood Racer — Chase Camera + Spectator Mode ── */

import * as THREE from 'three';

const CHASE_DISTANCE = 10;
const CHASE_HEIGHT = 4.5;
const LOOK_AHEAD = 4;
const POSITION_LERP = 0.06;
const LOOK_LERP = 0.08;
const FOV_MIN = 60;
const FOV_MAX = 78;
const FOV_LERP = 0.04;

// Spectator orbit params
const ORBIT_RADIUS = 35;
const ORBIT_HEIGHT = 18;
const ORBIT_SPEED = 0.15; // radians/s
const SPECTATE_FOV = 65;

// Reusable temps to avoid per-frame allocations
const _desired = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

export type CameraMode = 'chase' | 'orbit' | 'follow';

export class VehicleCamera {
  private camera: THREE.PerspectiveCamera;
  private currentLookAt = new THREE.Vector3();
  private smoothPos = new THREE.Vector3();
  private initialized = false;

  mode: CameraMode = 'chase';
  private orbitAngle = 0;
  private orbitCenter = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /** Update camera to follow a vehicle (chase mode). */
  update(
    targetPos: THREE.Vector3,
    heading: number,
    speed: number,
    maxSpeed: number,
  ) {
    if (this.mode === 'chase') {
      this.updateChase(targetPos, heading, speed, maxSpeed);
    } else if (this.mode === 'follow') {
      // Follow mode uses chase logic but with gentler FOV
      this.updateChase(targetPos, heading, speed, maxSpeed);
    }
  }

  private updateChase(
    targetPos: THREE.Vector3,
    heading: number,
    speed: number,
    maxSpeed: number,
  ) {
    // Desired position: behind and above the vehicle
    _desired.set(
      targetPos.x - Math.sin(heading) * CHASE_DISTANCE,
      targetPos.y + CHASE_HEIGHT,
      targetPos.z - Math.cos(heading) * CHASE_DISTANCE,
    );

    if (!this.initialized) {
      this.smoothPos.copy(_desired);
      this.currentLookAt.copy(targetPos);
      this.initialized = true;
    }

    // Smooth position follow
    this.smoothPos.lerp(_desired, POSITION_LERP);
    this.camera.position.copy(this.smoothPos);

    // Look-at point: slightly ahead of the vehicle
    _lookTarget.set(
      targetPos.x + Math.sin(heading) * LOOK_AHEAD,
      targetPos.y + 1.5,
      targetPos.z + Math.cos(heading) * LOOK_AHEAD,
    );
    this.currentLookAt.lerp(_lookTarget, LOOK_LERP);
    this.camera.lookAt(this.currentLookAt);

    // Speed-based FOV
    const speedRatio = Math.min(Math.abs(speed) / maxSpeed, 1);
    const targetFOV = FOV_MIN + (FOV_MAX - FOV_MIN) * speedRatio;
    this.camera.fov += (targetFOV - this.camera.fov) * FOV_LERP;
    this.camera.updateProjectionMatrix();
  }

  /** Start spectator orbit mode around a center point. */
  startOrbit(center: THREE.Vector3) {
    this.mode = 'orbit';
    this.orbitCenter.copy(center);
    // Start orbit at the camera's current angle toward center
    this.orbitAngle = Math.atan2(
      this.camera.position.x - center.x,
      this.camera.position.z - center.z,
    );
  }

  /** Start following a specific racer (uses chase logic). */
  startFollow() {
    this.mode = 'follow';
  }

  /** Update orbit spectator camera. */
  updateOrbit(dt: number) {
    if (this.mode !== 'orbit') return;

    this.orbitAngle += ORBIT_SPEED * dt;
    _desired.set(
      this.orbitCenter.x + Math.sin(this.orbitAngle) * ORBIT_RADIUS,
      this.orbitCenter.y + ORBIT_HEIGHT,
      this.orbitCenter.z + Math.cos(this.orbitAngle) * ORBIT_RADIUS,
    );

    this.smoothPos.lerp(_desired, 0.03);
    this.camera.position.copy(this.smoothPos);

    _lookTarget.copy(this.orbitCenter);
    _lookTarget.y += 2;
    this.currentLookAt.lerp(_lookTarget, 0.04);
    this.camera.lookAt(this.currentLookAt);

    this.camera.fov += (SPECTATE_FOV - this.camera.fov) * FOV_LERP;
    this.camera.updateProjectionMatrix();
  }

  /** Reset for new race. */
  reset() {
    this.initialized = false;
    this.mode = 'chase';
    this.orbitAngle = 0;
  }
}
