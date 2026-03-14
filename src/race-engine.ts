/* ── Hood Racer — Race Engine ── */

import * as THREE from 'three';
import { Checkpoint, RacerProgress } from './types';

export class RaceEngine {
  checkpoints: Checkpoint[] = [];
  totalLaps = 3;

  private racers = new Map<string, RacerProgress>();
  private raceStartTime = 0;
  private cpThreshold = 18; // distance to trigger checkpoint
  private cpTimestamps = new Map<string, Map<number, number>>(); // id → (globalCpIndex → time)

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
      trackT: 0,
      lapTimes: [],
      lastLapStart: 0,
    });
    this.cpTimestamps.set(id, new Map());
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
    trackT?: number,
  ): 'checkpoint' | 'lap' | 'finish' | null {
    const racer = this.racers.get(id);
    if (!racer || racer.finished) return null;

    racer.position.copy(worldPos);
    if (trackT !== undefined) racer.trackT = trackT;

    const nextCP = this.checkpoints[racer.checkpointIndex];
    if (!nextCP) return null;

    const dist = worldPos.distanceTo(nextCP.position);
    if (dist > this.cpThreshold) return null;

    // Checkpoint hit!
    racer.checkpointIndex++;

    // Record timestamp for this checkpoint (global index)
    const globalCpIndex = racer.lapIndex * this.checkpoints.length + racer.checkpointIndex - 1;
    const now = performance.now() - this.raceStartTime;
    const timestamps = this.cpTimestamps.get(id);
    if (timestamps) timestamps.set(globalCpIndex, now);

    if (racer.checkpointIndex >= this.checkpoints.length) {
      racer.checkpointIndex = 0;
      racer.lapIndex++;

      // Record lap time
      const now = performance.now() - this.raceStartTime;
      racer.lapTimes.push(now - racer.lastLapStart);
      racer.lastLapStart = now;

      if (racer.lapIndex >= this.totalLaps) {
        racer.finished = true;
        racer.finishTime = now;
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

  /** Get sorted rankings (finished first by time, then in-progress by laps/cp/distance, DNF last). */
  getRankings(): RacerProgress[] {
    const all = Array.from(this.racers.values());

    return all.sort((a, b) => {
      // DNF always last
      if (a.dnf && !b.dnf) return 1;
      if (!a.dnf && b.dnf) return -1;
      if (a.dnf && b.dnf) return 0;

      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;

      // Continuous ranking using spline parameter.
      // Handle wrap-around near the start/finish line (t=0):
      // Each checkpoint i is at roughly t = i/numCheckpoints.
      // If a racer's trackT is far ahead of their checkpoint's expected t,
      // they've wrapped around the t=0 boundary and are actually behind.
      const numCPs = this.checkpoints.length;
      const effectiveT = (r: RacerProgress) => {
        const expectedT = r.checkpointIndex / numCPs;
        let t = r.trackT;
        // If trackT is more than half a lap ahead of expected position,
        // the car wrapped around t=0 and is actually behind
        if (t - expectedT > 0.5) {
          t -= 1.0;
        }
        return r.lapIndex + t;
      };
      return effectiveT(b) - effectiveT(a);
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

  /** Get the best (fastest) lap time for a racer in ms, or null. */
  getBestLap(id: string): number | null {
    const racer = this.racers.get(id);
    if (!racer || racer.lapTimes.length === 0) return null;
    return Math.min(...racer.lapTimes);
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

  /** Get gap times to the car ahead and behind.
   *  Returns { ahead: ms | null, behind: ms | null }.
   *  Positive values = behind that car by X ms. */
  getGaps(id: string): { ahead: number | null; behind: number | null } {
    const rankings = this.getRankings();
    const myIdx = rankings.findIndex(r => r.id === id);
    if (myIdx < 0) return { ahead: null, behind: null };

    const myTs = this.cpTimestamps.get(id);
    if (!myTs || myTs.size === 0) return { ahead: null, behind: null };

    // Find the latest global CP we've hit
    const myProgress = rankings[myIdx];
    const myGlobalCp = myProgress.lapIndex * this.checkpoints.length + myProgress.checkpointIndex;

    let ahead: number | null = null;
    let behind: number | null = null;

    // Car ahead (lower index in rankings)
    if (myIdx > 0) {
      const aheadId = rankings[myIdx - 1].id;
      const aheadTs = this.cpTimestamps.get(aheadId);
      if (aheadTs) {
        // Find the last common checkpoint
        for (let cp = myGlobalCp; cp >= 0; cp--) {
          const myTime = myTs.get(cp);
          const theirTime = aheadTs.get(cp);
          if (myTime !== undefined && theirTime !== undefined) {
            ahead = myTime - theirTime; // positive = we're behind
            break;
          }
        }
      }
    }

    // Car behind (higher index in rankings)
    if (myIdx < rankings.length - 1) {
      const behindId = rankings[myIdx + 1].id;
      const behindTs = this.cpTimestamps.get(behindId);
      if (behindTs) {
        for (let cp = myGlobalCp; cp >= 0; cp--) {
          const myTime = myTs.get(cp);
          const theirTime = behindTs.get(cp);
          if (myTime !== undefined && theirTime !== undefined) {
            behind = theirTime - myTime; // positive = they're behind us
            break;
          }
        }
      }
    }

    return { ahead, behind };
  }
}
