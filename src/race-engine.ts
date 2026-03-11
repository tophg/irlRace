/* ── Hood Racer — Race Engine ── */

import * as THREE from 'three';
import { Checkpoint, RacerProgress } from './types';

export class RaceEngine {
  checkpoints: Checkpoint[] = [];
  totalLaps = 3;

  private racers = new Map<string, RacerProgress>();
  private raceStartTime = 0;
  private cpThreshold = 18; // distance to trigger checkpoint

  constructor(checkpoints: Checkpoint[], totalLaps = 3) {
    this.checkpoints = checkpoints;
    this.totalLaps = totalLaps;
  }

  /** Register a racer. */
  addRacer(id: string) {
    this.racers.set(id, {
      id,
      lapIndex: 0,
      checkpointIndex: 0,
      finished: false,
      finishTime: 0,
      position: new THREE.Vector3(),
    });
  }

  /** Start the race timer. */
  start() {
    this.raceStartTime = performance.now();
  }

  /** Update a racer's position and check for checkpoint crossings.
   *  Returns event string if a checkpoint/lap/finish was hit, null otherwise. */
  updateRacer(
    id: string,
    worldPos: THREE.Vector3,
  ): 'checkpoint' | 'lap' | 'finish' | null {
    const racer = this.racers.get(id);
    if (!racer || racer.finished) return null;

    racer.position.copy(worldPos);

    const nextCP = this.checkpoints[racer.checkpointIndex];
    if (!nextCP) return null;

    const dist = worldPos.distanceTo(nextCP.position);
    if (dist > this.cpThreshold) return null;

    // Checkpoint hit!
    racer.checkpointIndex++;

    if (racer.checkpointIndex >= this.checkpoints.length) {
      // Completed a lap
      racer.checkpointIndex = 0;
      racer.lapIndex++;

      if (racer.lapIndex >= this.totalLaps) {
        racer.finished = true;
        racer.finishTime = performance.now() - this.raceStartTime;
        return 'finish';
      }
      return 'lap';
    }

    return 'checkpoint';
  }

  /** Update a remote racer's progress directly (from network). */
  updateRemoteProgress(id: string, lapIndex: number, checkpointIndex: number) {
    const racer = this.racers.get(id);
    if (!racer) return;
    racer.lapIndex = lapIndex;
    racer.checkpointIndex = checkpointIndex;
  }

  /** Mark a racer as DNF (disconnected). */
  markDnf(id: string) {
    const racer = this.racers.get(id);
    if (racer) {
      racer.dnf = true;
      racer.finished = true;
      racer.finishTime = Infinity;
    }
  }

  /** Get sorted rankings (finished first by time, then in-progress by laps/cp, DNF last). */
  getRankings(): RacerProgress[] {
    const all = Array.from(this.racers.values());

    return all.sort((a, b) => {
      // DNF always last
      if (a.dnf && !b.dnf) return 1;
      if (!a.dnf && b.dnf) return -1;

      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;

      // Lap first, then checkpoint
      const scoreA = a.lapIndex * 10000 + a.checkpointIndex * 100;
      const scoreB = b.lapIndex * 10000 + b.checkpointIndex * 100;
      return scoreB - scoreA;
    });
  }

  /** Get a racer's progress. */
  getProgress(id: string): RacerProgress | undefined {
    return this.racers.get(id);
  }

  private static _moveDir = new THREE.Vector3();

  /** Check wrong-way by comparing velocity direction to spline tangent. */
  isWrongWay(heading: number, splineTangent: THREE.Vector3): boolean {
    RaceEngine._moveDir.set(Math.sin(heading), 0, Math.cos(heading));
    return RaceEngine._moveDir.dot(splineTangent) < -0.3;
  }

  /** Get elapsed race time in seconds. */
  getElapsedTime(): number {
    return (performance.now() - this.raceStartTime) / 1000;
  }

  /** Format time as M:SS.mmm */
  static formatTime(ms: number): string {
    const totalSec = ms / 1000;
    const min = Math.floor(totalSec / 60);
    const sec = Math.floor(totalSec % 60);
    const milli = Math.floor(ms % 1000);
    return `${min}:${sec.toString().padStart(2, '0')}.${milli.toString().padStart(3, '0')}`;
  }
}
