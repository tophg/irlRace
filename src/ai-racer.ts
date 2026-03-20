/* ── IRL Race — AI Racer (v2 — Curvature-Aware + Personalities) ── */

import * as THREE from 'three/webgpu';
import { CarDef, InputState } from './types';
import { Vehicle } from './vehicle';
import { getClosestSplinePoint, getSpeedProfileAt } from './track';
import type { SplineBVH } from './bvh';
import type { WeatherPhysics } from './weather';

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
  nameTag: THREE.Sprite | null = null;

  private spline: THREE.CatmullRomCurve3 | null = null;
  private bvh: SplineBVH | null = null;
  private speedProfile: number[] | null = null;
  private currentT = 0;

  // Overtake state
  private overtakeTarget: string | null = null;
  private stuckTimer = 0;
  private _noiseCounter = 0; // Bug #13 fix: deterministic noise seed
  private laneOffset = 0;       // -1 (left) to 1 (right), 0 = center
  private targetLaneOffset = 0;

  // Startup protection — prevents backwards driving on first frames
  private startupTimer = 0; // seconds remaining
  private initialT = 0;

  constructor(id: string, def: CarDef, personalityIndex?: number) {
    this.id = id;
    this.vehicle = new Vehicle(def);
    const pidx = personalityIndex ?? (parseInt(id.replace('ai_', ''), 10) || 0);
    this.personality = { ...DEFAULT_PERSONALITIES[
      Math.abs(pidx) % DEFAULT_PERSONALITIES.length
    ] };
  }

  /** Scale AI personality based on difficulty tier. */
  applyDifficulty(difficulty: 'easy' | 'medium' | 'hard') {
    const p = this.personality;
    switch (difficulty) {
      case 'easy':
        p.topSpeedFactor *= 0.78;
        p.consistency *= 0.70;
        p.aggression *= 0.5;
        p.bravery *= 0.4;
        break;
      case 'medium':
        // Default — no changes
        break;
      case 'hard':
        p.topSpeedFactor *= 1.06;
        p.consistency = Math.min(p.consistency * 1.1, 0.99);
        p.aggression = Math.min(p.aggression * 1.2, 1.0);
        p.bravery = Math.min(p.bravery * 1.3, 1.0);
        break;
    }
  }

  place(spline: THREE.CatmullRomCurve3, t: number, laneOffset: number, bvh?: SplineBVH) {
    this.spline = spline;
    this.bvh = bvh ?? null;
    this.currentT = t;
    this.vehicle.placeOnTrack(spline, t, laneOffset);
    this.laneOffset = laneOffset / ROAD_HALF_WIDTH;
    this.targetLaneOffset = this.personality.preferredLine;
    this.overtakeTarget = null;
    this.startupTimer = 0.5; // 0.5 seconds of startup protection
    this.initialT = t;
  }

  setSpeedProfile(profile: number[]) {
    this.speedProfile = profile;
  }

  /** Main AI update. Call with opponent positions for awareness. */
  update(dt: number, opponents?: OpponentInfo[], weather?: WeatherPhysics) {
    if (!this.spline) return;

    const p = this.personality;
    this._noiseCounter++; // Bug #13 fix

    // ── Startup protection: enforce placed heading on first frames ──
    // Prevents backwards driving caused by getClosestSplinePoint returning
    // wrong t near the spline start/end junction.
    if (this.startupTimer > 0) {
      this.startupTimer -= dt;
      this.currentT = this.initialT;
      // Gentle forward throttle, no steering — get the car rolling correctly
      const input: InputState = {
        up: true, down: false, left: false, right: false,
        boost: false, steerAnalog: 0,
      };
      this.vehicle.update(dt, input, this.spline, this.bvh ?? undefined, weather);
      return;
    }

    // ── Locate self on spline ──
    const nearest = this.bvh
      ? getClosestSplinePoint(this.spline, this.vehicle.group.position, this.bvh)
      : getClosestSplinePoint(this.spline, this.vehicle.group.position, 200);
    this.currentT = nearest.t;

    // ── Stuck Detection & Recovery ──
    // If AI is moving very slowly, they might be pinned against a wall or spun around.
    if (Math.abs(this.vehicle.speed) < 2) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 3.0) { // Stuck for 3 seconds
        // Respawn AI on the track at current T, facing forward
        const respawnPt = this.spline.getPointAt(this.currentT);
        const respawnDir = this.spline.getTangentAt(this.currentT).normalize();
        
        // Reset physics body
        this.vehicle.group.position.copy(respawnPt);
        this.vehicle.group.position.y += 0.5; // Drop slightly above track
        this.vehicle.heading = Math.atan2(respawnDir.x, respawnDir.z);
        this.vehicle.group.rotation.y = this.vehicle.heading;
        this.vehicle.speed = 10; // Give them a rolling start
        // Align velocity vector to new heading (prevents flying off-track)
        const sinH = Math.sin(this.vehicle.heading);
        const cosH = Math.cos(this.vehicle.heading);
        this.vehicle.velX = 10 * sinH;
        this.vehicle.velZ = 10 * cosH;
        
        // Reset stuck timer
        this.stuckTimer = 0;
        return; // Skip rest of update this frame
      }
    } else {
      this.stuckTimer = 0; // Reset if moving
    }

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
      // Bug #13 fix: deterministic noise from counter + AI id (instead of Math.random())
      const aiSeed = parseInt(this.id.replace('ai_', ''), 10) || 0;
      const noise = (Math.sin(this._noiseCounter * 127.1 + aiSeed * 311.7) * 0.5 + 0.5) - 0.5;
      steerInput += noise * (1 - p.consistency) * 0.3;
      steerInput = Math.max(-1, Math.min(1, steerInput));
    }

    // ── Rubber-banding: adjust speed factor based on gap to player ──
    let rubberBand = 0;
    if (opponents && opponents.length > 0) {
      // Find the player (assumed to be 'local') or first opponent as reference
      const playerOpp = opponents.find(o => o.id === 'local') ?? opponents[0];
      if (playerOpp) {
        // Gap in spline t: positive = AI is behind player
        let tGap = playerOpp.t - this.currentT;
        if (tGap > 0.5) tGap -= 1;
        if (tGap < -0.5) tGap += 1;
        // tGap > 0 means AI is behind, tGap < 0 means AI is ahead
        if (tGap > 0.02) {
          // Behind: boost up to +8% based on gap
          rubberBand = Math.min(tGap * 1.6, 0.08);
        } else if (tGap < -0.05) {
          // Ahead: slight penalty up to -5%
          rubberBand = Math.max(tGap * 0.5, -0.05);
        }
      }
    }

    // ── Curvature-aware speed control with 3-point lookahead ──
    const absSpeed = Math.abs(this.vehicle.speed);
    let targetSpeed = this.vehicle.def.maxSpeed * (p.topSpeedFactor + rubberBand);

    // Detect upcoming curvature for racing line + braking
    let curvatureAhead = 0; // 0 = straight, >0 = turning
    let exitingCorner = false;

    if (this.speedProfile) {
      // 3-point lookahead: current, near brake point, far brake point
      const currentOptimal = getSpeedProfileAt(this.speedProfile, this.currentT);

      const nearBrakeT = (this.currentT + LA_BRAKE * 0.5 * (1.3 - p.aggression * 0.5)) % 1;
      const farBrakeT = (this.currentT + LA_BRAKE * (1.3 - p.aggression * 0.5)) % 1;
      const pastT = (this.currentT + LA_BRAKE * 1.5) % 1;

      const nearOptimal = getSpeedProfileAt(this.speedProfile, nearBrakeT);
      const farOptimal = getSpeedProfileAt(this.speedProfile, farBrakeT);
      const pastOptimal = getSpeedProfileAt(this.speedProfile, pastT);

      // Aggressive drivers brake later (use less of the upcoming corner's speed limit)
      const brakeFactor = 0.7 + p.aggression * 0.3;

      // Take the minimum of all 3 points for safety
      targetSpeed = Math.min(targetSpeed, currentOptimal * p.topSpeedFactor);
      targetSpeed = Math.min(targetSpeed, nearOptimal * brakeFactor * p.topSpeedFactor);
      targetSpeed = Math.min(targetSpeed, farOptimal * brakeFactor * p.topSpeedFactor);

      // Curvature estimation: lower optimal speed = tighter corner
      curvatureAhead = 1 - Math.min(farOptimal / this.vehicle.def.maxSpeed, 1);

      // Corner exit: curvature is decreasing (past point is faster than far point)
      exitingCorner = pastOptimal > farOptimal * 1.15;
    }

    // Throttle/brake logic with trail braking
    let throttle: number;
    let brake: number;

    const speedError = targetSpeed - absSpeed;
    if (speedError > 2) {
      // Accelerating — proportional throttle
      throttle = Math.min(1, 0.5 + speedError / 15);
      brake = 0;
    } else if (speedError < -1 && speedError > -5) {
      // Trail braking zone — light brake + partial throttle for stability
      throttle = 0.15 + p.aggression * 0.15; // aggressive drivers trail-brake with more throttle
      brake = Math.min(0.5, Math.abs(speedError) / 8);
    } else if (speedError < -5) {
      // Hard braking
      throttle = 0;
      brake = Math.min(1, Math.abs(speedError) / 12);
    } else {
      // Cruise zone — light throttle to maintain
      throttle = 0.4 + (exitingCorner ? 0.3 : 0); // more throttle on corner exit
      brake = 0;
    }

    // Corner exit boost: ramp throttle when past the apex
    if (exitingCorner && speedError > -2) {
      throttle = Math.min(1, throttle + 0.4);
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

    // ── Barrier proximity avoidance ──
    // When close to road edge, bias toward center to prevent wall scraping
    const lateralPos = this.laneOffset; // -1 to 1
    if (Math.abs(lateralPos) > 0.7) {
      // Push toward center proportionally
      const pushStrength = (Math.abs(lateralPos) - 0.7) / 0.3; // 0 at 0.7, 1 at 1.0
      this.targetLaneOffset += -Math.sign(lateralPos) * pushStrength * 0.5;
      this.targetLaneOffset = Math.max(-1, Math.min(1, this.targetLaneOffset));
      // Also slow down if scraping the wall
      if (Math.abs(lateralPos) > 0.9) {
        throttle *= 0.7;
      }
    }

    // ── Side-by-side awareness ──
    if (opponents) {
      for (const opp of opponents) {
        const tDist = Math.abs(this.wrapDist(opp.t - this.currentT));
        if (tDist < 0.008) { // nearly alongside
          const dx = opp.position.x - this.vehicle.group.position.x;
          const dz = opp.position.z - this.vehicle.group.position.z;
          const lateralDist = Math.sqrt(dx * dx + dz * dz);
          if (lateralDist < 5) {
            // Lift off throttle slightly — don't try to muscle through
            throttle *= 0.8;
            // Steer away from opponent
            const oppSide = dx * Math.cos(this.vehicle.heading) - dz * Math.sin(this.vehicle.heading);
            steerInput -= Math.sign(oppSide) * 0.15 * (1 - tDist / 0.008);
            steerInput = Math.max(-1, Math.min(1, steerInput));
          }
        }
      }
    }

    // ── Dynamic racing line (curvature-based apex targeting) ──
    if (curvatureAhead > 0.15 && !this.overtakeTarget) {
      // Detect turn direction from spline tangent comparison
      const aheadT = (this.currentT + 0.04) % 1;
      const currentTangent = this.spline!.getTangentAt(this.currentT).normalize();
      const aheadTangent = this.spline!.getTangentAt(aheadT).normalize();
      // Cross product Y component tells us left vs right turn
      const turnDir = currentTangent.x * aheadTangent.z - currentTangent.z * aheadTangent.x;

      if (Math.abs(turnDir) > 0.01) {
        // Shift to outside before corner, towards inside at apex
        const outsideOffset = Math.sign(turnDir) * 0.6 * Math.min(curvatureAhead * 2, 1);
        this.targetLaneOffset = outsideOffset + p.preferredLine * 0.2;
        this.targetLaneOffset = Math.max(-1, Math.min(1, this.targetLaneOffset));
      }
    }

    // ── Drafting / Slipstream ──
    if (opponents && Math.abs(steerInput) < 0.15 && absSpeed > this.vehicle.def.maxSpeed * 0.5) {
      for (const opp of opponents) {
        const dist = this.wrapDist(opp.t - this.currentT);
        if (dist > 0.005 && dist < 0.04) {
          // Close behind on a straight — draft boost
          const dx = opp.position.x - this.vehicle.group.position.x;
          const dz = opp.position.z - this.vehicle.group.position.z;
          const lateralDist = Math.abs(
            dx * Math.cos(this.vehicle.heading) - dz * Math.sin(this.vehicle.heading)
          );
          if (lateralDist < 3) {
            // In slipstream — 5% speed boost
            targetSpeed *= 1.05;
            throttle = Math.min(1, throttle + 0.15);
            break;
          }
        }
      }
    }

    // ── Build input ──
    // AI uses nitro on straights when available and engine isn't too hot
    const heatThreshold = 55 + p.aggression * 35; // conservative=55, aggressive=90
    const onStraight = Math.abs(steerInput) < 0.15 && absSpeed > this.vehicle.def.maxSpeed * 0.6;
    const aiBoost = onStraight && this.vehicle.nitro > 30
      && this.vehicle.engineHeat < heatThreshold && !this.vehicle.engineDead;

    const input: InputState = {
      up: this.vehicle.engineDead ? false : throttle > 0.3,
      down: this.vehicle.engineDead ? false : brake > 0.1,
      left: steerInput < -0.12,
      right: steerInput > 0.12,
      boost: aiBoost,
      steerAnalog: steerInput,
    };

    this.vehicle.update(dt, input, this.spline, this.bvh ?? undefined, weather);
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
