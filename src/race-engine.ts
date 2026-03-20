/* ── IRL Race — Race Engine ── */

import * as THREE from 'three/webgpu';
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
  private totalLength: number; // total spline arc length in world units

  // Reusable vector for direction checks
  private static _moveDir = new THREE.Vector3();

  constructor(checkpoints: Checkpoint[], totalLaps = 3, totalLength = 1000) {
    this.checkpoints = checkpoints;
    this.totalLaps = totalLaps;
    this.totalLength = totalLength;
  }

  /** Register a racer. Pass initialT from placement so prevT is correct on frame 1. */
  addRacer(id: string, initialT = 0) {
    this.racers.set(id, {
      id,
      lapIndex: 0,
      checkpointIndex: 1, // Start at 1: racer is already at checkpoint 0 (start/finish line)
      finished: false,
      finishTime: 0,
      position: new THREE.Vector3(),
      rawT: initialT,
      prevT: initialT,
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

    // Store raw spline parameter for debugging / gap calculations
    if (rawT !== undefined) {
      racer.rawT = rawT;
    }

    // Grace period: skip checkpoint detection for first 1.5s to prevent instant triggers
    if (now < this.graceMs) {
      if (rawT !== undefined) racer.prevT = rawT;
      return null;
    }

    // ── Checkpoint detection ──
    const nextCP = this.checkpoints[racer.checkpointIndex];
    if (!nextCP) return null;

    // Method 1: Proximity check (original)
    const dist = worldPos.distanceTo(nextCP.position);
    let triggered = dist <= this.cpThreshold;

    // Method 2: Spline-t crossing check (catches high-speed skip-past)
    // If the racer's rawT crossed over the checkpoint's t between frames, trigger it
    if (!triggered && rawT !== undefined && racer.prevT !== undefined) {
      const cpT = nextCP.t;
      const prevT = racer.prevT;
      const currT = rawT;

      // Normal forward crossing (prevT < cpT <= currT)
      if (prevT < cpT && currT >= cpT) {
        triggered = true;
      }
      // Wrap-around crossing for checkpoint 0 at t≈0 (prevT near 1.0, currT near 0.0)
      else if (cpT < 0.05 && prevT > 0.9 && currT < 0.1) {
        triggered = true;
      }
    }

    if (rawT !== undefined) racer.prevT = rawT;

    if (!triggered) return null;

    // Directional check: racer must be moving forward through checkpoint
    if (heading !== undefined) {
      RaceEngine._moveDir.set(Math.sin(heading), 0, Math.cos(heading));
      if (RaceEngine._moveDir.dot(nextCP.tangent) < -0.2) return null; // wrong direction
    }

    // Checkpoint hit!
    const hitCpIndex = racer.checkpointIndex;
    racer.checkpointIndex++;

    // Record timestamp for this checkpoint (global index)
    const globalCpIndex = racer.lapIndex * this.checkpoints.length + hitCpIndex;
    const timestamps = this.cpTimestamps.get(id);
    if (timestamps) timestamps.set(globalCpIndex, now);

    if (racer.checkpointIndex >= this.checkpoints.length) {
      // Visited all interior checkpoints — wrap to 0 so racer must
      // now cross checkpoint 0 (the actual start/finish line) to complete the lap.
      racer.checkpointIndex = 0;
      return 'checkpoint';
    }

    // Checkpoint 0 crossed after all others ⇒ lap / finish
    if (hitCpIndex === 0) {
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
   * Get sorted rankings using total distance from start line.
   * Higher distance = further ahead in the race.
   */
  getRankings(): RacerProgress[] {
    // Return a sorted copy — never mutate the internal list in-place
    return [...this._racersList].sort((a, b) => {
      // DNF always last
      if (a.dnf && !b.dnf) return 1;
      if (!a.dnf && b.dnf) return -1;
      if (a.dnf && b.dnf) return 0;

      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;

      // Distance-based ranking: total distance from start line
      const progA = this.continuousProgress(a);
      const progB = this.continuousProgress(b);
      return progB - progA;
    });
  }

  /**
   * Compute continuous progress as total distance traveled from the start line.
   * Formula: effectiveLap * totalLength + rawT * totalLength
   *
   * Critical fix: rawT wraps from ~1.0 → ~0.0 when crossing the start line,
   * but lapIndex only increments after checkpoint 0 actually triggers (which
   * has a detection delay). During that window, naive progress drops by ~1 lap.
   * We detect this wrap-around: if checkpointIndex === 0 (all interior CPs passed,
   * waiting for start/finish) AND rawT is in the first 15% of the track, the racer
   * has effectively started the next lap for ranking purposes.
   */
  private continuousProgress(r: RacerProgress): number {
    let effectiveLap = r.lapIndex;

    // Detect wrap-around: racer passed all checkpoints (cpIndex reset to 0)
    // and rawT has crossed from end of track to start — they're effectively
    // on the next lap but the lapIndex hasn't incremented yet.
    if (r.checkpointIndex === 0 && r.rawT < 0.15 && r.lapIndex < this.totalLaps) {
      effectiveLap += 1;
    }

    return effectiveLap * this.totalLength + r.rawT * this.totalLength;
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
