/* ── IRL Race — Progression System ──
 *
 * Soft-exponential XP curve, expanded reward sources,
 * win streak multiplier, prestige system, and achievements.
 */

const STORAGE_KEY = 'hr-progress';

// ── XP & Currency Constants ──
const XP_BASE = 150;             // base XP needed for level 1→2
const XP_EXPONENT = 1.4;         // soft exponential growth
const XP_PER_RACE = 50;
const XP_WIN_BONUS = 100;
const XP_PODIUM_BONUS = 50;      // 2nd or 3rd
const XP_CLEAN_RACE_BONUS = 30;  // No barrier hits
const XP_DRIFT_PER_SEC = 2;      // per second of drift (uncapped)
const XP_PER_OVERTAKE = 10;
const XP_PER_NEAR_MISS = 5;
const XP_SPEED_DEMON = 20;       // >180 MPH sustained 5+ seconds
const XP_PERFECT_START = 15;
const PRESTIGE_LEVEL = 50;       // level at which prestige is available
const PRESTIGE_XP_BONUS = 0.05;  // +5% per prestige tier

const CREDITS_PER_RACE = 100;
const CREDITS_WIN_BONUS = 200;
const CREDITS_PODIUM_BONUS = 100;

// ── Streak multipliers ──
function streakMultiplier(streak: number): number {
  if (streak >= 10) return 3.0;
  if (streak >= 5) return 2.0;
  if (streak >= 3) return 1.5;
  if (streak >= 2) return 1.2;
  return 1.0;
}

// ── XP Curve ──
/** XP needed to go from `level` to `level+1`. */
export function xpForLevel(level: number): number {
  return Math.round(XP_BASE * Math.pow(level, XP_EXPONENT));
}

/** Total cumulative XP needed to reach `level` from level 1. */
function cumulativeXpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpForLevel(l);
  return total;
}

/** Compute level from raw XP. */
function levelFromXp(xp: number): number {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  return level;
}

// ── Car Unlock Costs (by id) ──
const UNLOCK_COSTS: Record<string, number> = {
  // Entry tier — free
  obey: 0,

  // Mid tier
  sleeper: 500,
  conform: 600,
  consume: 800,
  formaldehyde: 700,

  // Exotic tier
  bubblegum: 1500,
  sunglasses: 1800,
  nada: 2000,
  reproduce: 1600,

  // Elite tier
  kickass: 4000,
  revelator: 3500,
  submit: 4500,
  marry: 5000,
};

// ── Achievement definitions ──
export interface Achievement {
  id: string;
  name: string;
  icon: string;
  description: string;
  creditReward: number;
  check: (prog: PlayerProgress, result?: RaceResult) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_blood',   name: 'First Blood',     icon: '🏁', description: 'Win your first race',                 creditReward: 100,  check: p => p.wins >= 1 },
  { id: 'speed_demon',   name: 'Speed Demon',      icon: '⚡', description: 'Hit 200 MPH',                         creditReward: 200,  check: (p, r) => (r?.topSpeed ?? 0) >= 200 },
  { id: 'drift_king',    name: 'Drift King',        icon: '🔥', description: '60 seconds of drift in one race',     creditReward: 300,  check: (_, r) => (r?.driftTime ?? 0) >= 60 },
  { id: 'untouchable',   name: 'Untouchable',       icon: '✨', description: 'Win with zero collisions',             creditReward: 500,  check: (_, r) => (r?.placement ?? 99) === 1 && (r?.collisionCount ?? 1) === 0 },
  { id: 'globetrotter',  name: 'Globetrotter',      icon: '🌍', description: 'Race on every environment',            creditReward: 300,  check: p => (p.environmentsRaced?.length ?? 0) >= 6 },
  { id: 'ten_wins',      name: 'Dominant',           icon: '🏆', description: 'Win 10 races',                         creditReward: 500,  check: p => p.wins >= 10 },
  { id: 'fifty_races',   name: 'Veteran',            icon: '🎖️', description: 'Complete 50 races',                   creditReward: 500,  check: p => p.totalRaces >= 50 },
  { id: 'streak_5',      name: 'On Fire',            icon: '🔥', description: 'Win 5 races in a row',                creditReward: 500,  check: p => p.bestWinStreak >= 5 },
  { id: 'prestige_1',    name: 'Prestige I',         icon: '⭐', description: 'Reach Prestige for the first time',   creditReward: 1000, check: p => p.prestige >= 1 },
  { id: 'lapping_legend', name: 'Lapping Legend',    icon: '🔄', description: 'Lap all opponents in one race',       creditReward: 500,  check: (_, r) => (r?.lappingMultiplier ?? 1) >= 2.0 },
];

