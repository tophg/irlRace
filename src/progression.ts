/* ── IRL Race — Progression System ── */

const STORAGE_KEY = 'hr-progress';

// ── XP & Currency Constants ──
const XP_PER_RACE = 50;
const XP_WIN_BONUS = 100;
const XP_PODIUM_BONUS = 50;      // 2nd or 3rd
const XP_CLEAN_RACE_BONUS = 30;  // No barrier hits
const XP_DRIFT_BONUS = 20;       // Total drift time > 10s
const XP_PER_LEVEL = 200;

const CREDITS_PER_RACE = 100;
const CREDITS_WIN_BONUS = 200;
const CREDITS_PODIUM_BONUS = 100;

// ── Car Unlock Costs (by id) ──
const UNLOCK_COSTS: Record<string, number> = {
  // Entry tier — free
  haven: 0,

  // Mid tier
  phantom: 500,
  monarch: 600,
  stallion: 800,

  // Exotic tier
  venom: 1500,
  precision: 1800,
  apex: 2000,
  // Elite tier
  diablo: 4000,

};

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
    unlockedCars: ['haven'], // Entry tier free
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
  lapTimes: number[];    // seconds per lap
  bestLap: number;       // seconds
  collisionCount: number;
  driftTime: number;     // total seconds spent drifting
  topSpeed: number;      // units/s
  trackLength: number;   // total meters
  lapsCompleted: number;
}

export interface RewardBreakdown {
  baseXP: number;
  winBonus: number;
  podiumBonus: number;
  cleanBonus: number;
  driftBonus: number;
  totalXP: number;
  baseCredits: number;
  winCreditsBonus: number;
  podiumCreditsBonus: number;
  totalCredits: number;
  leveledUp: boolean;
  newLevel: number;
}

/** Process end-of-race rewards. Updates and saves progress. Returns breakdown. */
export function processRaceRewards(result: RaceResult): RewardBreakdown {
  const breakdown: RewardBreakdown = {
    baseXP: XP_PER_RACE,
    winBonus: result.placement === 1 ? XP_WIN_BONUS : 0,
    podiumBonus: (result.placement === 2 || result.placement === 3) ? XP_PODIUM_BONUS : 0,
    cleanBonus: result.collisionCount === 0 ? XP_CLEAN_RACE_BONUS : 0,
    driftBonus: result.driftTime > 10 ? XP_DRIFT_BONUS : 0,
    totalXP: 0,
    baseCredits: CREDITS_PER_RACE,
    winCreditsBonus: result.placement === 1 ? CREDITS_WIN_BONUS : 0,
    podiumCreditsBonus: (result.placement === 2 || result.placement === 3) ? CREDITS_PODIUM_BONUS : 0,
    totalCredits: 0,
    leveledUp: false,
    newLevel: current.level,
  };

  breakdown.totalXP = breakdown.baseXP + breakdown.winBonus + breakdown.podiumBonus + breakdown.cleanBonus + breakdown.driftBonus;
  breakdown.totalCredits = breakdown.baseCredits + breakdown.winCreditsBonus + breakdown.podiumCreditsBonus;

  // Update progress
  current.xp += breakdown.totalXP;
  current.credits += breakdown.totalCredits;
  current.totalRaces++;

  if (result.placement === 1) current.wins++;
  if (result.placement <= 3) current.podiums++;

  // Best lap
  if (result.bestLap > 0 && (current.bestLapTime === 0 || result.bestLap < current.bestLapTime)) {
    current.bestLapTime = result.bestLap;
  }

  // Distance (approximate: laps × track length)
  current.totalDistance += (result.lapsCompleted * result.trackLength) / 1000; // km
  current.totalDriftTime += result.driftTime;

  // Level up check
  const prevLevel = current.level;
  current.level = Math.floor(current.xp / XP_PER_LEVEL) + 1;
  if (current.level > prevLevel) {
    breakdown.leveledUp = true;
    breakdown.newLevel = current.level;
  }

  saveProgress();
  return breakdown;
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
  return (current.level * XP_PER_LEVEL) - current.xp;
}

/** Get XP progress fraction within current level (0–1). */
export function levelProgress(): number {
  const xpInLevel = current.xp % XP_PER_LEVEL;
  return xpInLevel / XP_PER_LEVEL;
}
