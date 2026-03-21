import { COLORS } from './colors';
/* ── IRL Race — Results Screen ── */

import { GameState, EventType } from './types';
import { G } from './game-context';
type GameContext = typeof G;
import { RaceEngine } from './race-engine';
import { processRaceRewards, getProgress, levelProgress, xpToNextLevel, canPrestige, prestige, ratingGrade, getDailyChallenges, getWeeklyChallenges, getChallengeProgress, DRIVER_PERKS, getAvailableSkillPoints, getPerkTier, getPerkBonus, spendSkillPoint, type RaceResult } from './progression';
import { playRewardsAnimation } from './rewards-animation';
import { spawnVictoryConfetti, setConfettiContinuous } from './vfx';
import { showTouchControls } from './input';
import { showToast } from './mp-lobby';
import { getMidRaceCredits, getMidRaceXP } from './mid-race-rewards';

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

function ratingColor(grade: string): string {
  switch (grade) {
    case 'S': return COLORS.GOLD;
    case 'A': return '#00e676';
    case 'B': return '#4fc3f7';
    case 'C': return '#fff176';
    case 'D': return '#ff9800';
    default: return '#ef5350';
  }
}

function buildDriverDNAHTML(): string {
  const prog = getProgress();
  const sg = ratingGrade(prog.speedRating);
  const cg = ratingGrade(prog.cleanRating);
  return `<div class="lap-breakdown" style="margin-top:8px;">
    <div class="lap-breakdown-title">DRIVER DNA</div>
    <div class="lap-breakdown-row"><span>⚡ Speed Rating</span><span style="color:${ratingColor(sg)};font-weight:700;">${sg} (${prog.speedRating})</span></div>
    <div style="background:rgba(255,255,255,0.1);border-radius:4px;height:4px;margin:2px 0;">
      <div style="background:${ratingColor(sg)};border-radius:4px;height:100%;width:${prog.speedRating}%;transition:width 0.5s;"></div>
    </div>
    <div class="lap-breakdown-row"><span>✨ Clean Rating</span><span style="color:${ratingColor(cg)};font-weight:700;">${cg} (${prog.cleanRating})</span></div>
    <div style="background:rgba(255,255,255,0.1);border-radius:4px;height:4px;margin:2px 0;">
      <div style="background:${ratingColor(cg)};border-radius:4px;height:100%;width:${prog.cleanRating}%;transition:width 0.5s;"></div>
    </div>
  </div>`;
}

function buildChallengesHTML(): string {
  const daily = getDailyChallenges();
  const weekly = getWeeklyChallenges();
  let html = `<div class="lap-breakdown" style="margin-top:8px;">
    <div class="lap-breakdown-title">DAILY CHALLENGES</div>`;
  for (const ch of daily) {
    const [cur, tgt, done] = getChallengeProgress(ch);
    const pct = Math.min(100, Math.round((cur / tgt) * 100));
    html += `<div class="lap-breakdown-row${done ? ' best' : ''}"><span>${ch.icon} ${ch.name}</span><span>${done ? '✅' : `${cur}/${tgt}`}</span></div>`;
    if (!done) html += `<div style="background:rgba(255,255,255,0.1);border-radius:3px;height:3px;margin:1px 0;"><div style="background:var(--col-orange);border-radius:3px;height:100%;width:${pct}%;"></div></div>`;
  }
  html += `<div class="lap-breakdown-title" style="margin-top:6px;">WEEKLY CHALLENGES</div>`;
  for (const ch of weekly) {
    const [cur, tgt, done] = getChallengeProgress(ch);
    const pct = Math.min(100, Math.round((cur / tgt) * 100));
    html += `<div class="lap-breakdown-row${done ? ' best' : ''}"><span>${ch.icon} ${ch.name}</span><span>${done ? '✅' : `${cur}/${tgt}`}</span></div>`;
    if (!done) html += `<div style="background:rgba(255,255,255,0.1);border-radius:3px;height:3px;margin:1px 0;"><div style="background:var(--col-cyan);border-radius:3px;height:100%;width:${pct}%;"></div></div>`;
  }
  html += `</div>`;
  return html;
}

