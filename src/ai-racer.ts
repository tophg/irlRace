/* ── Hood Racer — AI Racer (v2 — Curvature-Aware + Personalities) ── */

import * as THREE from 'three';
import { Vehicle } from './vehicle';
import { CarDef, InputState } from './types';
import { getClosestSplinePoint, getSpeedProfileAt } from './track';
import type { SplineBVH } from './bvh';

// ── AI Personality ──

export interface AIPersonality {
  aggression: number;      // 0–1: late braking, close following
  consistency: number;     // 0–1: input precision (1 = perfect, lower = noisy)
  preferredLine: number;   // -1 to 1: inside bias vs outside bias
  topSpeedFactor: number;  // 0.85–1.05: natural skill (replaces rubber-banding)
  bravery: number;         // 0–1: willingness to attempt overtakes
}

const DEFAULT_PERSONALITIES: AIPersonality[] = [
  { aggression: 0.7, consistency: 0.90, preferredLine: -0.2, topSpeedFactor: 0.98, bravery: 0.6 },
  { aggression: 0.4, consistency: 0.85, preferredLine:  0.3, topSpeedFactor: 0.92, bravery: 0.3 },
  { aggression: 0.9, consistency: 0.80, preferredLine: -0.4, topSpeedFactor: 1.02, bravery: 0.9 },
  { aggression: 0.5, consistency: 0.95, preferredLine:  0.0, topSpeedFactor: 0.95, bravery: 0.5 },
];

// ── Opponent info passed from the game loop ──

export interface OpponentInfo {
  position: THREE.Vector3;
  t: number;  // spline parameter
  id: string;
}

// Lookahead distances (as spline parameter fractions)
const LA_STEER_SHORT = 0.008;
const LA_STEER_MED   = 0.025;
const LA_BRAKE       = 0.06;

const ROAD_HALF_WIDTH = 5.5;
const OVERTAKE_DETECT_DIST = 0.05; // spline fraction ahead to scan
const OVERTAKE_CLEAR_DIST  = 0.02; // past this = overtake complete

// Reusable temps
const _targetPt = new THREE.Vector3();
const _right = new THREE.Vector3();
const _diff = new THREE.Vector3();

export class AIRacer {
  readonly vehicle: Vehicle;
  readonly id: string;
  readonly personality: AIPersonality;

  private spline: THREE.CatmullRomCurve3 | null = null;
  private bvh: SplineBVH | null = null;
  private speedProfile: number[] | null = null;
  private currentT = 0;

  // Overtake state
  private overtakeTarget: string | null = null;
  private laneOffset = 0;       // -1 (left) to 1 (right), 0 = center
  private targetLaneOffset = 0;

  constructor(id: string, def: CarDef, personalityIndex?: number) {
    this.id = id;
    this.vehicle = new Vehicle(def);
    this.personality = { ...DEFAULT_PERSONALITIES[
      (personalityIndex ?? parseInt(id.replace('ai_', ''), 10)) % DEFAULT_PERSONALITIES.length
    ] };
  }

  place(spline: THREE.CatmullRomCurve3, t: number, laneOffset: number, bvh?: SplineBVH) {
    this.spline = spline;
    this.bvh = bvh ?? null;
    this.currentT = t;
    this.vehicle.placeOnTrack(spline, t, laneOffset);
    this.laneOffset = laneOffset / ROAD_HALF_WIDTH;
    this.targetLaneOffset = this.personality.preferredLine;
    this.overtakeTarget = null;
  }

  setSpeedProfile(profile: number[]) {
    this.speedProfile = profile;
  }

