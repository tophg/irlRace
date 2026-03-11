/* ── Hood Racer — AI Racer ── */

import * as THREE from 'three';
import { Vehicle } from './vehicle';
import { CarDef, InputState } from './types';
import { getClosestSplinePoint } from './track';

export class AIRacer {
  readonly vehicle: Vehicle;
  readonly id: string;

  private spline: THREE.CatmullRomCurve3 | null = null;
  private currentT = 0;
  private lookaheadT = 0.015;
  private rubberBandTarget = 1.0; // speed multiplier

  constructor(id: string, def: CarDef) {
    this.id = id;
    this.vehicle = new Vehicle(def);
  }

  setSpline(spline: THREE.CatmullRomCurve3) {
    this.spline = spline;
  }

  /** Place the AI on the track at position t with a lane offset. */
  place(spline: THREE.CatmullRomCurve3, t: number, laneOffset: number) {
    this.spline = spline;
    this.currentT = t;
    this.vehicle.placeOnTrack(spline, t, laneOffset);
  }

  /** Set rubber-banding speed multiplier based on distance to player. */
  setRubberBand(playerT: number) {
    const diff = playerT - this.currentT;
    if (diff > 0.1) {
      // Player is ahead — speed up
      this.rubberBandTarget = 1.0 + Math.min(diff * 2, 0.6);
    } else if (diff < -0.1) {
      // Player is behind — slow down
      this.rubberBandTarget = 1.0 - Math.min(Math.abs(diff), 0.3);
    } else {
      this.rubberBandTarget = 1.0;
    }
  }

  /** AI update: follow spline with lookahead steering. */
  update(dt: number) {
    if (!this.spline) return;

    // Find current position on spline
    const nearest = getClosestSplinePoint(this.spline, this.vehicle.group.position, 200);
    this.currentT = nearest.t;

    // Target point ahead on spline
    const targetT = (this.currentT + this.lookaheadT) % 1;
    const targetPoint = this.spline.getPointAt(targetT);

    // Direction to target
    const dx = targetPoint.x - this.vehicle.group.position.x;
    const dz = targetPoint.z - this.vehicle.group.position.z;
    const targetHeading = Math.atan2(dx, dz);

    // Steering input
    let headingDiff = targetHeading - this.vehicle.heading;
    // Normalize to [-PI, PI]
    while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
    while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;

    const steerInput = Math.max(-1, Math.min(1, headingDiff * 3));

    // Speed control — slow for sharp turns
    const turnSharpness = Math.abs(headingDiff);
    const throttle = turnSharpness > 0.5 ? 0.6 : 1.0;
    const brake = turnSharpness > 1.0 ? 0.3 : 0;

    // Apply rubber-banding to speed
    const origMaxSpeed = this.vehicle.def.maxSpeed;
    this.vehicle.def.maxSpeed = origMaxSpeed * this.rubberBandTarget;

    const input: InputState = {
      up: throttle > 0.5,
      down: brake > 0.1,
      left: steerInput < -0.15,
      right: steerInput > 0.15,
      boost: false,
    };

    this.vehicle.update(dt, input, this.spline);

    // Restore original max speed
    this.vehicle.def.maxSpeed = origMaxSpeed;
  }

  getCurrentT(): number {
    return this.currentT;
  }
}
