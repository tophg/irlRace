/* ── Hood Racer — Race Replay System ── */

import * as THREE from 'three';

// ── Data Model ──

export interface ReplayFrame {
  // Position + motion
  x: number; y: number; z: number;
  heading: number; speed: number; time: number;
  // Vehicle visual state
  steer: number;          // -1..1 steering input
  wheelSpin: number;      // accumulated wheel rotation (radians)
  driftAngle: number;     // visual drift yaw offset
  bodyPitchX: number;     // body group pitch from acceleration/braking
  bodyRollZ: number;      // body group roll from cornering
  // VFX flags
  nitroActive?: boolean;
  engineHeat?: number;
  engineDead?: boolean;
  engineJustExploded?: boolean;
}

export interface ReplayEvent {
  time: number;
  type: 'explosion';
  vehicleId: string;
  x: number; y: number; z: number;
  speed: number; heading: number;
}

const MAX_FRAMES = 60 * 60 * 5; // ~5 minutes at 60fps

// ── Recorder ──

export class ReplayRecorder {
  private tracks = new Map<string, ReplayFrame[]>();
  private events: ReplayEvent[] = [];
  private startTime = 0;
  private recording = false;

  start() {
    this.tracks.clear();
    this.events.length = 0;
    this.startTime = performance.now();
    this.recording = true;
  }

  stop() {
    this.recording = false;
  }

  record(
    id: string, pos: THREE.Vector3, heading: number, speed: number,
    steer: number, wheelSpin: number, driftAngle: number,
    bodyPitchX: number, bodyRollZ: number,
    nitroActive?: boolean, engineHeat?: number,
    engineDead?: boolean, engineJustExploded?: boolean,
  ) {
    if (!this.recording) return;

    let frames = this.tracks.get(id);
    if (!frames) {
      frames = [];
      this.tracks.set(id, frames);
    }
    if (frames.length >= MAX_FRAMES) return;

    const time = performance.now() - this.startTime;

    frames.push({
      x: pos.x, y: pos.y, z: pos.z,
      heading, speed, time,
      steer, wheelSpin, driftAngle, bodyPitchX, bodyRollZ,
      nitroActive, engineHeat, engineDead, engineJustExploded,
    });

    // Record discrete explosion event
    if (engineJustExploded) {
      this.events.push({
        time, type: 'explosion', vehicleId: id,
        x: pos.x, y: pos.y, z: pos.z, speed, heading,
      });
    }
  }

  getTracks(): Map<string, ReplayFrame[]> { return this.tracks; }
  getEvents(): ReplayEvent[] { return this.events; }

  getDuration(): number {
    let max = 0;
    for (const frames of this.tracks.values()) {
      if (frames.length > 0) max = Math.max(max, frames[frames.length - 1].time);
    }
    return max;
  }

  hasData(): boolean {
    return this.tracks.size > 0 && this.getDuration() > 1000;
  }
}

// ── Camera Modes ──

export type ReplayCameraMode = 'chase' | 'orbit' | 'trackside' | 'helicopter' | 'free' | 'auto';

const AUTO_MODES: ReplayCameraMode[] = ['chase', 'orbit', 'trackside', 'helicopter'];
const MODE_DURATION = 6000; // switch angle every 6 seconds in auto mode

const _target = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _fallbackPos = new THREE.Vector3(); // reusable temp for fallback focus position

// ── Player ──

export type ExplosionCallback = (pos: THREE.Vector3, vehicleId: string, speed: number, heading: number) => void;
export type FrameUpdateCallback = (vehicleId: string, frame: ReplayFrame) => void;
export type LoopCallback = () => void;

export class ReplayPlayer {
  private tracks: Map<string, ReplayFrame[]>;
  private events: ReplayEvent[];
  private duration: number;
  private playbackTime = 0;
  private playing = false;
  private camera: THREE.PerspectiveCamera;
  private meshes = new Map<string, THREE.Group>();
  private smoothLookAt = new THREE.Vector3();
  private onExplosion?: ExplosionCallback;
  private onFrameUpdate?: FrameUpdateCallback;
  private onLoop?: LoopCallback;
  private explodedIds = new Set<string>();

  // ── Playback controls ──
  private _paused = false;
  private _speed = 1.0;
  private _focusTarget = 'local';
  private _cameraMode: ReplayCameraMode = 'auto';
  private autoModeIndex = 0;

  // ── Free camera state ──
  private freeAzimuth = 0;
  private freeElevation = 0.4;
  private freeDistance = 18;

  constructor(
    recorder: ReplayRecorder,
    camera: THREE.PerspectiveCamera,
    vehicleMeshes: Map<string, THREE.Group>,
    onExplosion?: ExplosionCallback,
    onFrameUpdate?: FrameUpdateCallback,
    onLoop?: LoopCallback,
  ) {
    this.tracks = recorder.getTracks();
    this.events = recorder.getEvents();
    this.duration = recorder.getDuration();
    this.camera = camera;
    this.meshes = vehicleMeshes;
    this.onExplosion = onExplosion;
    this.onFrameUpdate = onFrameUpdate;
    this.onLoop = onLoop;
  }

