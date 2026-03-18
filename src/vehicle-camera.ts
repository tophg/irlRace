/* ── Hood Racer — Chase Camera + Spectator Mode ── */

import * as THREE from 'three';

let CHASE_DISTANCE = 5;
let CHASE_HEIGHT_RATIO = 0.45;  // height proportional to distance (adjustable via Shift+scroll)
const LOOK_AHEAD = 2;
const POSITION_LERP = 0.14;
const LOOK_LERP = 0.08;
const FOV_MIN = 60;
const FOV_MAX = 78;
const FOV_LERP = 0.04;

// Spectator orbit params
const ORBIT_RADIUS = 35;
const ORBIT_HEIGHT = 18;
const ORBIT_SPEED = 0.15; // radians/s
const SPECTATE_FOV = 65;

// Explosion orbit params (tight, dramatic)
const EXPLOSION_ORBIT_RADIUS = 8;
const EXPLOSION_ORBIT_HEIGHT = 3.5;
const EXPLOSION_ORBIT_SPEED = 0.7; // radians/s — fast dramatic rotation
const EXPLOSION_FOV = 55;

// ── Camera controls ──
// Scroll = distance, Shift+scroll = tilt, right-click drag = tilt, 2-finger swipe = tilt

window.addEventListener('wheel', (e) => {
  if (e.shiftKey) {
    CHASE_HEIGHT_RATIO += e.deltaY * 0.01;
    CHASE_HEIGHT_RATIO = Math.max(0.5, Math.min(8, CHASE_HEIGHT_RATIO));
  } else {
    CHASE_DISTANCE += e.deltaY * 0.005;
    CHASE_DISTANCE = Math.max(0, Math.min(20, CHASE_DISTANCE));
  }
}, { passive: true });

// Right-click drag — vertical movement adjusts tilt
let _rightDragging = false;
let _rightDragLastY = 0;

window.addEventListener('mousedown', (e) => {
  if (e.button === 2) { _rightDragging = true; _rightDragLastY = e.clientY; }
});
window.addEventListener('mousemove', (e) => {
  if (!_rightDragging) return;
  const dy = e.clientY - _rightDragLastY;
  _rightDragLastY = e.clientY;
  CHASE_HEIGHT_RATIO += dy * 0.02;
  CHASE_HEIGHT_RATIO = Math.max(0.5, Math.min(8, CHASE_HEIGHT_RATIO));
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 2) _rightDragging = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

// Two-finger vertical swipe (mobile) — adjusts tilt
let _twoFingerLastY = 0;
let _twoFingerActive = false;

window.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    _twoFingerActive = true;
    _twoFingerLastY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  }
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (!_twoFingerActive || e.touches.length !== 2) return;
  const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  const dy = midY - _twoFingerLastY;
  _twoFingerLastY = midY;
  CHASE_HEIGHT_RATIO += dy * 0.02;
  CHASE_HEIGHT_RATIO = Math.max(0.5, Math.min(8, CHASE_HEIGHT_RATIO));
}, { passive: true });
window.addEventListener('touchend', () => { _twoFingerActive = false; }, { passive: true });

