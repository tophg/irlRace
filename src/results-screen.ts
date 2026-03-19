/* ── IRL Race — Results Screen ── */

import { GameState, EventType } from './types';
import { G } from './game-context';
type GameContext = typeof G;
import { RaceEngine } from './race-engine';
import { processRaceRewards, getProgress, levelProgress, xpToNextLevel, type RaceResult } from './progression';
import { playRewardsAnimation } from './rewards-animation';
import { spawnVictoryConfetti, setConfettiContinuous } from './vfx';
import { showTouchControls } from './input';
import { showToast } from './mp-lobby';

// ── AI driver names for results ──
const AI_DRIVER_NAMES = [
  'Blaze', 'Nitro', 'Ghost', 'Viper', 'Smoke', 'Flash',
  'Turbo', 'Clutch', 'Drift', 'Razor', 'Burn', 'Apex',
];

/** Resolve a racer ID into a display name. */
export function resolvePlayerName(id: string, G: GameContext): string {
  if (id === 'local') return 'You';
  if (id.startsWith('ai_')) {
    const idx = parseInt(id.replace('ai_', ''), 10) || 0;
    return AI_DRIVER_NAMES[idx % AI_DRIVER_NAMES.length];
  }
  const netName = G.netPeer?.getRemotePlayers().find(rp => rp.id === id)?.name;
  if (netName && netName !== 'Racer') return netName;
  const mpName = G.mpPlayersList.find(p => p.id === id)?.name;
  return mpName || netName || id.slice(0, 8);
}

function buildRewardHTML(rewards: import('./progression').RewardBreakdown): string {
  const prog = getProgress();
  const lvlPct = Math.round(levelProgress() * 100);

  let html = `<div class="lap-breakdown" style="margin-top:8px;">
    <div class="lap-breakdown-title">REWARDS</div>
    <div class="lap-breakdown-row"><span>Race Complete</span><span>+${rewards.baseXP} XP / +${rewards.baseCredits} CR</span></div>`;
  if (rewards.winBonus > 0) html += `<div class="lap-breakdown-row best"><span>🏆 Victory!</span><span>+${rewards.winBonus} XP / +${rewards.winCreditsBonus} CR</span></div>`;
  if (rewards.podiumBonus > 0) html += `<div class="lap-breakdown-row"><span>🥇 Podium</span><span>+${rewards.podiumBonus} XP / +${rewards.podiumCreditsBonus} CR</span></div>`;
  if (rewards.cleanBonus > 0) html += `<div class="lap-breakdown-row"><span>✨ Clean Race</span><span>+${rewards.cleanBonus} XP</span></div>`;
  if (rewards.driftBonus > 0) html += `<div class="lap-breakdown-row"><span>🔥 Drift Bonus</span><span>+${rewards.driftBonus} XP</span></div>`;
  html += `<div class="lap-breakdown-row" style="border-top:1px solid rgba(255,255,255,0.15);padding-top:4px;font-weight:700;"><span>Total</span><span>+${rewards.totalXP} XP / +${rewards.totalCredits} CR</span></div>`;
  if (rewards.leveledUp) html += `<div class="lap-breakdown-row best" style="color:#ffcc00;font-weight:700;"><span>⬆ LEVEL UP!</span><span>Level ${rewards.newLevel}</span></div>`;
  html += `<div class="lap-breakdown-row" style="margin-top:6px;"><span>Level ${prog.level}</span><span>${xpToNextLevel()} XP to next</span></div>`;
  html += `<div style="background:rgba(255,255,255,0.1);border-radius:4px;height:6px;margin:4px 0;"><div style="background:var(--col-orange);border-radius:4px;height:100%;width:${lvlPct}%;transition:width 0.5s;"></div></div>`;
  html += `<div class="lap-breakdown-row"><span>Credits</span><span style="color:#ffcc00;font-weight:700;">${prog.credits} CR</span></div>`;
  html += `</div>`;
  return html;
}

/** Callbacks injected by main.ts to avoid circular dependencies. */
export interface ResultsCallbacks {
  startRace: () => void;
  showTitleScreen: () => void;
  startReplayPlayback: () => void;
  clearRaceObjects: () => void;
  destroyLeaderboard: () => void;
  destroySpectateHUD: () => void;
}

