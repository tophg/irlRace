/* ── Hood Racer — Ghost Car System ── */
/* Records the player's best lap as position/heading snapshots,
 * then replays it as a semi-transparent "ghost" car for time trial. */

import * as THREE from 'three/webgpu';

// ── Configuration ──
const SAMPLE_RATE = 10; // snapshots per second (100ms interval)

// ── Snapshot Type ──
interface GhostSnapshot {
  x: number;
  y: number;
  z: number;
  heading: number;
  // VFX replay fields (optional)
  nitroActive?: boolean;
  engineHeat?: number;
}

// ── Storage ──
const STORAGE_KEY = 'hr-ghost';

interface GhostData {
  seed: number;
  carId: string;
  lapTime: number;        // ms
  timestamp: number;      // ms since epoch (for LRU eviction)
  snapshots: GhostSnapshot[];
}

// ── Recording State ──
let recording = false;
let currentSnapshots: GhostSnapshot[] = [];
let lapStartTime = 0;

// ── Playback State ──
let ghostMesh: THREE.Group | null = null;
let ghostData: GhostData | null = null;
let playbackActive = false;
let playbackStartTime = 0;

/** Start recording a new lap. Call at the start of each lap. */
export function startGhostRecording(position: THREE.Vector3, heading: number) {
  stopGhostRecording();
  recording = true;
  currentSnapshots = [{ x: position.x, y: position.y, z: position.z, heading }];
  lapStartTime = performance.now();
}

/** Sample the current position/heading. Call during the racing loop. */
export function sampleGhostFrame(position: THREE.Vector3, heading: number) {
  if (!recording) return;
  const elapsed = performance.now() - lapStartTime;
  // Only sample at ~SAMPLE_RATE hz
  const expectedSamples = Math.floor(elapsed / (1000 / SAMPLE_RATE));
  if (currentSnapshots.length <= expectedSamples) {
    currentSnapshots.push({ x: position.x, y: position.y, z: position.z, heading });
  }
}

/** Stop recording and return the lap data. */
export function stopGhostRecording(): GhostSnapshot[] {
  recording = false;
  const result = currentSnapshots;
  currentSnapshots = [];
  return result;
}

/**
 * Finalize a lap recording and save if it's a new best.
 * Returns true if this was a new best time.
 */
export function finalizeGhostLap(
  lapTime: number,
  seed: number,
  carId: string,
): boolean {
  // Capture snapshots BEFORE stopping, in case startGhostRecording was
  // already called for the next lap (which would clear currentSnapshots).
  const snapshots = currentSnapshots.length > 0 ? [...currentSnapshots] : stopGhostRecording();
  if (recording) stopGhostRecording(); // clean up recording state
  if (snapshots.length < 5) return false; // Too short to be valid

  // Check if this beats the stored ghost for this seed
  const existing = loadGhostForSeed(seed);
  if (existing && existing.lapTime <= lapTime) return false;

  const data: GhostData = { seed, carId, lapTime, timestamp: Date.now(), snapshots };
  try {
    const stored = loadAllGhosts();
    // Enforce 1 ghost per track seed (save best, overwrite old)
    stored[seed.toString()] = data;
    
    // Keep only 20 ghosts total — evict the Least Recently Used (oldest timestamp)
    const keys = Object.keys(stored);
    if (keys.length > 20) {
      let oldestKey = keys[0];
      let oldestTime = stored[oldestKey].timestamp;
      for (const k of keys) {
        if (stored[k].timestamp < oldestTime) {
          oldestTime = stored[k].timestamp;
          oldestKey = k;
        }
      }
      delete stored[oldestKey];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {}
  return true;
}

/** Load ghost for a specific track seed. */
export function loadGhostForSeed(seed: number): GhostData | null {
  const stored = loadAllGhosts();
  return stored[seed.toString()] ?? null;
}

function loadAllGhosts(): Record<string, GhostData> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// ── Playback ──

/** Create a ghost car mesh (semi-transparent clone) and start playback. */
export function startGhostPlayback(scene: THREE.Scene, data: GhostData) {
  destroyGhost(scene);
  ghostData = data;

  // Create a simple ghost car mesh (semi-transparent box)
  const group = new THREE.Group();
  const bodyGeo = new THREE.BoxGeometry(1.6, 0.8, 4.0);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x44aaff,
    transparent: true,
    opacity: 0.3,
    emissive: new THREE.Color(0x44aaff),
    emissiveIntensity: 0.4,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.5;
  group.add(body);

  // Roof
  const roofGeo = new THREE.BoxGeometry(1.3, 0.5, 2.0);
  const roof = new THREE.Mesh(roofGeo, bodyMat.clone());
  roof.position.y = 1.1;
  roof.position.z = -0.2;
  group.add(roof);

  scene.add(group);
  ghostMesh = group;
  playbackActive = true;
  playbackStartTime = performance.now();
}

/** Update ghost playback position from recorded data. Call every frame. */
export function updateGhostPlayback() {
  if (!playbackActive || !ghostData || !ghostMesh) return;

  const elapsed = performance.now() - playbackStartTime;
  const sampleInterval = 1000 / SAMPLE_RATE;
  const totalDuration = ghostData.snapshots.length * sampleInterval;

  const t = Math.min(elapsed, totalDuration);
  const idx = Math.floor(t / sampleInterval);
  const frac = (t / sampleInterval) - idx;

  const snaps = ghostData.snapshots;
  if (idx >= snaps.length) return;

  const a = snaps[idx];
  const b = snaps[Math.min(idx + 1, snaps.length - 1)];

  // Interpolate position
  ghostMesh.position.x = a.x + (b.x - a.x) * frac;
  ghostMesh.position.y = a.y + (b.y - a.y) * frac;
  ghostMesh.position.z = a.z + (b.z - a.z) * frac;

  // Interpolate heading (handle wrapping)
  let dh = b.heading - a.heading;
  if (dh > Math.PI) dh -= Math.PI * 2;
  if (dh < -Math.PI) dh += Math.PI * 2;
  ghostMesh.rotation.y = a.heading + dh * frac;

  // Fade out slightly when finished rather than looping infinitely
  if (elapsed > totalDuration) {
    const fadeOutDuration = 2000; // ms
    const fadeFrac = Math.min((elapsed - totalDuration) / fadeOutDuration, 1);
    const targetOpacity = 0.3 * (1 - fadeFrac);
    ghostMesh.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.opacity = targetOpacity;
      }
    });
  }
}

/** Get the ghost's best lap time formatted string. */
export function getGhostBestTime(seed: number): string | null {
  const data = loadGhostForSeed(seed);
  if (!data) return null;
  const s = data.lapTime / 1000;
  const min = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3);
  return `${min}:${sec.padStart(6, '0')}`;
}

/** Clean up ghost from the scene. */
export function destroyGhost(scene: THREE.Scene) {
  if (ghostMesh) {
    scene.remove(ghostMesh);
    
    // Dispose explicitly to prevent memory leaks across lap restarts
    ghostMesh.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      }
    });

    ghostMesh = null;
  }
  playbackActive = false;
  ghostData = null;
}
