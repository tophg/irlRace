/* ── Hood Racer — Shared Types ── */

import * as THREE from 'three';

// ── Game States ──
export enum GameState {
  TITLE,
  GARAGE,
  LOBBY,
  COUNTDOWN,
  RACING,
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
  driftFactor: number;    // 0–1, higher = more slide
  // ── Phase 1 physics params ──
  gripCoeff: number;      // friction circle radius (0.4=ice..1.2=race slicks)
  latFriction: number;    // lateral damping (high=grippy, low=slidey)
  suspStiffness: number;  // visual roll intensity
  steerSpeed: number;     // how fast steering reaches target (rad/s)
  driftThreshold: number; // slip angle that initiates visible drift
}

export const CAR_ROSTER: CarDef[] = [
  { id: 'camry_blue',  name: 'Camry SE',        file: 'blue_camry.glb',    maxSpeed: 70, acceleration: 28, handling: 2.2, braking: 45, driftFactor: 0.30, gripCoeff: 0.85, latFriction: 6.0, suspStiffness: 0.04, steerSpeed: 3.0,  driftThreshold: 0.12 },
  { id: 'camry_white', name: 'Camry LE',        file: 'white_camry.glb',   maxSpeed: 65, acceleration: 30, handling: 2.4, braking: 48, driftFactor: 0.25, gripCoeff: 0.90, latFriction: 7.0, suspStiffness: 0.03, steerSpeed: 3.2,  driftThreshold: 0.15 },
  { id: 'altima',      name: 'Altima SR',       file: 'Nissan_Altima.glb', maxSpeed: 78, acceleration: 25, handling: 2.0, braking: 42, driftFactor: 0.35, gripCoeff: 0.75, latFriction: 4.5, suspStiffness: 0.05, steerSpeed: 2.6,  driftThreshold: 0.10 },
  { id: 'maxima',      name: 'Maxima Platinum', file: 'Nissan_Maxima.glb', maxSpeed: 72, acceleration: 32, handling: 2.1, braking: 44, driftFactor: 0.32, gripCoeff: 0.80, latFriction: 5.5, suspStiffness: 0.04, steerSpeed: 2.8,  driftThreshold: 0.11 },
  { id: 'wrx_rally',   name: 'WRX STI Rally',   file: 'Subaru_WRX1.glb',  maxSpeed: 68, acceleration: 34, handling: 2.8, braking: 50, driftFactor: 0.20, gripCoeff: 1.00, latFriction: 8.0, suspStiffness: 0.03, steerSpeed: 3.5,  driftThreshold: 0.18 },
  { id: 'wrx_street',  name: 'WRX STI Street',  file: 'Subaru_WRX2.glb',  maxSpeed: 66, acceleration: 30, handling: 2.5, braking: 46, driftFactor: 0.45, gripCoeff: 0.70, latFriction: 3.5, suspStiffness: 0.06, steerSpeed: 2.5,  driftThreshold: 0.08 },
];

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
}

// ── Network Packets ──
export enum PacketType {
  STATE = 1,
  EVENT = 2,
  PING = 3,
  PONG = 4,
  STATE_RELAY = 5,
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
}

// ── Input ──
export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  boost: boolean;
}
