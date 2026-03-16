/* ── Hood Racer — Race Engine ── */

import * as THREE from 'three';
import { Checkpoint, RacerProgress } from './types';

export class RaceEngine {
  checkpoints: Checkpoint[] = [];
  totalLaps = 3;

  private racers = new Map<string, RacerProgress>();
  private _racersList: RacerProgress[] = []; // pre-allocated for getRankings()
  private raceStartTime = 0;
  private cpThreshold = 12; // distance to trigger checkpoint (reduced from 18)
  private cpTimestamps = new Map<string, Map<number, number>>(); // id → (globalCpIndex → time)
  private graceMs = 1500; // ignore checkpoint triggers for first 1.5s after race start

  // Reusable vector for direction checks
  private static _moveDir = new THREE.Vector3();

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
      prevT: 0,
      lapTimes: [],
      lastLapStart: 0,
    });
    this._racersList = Array.from(this.racers.values());
    this.cpTimestamps.set(id, new Map());
  }

  /** Start the race timer. */
  start() {
    this.raceStartTime = performance.now();
  }

  /**
   * Compute fractional progress within the current checkpoint segment.
   * Returns a value 0–1 representing how far between the current CP and the next CP
   * the racer is, based on raw spline t.
   */
  private computeFractionalT(rawT: number, cpIndex: number): number {
    const N = this.checkpoints.length;
    const cpT = this.checkpoints[cpIndex]?.t ?? 0;
    const nextCpT = this.checkpoints[(cpIndex + 1) % N]?.t ?? 1;

    // Handle wrapping (e.g., last CP at t=0.95 → first CP at t=0.05)
    let segLen = nextCpT - cpT;
    if (segLen <= 0) segLen += 1; // wrap
    let offset = rawT - cpT;
    if (offset < -0.5) offset += 1; // wrap
    if (offset > 0.5) offset -= 1; // wrap

    return Math.max(0, Math.min(1, offset / segLen));
  }

  /** Update a racer's position and check for checkpoint crossings.
   *  Returns event string if a checkpoint/lap/finish was hit, null otherwise.
   *  @param heading — racer's heading in radians (for directional validation)
   */
  updateRacer(
    id: string,
    worldPos: THREE.Vector3,
    rawT?: number,
    heading?: number,
  ): 'checkpoint' | 'lap' | 'finish' | null {
    const racer = this.racers.get(id);
    if (!racer || racer.finished) return null;

    racer.position.copy(worldPos);
    const now = performance.now() - this.raceStartTime;

    // Update fractional trackT for sub-checkpoint positioning
    if (rawT !== undefined) {
      racer.trackT = this.computeFractionalT(rawT, racer.checkpointIndex);
      racer.prevT = rawT;
    }

    // Grace period: skip checkpoint detection for first 1.5s to prevent instant triggers
    if (now < this.graceMs) return null;

    // ── Checkpoint proximity detection ──
    const nextCP = this.checkpoints[racer.checkpointIndex];
    if (!nextCP) return null;

    const dist = worldPos.distanceTo(nextCP.position);
    if (dist > this.cpThreshold) return null;

    // Directional check: racer must be moving forward through checkpoint
    if (heading !== undefined) {
      RaceEngine._moveDir.set(Math.sin(heading), 0, Math.cos(heading));
      if (RaceEngine._moveDir.dot(nextCP.tangent) < -0.2) return null; // wrong direction
    }

    // Checkpoint hit!
    racer.checkpointIndex++;

    // Record timestamp for this checkpoint (global index)
    const globalCpIndex = racer.lapIndex * this.checkpoints.length + racer.checkpointIndex - 1;
    const timestamps = this.cpTimestamps.get(id);
    if (timestamps) timestamps.set(globalCpIndex, now);

    if (racer.checkpointIndex >= this.checkpoints.length) {
      // All checkpoints passed — lap complete
      racer.checkpointIndex = 0;
      racer.lapIndex++;

      // Record lap time
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

  /**
   * Get sorted rankings (finished first by time, then in-progress by continuous progress, DNF last).
   * Uses continuous progress = lapIndex * N + checkpointIndex + fractionalT
   * This eliminates the t-wraparound bug entirely.
   */
  getRankings(): RacerProgress[] {
    const list = this._racersList;
    const N = this.checkpoints.length;

    return list.sort((a, b) => {
      // DNF always last
      if (a.dnf && !b.dnf) return 1;
      if (!a.dnf && b.dnf) return -1;
      if (a.dnf && b.dnf) return 0;

      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;

      // Continuous progress: lap * N + checkpoint + fractional
      const progA = a.lapIndex * N + a.checkpointIndex + a.trackT;
      const progB = b.lapIndex * N + b.checkpointIndex + b.trackT;
      return progB - progA;
    });
  }

  /** Get a racer's progress. */
  getProgress(id: string): RacerProgress | undefined {
    return this.racers.get(id);
  }

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
