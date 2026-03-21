/* ── IRL Race — Shared Types ── */

import * as THREE from 'three/webgpu';
import type { SplineBVH } from './bvh';

// ── Game States ──
export enum GameState {
  TITLE,
  GARAGE,
  LOBBY,
  FLYOVER,
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
  heightOffset?: number;  // extra Y offset from road surface (raise/lower per-model)
}

export const CAR_ROSTER: CarDef[] = [
  // ── ENTRY TIER ──
  // Obey — beginner-friendly, forgiving grip, smooth ride
  { id: 'obey',          name: 'Obey',          file: 'white_camry.glb',   maxSpeed: 65, acceleration: 30, handling: 2.6, braking: 48, driftFactor: 0.20, gripCoeff: 0.95, latFriction: 6.5, suspStiffness: 0.03, steerSpeed: 3.2,  driftThreshold: 0.15, mass: 1480, cgHeight: 0.11, frontBias: 0.53, heightOffset: 0.15 },


  // ── MID TIER ──
  // Sleeper — loose rear, rewards aggression, high mid-tier speed
  { id: 'sleeper',       name: 'Sleeper',       file: 'Sleeper_New.glb',    maxSpeed: 76, acceleration: 27, handling: 2.1, braking: 42, driftFactor: 0.40, gripCoeff: 0.78, latFriction: 4.0, suspStiffness: 0.05, steerSpeed: 2.6,  driftThreshold: 0.10, mass: 1550, cgHeight: 0.16, frontBias: 0.57, heightOffset: 0.05 },
  // Conform — heavy cruiser, strong accel, planted but slow to turn
  { id: 'conform',       name: 'Conform',       file: 'Nissan_Maxima.glb',  maxSpeed: 73, acceleration: 33, handling: 1.9, braking: 44, driftFactor: 0.26, gripCoeff: 0.84, latFriction: 5.0, suspStiffness: 0.04, steerSpeed: 2.8,  driftThreshold: 0.11, mass: 1650, cgHeight: 0.14, frontBias: 0.55, heightOffset: 0.05 },
  // Consume — muscle car, high speed, torquey, likes to slide
  { id: 'consume',       name: 'Consume',       file: 'Black_Mustang_GT.glb', maxSpeed: 79, acceleration: 35, handling: 2.2, braking: 46, driftFactor: 0.38, gripCoeff: 0.82, latFriction: 4.5, suspStiffness: 0.05, steerSpeed: 2.7,  driftThreshold: 0.10, mass: 1600, cgHeight: 0.13, frontBias: 0.52, heightOffset: 0.0 },
  // Further — classic VW Beetle, light, nimble, low top speed but fun drift character
  { id: 'further',       name: 'Further',       file: 'VW_Beetle.glb',      maxSpeed: 68, acceleration: 26, handling: 2.7, braking: 40, driftFactor: 0.35, gripCoeff: 0.82, latFriction: 4.8, suspStiffness: 0.06, steerSpeed: 3.0,  driftThreshold: 0.10, mass: 1200, cgHeight: 0.14, frontBias: 0.42, heightOffset: 0.05 },
  // Flatline — understated sedan, balanced all-rounder, deceptively quick
  { id: 'flatline',      name: 'Flatline',      file: 'Sedan.glb',          maxSpeed: 74, acceleration: 30, handling: 2.3, braking: 44, driftFactor: 0.28, gripCoeff: 0.88, latFriction: 5.2, suspStiffness: 0.04, steerSpeed: 2.9,  driftThreshold: 0.12, mass: 1500, cgHeight: 0.12, frontBias: 0.54, heightOffset: 0.05 },


  // ── EXOTIC TIER ──
  // Bubblegum — dramatic drift character, spectacular slides, high speed
  { id: 'bubblegum',     name: 'Bubblegum',     file: 'Ferrari.glb',        maxSpeed: 83, acceleration: 34, handling: 2.3, braking: 50, driftFactor: 0.44, gripCoeff: 0.80, latFriction: 4.5, suspStiffness: 0.05, steerSpeed: 2.8,  driftThreshold: 0.09, mass: 1380, cgHeight: 0.09, frontBias: 0.44, heightOffset: 0.0 },
  // Sunglasses — surgical accuracy, balanced, rear-engine snap oversteer
  { id: 'sunglasses',    name: 'Sunglasses',    file: 'Porsche_911.glb',    maxSpeed: 80, acceleration: 32, handling: 2.9, braking: 52, driftFactor: 0.24, gripCoeff: 0.96, latFriction: 6.0, suspStiffness: 0.03, steerSpeed: 3.4,  driftThreshold: 0.13, mass: 1420, cgHeight: 0.09, frontBias: 0.40, heightOffset: 0.0 },
  // Nada — rally-bred monster, raw turbo power, explosive acceleration
  { id: 'nada',          name: 'Nada',          file: 'Subaru_WRX3.glb',   maxSpeed: 78, acceleration: 38, handling: 2.8, braking: 48, driftFactor: 0.30, gripCoeff: 1.00, latFriction: 6.5, suspStiffness: 0.04, steerSpeed: 3.3,  driftThreshold: 0.14, mass: 1380, cgHeight: 0.10, frontBias: 0.48, heightOffset: 0.05 },
  // Reproduce — sporty SUV, surprisingly agile, high CG means dramatic body roll
  { id: 'reproduce',     name: 'Reproduce',     file: 'Family_SUV_B.glb',  maxSpeed: 77, acceleration: 31, handling: 2.4, braking: 47, driftFactor: 0.32, gripCoeff: 0.86, latFriction: 5.0, suspStiffness: 0.06, steerSpeed: 2.9,  driftThreshold: 0.11, mass: 1750, cgHeight: 0.22, frontBias: 0.53, heightOffset: 0.30 },
  // Siren — modified ambulance, heavy, strong accel, high CG but surprisingly grippy
  { id: 'siren',         name: 'Siren',         file: 'Ambulance.glb',      maxSpeed: 75, acceleration: 34, handling: 1.8, braking: 45, driftFactor: 0.24, gripCoeff: 0.92, latFriction: 5.5, suspStiffness: 0.05, steerSpeed: 2.5,  driftThreshold: 0.14, mass: 2100, cgHeight: 0.28, frontBias: 0.56, heightOffset: 0.35 },
  // Mystery Van — souped-up cargo van, heavy tank, massive grip, bullish presence
  { id: 'mystery_van',   name: 'Mystery Van',   file: 'Mystery_Van.glb',    maxSpeed: 72, acceleration: 32, handling: 1.7, braking: 42, driftFactor: 0.20, gripCoeff: 0.94, latFriction: 5.8, suspStiffness: 0.04, steerSpeed: 2.4,  driftThreshold: 0.15, mass: 2200, cgHeight: 0.30, frontBias: 0.58, heightOffset: 0.35 },
  // Flaming Wainscot — exotic hot rod, wild drift machine, spectacular slides
  { id: 'wainscot',      name: 'Flaming Wainscot', file: 'Flaming_Wainscot.glb', maxSpeed: 82, acceleration: 36, handling: 2.5, braking: 49, driftFactor: 0.46, gripCoeff: 0.76, latFriction: 4.2, suspStiffness: 0.05, steerSpeed: 3.0,  driftThreshold: 0.08, mass: 1400, cgHeight: 0.10, frontBias: 0.46, heightOffset: 0.0 },

  // ── ELITE TIER ──
  // Kick Ass — top speed king, lightweight, fragile glass cannon
  { id: 'kickass',       name: 'Kick Ass',      file: 'Lamborghini.glb',    maxSpeed: 92, acceleration: 36, handling: 2.2, braking: 55, driftFactor: 0.36, gripCoeff: 0.88, latFriction: 5.5, suspStiffness: 0.04, steerSpeed: 3.2,  driftThreshold: 0.10, mass: 1320, cgHeight: 0.08, frontBias: 0.42, heightOffset: 0.0 },
  // Submit — elite pickup brawler, massive torque, unstoppable presence
  { id: 'submit',        name: 'Submit',        file: 'Pickup_Truck.glb',      maxSpeed: 86, acceleration: 34, handling: 2.3, braking: 52, driftFactor: 0.34, gripCoeff: 0.94, latFriction: 5.8, suspStiffness: 0.05, steerSpeed: 3.0,  driftThreshold: 0.11, mass: 1950, cgHeight: 0.20, frontBias: 0.56, heightOffset: 0.25 },
  // Marry — futuristic sports car, razor steering, featherweight, loves to slide
  { id: 'marry',         name: 'Marry',         file: 'Futuristic_Sports.glb', maxSpeed: 90, acceleration: 37, handling: 3.0, braking: 54, driftFactor: 0.40, gripCoeff: 0.84, latFriction: 5.0, suspStiffness: 0.04, steerSpeed: 3.5,  driftThreshold: 0.09, mass: 1280, cgHeight: 0.08, frontBias: 0.45, heightOffset: 0.0 },
  // Phantom — aggressive street racer, razor-sharp, light, loves to slide
  { id: 'phantom',       name: 'Phantom',       file: 'Street_Racer.glb',      maxSpeed: 91, acceleration: 38, handling: 3.1, braking: 55, driftFactor: 0.42, gripCoeff: 0.86, latFriction: 5.2, suspStiffness: 0.04, steerSpeed: 3.4,  driftThreshold: 0.09, mass: 1300, cgHeight: 0.08, frontBias: 0.43, heightOffset: 0.0 },

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
  rampGroup: THREE.Group;
  rampDefs: RampDef[];
  distanceField?: THREE.DataTexture;  // baked spline distance for ground zone blending
}

// ── Ramps ──
export interface RampDef {
  t: number;       // spline position (0-1)
  length: number;  // world units along spline
  height: number;  // peak height above road
  flatTop: number; // fraction of length that's flat at peak (0-0.5)
  side: 'full' | 'left' | 'right'; // full-width or half-ramp
}

// ── Custom Track (user-created in editor) ──
export interface CustomTrackDef {
  name: string;
  controlPoints: { x: number; z: number }[];
  elevations?: number[];
  ramps?: RampDef[];
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
  engineHeat: number; // 0-100 engine temperature
}

// ── Race Progress ──
export interface RacerProgress {
  id: string;
  lapIndex: number;
  checkpointIndex: number;
  finished: boolean;
  finishTime: number;
  position: THREE.Vector3;
  rawT: number;         // raw spline parameter t (0–1) for position on track
  prevT: number;        // previous frame's raw spline t (for wraparound detection)
  totalDistance: number; // cumulative spline distance from race start (monotonic, never wraps)
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
