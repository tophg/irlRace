/* ── Hood Racer — Chase Camera ── */

import * as THREE from 'three';

const CHASE_DISTANCE = 10;
const CHASE_HEIGHT = 4.5;
const LOOK_AHEAD = 4;
const POSITION_LERP = 0.06;
const LOOK_LERP = 0.08;
const FOV_MIN = 60;
const FOV_MAX = 78;
const FOV_LERP = 0.04;

export class VehicleCamera {
  private camera: THREE.PerspectiveCamera;
  private currentLookAt = new THREE.Vector3();
  private smoothPos = new THREE.Vector3();
  private initialized = false;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /** Update camera to follow a vehicle. */
  update(
    targetPos: THREE.Vector3,
    heading: number,
    speed: number,
    maxSpeed: number,
  ) {
    // Desired position: behind and above the vehicle
    const desiredX = targetPos.x - Math.sin(heading) * CHASE_DISTANCE;
    const desiredY = targetPos.y + CHASE_HEIGHT;
    const desiredZ = targetPos.z - Math.cos(heading) * CHASE_DISTANCE;

    const desired = new THREE.Vector3(desiredX, desiredY, desiredZ);

    if (!this.initialized) {
      this.smoothPos.copy(desired);
      this.currentLookAt.copy(targetPos);
      this.initialized = true;
    }

    // Smooth position follow
    this.smoothPos.lerp(desired, POSITION_LERP);
    this.camera.position.copy(this.smoothPos);

    // Look-at point: slightly ahead of the vehicle
    const lookTarget = new THREE.Vector3(
      targetPos.x + Math.sin(heading) * LOOK_AHEAD,
      targetPos.y + 1.5,
      targetPos.z + Math.cos(heading) * LOOK_AHEAD,
    );
    this.currentLookAt.lerp(lookTarget, LOOK_LERP);
    this.camera.lookAt(this.currentLookAt);

    // Speed-based FOV
    const speedRatio = Math.min(Math.abs(speed) / maxSpeed, 1);
    const targetFOV = FOV_MIN + (FOV_MAX - FOV_MIN) * speedRatio;
    this.camera.fov += (targetFOV - this.camera.fov) * FOV_LERP;
    this.camera.updateProjectionMatrix();
  }

  /** Reset for new race. */
  reset() {
    this.initialized = false;
  }
}
