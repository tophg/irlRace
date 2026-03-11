/* ── Hood Racer — Shared Types ── */

import * as THREE from 'three';
import type { SplineBVH } from './bvh';

// ── Game States ──
export enum GameState {
  TITLE,
  GARAGE,
  LOBBY,
  COUNTDOWN,
  RACING,
  PAUSED,
  RESULTS,
}

// ── Car Roster ──
export interface CarDef {
  id: string;
  name: string;
  file: string;
  maxSpeed: number;       // units/s
  acceleration: number;   // units/s²
  handling: number;       // base steer rate rad/s
  braking: number;        // deceleration units/s²
  driftFactor: number;    // visual drift multiplier for VFX
  gripCoeff: number;      // tyre grip coefficient (Pacejka D scaling, 0.4=ice..1.2=slicks)
  latFriction: number;    // cornering stiffness (Pacejka B scaling, high=snappy, low=lazy)
  suspStiffness: number;  // visual body-roll intensity
  steerSpeed: number;     // how fast steering reaches target (rad/s)
  driftThreshold: number; // slip angle that initiates visible drift
  mass: number;           // vehicle mass kg (weight transfer, damage, inertia)
  cgHeight: number;       // CG height ratio (weight transfer sensitivity, 0.05–0.3)
  frontBias: number;      // static front axle weight fraction (0.5=even)
}

export const CAR_ROSTER: CarDef[] = [
  // Camry SE — reliable all-rounder, predictable and stable
  { id: 'camry_blue',  name: 'Camry SE',        file: 'blue_camry.glb',    maxSpeed: 70, acceleration: 28, handling: 2.4, braking: 45, driftFactor: 0.30, gripCoeff: 0.85, latFriction: 5.5, suspStiffness: 0.04, steerSpeed: 3.0,  driftThreshold: 0.12, mass: 1500, cgHeight: 0.12, frontBias: 0.54 },
  // Camry LE — better grip, forgiving, great for beginners
  { id: 'camry_white', name: 'Camry LE',        file: 'white_camry.glb',   maxSpeed: 65, acceleration: 30, handling: 2.6, braking: 48, driftFactor: 0.22, gripCoeff: 0.92, latFriction: 6.5, suspStiffness: 0.03, steerSpeed: 3.2,  driftThreshold: 0.15, mass: 1480, cgHeight: 0.11, frontBias: 0.53 },
  // Altima SR — fastest top speed but loose rear, rewards skilled driving
  { id: 'altima',      name: 'Altima SR',       file: 'Nissan_Altima.glb', maxSpeed: 78, acceleration: 26, handling: 2.0, braking: 42, driftFactor: 0.38, gripCoeff: 0.78, latFriction: 4.0, suspStiffness: 0.05, steerSpeed: 2.6,  driftThreshold: 0.10, mass: 1550, cgHeight: 0.16, frontBias: 0.57 },
  // Maxima Platinum — heavy cruiser, strong accel, planted but slow to turn
  { id: 'maxima',      name: 'Maxima Platinum', file: 'Nissan_Maxima.glb', maxSpeed: 72, acceleration: 33, handling: 1.9, braking: 44, driftFactor: 0.28, gripCoeff: 0.82, latFriction: 5.0, suspStiffness: 0.04, steerSpeed: 2.8,  driftThreshold: 0.11, mass: 1650, cgHeight: 0.14, frontBias: 0.55 },
  // WRX STI Rally — best grip, neutral AWD balance, sharp turn-in
  { id: 'wrx_rally',   name: 'WRX STI Rally',   file: 'Subaru_WRX1.glb',  maxSpeed: 68, acceleration: 34, handling: 3.0, braking: 50, driftFactor: 0.18, gripCoeff: 1.05, latFriction: 7.0, suspStiffness: 0.03, steerSpeed: 3.5,  driftThreshold: 0.18, mass: 1430, cgHeight: 0.10, frontBias: 0.47 },
  // WRX STI Street — drift missile, low grip, huge slide, fun but wild
  { id: 'wrx_street',  name: 'WRX STI Street',  file: 'Subaru_WRX2.glb',  maxSpeed: 66, acceleration: 30, handling: 2.5, braking: 46, driftFactor: 0.50, gripCoeff: 0.68, latFriction: 3.2, suspStiffness: 0.06, steerSpeed: 2.5,  driftThreshold: 0.08, mass: 1400, cgHeight: 0.13, frontBias: 0.50 },
];

// ── Damage ──
export interface DamageZone {
  hp: number;           // 0–100, 100 = pristine
  deformAmount: number; // accumulated deformation magnitude
}

export interface DamageState {
  front: DamageZone;
  rear: DamageZone;
  left: DamageZone;
  right: DamageZone;
}

export function createDamageState(): DamageState {
  return {
    front: { hp: 100, deformAmount: 0 },
    rear:  { hp: 100, deformAmount: 0 },
    left:  { hp: 100, deformAmount: 0 },
    right: { hp: 100, deformAmount: 0 },
  };
}

// ── Track ──
export interface Checkpoint {
  position: THREE.Vector3;
  tangent: THREE.Vector3;   // forward direction at this CP
  index: number;
}

export interface TrackData {
  spline: THREE.CatmullRomCurve3;
  roadMesh: THREE.Mesh;
  barrierLeft: THREE.Mesh;
  barrierRight: THREE.Mesh;
  checkpoints: Checkpoint[];
  sceneryGroup: THREE.Group;
  totalLength: number;
  bvh: SplineBVH;
  speedProfile: number[];
  curvatures: number[];
}

// ── Vehicle Runtime ──
export interface VehicleState {
  position: THREE.Vector3;
  heading: number;    // radians
  speed: number;      // current speed units/s
  steer: number;      // -1..1
  throttle: number;   // 0..1
  brake: number;      // 0..1
  driftAngle: number;
}

// ── Race Progress ──
export interface RacerProgress {
  id: string;
  lapIndex: number;
  checkpointIndex: number;
  finished: boolean;
  finishTime: number;
  position: THREE.Vector3;
  dnf?: boolean;
  lapTimes: number[];
  lastLapStart: number;
}

// ── Network Packets ──
export enum PacketType {
  STATE = 1,
  EVENT = 2,
  PING = 3,
  PONG = 4,
  STATE_RELAY = 5,
  EVENT_RELAY = 6,
}

export enum EventType {
  JOIN = 1,
  LEAVE = 2,
  COUNTDOWN_START = 3,
  CHECKPOINT_HIT = 4,
  LAP_COMPLETE = 5,
  RACE_FINISH = 6,
  CAR_SELECT = 7,
  REMATCH_REQUEST = 8,
  REMATCH_ACCEPT = 9,
  PLAYER_READY = 10,
  PLAYER_LIST = 11,
}

// ── Input ──
export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  boost: boolean;
  steerAnalog: number; // -1..1 proportional steering (touch/tilt), 0 = center
}