// ── Progress Data ──
export interface PlayerProgress {
  xp: number;
  level: number;
  credits: number;
  totalRaces: number;
  wins: number;
  podiums: number;
  bestLapTime: number;        // seconds (0 = none)
  totalDistance: number;       // cumulative km
  totalDriftTime: number;     // cumulative seconds
  unlockedCars: string[];     // car IDs
  prestige: number;           // prestige tier (0 = none)
  winStreak: number;          // current consecutive wins
  bestWinStreak: number;      // all-time best streak
  unlockedAchievements: string[];  // achievement IDs
  environmentsRaced: string[];     // environment names raced in
  totalOvertakes: number;
  // Driver DNA
  speedRating: number;        // 0-100 (pace/race performance)
  cleanRating: number;        // 0-100 (sportsmanship)
  // Daily/Weekly challenges
  dailyChallengeProgress: Record<string, number>; // challengeId → progress
  dailyChallengeDay: number;  // day-of-year last generated
  weeklyChallengeProgress: Record<string, number>;
  weeklyChallengeWeek: number; // week-of-year last generated
}

function defaultProgress(): PlayerProgress {
  return {
    xp: 0,
    level: 1,
    credits: 0,
    totalRaces: 0,
    wins: 0,
    podiums: 0,
    bestLapTime: 0,
    totalDistance: 0,
    totalDriftTime: 0,
    unlockedCars: ['obey'],
    prestige: 0,
    winStreak: 0,
    bestWinStreak: 0,
    unlockedAchievements: [],
    environmentsRaced: [],
    totalOvertakes: 0,
    speedRating: 50,
    cleanRating: 50,
    dailyChallengeProgress: {},
    dailyChallengeDay: 0,
    weeklyChallengeProgress: {},
    weeklyChallengeWeek: 0,
  };
}

let current: PlayerProgress = defaultProgress();

/** Load progress from localStorage. */
export function loadProgress(): PlayerProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      current = { ...defaultProgress(), ...parsed };
    }
  } catch {}
  return current;
}

/** Save progress to localStorage. */
export function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}

/** Get the current progress. */
export function getProgress(): PlayerProgress {
  return current;
}

// ── Race Results Processing ──

export interface RaceResult {
  placement: number;     // 1-based
  totalRacers: number;
  lapTimes: number[];    // ms per lap
  bestLap: number;       // seconds
  collisionCount: number;
  driftTime: number;     // total seconds spent drifting
  topSpeed: number;      // units/s
  trackLength: number;   // total meters
  lapsCompleted: number;
  lappingMultiplier: number;
  overtakeCount: number;
  nearMissCount: number;
  speedDemonTime: number; // seconds at >180 MPH
  perfectStart: boolean;
  environment: string;    // environment name for tracking
}

export interface RewardBreakdown {
  baseXP: number;
  winBonus: number;
  podiumBonus: number;
  cleanBonus: number;
  driftBonus: number;
  overtakeBonus: number;
  nearMissBonus: number;
  speedDemonBonus: number;
  perfectStartBonus: number;
  subtotalXP: number;       // before multipliers
  streakMultiplier: number;
  lappingMultiplier: number;
  prestigeMultiplier: number;
  totalXP: number;
  baseCredits: number;
  winCreditsBonus: number;
  podiumCreditsBonus: number;
  totalCredits: number;
  leveledUp: boolean;
  newLevel: number;
  newAchievements: Achievement[];
}

