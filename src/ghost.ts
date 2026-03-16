/* ── Hood Racer — Ghost Car System ── */
/* Records the player's best lap as position/heading snapshots,
 * then replays it as a semi-transparent "ghost" car for time trial. */

import * as THREE from 'three';

// ── Configuration ──
const SAMPLE_RATE = 10; // snapshots per second (100ms interval)

// ── Snapshot Type ──
interface GhostSnapshot {
  x: number;
  y: number;
  z: number;
  heading: number;
}

// ── Storage ──
const STORAGE_KEY = 'hr-ghost';

interface GhostData {
  seed: number;
  carId: string;
  lapTime: number;        // ms
  snapshots: GhostSnapshot[];
}

// ── Recording State ──
let recording = false;
let currentSnapshots: GhostSnapshot[] = [];
let recordInterval: number | null = null;
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
  const snapshots = stopGhostRecording();
  if (snapshots.length < 5) return false; // Too short to be valid

  // Check if this beats the stored ghost for this seed
  const existing = loadGhostForSeed(seed);
  if (existing && existing.lapTime <= lapTime) return false;

  const data: GhostData = { seed, carId, lapTime, snapshots };
  try {
    const stored = loadAllGhosts();
    stored[seed.toString()] = data;
    // Keep only last 20 ghosts to limit storage
    const keys = Object.keys(stored);
    if (keys.length > 20) {
      delete stored[keys[0]];
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

  // Loop playback
  const t = elapsed % totalDuration;
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
    ghostMesh = null;
  }
  playbackActive = false;
  ghostData = null;
}
