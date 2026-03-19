/* ── IRL Race — Centralized Game Context ──
 *
 * All shared mutable state lives here as a single object.
 * Modules import `G` and read/write properties directly:
 *   import { G } from './game-context';
 *   G.gameState = GameState.RACING;  // ✅ works (mutating property)
 *
 * This pattern avoids the ES-module immutable-binding pitfall
 * where `import { gameState }` + `gameState = X` is illegal.
 */

import * as THREE from 'three/webgpu';
import { GameState, CarDef, CAR_ROSTER, type TrackData } from './types';
import { Vehicle } from './vehicle';
import { VehicleCamera } from './vehicle-camera';
import { RaceEngine } from './race-engine';
import { NetPeer } from './net-peer';
import { AIRacer } from './ai-racer';
import { ReplayRecorder, ReplayPlayer } from './replay';

// ── Detached-part descriptor (collision debris) ──
export interface DetachedPart {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  ax: number; ay: number; az: number;
  life: number;
  zone?: string;
  owner?: string;
}

// ── Race stats for post-race screen ──
export interface RaceStats {
  topSpeed: number;
  totalDriftTime: number;
  collisionCount: number;
  nearMissCount: number;
  avgPosition: number;
  positionSampleCount: number;
  overtakeCount: number;
  perfectStart: boolean;
  speedDemonTime: number; // seconds at top speed (>180 MPH)
}

function freshRaceStats(): RaceStats {
  return { topSpeed: 0, totalDriftTime: 0, collisionCount: 0, nearMissCount: 0, avgPosition: 0, positionSampleCount: 0, overtakeCount: 0, perfectStart: false, speedDemonTime: 0 };
}

/** The single shared game context. Import `G` everywhere. */
export const G = {
  // ── Core State ──
  gameState: GameState.TITLE as GameState,
  totalLaps: 3,
  selectedCar: CAR_ROSTER[0] as CarDef,
  trackSeed: null as number | null,
  localPlayerName: localStorage.getItem('hr-player-name') || `Racer_${Math.floor(Math.random() * 9999)}`,

  // ── Player Vehicle ──
  playerVehicle: null as Vehicle | null,
  vehicleCamera: null as VehicleCamera | null,

  // ── Track ──
  trackData: null as TrackData | null,
  checkpointMarkers: null as THREE.Group | null,

  // ── AI ──
  aiRacers: [] as AIRacer[],

  // ── Rear-View Mirror ──
  mirrorCamera: null as THREE.PerspectiveCamera | null,
  mirrorBorder: null as HTMLElement | null,

  // ── Race Engine ──
  raceEngine: null as RaceEngine | null,

  // ── Race Stats ──
  raceStats: freshRaceStats() as RaceStats,

  // ── Multiplayer ──
  netPeer: null as NetPeer | null,
  remoteMeshes: new Map<string, THREE.Group>(),
  remoteNameTags: new Map<string, THREE.Sprite>(),

  // ── Timing & Cooldowns ──
  lastTime: 0,
  raceStarting: false,
  driftSfxCooldown: 0,

  // ── Collision half-extents ──
  carHalf: new THREE.Vector3(0.85, 0.8, 2.2),

  // ── Reusable temp vectors (avoid per-frame GC) ──
  _defaultTangent: new THREE.Vector3(0, 0, 1),
  _remoteRayOrigin: new THREE.Vector3(),
  _remoteRayDir: new THREE.Vector3(0, -1, 0),
  _remoteRaycaster: new THREE.Raycaster(),
  _impactDir: new THREE.Vector3(),
  _sparkPos: new THREE.Vector3(),
  _flamePos: new THREE.Vector3(),
  _leftTireBlown: false,
  _rightTireBlown: false,
  _playerUnderglow: null as THREE.PointLight | null,
  _prevSpeedRatio: 0,
  _nearMissCooldowns: new Map<string, number>(),
  _wasNitroActive: false,
  remotePrevPos: new Map<string, { x: number; z: number }>(),

  // ── Replay ──
  replayRecorder: null as ReplayRecorder | null,
  replayPlayer: null as ReplayPlayer | null,

  // ── Spectator ──
  spectateTargetId: null as string | null,
  spectateHudEl: null as HTMLElement | null,

  // ── UI State ──
  prevMyRank: 0,
  sessionWins: new Map<string, number>(),
  postWinnerTimer: null as number | null,
  debugVisible: false,
  debugEl: null as HTMLElement | null,
  pauseOverlay: null as HTMLElement | null,
  loadingEl: null as HTMLElement | null,

  // ── Race Config ──
  aiCount: 4,
  aiDifficulty: 'medium' as 'easy' | 'medium' | 'hard',

  // ── Multiplayer Race Sync ──
  currentRaceSeed: 0,
  raceReadyCount: 0,
  mpPlayersList: [] as { id: string; name: string; carId: string }[],
  raceGoResolve: null as (() => void) | null,

  // ── Detached Parts ──
  detachedParts: [] as DetachedPart[],

  // ── Leaderboard ──
  lbEl: null as HTMLElement | null,
  lbLastUpdate: 0,

  // ── Physics Accumulator ──
  physicsAccumulator: 0,

  // ── Post-Processing ──
  postFXPipeline: null as { render(): void } | null,

  // ── Performance ──
  _lastShadowX: -999,
  _lastShadowZ: -999,
  _drsFrameTimes: new Array(30).fill(0) as number[],
  _drsWriteIdx: 0,

  // ── Track Editor / Race Config (typed to avoid `as any` smuggling) ──
  _customTrack: null as TrackData | null,
  _selectedWeather: null as string | null,
  _selectedEnvironment: null as string | null,
};

// ── Constants (not in G because they're truly immutable) ──
export const PHYSICS_HZ = 60;
export const PHYSICS_DT = 1 / PHYSICS_HZ;
export const MAX_FRAME_DT = 0.1;
export const LB_UPDATE_INTERVAL = 250; // ms — 4Hz

/** Reset race stats to zero. */
export function resetRaceStats() {
  G.raceStats = freshRaceStats();
}