/** Set chase distance programmatically. */
export function setChaseDistance(d: number) {
  CHASE_DISTANCE = Math.max(0, Math.min(20, d));
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

export type CameraMode = 'chase' | 'orbit' | 'follow' | 'explosion-orbit' | 'flyover';

export class VehicleCamera {
  private camera: THREE.PerspectiveCamera;
  private currentLookAt = new THREE.Vector3();
  private smoothPos = new THREE.Vector3();
  private initialized = false;

  mode: CameraMode = 'chase';
  private orbitAngle = 0;
  private explosionElapsed = 0;
  private orbitCenter = new THREE.Vector3();

  // Shake state
  private shakeIntensity = 0;
  private shakeDecay = 0;
  private driftTilt = 0;

  // Flyover state
  private flyoverSpline: THREE.CatmullRomCurve3 | null = null;
  private flyoverDuration = 6;
  private flyoverElapsed = 0;
  private flyoverComplete = false;

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
    dt = 1 / 60,
  ) {
    if (this.mode === 'chase') {
      this.updateChase(targetPos, heading, speed, maxSpeed, driftAngle, dt);
    } else if (this.mode === 'follow') {
      this.updateChase(targetPos, heading, speed, maxSpeed, driftAngle, dt);
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
    dt = 1 / 60,
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
      // Decay shake over shakeDecay seconds (frame-rate-independent)
      const decayRate = 1 / Math.max(this.shakeDecay, 0.01);
      this.shakeIntensity *= Math.exp(-decayRate * dt);
      if (this.shakeIntensity < 0.001) this.shakeIntensity = 0;
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

  /** Start dramatic multi-phase explosion cinematic. */
  startExplosionOrbit(center: THREE.Vector3) {
    this.mode = 'explosion-orbit';
    this.orbitCenter.copy(center);
    this.explosionElapsed = 0;
    // Start from current camera angle
    this.orbitAngle = Math.atan2(
      this.camera.position.x - center.x,
      this.camera.position.z - center.z,
    );
  }

  /** Multi-phase explosion cinematic camera. */
  updateExplosionOrbit(dt: number) {
    if (this.mode !== 'explosion-orbit') return;

    this.explosionElapsed += dt;
    const t = this.explosionElapsed;

    // ── Phase parameters based on elapsed time ──
    let radius: number, height: number, speed: number, fov: number;
    let posLerp: number, lookLerp: number, lookOffsetY: number;

    if (t < 0.5) {
      // Phase 1: IMPACT JOLT — camera jolts backward, heavy shake feel
      const p = t / 0.5; // 0→1
      const ease = p * p; // ease-in
      radius = 5 + ease * 3;     // 5→8 (push out from blast)
      height = 1.5 + ease * 1.0; // low angle, slightly rising
      speed = 0.3;               // slow orbit during jolt
      fov = 65 - ease * 10;      // 65→55 (zoom in for impact intimacy)
      posLerp = 0.15;            // snappy
      lookLerp = 0.12;
      lookOffsetY = 0.5;         // look at ground level wreck
    } else if (t < 2.0) {
      // Phase 2: LOW ORBIT — tight ground-level wreck view
      const p = (t - 0.5) / 1.5; // 0→1
      radius = 6;
      height = 1.5 + p * 0.5;    // very low, subtle rise
      speed = 0.5;               // moderate orbit
      fov = 55;                  // narrow cinematic
      posLerp = 0.06;            // smooth
      lookLerp = 0.06;
      lookOffsetY = 0.6;
    } else if (t < 3.5) {
      // Phase 3: RISING PULLBACK — dramatic reveal
      const p = (t - 2.0) / 1.5; // 0→1
      const ease = p * p * (3 - 2 * p); // smoothstep
      radius = 6 + ease * 12;    // 6→18 (pull back)
      height = 2.0 + ease * 10;  // 2→12 (rise dramatically)
      speed = 0.4 - ease * 0.15; // slowing orbit
      fov = 55 + ease * 15;      // 55→70 (widen for context)
      posLerp = 0.04;
      lookLerp = 0.05;
      lookOffsetY = 0.8 + ease * 1.5;
    } else {
      // Phase 4: WIDE STABILIZED — debris settling, final view
      radius = 18;
      height = 12;
      speed = 0.2;               // slow majestic orbit
      fov = 70;
      posLerp = 0.03;            // very smooth
      lookLerp = 0.04;
      lookOffsetY = 2.0;
    }

    // Apply orbit
    this.orbitAngle += speed * dt;
    _desired.set(
      this.orbitCenter.x + Math.sin(this.orbitAngle) * radius,
      this.orbitCenter.y + height,
      this.orbitCenter.z + Math.cos(this.orbitAngle) * radius,
    );

    this.smoothPos.lerp(_desired, posLerp);
    this.camera.position.copy(this.smoothPos);

    // Phase-matched camera shake
    let shakeAmp = 0;
    if (t < 0.5) shakeAmp = 0.35 * (1 - t / 0.5);           // heavy impact
    else if (t < 2.0) shakeAmp = 0.08;                        // rumble
    else if (t < 3.5) shakeAmp = 0.03;                        // settle
    // Secondary explosion shake spikes
    if (t > 0.9 && t < 1.2) shakeAmp = Math.max(shakeAmp, 0.15);
    if (t > 2.4 && t < 2.7) shakeAmp = Math.max(shakeAmp, 0.12);

    if (shakeAmp > 0.005) {
      this.camera.position.x += (Math.random() - 0.5) * shakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * shakeAmp * 0.7;
      this.camera.position.z += (Math.random() - 0.5) * shakeAmp;
    }

    // Look at wreck
    _lookTarget.copy(this.orbitCenter);
    _lookTarget.y += lookOffsetY;
    this.currentLookAt.lerp(_lookTarget, lookLerp);
    this.camera.lookAt(this.currentLookAt);

    // FOV transition
    this.camera.fov += (fov - this.camera.fov) * 0.05;
    this.camera.updateProjectionMatrix();
  }

  /** Start pre-race helicopter flyover — orbits above the start area. */
  startFlyover(spline: THREE.CatmullRomCurve3, duration = 5) {
    this.mode = 'flyover';
    this.flyoverSpline = spline;
    this.flyoverDuration = duration;
    this.flyoverElapsed = 0;
    this.flyoverComplete = false;

    // Orbit center = start/finish line
    const center = spline.getPointAt(0);
    this.orbitCenter.copy(center);
    this.orbitAngle = 0;

    // Initialize camera position
    const startX = center.x + Math.sin(0) * 50;
    const startZ = center.z + Math.cos(0) * 50;
    this.camera.position.set(startX, center.y + 35, startZ);
    this.currentLookAt.copy(center);
    this.currentLookAt.y += 2;
    this.camera.lookAt(this.currentLookAt);
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
  }

  /** Update flyover camera — helicopter orbit. Returns true when complete. */
  updateFlyover(dt: number): boolean {
    if (this.mode !== 'flyover') return true;

    this.flyoverElapsed += dt;
    const rawProgress = Math.min(this.flyoverElapsed / this.flyoverDuration, 1);

    // Orbit around start area
    this.orbitAngle += 0.4 * dt;
    const radius = 50;
    const height = 35;

    _desired.set(
      this.orbitCenter.x + Math.sin(this.orbitAngle) * radius,
      this.orbitCenter.y + height,
      this.orbitCenter.z + Math.cos(this.orbitAngle) * radius,
    );
    this.smoothPos.lerp(_desired, 0.06);
    this.camera.position.copy(this.smoothPos);

    // Look at center of start area
    _lookTarget.copy(this.orbitCenter);
    _lookTarget.y += 2;
    this.currentLookAt.lerp(_lookTarget, 0.05);
    this.camera.lookAt(this.currentLookAt);

    // Cinematic FOV
    this.camera.fov += (70 - this.camera.fov) * 0.05;
    this.camera.updateProjectionMatrix();

    if (rawProgress >= 1) {
      this.flyoverComplete = true;
      this.initialized = false;
      this.camera.fov = FOV_MIN;
      this.camera.updateProjectionMatrix();
      return true;
    }
    return false;
  }

  /** Check if flyover is complete. */
  isFlyoverComplete(): boolean {
    return this.flyoverComplete;
  }

  /** Force-end the flyover (skip). */
  skipFlyover() {
    this.flyoverComplete = true;
    this.mode = 'chase';
    this.initialized = false; // force chase cam to snap to correct position
    this.camera.fov = FOV_MIN;
    this.camera.updateProjectionMatrix();
  }

  /** Reset for new race. */
  reset() {
    this.initialized = false;
    this.mode = 'chase';
    this.orbitAngle = 0;
    this.flyoverComplete = false;
    this.flyoverElapsed = 0;
    this.flyoverSpline = null;
  }
}
