/* ── IRL Race — Race Events Subsystem ──
 *
 * Checkpoint detection, lap/finish events, race stats tracking,
 * wrong-way detection, and HUD updates. Extracted from game-loop.ts.
 */

import { GameState } from './types';
import { G } from './game-context';
import { bus } from './event-bus';
import { getClosestSplinePoint, updateCheckpointHighlight } from './track';
import { updateTrackRadar } from './minimap';
import { playRumbleStrip, playFinishFanfare, playWrongWayBeep } from './audio';
import { triggerSlowMo } from './time-scale';
import { finalizeGhostLap, startGhostRecording } from './ghost';
import {
  updateHUD, updateDamageHUD,
  updateGapHUD,
} from './hud';

// ── Per-race state ──
let _wrongWayBeepTimer = 0;
let _pendingRank = 0;         // candidate rank waiting for confirmation
let _pendingRankFrames = 0;   // consecutive frames the candidate rank has held
const RANK_HYSTERESIS = 30;   // require 30 stable frames (~500ms at 60fps)

export function resetRaceEventsState() {
  _wrongWayBeepTimer = 0;
  _pendingRank = 0;
  _pendingRankFrames = 0;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RACE STATS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Per-frame race stats accumulation. */
export function updateRaceStats(gameDt: number) {
  if (!G.playerVehicle || G.gameState !== GameState.RACING) return;
  const driftAbs = Math.abs(G.playerVehicle.driftAngle);
  const speedMph = Math.abs(G.playerVehicle.speed) * 2.5;
  if (speedMph > G.raceStats.topSpeed) G.raceStats.topSpeed = speedMph;
  if (speedMph > 180) G.raceStats.speedDemonTime += gameDt;
  if (driftAbs > 0.15) G.raceStats.totalDriftTime += gameDt;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MINIMAP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function updateMinimap(timestamp: number) {
  if (!G.playerVehicle) return;
  const aiDots = G.aiRacers.map(a => ({ pos: a.vehicle.group.position, id: a.id }));
  updateTrackRadar(G.playerVehicle.group.position, G.playerVehicle.heading, aiDots);

  if (G.checkpointMarkers) {
    const localProgress = G.raceEngine?.getProgress('local');
    const nextCp = localProgress ? localProgress.checkpointIndex : 0;
    updateCheckpointHighlight(G.checkpointMarkers, nextCp, timestamp / 1000);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHECKPOINT + LAP + FINISH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Checkpoint detection, lap/finish events, rank tracking, wrong-way, HUD. */
export function updateCheckpointsAndHUD(
  uiOverlay: HTMLElement,
  frameDt: number,
  updateLeaderboard: () => void,
) {
  if (G.gameState !== GameState.RACING || !G.raceEngine || !G.playerVehicle || !G.trackData) return;

  const closestPt = getClosestSplinePoint(G.trackData.spline, G.playerVehicle.group.position, G.trackData.bvh);
  const localT = closestPt.t;

  // Rumble strip
  const lateralDist = G.playerVehicle.group.position.distanceTo(closestPt.point);
  if (lateralDist > 4.5 && G.playerVehicle.speed > 5) {
    playRumbleStrip();
  }

  const event = G.raceEngine.updateRacer('local', G.playerVehicle.group.position, localT, G.playerVehicle.heading);
  const progress = G.raceEngine.getProgress('local');

  if (event === 'checkpoint') {
    bus.emit('checkpoint', {
      racerId: 'local',
      index: progress?.checkpointIndex ?? 0,
      lap: progress?.lapIndex ?? 0,
    });
  } else if (event === 'lap') {
    const lastLapTime = progress?.lapTimes[progress.lapTimes.length - 1] ?? 0;
    const bestLap = G.raceEngine.getBestLap('local');
    finalizeGhostLap(lastLapTime, G.currentRaceSeed, G.selectedCar?.id ?? '');
    startGhostRecording(G.playerVehicle.group.position, G.playerVehicle.heading);
    bus.emit('lap', {
      racerId: 'local',
      lapIndex: progress?.lapIndex ?? 0,
      lapTime: lastLapTime,
      isBest: bestLap !== null && lastLapTime <= bestLap,
    });
  } else if (event === 'finish') {
    playFinishFanfare();
    triggerSlowMo('finish');
    const finishTime = G.raceEngine.getProgress('local')?.finishTime ?? 0;
    bus.emit('finish', { racerId: 'local', finishTime });
  }

  // HUD update
  const rankings = G.raceEngine.getRankings();
  const myRank = rankings.findIndex(r => r.id === 'local') + 1;

  if (myRank > 0) {
    G.raceStats.avgPosition += myRank;
    G.raceStats.positionSampleCount++;
  }

  if (G.prevMyRank > 0 && myRank > 0 && myRank !== G.prevMyRank) {
    // Hysteresis: only emit position change after rank holds for N frames
    if (myRank === _pendingRank) {
      _pendingRankFrames++;
    } else {
      _pendingRank = myRank;
      _pendingRankFrames = 1;
    }
    if (_pendingRankFrames >= RANK_HYSTERESIS) {
      const gained = myRank < G.prevMyRank;
      if (gained) G.raceStats.overtakeCount += (G.prevMyRank - myRank);
      bus.emit('position_change', {
        racerId: 'local', oldRank: G.prevMyRank, newRank: myRank, gained,
      });
      G.prevMyRank = myRank;
      _pendingRankFrames = 0;
    }
  } else {
    _pendingRank = myRank;
    _pendingRankFrames = 0;
    G.prevMyRank = myRank;
  }

  const wrongWay = G.raceEngine.isWrongWay(
    G.playerVehicle.heading,
    G.trackData.checkpoints[progress?.checkpointIndex ?? 0]?.tangent ?? G._defaultTangent,
  );
  uiOverlay.classList.toggle('wrong-way-flash', wrongWay);

  // Wrong-way audio warning beep
  if (wrongWay) {
    _wrongWayBeepTimer -= frameDt;
    if (_wrongWayBeepTimer <= 0) {
      playWrongWayBeep();
      _wrongWayBeepTimer = 0.5;
    }
  } else {
    _wrongWayBeepTimer = 0;
  }

  updateHUD(
    G.playerVehicle.speed,
    progress?.lapIndex ?? 0,
    G.totalLaps,
    myRank,
    rankings.length,
    wrongWay,
    G.raceEngine.getElapsedTime() * 1000,
    G.playerVehicle.isNitroActive,
    frameDt,
  );

  updateLeaderboard();

  if (G.raceEngine) {
    const gaps = G.raceEngine.getGaps('local');
    updateGapHUD(gaps.ahead, gaps.behind);
  }

  if (G.playerVehicle) updateDamageHUD(G.playerVehicle.damage);
}
