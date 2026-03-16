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
  TRACK_EDITOR,
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
  // ── ENTRY TIER ──
  // Civic — all-rounder, predictable and stable, the default
  { id: 'civic',       name: 'Civic',       file: 'blue_camry.glb',    maxSpeed: 68, acceleration: 28, handling: 2.4, braking: 45, driftFactor: 0.28, gripCoeff: 0.85, latFriction: 5.5, suspStiffness: 0.04, steerSpeed: 3.0,  driftThreshold: 0.12, mass: 1500, cgHeight: 0.12, frontBias: 0.54 },
  // Haven — beginner-friendly, forgiving grip, smooth ride
  { id: 'haven',       name: 'Haven',       file: 'white_camry.glb',   maxSpeed: 65, acceleration: 30, handling: 2.6, braking: 48, driftFactor: 0.20, gripCoeff: 0.95, latFriction: 6.5, suspStiffness: 0.03, steerSpeed: 3.2,  driftThreshold: 0.15, mass: 1480, cgHeight: 0.11, frontBias: 0.53 },


  // ── MID TIER ──
  // Phantom — loose rear, rewards aggression, high mid-tier speed
  { id: 'phantom',     name: 'Phantom',     file: 'Nissan_Altima.glb',  maxSpeed: 76, acceleration: 27, handling: 2.1, braking: 42, driftFactor: 0.40, gripCoeff: 0.78, latFriction: 4.0, suspStiffness: 0.05, steerSpeed: 2.6,  driftThreshold: 0.10, mass: 1550, cgHeight: 0.16, frontBias: 0.57 },
  // Monarch — heavy cruiser, strong accel, planted but slow to turn
  { id: 'monarch',     name: 'Monarch',     file: 'Nissan_Maxima.glb',  maxSpeed: 73, acceleration: 33, handling: 1.9, braking: 44, driftFactor: 0.26, gripCoeff: 0.84, latFriction: 5.0, suspStiffness: 0.04, steerSpeed: 2.8,  driftThreshold: 0.11, mass: 1650, cgHeight: 0.14, frontBias: 0.55 },
  // Rally — AWD grip machine, best handling in class, sharp turn-in
  { id: 'rally',       name: 'Rally',       file: 'Subaru_WRX1.glb',   maxSpeed: 72, acceleration: 34, handling: 3.0, braking: 50, driftFactor: 0.18, gripCoeff: 1.05, latFriction: 7.0, suspStiffness: 0.03, steerSpeed: 3.5,  driftThreshold: 0.18, mass: 1430, cgHeight: 0.10, frontBias: 0.47 },

  // ── EXOTIC TIER ──
  // Venom — dramatic drift character, spectacular slides, high speed
  { id: 'venom',       name: 'Venom',       file: 'Ferrari.glb',        maxSpeed: 83, acceleration: 34, handling: 2.3, braking: 50, driftFactor: 0.44, gripCoeff: 0.80, latFriction: 4.5, suspStiffness: 0.05, steerSpeed: 2.8,  driftThreshold: 0.09, mass: 1380, cgHeight: 0.09, frontBias: 0.44 },
  // Precision — surgical accuracy, balanced, rear-engine snap oversteer
  { id: 'precision',   name: 'Precision',   file: 'Porsche_911.glb',    maxSpeed: 80, acceleration: 32, handling: 2.9, braking: 52, driftFactor: 0.24, gripCoeff: 0.96, latFriction: 6.0, suspStiffness: 0.03, steerSpeed: 3.4,  driftThreshold: 0.13, mass: 1420, cgHeight: 0.09, frontBias: 0.40 },
  // Apex — rally-bred monster, raw turbo power, explosive acceleration
  { id: 'apex',        name: 'Apex',        file: 'Subaru_WRX3.glb',   maxSpeed: 78, acceleration: 38, handling: 2.8, braking: 48, driftFactor: 0.30, gripCoeff: 1.00, latFriction: 6.5, suspStiffness: 0.04, steerSpeed: 3.3,  driftThreshold: 0.14, mass: 1380, cgHeight: 0.10, frontBias: 0.48 },

  // ── ELITE TIER ──
  // Diablo — top speed king, lightweight, fragile glass cannon
  { id: 'diablo',      name: 'Diablo',      file: 'Lamborghini.glb',    maxSpeed: 92, acceleration: 36, handling: 2.2, braking: 55, driftFactor: 0.36, gripCoeff: 0.88, latFriction: 5.5, suspStiffness: 0.04, steerSpeed: 3.2,  driftThreshold: 0.10, mass: 1320, cgHeight: 0.08, frontBias: 0.42 },
  // Shadow — grip king, planted at all speeds, composed cornering
  { id: 'shadow',      name: 'Shadow',      file: 'Subaru_WRX4.glb',   maxSpeed: 85, acceleration: 32, handling: 3.4, braking: 52, driftFactor: 0.14, gripCoeff: 1.12, latFriction: 7.5, suspStiffness: 0.03, steerSpeed: 3.6,  driftThreshold: 0.20, mass: 1400, cgHeight: 0.09, frontBias: 0.46 },
];

// ── Damage ──
export interface DamageZone {
  hp: number;           // 0–100, 100 = pristine
  deformAmount: number; // accumulated deformation magnitude
  glassBroken: boolean; // headlight/glass particles already emitted
}

export interface DamageState {
  front: DamageZone;
  rear: DamageZone;
  left: DamageZone;
  right: DamageZone;
}

export function createDamageState(): DamageState {
  return {
    front: { hp: 100, deformAmount: 0, glassBroken: false },
    rear:  { hp: 100, deformAmount: 0, glassBroken: false },
    left:  { hp: 100, deformAmount: 0, glassBroken: false },
    right: { hp: 100, deformAmount: 0, glassBroken: false },
  };
}

// ── Track ──
export interface Checkpoint {
  position: THREE.Vector3;
  tangent: THREE.Vector3;   // forward direction at this CP
  index: number;
  t: number;                // spline parameter (0–1)
}

export interface TrackData {
  spline: THREE.CatmullRomCurve3;
  roadMesh: THREE.Mesh;
  barrierLeft: THREE.Mesh;
  barrierRight: THREE.Mesh;
  shoulderMesh: THREE.Mesh;
  kerbGroup: THREE.Group;
  checkpoints: Checkpoint[];
  sceneryGroup: THREE.Group;
  totalLength: number;
  bvh: SplineBVH;
  speedProfile: number[];
  curvatures: number[];
}

// ── Custom Track (user-created in editor) ──
export interface CustomTrackDef {
  name: string;
  controlPoints: { x: number; z: number }[];
  elevations?: number[];
  createdAt: number;
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
  trackT: number;       // fractional progress within current checkpoint segment (0–1)
  prevT: number;        // previous frame's raw spline t (for wraparound detection)
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
  INPUT = 7,
  INPUT_RELAY = 8,
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
  RACE_READY = 12,
  RACE_GO = 13,
  CHAT = 14,
  KICK = 15,
  EMOTE = 16,
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
