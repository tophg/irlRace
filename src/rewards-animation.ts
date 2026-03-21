/* ── IRL Race — Post-Race Rewards Animation ──
 *
 * AAA-inspired staggered reveal: placement banner → reward rows →
 * XP bar fill → credits → level-up. All procedural Web Audio SFX.
 * Tap anywhere to skip.
 */

import { COLORS } from './colors';
import type { RewardBreakdown } from './progression';
import { levelProgress, xpToNextLevel, getProgress } from './progression';
import { emitLevelBurst, emitXPStream, emitAchievementConfetti, emitCurrencyBurst } from './reward-particles';
import { SHAKE } from './screen-shake';

// Audit fix #3: use shared AudioContext (Safari max 6 limit)
// Set via setRewardsAnimAudioContext() from audio.ts init
let _audioCtx: AudioContext | null = null;
function ctx(): AudioContext | null {
  return _audioCtx;
}

/** Provide the shared AudioContext — call from audio.ts initAudio(). */
export function setRewardsAnimAudioContext(c: AudioContext) {
  _audioCtx = c;
}

/** Audit fix #17: cleanup function for race teardown. */
export function destroyRewardsAnimation() {
  // Don't close — shared context is owned by audio.ts
  _audioCtx = null;
}

function playCounterTick() {
  try {
    const c = ctx();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = 1200;
    g.gain.setValueAtTime(0.08, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.03);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime);
    o.stop(c.currentTime + 0.03);
  } catch {}
}

function playBonusChime() {
  try {
    const c = ctx();
    if (!c) return;
    const now = c.currentTime;
    for (const [freq, delay] of [[800, 0], [1200, 0.06]] as const) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.12, now + delay);
      g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.12);
      o.connect(g).connect(c.destination);
      o.start(now + delay);
      o.stop(now + delay + 0.12);
    }
  } catch {}
}

function playBarFillSweep() {
  try {
    const c = ctx();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(400, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(1600, c.currentTime + 0.8);
    g.gain.setValueAtTime(0.06, c.currentTime);
    g.gain.linearRampToValueAtTime(0.08, c.currentTime + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.9);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime);
    o.stop(c.currentTime + 0.9);
  } catch {}
}

function playLevelUpFanfare() {
  try {
    const c = ctx();
    if (!c) return;
    const now = c.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      const t = now + i * 0.1;
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  } catch {}
}

function playTotalPunch() {
  try {
    const c = ctx();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = 600;
    g.gain.setValueAtTime(0.1, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.15);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime);
    o.stop(c.currentTime + 0.15);
  } catch {}
}

