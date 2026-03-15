/* ── Hood Racer — Chase Camera + Spectator Mode ── */

import * as THREE from 'three';

let CHASE_DISTANCE = 1;
let CHASE_HEIGHT_RATIO = 3.2;  // height proportional to distance (adjustable via Shift+scroll)
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

// Mouse wheel controls — plain scroll = distance, Shift+scroll = tilt
window.addEventListener('wheel', (e) => {
  if (e.shiftKey) {
    // Shift+scroll adjusts camera tilt (height ratio)
    CHASE_HEIGHT_RATIO += e.deltaY * 0.01;
    CHASE_HEIGHT_RATIO = Math.max(0.5, Math.min(8, CHASE_HEIGHT_RATIO));
  } else {
    // Plain scroll adjusts chase distance
    CHASE_DISTANCE += e.deltaY * 0.005;
    CHASE_DISTANCE = Math.max(0.5, Math.min(20, CHASE_DISTANCE));
  }
}, { passive: true });

/** Set chase distance programmatically. */
export function setChaseDistance(d: number) {
  CHASE_DISTANCE = Math.max(0.5, Math.min(20, d));
}

/** Set chase tilt (height ratio) programmatically. */
export function setChaseTilt(ratio: number) {
  CHASE_HEIGHT_RATIO = Math.max(0.5, Math.min(8, ratio));
}

// Reusable temps to avoid per-frame allocations
const _desired = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _tiltQuat = new THREE.Quaternion();
const _localZ = new THREE.Vector3(0, 0, 1);

export type CameraMode = 'chase' | 'orbit' | 'follow';

export class VehicleCamera {
  private camera: THREE.PerspectiveCamera;
  private currentLookAt = new THREE.Vector3();
  private smoothPos = new THREE.Vector3();
  private initialized = false;

  mode: CameraMode = 'chase';
  private orbitAngle = 0;
  private orbitCenter = new THREE.Vector3();

  // Shake state
  private shakeIntensity = 0;
  private shakeDecay = 0;
  private driftTilt = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /** Update camera to follow a vehicle (chase mode). */
  update(
    targetPos: THREE.Vector3,
    heading: number,
    speed: number,
    maxSpeed: number,
    driftAngle = 0,
  ) {
    if (this.mode === 'chase') {
      this.updateChase(targetPos, heading, speed, maxSpeed, driftAngle);
    } else if (this.mode === 'follow') {
      this.updateChase(targetPos, heading, speed, maxSpeed, driftAngle);
    }
  }

  /** Trigger a camera shake (e.g. on collision). intensity 0–1. */
  shake(intensity: number) {
    this.shakeIntensity = Math.max(this.shakeIntensity, Math.min(intensity, 1));
    this.shakeDecay = 0.3; // 300ms decay
  }

  private updateChase(
    targetPos: THREE.Vector3,
    heading: number,
    speed: number,
    maxSpeed: number,
    driftAngle = 0,
  ) {
    // Desired position: behind and above the vehicle
    _desired.set(
      targetPos.x - Math.sin(heading) * CHASE_DISTANCE,
      targetPos.y + CHASE_HEIGHT_RATIO * Math.max(CHASE_DISTANCE, 1),
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

    // ── Camera effects ──

    // Collision shake (decaying noise)
    if (this.shakeIntensity > 0.001) {
      const t = performance.now() * 0.03;
      const sx = (Math.sin(t * 7.3) + Math.sin(t * 13.1)) * this.shakeIntensity * 0.3;
      const sy = (Math.sin(t * 11.7) + Math.sin(t * 5.3)) * this.shakeIntensity * 0.2;
      this.camera.position.x += sx;
      this.camera.position.y += sy;
      this.shakeDecay -= 1 / 60; // approximate dt
      if (this.shakeDecay <= 0) this.shakeIntensity = 0;
      else this.shakeIntensity *= 0.92;
    }

    // Speed vibration (subtle at high speed)
    if (speedRatio > 0.75) {
      const vib = (speedRatio - 0.75) * 4; // 0–1 above 75% speed
      const t2 = performance.now() * 0.05;
      this.camera.position.x += Math.sin(t2 * 23) * vib * 0.04;
      this.camera.position.y += Math.sin(t2 * 31) * vib * 0.02;
    }

    // Drift tilt (camera rolls toward drift direction) — apply via quaternion
    // to avoid corrupting the lookAt euler decomposition
    const targetTilt = driftAngle * 0.15;
    this.driftTilt += (targetTilt - this.driftTilt) * 0.06;
    if (Math.abs(this.driftTilt) > 0.001) {
      _tiltQuat.setFromAxisAngle(_localZ, this.driftTilt);
      this.camera.quaternion.multiply(_tiltQuat);
    }
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