/** Process end-of-race rewards. Updates and saves progress. Returns breakdown. */
export function processRaceRewards(result: RaceResult): RewardBreakdown {
  // Compute individual bonuses
  const driftBonus = Math.min(Math.floor(result.driftTime * XP_DRIFT_PER_SEC), 200); // cap at 200 XP
  const overtakeBonus = result.overtakeCount * XP_PER_OVERTAKE;
  const nearMissBonus = result.nearMissCount * XP_PER_NEAR_MISS;
  const speedDemonBonus = result.speedDemonTime >= 5 ? XP_SPEED_DEMON : 0;
  const perfectStartBonus = result.perfectStart ? XP_PERFECT_START : 0;

  // Multipliers
  const sMultiplier = streakMultiplier(current.winStreak);
  const pMultiplier = 1.0 + current.prestige * PRESTIGE_XP_BONUS;

  const breakdown: RewardBreakdown = {
    baseXP: XP_PER_RACE,
    winBonus: result.placement === 1 ? XP_WIN_BONUS : 0,
    podiumBonus: (result.placement === 2 || result.placement === 3) ? XP_PODIUM_BONUS : 0,
    cleanBonus: result.collisionCount === 0 ? XP_CLEAN_RACE_BONUS : 0,
    driftBonus,
    overtakeBonus,
    nearMissBonus,
    speedDemonBonus,
    perfectStartBonus,
    subtotalXP: 0,
    streakMultiplier: sMultiplier,
    lappingMultiplier: result.lappingMultiplier,
    prestigeMultiplier: pMultiplier,
    totalXP: 0,
    baseCredits: CREDITS_PER_RACE,
    winCreditsBonus: result.placement === 1 ? CREDITS_WIN_BONUS : 0,
    podiumCreditsBonus: (result.placement === 2 || result.placement === 3) ? CREDITS_PODIUM_BONUS : 0,
    totalCredits: 0,
    leveledUp: false,
    newLevel: current.level,
    newAchievements: [],
  };

  // Sum subtotal
  breakdown.subtotalXP = breakdown.baseXP + breakdown.winBonus + breakdown.podiumBonus
    + breakdown.cleanBonus + breakdown.driftBonus + breakdown.overtakeBonus
    + breakdown.nearMissBonus + breakdown.speedDemonBonus + breakdown.perfectStartBonus;

  // Apply all multipliers
  let combinedMultiplier = 1.0;
  if (breakdown.lappingMultiplier > 1) combinedMultiplier *= breakdown.lappingMultiplier;
  if (breakdown.streakMultiplier > 1) combinedMultiplier *= breakdown.streakMultiplier;
  if (breakdown.prestigeMultiplier > 1) combinedMultiplier *= breakdown.prestigeMultiplier;

  breakdown.totalXP = Math.round(breakdown.subtotalXP * combinedMultiplier);
  breakdown.totalCredits = Math.round(
    (breakdown.baseCredits + breakdown.winCreditsBonus + breakdown.podiumCreditsBonus) * combinedMultiplier,
  );

  // Update progress
  current.xp += breakdown.totalXP;
  current.credits += breakdown.totalCredits;
  current.totalRaces++;
  current.totalOvertakes += result.overtakeCount;

  // Win streak
  if (result.placement === 1) {
    current.wins++;
    current.winStreak++;
    if (current.winStreak > current.bestWinStreak) current.bestWinStreak = current.winStreak;
  } else {
    current.winStreak = 0;
  }
  if (result.placement <= 3) current.podiums++;

  // Environment tracking
  if (result.environment && !current.environmentsRaced.includes(result.environment)) {
    current.environmentsRaced.push(result.environment);
  }

  // Best lap
  if (result.bestLap > 0 && (current.bestLapTime === 0 || result.bestLap < current.bestLapTime)) {
    current.bestLapTime = result.bestLap;
  }

  // Distance (approximate: laps × track length)
  current.totalDistance += (result.lapsCompleted * result.trackLength) / 1000; // km
  current.totalDriftTime += result.driftTime;

  // Level up check (new curve)
  const prevLevel = current.level;
  current.level = levelFromXp(current.xp);
  if (current.level > prevLevel) {
    breakdown.leveledUp = true;
    breakdown.newLevel = current.level;
  }

  // Check achievements
  for (const ach of ACHIEVEMENTS) {
    if (!current.unlockedAchievements.includes(ach.id) && ach.check(current, result)) {
      current.unlockedAchievements.push(ach.id);
      current.credits += ach.creditReward;
      breakdown.newAchievements.push(ach);
    }
  }

  // ── Driver DNA Update ──
  // Speed Rating: moves toward 100 when placing well, toward 0 when placing poorly
  const placementPct = 1 - (result.placement - 1) / Math.max(1, result.totalRacers - 1); // 1.0 = 1st, 0.0 = last
  const speedTarget = placementPct * 100;
  current.speedRating = clampRating(current.speedRating + (speedTarget - current.speedRating) * 0.08);

  // Clean Rating: moves up with clean races, down with collisions
  const cleanScore = result.collisionCount === 0 ? 100 : Math.max(0, 100 - result.collisionCount * 15);
  current.cleanRating = clampRating(current.cleanRating + (cleanScore - current.cleanRating) * 0.08);

  // ── Daily/Weekly Challenge Progress ──
  refreshChallengesIfNeeded();
  const challengeRewards = updateChallengeProgress(result, breakdown);
  breakdown.totalXP += challengeRewards.xp;
  breakdown.totalCredits += challengeRewards.cr;
  current.xp += challengeRewards.xp;
  current.credits += challengeRewards.cr;

  saveProgress();
  return breakdown;
}