// ── Counter-roll animation ──
function counterRoll(el: HTMLElement, target: number, durationMs: number, prefix = '+', suffix = ''): Promise<void> {
  return new Promise(resolve => {
    const start = performance.now();
    let tickCounter = 0;
    function frame(now: number) {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const current = Math.round(target * eased);
      el.textContent = `${prefix}${current}${suffix}`;
      if (++tickCounter % 4 === 0 && t < 1) playCounterTick();
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

// ── Placement text ──
function placementText(p: number): string {
  if (p === 1) return '1ST';
  if (p === 2) return '2ND';
  if (p === 3) return '3RD';
  return `${p}TH`;
}

function placementColor(p: number): string {
  if (p === 1) return COLORS.GOLD;
  if (p === 2) return '#c0c0c0';
  if (p === 3) return '#cd7f32';
  return '#ffffff';
}

// ── Reward rows config ──
interface RewardRow {
  icon: string;
  label: string;
  xp: number;
  cr: number;
  isBonus: boolean;
}

function buildRewardRows(r: RewardBreakdown): RewardRow[] {
  const rows: RewardRow[] = [
    { icon: '🏁', label: 'Race Complete', xp: r.baseXP, cr: r.baseCredits, isBonus: false },
  ];
  if (r.winBonus > 0) rows.push({ icon: '🏆', label: 'Victory!', xp: r.winBonus, cr: r.winCreditsBonus, isBonus: true });
  if (r.podiumBonus > 0) rows.push({ icon: '🥇', label: 'Podium', xp: r.podiumBonus, cr: r.podiumCreditsBonus, isBonus: true });
  if (r.cleanBonus > 0) rows.push({ icon: '✨', label: 'Clean Race', xp: r.cleanBonus, cr: 0, isBonus: true });
  if (r.driftBonus > 0) rows.push({ icon: '🔥', label: 'Drift', xp: r.driftBonus, cr: 0, isBonus: true });
  if (r.overtakeBonus > 0) rows.push({ icon: '🏎️', label: 'Overtakes', xp: r.overtakeBonus, cr: 0, isBonus: true });
  if (r.nearMissBonus > 0) rows.push({ icon: '😤', label: 'Near Misses', xp: r.nearMissBonus, cr: 0, isBonus: true });
  if (r.speedDemonBonus > 0) rows.push({ icon: '⚡', label: 'Speed Demon', xp: r.speedDemonBonus, cr: 0, isBonus: true });
  if (r.perfectStartBonus > 0) rows.push({ icon: '🚀', label: 'Perfect Start', xp: r.perfectStartBonus, cr: 0, isBonus: true });
  // Combined multiplier row
  const mults: string[] = [];
  if (r.streakMultiplier > 1) mults.push(`Streak ×${r.streakMultiplier.toFixed(1)}`);
  if (r.lappingMultiplier > 1) mults.push(`Lapping ×${r.lappingMultiplier.toFixed(2)}`);
  if (r.prestigeMultiplier > 1) mults.push(`Prestige ×${r.prestigeMultiplier.toFixed(2)}`);
  if (mults.length > 0) rows.push({ icon: '🔄', label: mults.join(' · '), xp: 0, cr: 0, isBonus: true });
  return rows;
}

// ── Main entry ──

/**
 * Play the 5-phase post-race rewards animation.
 * Resolves when complete or skipped.
 * @param rewards Pre-computed reward breakdown
 * @param placement 1-based finish position
 * @param previousLevelProgress XP bar % BEFORE this race (0–1)
 * @param uiOverlay DOM container
 */
export function playRewardsAnimation(
  rewards: RewardBreakdown,
  placement: number,
  previousLevelProgress: number,
  uiOverlay: HTMLElement,
): Promise<void> {
  return new Promise(resolve => {
    let skipped = false;
    let overlay: HTMLDivElement | null = null;
    const timers: number[] = [];

    function schedule(fn: () => void, ms: number) {
      timers.push(window.setTimeout(() => { if (!skipped) fn(); }, ms));
    }

    function skip() {
      if (skipped) return;
      skipped = true;
      timers.forEach(clearTimeout);
      if (overlay) overlay.remove();
      overlay = null;
      resolve();
    }

    // Create overlay
    overlay = document.createElement('div');
    overlay.className = 'rewards-overlay';
    overlay.addEventListener('click', skip);
    overlay.addEventListener('touchstart', skip, { passive: true });

    // Skip hint
    const hint = document.createElement('div');
    hint.className = 'rewards-skip-hint';
    hint.textContent = 'TAP TO SKIP';
    overlay.appendChild(hint);

    uiOverlay.appendChild(overlay);
    const container = overlay;

    // ── Phase 1: Placement Banner (0ms) ──
    schedule(() => {
      const banner = document.createElement('div');
      banner.className = 'rewards-placement';
      banner.style.color = placementColor(placement);
      banner.textContent = placementText(placement);
      container.appendChild(banner);
      playTotalPunch();
      // Particle burst behind placement (crowning moment)
      emitLevelBurst();
    }, 100);

    // ── Phase 2: Reward Rows (800ms, staggered 400ms apart) ──
    const rows = buildRewardRows(rewards);
    rows.forEach((row, i) => {
      schedule(() => {
        const rowEl = document.createElement('div');
        rowEl.className = `rewards-row${row.isBonus ? ' rewards-row-bonus' : ''}`;
        rowEl.style.animationDelay = '0ms';

        const left = document.createElement('span');
        left.className = 'rewards-row-label';
        left.textContent = `${row.icon} ${row.label}`;

        const right = document.createElement('span');
        right.className = 'rewards-row-value';

        rowEl.appendChild(left);
        rowEl.appendChild(right);
        container.appendChild(rowEl);

        // Counter-roll the values
        if (row.xp === 0 && row.cr === 0) {
          // Multiplier row — show label only (no counter)
          const multSpan = document.createElement('span');
          multSpan.style.color = COLORS.GOLD;
          multSpan.style.fontWeight = '700';
          multSpan.textContent = 'APPLIED TO ALL';
          right.appendChild(multSpan);
        } else {
          // Animate: roll XP, then CR
          const xpSpan = document.createElement('span');
          right.appendChild(xpSpan);
          if (row.cr > 0) {
            const crSpan = document.createElement('span');
            crSpan.style.color = COLORS.YELLOW;
            crSpan.style.marginLeft = '8px';
            right.appendChild(crSpan);
            counterRoll(xpSpan, row.xp, 350, '+', ' XP');
            counterRoll(crSpan, row.cr, 350, '+', ' CR');
          } else {
            counterRoll(xpSpan, row.xp, 350, '+', ' XP');
          }
        }

        if (row.isBonus) {
          playBonusChime();
          // Particle sparkle from bonus row toward total area
          const rect = rowEl.getBoundingClientRect();
          emitCurrencyBurst(rect.right - 20, rect.top + rect.height / 2, 45);
        }
      }, 800 + i * 400);
    });

    const phase3Start = 800 + rows.length * 400 + 300;

    // ── Phase 3: Total + XP Bar (after rows) ──
    schedule(() => {
      // Separator line
      const sep = document.createElement('div');
      sep.className = 'rewards-separator';
      container.appendChild(sep);

      // Total row
      const totalRow = document.createElement('div');
      totalRow.className = 'rewards-total';
      const totalLabel = document.createElement('span');
      totalLabel.textContent = 'TOTAL';
      const totalValue = document.createElement('span');
      totalRow.appendChild(totalLabel);
      totalRow.appendChild(totalValue);
      container.appendChild(totalRow);

      const xpS = document.createElement('span');
      totalValue.appendChild(xpS);
      const crS = document.createElement('span');
      crS.style.color = COLORS.YELLOW;
      crS.style.marginLeft = '10px';
      totalValue.appendChild(crS);
      counterRoll(xpS, rewards.totalXP, 500, '+', ' XP');
      counterRoll(crS, rewards.totalCredits, 500, '+', ' CR');
      playTotalPunch();

      // XP progress bar
      const prog = getProgress();
      const barContainer = document.createElement('div');
      barContainer.className = 'rewards-xp-bar-track';
      const barLabel = document.createElement('div');
      barLabel.className = 'rewards-xp-bar-label';
      barLabel.textContent = `Level ${prog.level}  ·  ${xpToNextLevel()} XP to next`;
      const barBg = document.createElement('div');
      barBg.className = 'rewards-xp-bar-bg';
      const barFill = document.createElement('div');
      barFill.className = 'rewards-xp-bar-fill';
      barFill.style.width = `${Math.round(previousLevelProgress * 100)}%`;
      barBg.appendChild(barFill);
      barContainer.appendChild(barLabel);
      barContainer.appendChild(barBg);
      container.appendChild(barContainer);

      // Animate bar fill after a beat
      setTimeout(() => {
        if (skipped) return;
        const newPct = Math.round(levelProgress() * 100);
        barFill.style.width = `${newPct}%`;
        playBarFillSweep();
        // XP stream particles from total toward bar
        const totalRect = totalRow.getBoundingClientRect();
        const barRect = barBg.getBoundingClientRect();
        emitXPStream(totalRect.left + totalRect.width / 2, totalRect.bottom, barRect.left + barRect.width * (newPct / 100), barRect.top + barRect.height / 2);
      }, 300);
    }, phase3Start);

    // ── Phase 4: Credits Balance ──
    const phase4Start = phase3Start + 1000;
    schedule(() => {
      const credRow = document.createElement('div');
      credRow.className = 'rewards-credits';
      const credLabel = document.createElement('span');
      credLabel.textContent = 'Credits';
      const credValue = document.createElement('span');
      credValue.style.color = COLORS.YELLOW;
      credValue.style.fontWeight = '700';
      credRow.appendChild(credLabel);
      credRow.appendChild(credValue);
      container.appendChild(credRow);
      counterRoll(credValue, getProgress().credits, 600, '', ' CR');
    }, phase4Start);

    // ── Phase 5: Level Up (conditional) ──
    const phase5Start = phase4Start + 800;
    if (rewards.leveledUp) {
      schedule(() => {
        // Golden flash
        const flash = document.createElement('div');
        flash.className = 'rewards-level-flash';
        container.appendChild(flash);
        setTimeout(() => flash.remove(), 600);

        // Level up text
        const lvlUp = document.createElement('div');
        lvlUp.className = 'rewards-level-up';
        lvlUp.innerHTML = `⬆ LEVEL UP!<br><span class="rewards-level-num">Level ${rewards.newLevel}</span>`;
        container.appendChild(lvlUp);
        playLevelUpFanfare();

        // Particle ceremony + screen shake (crowning moment)
        emitLevelBurst();
        SHAKE.levelUp();
      }, phase5Start);
    }

    // ── Phase 6: Achievements (staggered after level up / credits) ──
    const phase6Start = (rewards.leveledUp ? phase5Start + 1200 : phase4Start + 800);
    if (rewards.newAchievements.length > 0) {
      rewards.newAchievements.forEach((ach, i) => {
        schedule(() => {
          const achEl = document.createElement('div');
          achEl.className = 'rewards-row rewards-row-bonus rewards-achievement';
          achEl.style.color = COLORS.GOLD;
          achEl.style.fontWeight = '700';
          achEl.innerHTML = `<span class="rewards-row-label">${ach.icon} ${ach.name}</span><span class="rewards-row-value">+${ach.creditReward} CR</span>`;
          container.appendChild(achEl);
          playBonusChime();
          // Achievement confetti (trophy moment)
          emitAchievementConfetti();
        }, phase6Start + i * 400);
      });
    }

    // ── Auto-dismiss ──
    const achTime = rewards.newAchievements.length * 400;
    const dismissTime = (rewards.leveledUp ? phase5Start + 2000 : phase4Start + 1500) + achTime;
    schedule(() => skip(), dismissTime);
  });
}