function buildPerksHTML(): string {
  const sp = getAvailableSkillPoints();
  let html = `<div class="lap-breakdown" style="margin-top:8px;" id="perks-section">
    <div class="lap-breakdown-title">DRIVER PERKS <span style="color:${COLORS.GOLD};float:right;">${sp} SP available</span></div>`;
  for (const perk of DRIVER_PERKS) {
    const tier = getPerkTier(perk.id);
    const bonus = getPerkBonus(perk.id);
    const maxed = tier >= perk.maxTier;
    const dots = Array.from({ length: perk.maxTier }, (_, i) => i < tier ? '●' : '○').join('');
    html += `<div class="lap-breakdown-row" style="align-items:center;">`;
    html += `<span>${perk.icon} ${perk.name} <span style="color:rgba(255,255,255,0.4);font-size:11px;">${dots}</span></span>`;
    html += `<span style="display:flex;align-items:center;gap:6px;">`;
    if (bonus > 0) html += `<span style="color:#4fc3f7;">+${bonus}${perk.unit}</span>`;
    if (!maxed && sp > 0) {
      html += `<button class="perk-upgrade-btn" data-perk="${perk.id}" style="padding:2px 8px;font-size:11px;background:linear-gradient(135deg,${COLORS.GOLD},#ff8c00);color:#000;border:none;border-radius:4px;cursor:pointer;font-weight:700;">▲ UP</button>`;
    } else if (maxed) {
      html += `<span style="color:${COLORS.GOLD};font-size:11px;">MAX</span>`;
    }
    html += `</span></div>`;
  }
  html += `</div>`;
  return html;
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
  if (rewards.driftBonus > 0) html += `<div class="lap-breakdown-row"><span>🔥 Drift</span><span>+${rewards.driftBonus} XP</span></div>`;
  if (rewards.overtakeBonus > 0) html += `<div class="lap-breakdown-row"><span>🏎️ Overtakes</span><span>+${rewards.overtakeBonus} XP</span></div>`;
  if (rewards.nearMissBonus > 0) html += `<div class="lap-breakdown-row"><span>😤 Near Misses</span><span>+${rewards.nearMissBonus} XP</span></div>`;
  if (rewards.speedDemonBonus > 0) html += `<div class="lap-breakdown-row"><span>⚡ Speed Demon</span><span>+${rewards.speedDemonBonus} XP</span></div>`;
  if (rewards.perfectStartBonus > 0) html += `<div class="lap-breakdown-row"><span>🚀 Perfect Start</span><span>+${rewards.perfectStartBonus} XP</span></div>`;
  // Multipliers
  const mults: string[] = [];
  if (rewards.streakMultiplier > 1) mults.push(`Streak ×${rewards.streakMultiplier.toFixed(1)}`);
  if (rewards.lappingMultiplier > 1) mults.push(`Lapping ×${rewards.lappingMultiplier.toFixed(2)}`);
  if (rewards.prestigeMultiplier > 1) mults.push(`Prestige ×${rewards.prestigeMultiplier.toFixed(2)}`);
  if (mults.length > 0) html += `<div class="lap-breakdown-row best" style="color:${COLORS.GOLD};"><span>🔄 ${mults.join(' · ')}</span><span>APPLIED</span></div>`;
  html += `<div class="lap-breakdown-row" style="border-top:1px solid rgba(255,255,255,0.15);padding-top:4px;font-weight:700;"><span>Total</span><span>+${rewards.totalXP} XP / +${rewards.totalCredits} CR</span></div>`;
  if (rewards.leveledUp) html += `<div class="lap-breakdown-row best" style="color:#ffcc00;font-weight:700;"><span>⬆ LEVEL UP!</span><span>Level ${rewards.newLevel}</span></div>`;
  // Achievements
  for (const ach of rewards.newAchievements) {
    html += `<div class="lap-breakdown-row best" style="color:${COLORS.GOLD};font-weight:700;"><span>${ach.icon} ${ach.name}</span><span>+${ach.creditReward} CR</span></div>`;
  }
  html += `<div class="lap-breakdown-row" style="margin-top:6px;"><span>Level ${prog.level}${prog.prestige > 0 ? ` ⭐${prog.prestige}` : ''}</span><span>${xpToNextLevel()} XP to next</span></div>`;
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

  // Compute lapping multiplier: sum of laps the player is ahead of each opponent
  let totalLapsLapped = 0;
  const playerLapIdx = localProgress?.lapIndex ?? 0;
  for (const r of rankings) {
    if (r.id === 'local' || r.dnf) continue;
    const diff = playerLapIdx - r.lapIndex;
    if (diff > 0) totalLapsLapped += diff;
  }
  const lappingMultiplier = 1.0 + totalLapsLapped * 0.25; // +25% per lap lead

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
    lappingMultiplier,
    overtakeCount: G.raceStats.overtakeCount,
    nearMissCount: G.raceStats.nearMissCount,
    speedDemonTime: G.raceStats.speedDemonTime,
    perfectStart: G.raceStats.perfectStart,
    environment: G._selectedEnvironment ?? 'Random',
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
        <div class="lap-breakdown-row"><span>Overtakes</span><span>${G.raceStats.overtakeCount}</span></div>
        <div class="lap-breakdown-row"><span>Near Misses</span><span>${G.raceStats.nearMissCount}</span></div>
        <div class="lap-breakdown-row"><span>Avg Position</span><span>${G.raceStats.positionSampleCount > 0 ? (G.raceStats.avgPosition / G.raceStats.positionSampleCount).toFixed(1) : '—'}</span></div>
        <div class="lap-breakdown-row"><span>Collisions</span><span>${G.raceStats.collisionCount}</span></div>
        ${G.raceStats.speedDemonTime >= 5 ? `<div class="lap-breakdown-row best"><span>⚡ Speed Demon</span><span>${G.raceStats.speedDemonTime.toFixed(1)}s</span></div>` : ''}
        ${G.raceStats.perfectStart ? '<div class="lap-breakdown-row best"><span>🚀 Perfect Start</span><span>YES</span></div>' : ''}
        ${getMidRaceCredits() > 0 || getMidRaceXP() > 0 ? `<div class="lap-breakdown-row best" style="border-top:1px solid rgba(255,255,255,0.15);padding-top:4px;"><span>🎯 Mid-Race Bonuses</span><span>+${getMidRaceCredits()} CR / +${getMidRaceXP()} XP</span></div>` : ''}
      </div>
      ${buildRewardHTML(earlyRewards)}
      ${earlyRewards.streakMultiplier > 1 ? `<div style="text-align:center;margin:6px 0;color:${COLORS.GOLD};font-weight:700;">🔥 Win Streak: ${getProgress().winStreak} — ×${earlyRewards.streakMultiplier.toFixed(1)} bonus</div>` : ''}
      ${buildDriverDNAHTML()}
      ${buildChallengesHTML()}
      ${buildPerksHTML()}
    </div>
    <div class="results-actions">
      <div class="menu-buttons" style="width:240px;">
        ${hasReplay ? '<button class="menu-btn" id="btn-replay" style="border-color:var(--col-cyan);color:var(--col-cyan);">WATCH REPLAY</button>' : ''}
        ${canPrestige() ? '<button class="menu-btn" id="btn-prestige" style="background:linear-gradient(135deg,${COLORS.GOLD},#ff8c00);color:#000;font-weight:700;">⭐ PRESTIGE</button>' : ''}
        ${isMultiplayer ? '<button class="menu-btn" id="btn-rematch" style="background:var(--col-green);">REMATCH</button>' : ''}
        ${!isMultiplayer ? '<button class="menu-btn" id="btn-play-again">PLAY AGAIN</button>' : ''}
        <button class="menu-btn" id="btn-main-menu">MAIN MENU</button>
      </div>
    </div>
  `;
  uiOverlay.appendChild(el);

  // ── Perk upgrade button handler (delegated) ──
  el.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.perk-upgrade-btn') as HTMLElement;
    if (!btn) return;
    const perkId = btn.dataset.perk;
    if (!perkId) return;
    if (spendSkillPoint(perkId)) {
      // Re-render entire perks section
      const section = document.getElementById('perks-section');
      if (section) section.outerHTML = buildPerksHTML();
    }
  });

  document.getElementById('btn-prestige')?.addEventListener('click', () => {
    if (prestige()) {
      // Re-render the reward HTML section
      const rewardSection = el.querySelector('.results-scroll .lap-breakdown:last-of-type');
      if (rewardSection) rewardSection.outerHTML = buildRewardHTML(earlyRewards);
      document.getElementById('btn-prestige')?.remove();
    }
  });
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