  start() {
    this.playbackTime = 0;
    this.playing = true;
    this._paused = false;
    this.autoModeIndex = 0;
    this.explodedIds.clear();
  }

  stop() { this.playing = false; }
  isPlaying(): boolean { return this.playing; }
  getProgress(): number { return this.duration > 0 ? this.playbackTime / this.duration : 0; }
  getDuration(): number { return this.duration; }
  getPlaybackTime(): number { return this.playbackTime; }

  // ── Playback controls ──
  get paused(): boolean { return this._paused; }
  togglePause() { this._paused = !this._paused; }
  pause() { this._paused = true; }
  resume() { this._paused = false; }

  get speed(): number { return this._speed; }
  setSpeed(s: number) { this._speed = Math.max(0.25, Math.min(4, s)); }
  cycleSpeedUp() {
    const speeds = [0.25, 0.5, 1, 2, 4];
    const idx = speeds.indexOf(this._speed);
    this._speed = speeds[Math.min(speeds.length - 1, idx + 1)] ?? 1;
  }
  cycleSpeedDown() {
    const speeds = [0.25, 0.5, 1, 2, 4];
    const idx = speeds.indexOf(this._speed);
    this._speed = speeds[Math.max(0, idx - 1)] ?? 1;
  }

  get focusTarget(): string { return this._focusTarget; }
  cycleFocusTarget() {
    const ids = Array.from(this.meshes.keys());
    const idx = ids.indexOf(this._focusTarget);
    this._focusTarget = ids[(idx + 1) % ids.length] ?? 'local';
  }
  setFocusTarget(id: string) { if (this.meshes.has(id)) this._focusTarget = id; }

  get cameraMode(): ReplayCameraMode { return this._cameraMode; }
  setCameraMode(mode: ReplayCameraMode) {
    this._cameraMode = mode;
    if (mode === 'free') {
      // Init free camera from current camera position
      const dir = new THREE.Vector3().subVectors(this.camera.position, _target);
      this.freeDistance = dir.length();
      this.freeAzimuth = Math.atan2(dir.x, dir.z);
      this.freeElevation = Math.asin(Math.max(-1, Math.min(1, dir.y / this.freeDistance)));
    }
  }

  // Free camera mouse input
  rotateFreeCam(deltaAzimuth: number, deltaElevation: number) {
    this.freeAzimuth += deltaAzimuth;
    this.freeElevation = Math.max(-0.1, Math.min(1.4, this.freeElevation + deltaElevation));
  }
  zoomFreeCam(delta: number) {
    this.freeDistance = Math.max(5, Math.min(60, this.freeDistance + delta));
  }

  seekTo(progress: number) {
    const oldTime = this.playbackTime;
    this.playbackTime = Math.max(0, Math.min(this.duration, progress * this.duration));
    // If seeking backwards, need to re-evaluate which explosions have passed
    if (this.playbackTime < oldTime) {
      this.explodedIds.clear();
      // Re-mark explosions that happened before new time
      for (const evt of this.events) {
        if (evt.time <= this.playbackTime) this.explodedIds.add(evt.vehicleId);
      }
    }
  }
  seekRelative(deltaMs: number) {
    this.seekTo((this.playbackTime + deltaMs) / this.duration);
  }

  // ── Main update ──
  update(dt: number): boolean {
    if (!this.playing) return false;

    if (!this._paused) {
      const oldTime = this.playbackTime;
      this.playbackTime += dt * 1000 * this._speed;

      if (this.playbackTime >= this.duration) {
        this.playbackTime = 0; // loop
        this.explodedIds.clear();
        this.onLoop?.();
      }

      // Fire discrete explosion events that fall in [oldTime, playbackTime]
      const tStart = oldTime;
      const tEnd = this.playbackTime;
      for (const evt of this.events) {
        if (evt.type === 'explosion' && !this.explodedIds.has(evt.vehicleId)) {
          if ((tStart < tEnd && evt.time >= tStart && evt.time < tEnd) ||
              (tStart > tEnd && (evt.time >= tStart || evt.time < tEnd))) {  // wrapped loop
            this.explodedIds.add(evt.vehicleId);
            if (this.onExplosion) {
              const pos = new THREE.Vector3(evt.x, evt.y, evt.z);
              this.onExplosion(pos, evt.vehicleId, evt.speed, evt.heading);
            }
          }
        }
      }
    }

    // Determine camera mode for this frame
    let activeMode: ReplayCameraMode;
    if (this._cameraMode === 'auto') {
      this.autoModeIndex = Math.floor(this.playbackTime / MODE_DURATION) % AUTO_MODES.length;
      activeMode = AUTO_MODES[this.autoModeIndex]!;
    } else {
      activeMode = this._cameraMode;
    }

    // Update all vehicle positions from replay data
    let focusPos: THREE.Vector3 | null = null;
    let focusHeading = 0;

    for (const [id, frames] of this.tracks) {
      const frame = this.interpolateFrame(frames, this.playbackTime);
      if (!frame) continue;

      const mesh = this.meshes.get(id);
      if (mesh) {
        mesh.position.set(frame.x, frame.y, frame.z);
        mesh.rotation.set(0, frame.heading, 0);
      }

      // Call frame update callback for VFX + visual state
      this.onFrameUpdate?.(id, frame);

      // Track focus target
      if (id === this._focusTarget) {
        focusPos = mesh?.position ?? _fallbackPos.set(frame.x, frame.y, frame.z);
        focusHeading = frame.heading;
      }
    }

    // Fallback: use first vehicle if focus target not found
    if (!focusPos) {
      for (const [, frames] of this.tracks) {
        const frame = this.interpolateFrame(frames, this.playbackTime);
        if (frame) {
          focusPos = _fallbackPos.set(frame.x, frame.y, frame.z);
          focusHeading = frame.heading;
          break;
        }
      }
    }

    if (focusPos) {
      this.updateCamera(activeMode, focusPos, focusHeading, this.playbackTime / 1000);
    }

    return true;
  }