/** Prestige: reset level to 1 but keep credits, cars, achievements. */
export function prestige(): boolean {
  if (current.level < PRESTIGE_LEVEL) return false;
  current.prestige++;
  current.xp = 0;
  current.level = 1;
  saveProgress();
  return true;
}

/** Check if the player can prestige. */
export function canPrestige(): boolean {
  return current.level >= PRESTIGE_LEVEL;
}

/** Check if a car is unlocked. */
export function isCarUnlocked(carId: string): boolean {
  return current.unlockedCars.includes(carId);
}

/** Get the unlock cost for a car. Returns 0 if already unlocked. */
export function getUnlockCost(carId: string): number {
  if (isCarUnlocked(carId)) return 0;
  return UNLOCK_COSTS[carId] ?? 9999;
}

/** Attempt to unlock a car. Returns true if successful. */
export function unlockCar(carId: string): boolean {
  if (isCarUnlocked(carId)) return true;
  const cost = UNLOCK_COSTS[carId] ?? 9999;
  if (current.credits >= cost) {
    current.credits -= cost;
    current.unlockedCars.push(carId);
    saveProgress();
    return true;
  }
  return false;
}

/** Get XP needed for next level. */
export function xpToNextLevel(): number {
  const xpInLevel = current.xp - cumulativeXpForLevel(current.level);
  return xpForLevel(current.level) - xpInLevel;
}

/** Get XP progress fraction within current level (0–1). */
export function levelProgress(): number {
  const xpInLevel = current.xp - cumulativeXpForLevel(current.level);
  const needed = xpForLevel(current.level);
  return Math.max(0, Math.min(1, xpInLevel / needed));
}

// ── Driver DNA Helpers ──

function clampRating(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Get letter grade from rating 0-100. */
export function ratingGrade(rating: number): string {
  if (rating >= 90) return 'S';
  if (rating >= 75) return 'A';
  if (rating >= 60) return 'B';
  if (rating >= 40) return 'C';
  if (rating >= 20) return 'D';
  return 'E';
}

// ── Daily / Weekly Challenges ──

export interface ChallengeDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  target: number;
  xpReward: number;
  crReward: number;
  type: 'daily' | 'weekly';
  /** Extract progress from a single race result. */
  extract: (result: RaceResult) => number;
}

const CHALLENGE_POOL: Omit<ChallengeDefinition, 'type'>[] = [
  // Daily-oriented (smaller targets)
  { id: 'ch_win_1',        name: 'Victor',          icon: '🏆', description: 'Win a race',                          target: 1,  xpReward: 50,  crReward: 30,  extract: r => r.placement === 1 ? 1 : 0 },
  { id: 'ch_clean_1',      name: 'Spotless',        icon: '✨', description: 'Finish a race with 0 collisions',     target: 1,  xpReward: 40,  crReward: 25,  extract: r => r.collisionCount === 0 ? 1 : 0 },
  { id: 'ch_drift_30',     name: 'Slide Artist',    icon: '🔥', description: 'Drift for 30 cumulative seconds',      target: 30, xpReward: 40,  crReward: 20,  extract: r => r.driftTime },
  { id: 'ch_overtake_5',   name: 'Lane Cutter',     icon: '🏎️', description: 'Make 5 overtakes',                     target: 5,  xpReward: 40,  crReward: 20,  extract: r => r.overtakeCount },
  { id: 'ch_nearmiss_5',   name: 'Thread Needle',   icon: '😤', description: 'Get 5 near misses',                    target: 5,  xpReward: 35,  crReward: 15,  extract: r => r.nearMissCount },
  { id: 'ch_speed_180',    name: 'Speedster',       icon: '⚡', description: 'Sustain 180+ MPH for 5 seconds',       target: 1,  xpReward: 40,  crReward: 25,  extract: r => r.speedDemonTime >= 5 ? 1 : 0 },
  { id: 'ch_perfect',      name: 'Quick Draw',      icon: '🚀', description: 'Get a perfect start',                  target: 1,  xpReward: 30,  crReward: 15,  extract: r => r.perfectStart ? 1 : 0 },
  { id: 'ch_podium_1',     name: 'Podium Finish',   icon: '🥇', description: 'Finish in top 3',                      target: 1,  xpReward: 35,  crReward: 20,  extract: r => r.placement <= 3 ? 1 : 0 },
  // Weekly-oriented (larger targets)
  { id: 'ch_win_5',        name: 'Dominator',       icon: '🏆', description: 'Win 5 races',                          target: 5,  xpReward: 200, crReward: 150, extract: r => r.placement === 1 ? 1 : 0 },
  { id: 'ch_race_10',      name: 'Grinder',         icon: '🏁', description: 'Complete 10 races',                     target: 10, xpReward: 150, crReward: 100, extract: r => 1 },
  { id: 'ch_clean_5',      name: 'Gentleman Driver', icon: '✨', description: 'Finish 5 races with 0 collisions',    target: 5,  xpReward: 180, crReward: 120, extract: r => r.collisionCount === 0 ? 1 : 0 },
  { id: 'ch_overtake_20',  name: 'Bulldozer',       icon: '🏎️', description: 'Make 20 overtakes',                    target: 20, xpReward: 180, crReward: 100, extract: r => r.overtakeCount },
  { id: 'ch_drift_120',    name: 'Drift Legend',    icon: '🔥', description: 'Drift for 2 cumulative minutes',        target: 120, xpReward: 200, crReward: 120, extract: r => r.driftTime },
  { id: 'ch_podium_7',     name: 'Consistent',      icon: '🥇', description: 'Finish in top 3 seven times',           target: 7,  xpReward: 180, crReward: 100, extract: r => r.placement <= 3 ? 1 : 0 },
  { id: 'ch_nearmiss_30',  name: 'Risk Taker',      icon: '😤', description: 'Get 30 near misses',                   target: 30, xpReward: 150, crReward: 80,  extract: r => r.nearMissCount },
];