  /** Main AI update. Call with opponent positions for awareness. */
  update(dt: number, opponents?: OpponentInfo[]) {
    if (!this.spline) return;

    const p = this.personality;

    // ── Locate self on spline ──
    const nearest = this.bvh
      ? getClosestSplinePoint(this.spline, this.vehicle.group.position, this.bvh)
      : getClosestSplinePoint(this.spline, this.vehicle.group.position, 200);
    this.currentT = nearest.t;

    // ── Opponent awareness + overtaking ──
    if (opponents && opponents.length > 0) {
      this.updateOvertake(opponents, p);
    } else {
      this.targetLaneOffset = p.preferredLine;
      this.overtakeTarget = null;
    }

    // Smooth lane offset transition
    this.laneOffset += (this.targetLaneOffset - this.laneOffset) * Math.min(1, 3 * dt);

    // ── Multi-lookahead steering ──
    const shortT = (this.currentT + LA_STEER_SHORT) % 1;
    const medT   = (this.currentT + LA_STEER_MED) % 1;

    const shortPt = this.getOffsetPoint(shortT);
    const medPt   = this.getOffsetPoint(medT);

    // Blend: 40% short (tight corrections) + 60% medium (corner anticipation)
    _targetPt.lerpVectors(shortPt, medPt, 0.6);

    const dx = _targetPt.x - this.vehicle.group.position.x;
    const dz = _targetPt.z - this.vehicle.group.position.z;
    const targetHeading = Math.atan2(dx, dz);

    let headingDiff = targetHeading - this.vehicle.heading;
    while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
    while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;

    // Analog-style steering with consistency noise
    let steerInput = Math.max(-1, Math.min(1, headingDiff * 3.5));
    if (p.consistency < 1) {
      steerInput += (Math.random() - 0.5) * (1 - p.consistency) * 0.3;
      steerInput = Math.max(-1, Math.min(1, steerInput));
    }

    // ── Curvature-aware speed control ──
    const absSpeed = Math.abs(this.vehicle.speed);
    let targetSpeed = this.vehicle.def.maxSpeed * p.topSpeedFactor;

    if (this.speedProfile) {
      // Look ahead for braking — check speed at current pos AND at brake lookahead
      const currentOptimal = getSpeedProfileAt(this.speedProfile, this.currentT);
      const brakeT = (this.currentT + LA_BRAKE * (1 + p.aggression * 0.5)) % 1;
      const brakeOptimal = getSpeedProfileAt(this.speedProfile, brakeT);

      // Aggressive drivers brake later (use less of the upcoming corner's speed limit)
      const brakeFactor = 0.7 + p.aggression * 0.3;
      targetSpeed = Math.min(targetSpeed, currentOptimal * p.topSpeedFactor);
      targetSpeed = Math.min(targetSpeed, brakeOptimal * brakeFactor * p.topSpeedFactor);
    }

    // Throttle/brake logic with proportional control
    let throttle: number;
    let brake: number;

    const speedError = targetSpeed - absSpeed;
    if (speedError > 2) {
      throttle = Math.min(1, speedError / 10);
      brake = 0;
    } else if (speedError < -3) {
      throttle = 0;
      brake = Math.min(1, Math.abs(speedError) / 15);
    } else {
      throttle = 0.4;
      brake = 0;
    }

    // Slow down when very close behind another car
    if (this.overtakeTarget && opponents) {
      const blocker = opponents.find(o => o.id === this.overtakeTarget);
      if (blocker) {
        const blockDist = this.wrapDist(blocker.t - this.currentT);
        if (blockDist > 0 && blockDist < 0.015) {
          throttle *= 0.5;
          brake = Math.max(brake, 0.2);
        }
      }
    }

    // ── Build input ──
    const input: InputState = {
      up: throttle > 0.3,
      down: brake > 0.1,
      left: steerInput < -0.12,
      right: steerInput > 0.12,
      boost: false,
      steerAnalog: steerInput,
    };

    this.vehicle.update(dt, input, this.spline, this.bvh ?? undefined);
  }

  getCurrentT(): number {
    return this.currentT;
  }

  // ── Overtake logic ──

  private updateOvertake(opponents: OpponentInfo[], p: AIPersonality) {
    // Find the closest opponent ahead within detection range
    let closestAhead: OpponentInfo | null = null;
    let closestDist = Infinity;

    for (const opp of opponents) {
      const dist = this.wrapDist(opp.t - this.currentT);
      if (dist > 0 && dist < OVERTAKE_DETECT_DIST && dist < closestDist) {
        closestDist = dist;
        closestAhead = opp;
      }
    }

    if (closestAhead && closestDist < OVERTAKE_DETECT_DIST * p.bravery * 1.5 + 0.01) {
      // Enter or continue overtake
      this.overtakeTarget = closestAhead.id;

      // Determine which side to pass: go opposite to opponent's lateral position
      const oppNearest = this.bvh
        ? getClosestSplinePoint(this.spline!, closestAhead.position, this.bvh)
        : getClosestSplinePoint(this.spline!, closestAhead.position, 200);

      // Compute opponent's lateral offset from centerline
      const splinePt = oppNearest.point;
      const tangent = this.spline!.getTangentAt(oppNearest.t).normalize();
      _right.set(tangent.z, 0, -tangent.x); // perpendicular in XZ
      _diff.subVectors(closestAhead.position, splinePt);
      const oppLateralOffset = _diff.dot(_right);

      // Pass on the opposite side, clamped to road bounds
      const passOffset = oppLateralOffset > 0 ? -0.7 : 0.7;
      this.targetLaneOffset = Math.max(-1, Math.min(1,
        passOffset + p.preferredLine * 0.3
      ));
    } else if (this.overtakeTarget) {
      // Check if overtake is complete
      const pastTarget = opponents.find(o => o.id === this.overtakeTarget);
      if (!pastTarget) {
        this.overtakeTarget = null;
        this.targetLaneOffset = p.preferredLine;
      } else {
        const dist = this.wrapDist(pastTarget.t - this.currentT);
        if (dist < -OVERTAKE_CLEAR_DIST || dist > OVERTAKE_DETECT_DIST * 2) {
          this.overtakeTarget = null;
          this.targetLaneOffset = p.preferredLine;
        }
      }
    } else {
      this.targetLaneOffset = p.preferredLine;
    }
  }

  /** Get a point on the spline offset laterally by current laneOffset. */
  private getOffsetPoint(t: number): THREE.Vector3 {
    const pt = this.spline!.getPointAt(t);
    if (Math.abs(this.laneOffset) < 0.01) return pt;

    const tangent = this.spline!.getTangentAt(t).normalize();
    _right.set(tangent.z, 0, -tangent.x);
    pt.x += _right.x * this.laneOffset * ROAD_HALF_WIDTH;
    pt.z += _right.z * this.laneOffset * ROAD_HALF_WIDTH;
    return pt;
  }

  /** Wrap-aware signed distance on the circular [0,1) track parameter. */
  private wrapDist(d: number): number {
    if (d > 0.5) return d - 1;
    if (d < -0.5) return d + 1;
    return d;
  }
}