  private interpolateFrame(frames: ReplayFrame[], time: number): ReplayFrame | null {
    if (frames.length === 0) return null;
    if (time <= frames[0].time) return frames[0];
    if (time >= frames[frames.length - 1].time) return frames[frames.length - 1];

    // Binary search for surrounding frames
    let lo = 0, hi = frames.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].time <= time) lo = mid;
      else hi = mid;
    }

    const a = frames[lo];
    const b = frames[hi];
    const t = (time - a.time) / (b.time - a.time);

    // Interpolate heading with angle wrapping
    let dh = b.heading - a.heading;
    if (dh > Math.PI) dh -= Math.PI * 2;
    if (dh < -Math.PI) dh += Math.PI * 2;

    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      heading: a.heading + dh * t,
      speed: a.speed + (b.speed - a.speed) * t,
      time,
      // Vehicle visual state — interpolate with angle-wrapping for wheelSpin
      steer: a.steer + (b.steer - a.steer) * t,
      wheelSpin: (() => {
        let dw = b.wheelSpin - a.wheelSpin;
        if (dw > Math.PI) dw -= Math.PI * 2;
        if (dw < -Math.PI) dw += Math.PI * 2;
        return a.wheelSpin + dw * t;
      })(),
      driftAngle: a.driftAngle + (b.driftAngle - a.driftAngle) * t,
      bodyPitchX: a.bodyPitchX + (b.bodyPitchX - a.bodyPitchX) * t,
      bodyRollZ: a.bodyRollZ + (b.bodyRollZ - a.bodyRollZ) * t,
      // Snap booleans from nearest frame (don't interpolate events)
      nitroActive: t < 0.5 ? a.nitroActive : b.nitroActive,
      engineHeat: a.engineHeat !== undefined && b.engineHeat !== undefined
        ? a.engineHeat + (b.engineHeat - a.engineHeat) * t : undefined,
      engineDead: t < 0.5 ? a.engineDead : b.engineDead,
      engineJustExploded: a.engineJustExploded || b.engineJustExploded,
    };
  }

  private updateCamera(mode: ReplayCameraMode, target: THREE.Vector3, heading: number, time: number) {
    _target.copy(target);
    _target.y += 1.5;

    switch (mode) {
      case 'chase': {
        const dist = 12;
        _camPos.set(
          target.x - Math.sin(heading) * dist,
          target.y + 5,
          target.z - Math.cos(heading) * dist,
        );
        break;
      }
      case 'orbit': {
        const angle = time * 0.3;
        const radius = 18;
        _camPos.set(
          target.x + Math.cos(angle) * radius,
          target.y + 6,
          target.z + Math.sin(angle) * radius,
        );
        break;
      }
      case 'trackside': {
        const side = Math.sin(heading) > 0 ? 1 : -1;
        _camPos.set(
          target.x + Math.cos(heading) * 20 * side,
          target.y + 2.5,
          target.z - Math.sin(heading) * 20 * side,
        );
        break;
      }
      case 'helicopter': {
        const hAngle = time * 0.15;
        _camPos.set(
          target.x + Math.cos(hAngle) * 30,
          target.y + 25,
          target.z + Math.sin(hAngle) * 30,
        );
        break;
      }
      case 'free': {
        const cosEl = Math.cos(this.freeElevation);
        _camPos.set(
          target.x + Math.sin(this.freeAzimuth) * cosEl * this.freeDistance,
          target.y + Math.sin(this.freeElevation) * this.freeDistance,
          target.z + Math.cos(this.freeAzimuth) * cosEl * this.freeDistance,
        );
        break;
      }
    }

    this.camera.position.lerp(_camPos, 0.05);
    this.smoothLookAt.lerp(_target, 0.08);
    this.camera.lookAt(this.smoothLookAt);
  }
}