/** Simple deterministic hash for seed-based rotation. */
function simpleHash(seed: number): number {
  let h = seed;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return Math.abs(h);
}

function getDayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / 86400000);
}

function getWeekOfYear(): number {
  return Math.floor(getDayOfYear() / 7);
}

/** Refresh challenges if the day/week has changed. */
function refreshChallengesIfNeeded() {
  const day = getDayOfYear();
  const week = getWeekOfYear();

  if (current.dailyChallengeDay !== day) {
    current.dailyChallengeDay = day;
    current.dailyChallengeProgress = {};
  }
  if (current.weeklyChallengeWeek !== week) {
    current.weeklyChallengeWeek = week;
    current.weeklyChallengeProgress = {};
  }
}

/** Pick N challenges from the pool using a seed (deterministic). */
function pickChallenges(seed: number, count: number, type: 'daily' | 'weekly'): ChallengeDefinition[] {
  // For daily, prefer small-target challenges (first 8); for weekly, prefer big ones (last 7)
  const pool = type === 'daily' ? CHALLENGE_POOL.slice(0, 8) : CHALLENGE_POOL.slice(8);
  const picked: ChallengeDefinition[] = [];
  const indices = new Set<number>();

  for (let i = 0; picked.length < count && i < 20; i++) {
    const idx = simpleHash(seed + i * 7) % pool.length;
    if (!indices.has(idx)) {
      indices.add(idx);
      picked.push({ ...pool[idx], type });
    }
  }
  return picked;
}

/** Get today's daily challenges (3 per day). */
export function getDailyChallenges(): ChallengeDefinition[] {
  refreshChallengesIfNeeded();
  return pickChallenges(current.dailyChallengeDay * 1000 + 42, 3, 'daily');
}

/** Get this week's weekly challenges (3 per week). */
export function getWeeklyChallenges(): ChallengeDefinition[] {
  refreshChallengesIfNeeded();
  return pickChallenges(current.weeklyChallengeWeek * 1000 + 99, 3, 'weekly');
}

/** Get progress for a challenge. Returns [current, target, completed]. */
export function getChallengeProgress(ch: ChallengeDefinition): [number, number, boolean] {
  const store = ch.type === 'daily' ? current.dailyChallengeProgress : current.weeklyChallengeProgress;
  const prog = store[ch.id] ?? 0;
  return [Math.min(prog, ch.target), ch.target, prog >= ch.target];
}

/** Update challenge progress from a race result. Returns bonus XP/CR earned. */
function updateChallengeProgress(result: RaceResult, _breakdown: RewardBreakdown): { xp: number; cr: number } {
  let xp = 0;
  let cr = 0;

  const allChallenges = [...getDailyChallenges(), ...getWeeklyChallenges()];
  for (const ch of allChallenges) {
    const store = ch.type === 'daily' ? current.dailyChallengeProgress : current.weeklyChallengeProgress;
    const before = store[ch.id] ?? 0;
    if (before >= ch.target) continue; // already completed

    const increment = ch.extract(result);
    if (increment <= 0) continue;

    store[ch.id] = before + increment;
    if (store[ch.id] >= ch.target) {
      // Challenge completed!
      xp += ch.xpReward;
      cr += ch.crReward;
    }
  }
  return { xp, cr };
}