/** Show the results overlay with rankings, stats, rewards, and action buttons. */
export async function showResults(
  G: GameContext,
  uiOverlay: HTMLElement,
  callbacks: ResultsCallbacks,
) {
  G.gameState = GameState.RESULTS;
  // Victory confetti burst!
  if (G.playerVehicle) {
    spawnVictoryConfetti(G.playerVehicle.group.position);
    setConfettiContinuous(true, G.playerVehicle.group.position);
  }

  // Record session wins
  const preRankings = G.raceEngine?.getRankings() ?? [];
  if (preRankings.length > 0 && !preRankings[0].dnf && preRankings[0].finished) {
    const winnerId = preRankings[0].id;
    G.sessionWins.set(winnerId, (G.sessionWins.get(winnerId) || 0) + 1);
  }
  G.netPeer?.stopBroadcasting();
  G.netPeer?.stopPinging();
  showTouchControls(false);
  G.replayRecorder?.stop();

  if (G.postWinnerTimer) clearTimeout(G.postWinnerTimer);
  G.postWinnerTimer = window.setTimeout(() => {
    if (G.raceEngine) {
      for (const r of G.raceEngine.getRankings()) {
        if (!r.finished) G.raceEngine.markDnf(r.id);
      }
    }
    G.postWinnerTimer = null;
  }, 15000);

  const rankings = G.raceEngine?.getRankings() ?? [];
  const winner = rankings[0];

  // ── Rewards Animation (plays BEFORE building results HTML) ──
  const localProgress = G.raceEngine?.getProgress('local');
  const localRank = rankings.findIndex((r: any) => r.id === 'local') + 1;
  const bestLapForReward = localProgress?.lapTimes?.length ? Math.min(...localProgress.lapTimes) : 0;
  const prevLevelPct = levelProgress(); // capture BEFORE processRaceRewards mutates state
  const earlyResult: RaceResult = {
    placement: localRank || 1,
    totalRacers: rankings.length,
    lapTimes: localProgress?.lapTimes ?? [],
    bestLap: bestLapForReward / 1000,
    collisionCount: G.raceStats.collisionCount,
    driftTime: G.raceStats.totalDriftTime,
    topSpeed: G.raceStats.topSpeed,
    trackLength: G.trackData?.totalLength ?? 500,
    lapsCompleted: localProgress?.lapTimes?.length ?? 0,
  };
  const earlyRewards = processRaceRewards(earlyResult);
  await playRewardsAnimation(earlyRewards, localRank || 1, prevLevelPct, uiOverlay);

  const escHtml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const winnerName = winner ? escHtml(resolvePlayerName(winner.id, G)) : '???';
  const isMultiplayer = !!G.netPeer;
  const isHost = G.netPeer?.getIsHost() ?? false;
  const hasReplay = G.replayRecorder?.hasData() ?? false;

  const el = document.createElement('div');
  el.className = 'results-overlay';
  const localBestLap = G.raceEngine?.getBestLap('local');
  const lapBreakdownHtml = localProgress && localProgress.lapTimes.length > 0
    ? `<div class="lap-breakdown">
        <div class="lap-breakdown-title">YOUR LAPS</div>
        ${localProgress.lapTimes.map((t, i) => {
          const isBest = localBestLap != null && t <= localBestLap;
          return `<div class="lap-breakdown-row${isBest ? ' best' : ''}">
            <span>Lap ${i + 1}</span>
            <span>${RaceEngine.formatTime(t)}${isBest ? ' ★' : ''}</span>
          </div>`;
        }).join('')}
       </div>` : '';

  el.innerHTML = `
    <div class="results-scroll">
      <div class="results-title">${winner?.dnf ? 'RACE COMPLETE' : `${winnerName.toUpperCase()} ${winner?.id === 'local' ? 'WIN' : 'WINS'}!`}</div>
      <table class="results-table">
        <thead><tr>
          <th>POS</th>
          <th>RACER</th>
          <th>TIME</th>
          <th>BEST LAP</th>
        </tr></thead>
        <tbody>
          ${rankings.map((r, i) => {
            const name = escHtml(resolvePlayerName(r.id, G));
            const isSelf = r.id === 'local';
            const isDnf = r.dnf;
            const bestLap = r.lapTimes.length > 0 ? Math.min(...r.lapTimes) : null;
            const delayMs = (i + 1) * 150;
            const wins = G.sessionWins.get(r.id) || 0;
            const winsHtml = wins > 0 ? ` <span class="session-wins">${wins}W</span>` : '';
            const crownHtml = G.sessionWins.size > 0 && wins === Math.max(...G.sessionWins.values()) && wins > 0 ? ' 👑' : '';
            return `
              <tr class="${isSelf ? 'local' : ''} ${isDnf ? 'dnf' : ''} ${i === 0 && !isDnf ? 'winner' : ''}" style="animation-delay:${delayMs}ms;">
                <td>${isDnf ? '—' : i + 1}</td>
                <td>${name}${crownHtml}${winsHtml}${isDnf ? ' <span style="color:#ff4444;font-size:11px;">DNF</span>' : ''}</td>
                <td>${isDnf ? '—' : r.finished ? RaceEngine.formatTime(r.finishTime) : 'Racing...'}</td>
                <td>${bestLap !== null ? RaceEngine.formatTime(bestLap) : '—'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      ${lapBreakdownHtml}
      <div class="lap-breakdown" style="margin-top:8px;">
        <div class="lap-breakdown-title">RACE STATS</div>
        <div class="lap-breakdown-row"><span>Top Speed</span><span>${Math.floor(G.raceStats.topSpeed)} MPH</span></div>
        <div class="lap-breakdown-row"><span>Drift Time</span><span>${G.raceStats.totalDriftTime.toFixed(1)}s</span></div>
        <div class="lap-breakdown-row"><span>Avg Position</span><span>${G.raceStats.positionSampleCount > 0 ? (G.raceStats.avgPosition / G.raceStats.positionSampleCount).toFixed(1) : '—'}</span></div>
        <div class="lap-breakdown-row"><span>Collisions</span><span>${G.raceStats.collisionCount}</span></div>
        <div class="lap-breakdown-row"><span>Near Misses</span><span>${G.raceStats.nearMissCount}</span></div>
      </div>
      ${buildRewardHTML(earlyRewards)}
    </div>
    <div class="results-actions">
      <div class="menu-buttons" style="width:240px;">
        ${hasReplay ? '<button class="menu-btn" id="btn-replay" style="border-color:var(--col-cyan);color:var(--col-cyan);">WATCH REPLAY</button>' : ''}
        ${isMultiplayer ? '<button class="menu-btn" id="btn-rematch" style="background:var(--col-green);">REMATCH</button>' : ''}
        ${!isMultiplayer ? '<button class="menu-btn" id="btn-play-again">PLAY AGAIN</button>' : ''}
        <button class="menu-btn" id="btn-main-menu">MAIN MENU</button>
      </div>
    </div>
  `;
  uiOverlay.appendChild(el);

  document.getElementById('btn-replay')?.addEventListener('click', () => {
    el.remove();
    callbacks.destroyLeaderboard();
    callbacks.startReplayPlayback();
  });
  document.getElementById('btn-play-again')?.addEventListener('click', () => {
    el.remove();
    if (G.postWinnerTimer) { clearTimeout(G.postWinnerTimer); G.postWinnerTimer = null; }
    callbacks.startRace();
  });
  document.getElementById('btn-rematch')?.addEventListener('click', () => {
    el.remove();
    if (G.postWinnerTimer) { clearTimeout(G.postWinnerTimer); G.postWinnerTimer = null; }
    if (isHost) {
      G.raceReadyCount = 0;
      G.trackSeed = Math.floor(Math.random() * 99999);
      const rematchPlayers = [{ id: G.netPeer!.getLocalId(), name: G.localPlayerName, carId: G.selectedCar.id }];
      for (const rp of G.netPeer!.getRemotePlayers()) rematchPlayers.push({ id: rp.id, name: rp.name, carId: rp.carId });
      G.mpPlayersList = rematchPlayers;
      G.netPeer!.broadcastEvent(EventType.REMATCH_REQUEST, { seed: G.trackSeed, laps: G.totalLaps, players: rematchPlayers });
      callbacks.destroyLeaderboard();
      callbacks.startRace();
    } else {
      G.netPeer!.broadcastEvent(EventType.REMATCH_ACCEPT, {});
      showToast(uiOverlay, 'Rematch requested...');
    }
  });
  document.getElementById('btn-main-menu')!.addEventListener('click', () => {
    el.remove();
    if (G.postWinnerTimer) { clearTimeout(G.postWinnerTimer); G.postWinnerTimer = null; }
    G.netPeer?.destroy();
    G.netPeer = null;
    callbacks.clearRaceObjects();
    callbacks.destroyLeaderboard();
    callbacks.destroySpectateHUD();
    G.sessionWins.clear();
    callbacks.showTitleScreen();
  });
}
