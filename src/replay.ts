/* ── Hood Racer — Race Replay System ── */

import * as THREE from 'three';

interface ReplayFrame {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  time: number;
}

interface ReplayTrack {
  id: string;
  frames: ReplayFrame[];
}

const MAX_FRAMES = 60 * 60 * 5; // ~5 minutes at 60fps

export class ReplayRecorder {
  private tracks = new Map<string, ReplayFrame[]>();
  private startTime = 0;
  private recording = false;

  start() {
    this.tracks.clear();
    this.startTime = performance.now();
    this.recording = true;
  }

  stop() {
    this.recording = false;
  }

  record(id: string, pos: THREE.Vector3, heading: number, speed: number) {
    if (!this.recording) return;

    let frames = this.tracks.get(id);
    if (!frames) {
      frames = [];
      this.tracks.set(id, frames);
    }
    if (frames.length >= MAX_FRAMES) return;

    frames.push({
      x: pos.x, y: pos.y, z: pos.z,
      heading, speed,
      time: performance.now() - this.startTime,
    });
  }

  getTracks(): Map<string, ReplayFrame[]> {
    return this.tracks;
  }

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

// Camera angle types for cinematic playback
type CameraMode = 'chase' | 'orbit' | 'trackside' | 'helicopter';

const CAMERA_MODES: CameraMode[] = ['chase', 'orbit', 'trackside', 'helicopter'];
const MODE_DURATION = 6000; // switch angle every 6 seconds

const _target = new THREE.Vector3();
const _camPos = new THREE.Vector3();

export class ReplayPlayer {
  private tracks: Map<string, ReplayFrame[]>;
  private duration: number;
  private playbackTime = 0;
  private playing = false;
  private camera: THREE.PerspectiveCamera;
  private meshes = new Map<string, THREE.Group>();
  private modeIndex = 0;
  private smoothLookAt = new THREE.Vector3();

  constructor(
    recorder: ReplayRecorder,
    camera: THREE.PerspectiveCamera,
    vehicleMeshes: Map<string, THREE.Group>,
  ) {
    this.tracks = recorder.getTracks();
    this.duration = recorder.getDuration();
    this.camera = camera;
    this.meshes = vehicleMeshes;
  }

  start() {
    this.playbackTime = 0;
    this.playing = true;
    this.modeIndex = 0;
  }

  stop() {
    this.playing = false;
  }

  isPlaying(): boolean { return this.playing; }
  getProgress(): number { return this.duration > 0 ? this.playbackTime / this.duration : 0; }

  update(dt: number): boolean {
    if (!this.playing) return false;

    this.playbackTime += dt * 1000;
    if (this.playbackTime >= this.duration) {
      this.playbackTime = 0; // loop
    }

    // Switch camera mode periodically
    this.modeIndex = Math.floor(this.playbackTime / MODE_DURATION) % CAMERA_MODES.length;
    const mode = CAMERA_MODES[this.modeIndex];

    // Update all vehicle positions from replay data
    let primaryPos: THREE.Vector3 | null = null;
    let primaryHeading = 0;

    for (const [id, frames] of this.tracks) {
      const frame = this.interpolateFrame(frames, this.playbackTime);
      if (!frame) continue;

      const mesh = this.meshes.get(id);
      if (mesh) {
        mesh.position.set(frame.x, frame.y, frame.z);
        mesh.rotation.y = frame.heading;
      }

      if (!primaryPos) {
        primaryPos = mesh?.position ?? new THREE.Vector3(frame.x, frame.y, frame.z);
        primaryHeading = frame.heading;
      }
    }

    if (!primaryPos) return true;

    // Cinematic camera
    this.updateCamera(mode, primaryPos, primaryHeading, this.playbackTime / 1000);

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
    };
  }

  private updateCamera(mode: CameraMode, target: THREE.Vector3, heading: number, time: number) {
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
    }

    this.camera.position.lerp(_camPos, 0.05);
    this.smoothLookAt.lerp(_target, 0.08);
    this.camera.lookAt(this.smoothLookAt);
  }
}
