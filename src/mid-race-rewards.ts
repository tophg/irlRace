/* ── Mid-Race Rewards Module ──
 *
 * Centralised reward logic with combo chains, jackpot rolls,
 * ascending-pitch SFX, toast UI, and 5-layer juice feedback.
 *
 * Psychology: variable ratio reinforcement, dopamine prediction error,
 * loss aversion, Zeigarnik visible timer, ascending pitch.
 */

import { G } from './game-context';
import { bus, type GameEvents } from './event-bus';
import { getProgress, saveProgress } from './progression';
import { haptic } from './input';
import type { Vehicle } from './vehicle';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REWARD DEFINITIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type RewardType =
  | 'near_miss' | 'overtake' | 'drift_bonus' | 'hang_time'
  | 'nitro_drift' | 'lap_refuel' | 'clean_lap' | 'perfect_start'
  | 'position_gained';

interface RewardDef {
  label: string;
  icon: string;
  nitro: number;
  credits: number;
  xp: number;
  comboable: boolean;
  category: 'tactical' | 'skill' | 'milestone';
  /** toast accent colour (hsl hue) */
  hue: number;
}

const REWARDS: Record<RewardType, RewardDef> = {
  near_miss:       { label: 'NEAR MISS',      icon: '😤', nitro: 5,  credits: 0,  xp: 2, comboable: true,  category: 'tactical',  hue: 30  },
  overtake:        { label: 'OVERTAKE',        icon: '🏎️', nitro: 8,  credits: 5,  xp: 5, comboable: true,  category: 'skill',     hue: 200 },
  drift_bonus:     { label: 'DRIFT',           icon: '🔥', nitro: 3,  credits: 0,  xp: 3, comboable: true,  category: 'skill',     hue: 15  },
  hang_time:       { label: 'HANG TIME',       icon: '🪂', nitro: 10, credits: 3,  xp: 2, comboable: true,  category: 'skill',     hue: 270 },
  nitro_drift:     { label: 'NITRO DRIFT',     icon: '💨', nitro: 5,  credits: 2,  xp: 3, comboable: true,  category: 'skill',     hue: 50  },
  lap_refuel:      { label: 'LAP REFUEL',      icon: '⛽', nitro: 20, credits: 0,  xp: 0, comboable: false, category: 'milestone', hue: 120 },
  clean_lap:       { label: 'CLEAN LAP',       icon: '✨', nitro: 33, credits: 10, xp: 5, comboable: false, category: 'milestone', hue: 60  },
  perfect_start:   { label: 'PERFECT START',   icon: '⚡', nitro: 15, credits: 5,  xp: 5, comboable: false, category: 'milestone', hue: 45  },
  position_gained: { label: 'POSITION GAINED', icon: '📈', nitro: 5,  credits: 3,  xp: 3, comboable: false, category: 'milestone', hue: 160 },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMBO STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const COMBO_DURATION = 3.0;   // seconds
const COMBO_MAX = 5;          // max multiplier ×5
const JACKPOT_THRESHOLD = 4;  // ×4+ to roll
const JACKPOT_CHANCE = 0.15;  // 15% per comboable reward at ×4+
const NITRO_EXTEND = 1.0;     // +1s when using nitro during combo

let _comboTimer = 0;
let _comboMultiplier = 1;
let _comboLength = 0;           // total rewards in current chain
let _comboTypes = new Set<RewardType>();
let _lastRewardType: RewardType | null = null;
let _wasNitroActive = false;    // for nitro-extend detection
let _midRaceCredits = 0;
let _midRaceXP = 0;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOAST UI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _toastContainer: HTMLDivElement | null = null;
const MAX_TOASTS = 4;
const TOAST_LIFESPAN = 1500; // ms

function ensureToastContainer(): HTMLDivElement {
  if (_toastContainer && _toastContainer.parentNode) return _toastContainer;
  _toastContainer = document.createElement('div');
  _toastContainer.className = 'reward-toast-container';
  document.getElementById('ui-overlay')?.appendChild(_toastContainer);
  return _toastContainer;
}

function showToast(def: RewardDef, finalNitro: number, finalCredits: number, finalXP: number, isJackpot: boolean) {
  const container = ensureToastContainer();

  // Enforce max toasts
  while (container.children.length >= MAX_TOASTS) {
    container.removeChild(container.firstChild!);
  }

  const toast = document.createElement('div');
  toast.className = `reward-toast${isJackpot ? ' reward-jackpot' : ''}`;
  toast.style.setProperty('--reward-hue', String(isJackpot ? 45 : def.hue));

  let amounts = '';
  if (finalNitro > 0) amounts += `<span class="reward-amt reward-amt-nitro">⛽+${finalNitro}</span>`;
  if (finalCredits > 0) amounts += `<span class="reward-amt reward-amt-credits">💰+${finalCredits}</span>`;
  if (finalXP > 0) amounts += `<span class="reward-amt reward-amt-xp">+${finalXP} XP</span>`;

  const comboHtml = _comboMultiplier > 1
    ? `<span class="reward-combo-badge">×${_comboMultiplier}</span>`
    : '';

  toast.innerHTML = `
    <span class="reward-icon">${isJackpot ? '💥' : def.icon}</span>
    <span class="reward-label">${isJackpot ? 'JACKPOT!' : def.label}</span>
    ${amounts}
    ${comboHtml}
  `;

  container.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => toast.classList.add('reward-toast--in'));

  // Remove after lifespan
  setTimeout(() => {
    toast.classList.add('reward-toast--out');
    setTimeout(() => toast.remove(), 300);
  }, TOAST_LIFESPAN);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMBO TIMER BAR (Zeigarnik visible drain)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _comboBarEl: HTMLDivElement | null = null;
let _comboBarFill: HTMLDivElement | null = null;

function ensureComboBar(): void {
  if (_comboBarEl && _comboBarEl.parentNode) return;
  _comboBarEl = document.createElement('div');
  _comboBarEl.className = 'reward-combo-bar';
  _comboBarFill = document.createElement('div');
  _comboBarFill.className = 'reward-combo-bar-fill';
  _comboBarEl.appendChild(_comboBarFill);
  document.getElementById('ui-overlay')?.appendChild(_comboBarEl);
}

function updateComboBarVisual() {
  if (_comboTimer <= 0) {
    if (_comboBarEl) _comboBarEl.style.opacity = '0';
    return;
  }
  ensureComboBar();
  if (_comboBarEl) _comboBarEl.style.opacity = '1';
  if (_comboBarFill) {
    const pct = Math.min(1, _comboTimer / COMBO_DURATION) * 100;
    _comboBarFill.style.width = `${pct}%`;
    // Colour shifts with multiplier
    const hue = 120 - (_comboMultiplier - 1) * 25; // green → orange → red
    _comboBarFill.style.background = `hsl(${Math.max(0, hue)}, 80%, 55%)`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ASCENDING PITCH SFX (Web Audio)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!_audioCtx) _audioCtx = new AudioContext();
  return _audioCtx;
}

function playChirp(freq: number, duration: number, gain = 0.15) {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch { /* audio may be blocked */ }
}

function playRewardSFX(comboCount: number) {
  // Ascending semitone: C4 base, +1 semitone per combo
  const base = 261.6; // C4
  const freq = base * Math.pow(2, Math.min(comboCount, 12) / 12);
  playChirp(freq, 0.08);
}

function playJackpotSFX() {
  // Major chord: root + major 3rd
  const base = 261.6 * Math.pow(2, Math.min(_comboLength, 12) / 12);
  playChirp(base, 0.15, 0.2);
  setTimeout(() => playChirp(base * Math.pow(2, 4 / 12), 0.15, 0.18), 50);
}

function playComboLostSFX() {
  // Descending minor 3rd
  playChirp(330, 0.12, 0.12);
  setTimeout(() => playChirp(277, 0.15, 0.1), 80);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EDGE GLOW VFX
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _edgeGlowEl: HTMLDivElement | null = null;

function flashEdgeGlow(hue: number) {
  if (!_edgeGlowEl) {
    _edgeGlowEl = document.createElement('div');
    _edgeGlowEl.className = 'reward-edge-glow';
    document.getElementById('ui-overlay')?.appendChild(_edgeGlowEl);
  }
  _edgeGlowEl.style.boxShadow = `inset 0 0 60px 20px hsla(${hue}, 80%, 55%, 0.4)`;
  _edgeGlowEl.classList.remove('reward-edge-glow--flash');
  void _edgeGlowEl.offsetWidth; // force reflow
  _edgeGlowEl.classList.add('reward-edge-glow--flash');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NITRO BAR PULSE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function pulseNitroBar() {
  const fill = document.getElementById('hud-nitro-fill');
  if (!fill) return;
  fill.classList.remove('reward-nitro-pulse');
  void fill.offsetWidth;
  fill.classList.add('reward-nitro-pulse');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POSITION SCALING (subtle catch-up)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getPositionScale(): number {
  if (!G.raceEngine) return 1.0;
  const rankings = G.raceEngine.getRankings();
  const localRank = rankings.findIndex(r => r.id === 'local') + 1;
  const total = rankings.length;
  if (total <= 1) return 1.0;
  // 1st = 1.0, last = 1.3
  return 1.0 + (localRank - 1) / (total - 1) * 0.3;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CORE: awardReward
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function awardReward(type: RewardType, vehicle?: Vehicle): void {
  const def = REWARDS[type];
  if (!def) return;

  const v = vehicle ?? G.playerVehicle;
  if (!v) return;

  // ── Combo logic (comboable rewards only) ──
  let isJackpot = false;
  if (def.comboable) {
    // Variety bonus: different type from last → +0.5×
    if (_comboTimer > 0 && type !== _lastRewardType) {
      _comboMultiplier = Math.min(COMBO_MAX, _comboMultiplier + 0.5);
    } else if (_comboTimer <= 0) {
      // Fresh combo — endowed progress: start at 0.5s grace
      _comboMultiplier = 1;
    }
    // Same type back-to-back = no × increase (but still resets timer)

    _comboTimer = COMBO_DURATION + 0.5; // 0.5s endowed grace
    _comboLength++;
    _comboTypes.add(type);
    _lastRewardType = type;

    // Jackpot roll at ×4+
    if (_comboMultiplier >= JACKPOT_THRESHOLD && Math.random() < JACKPOT_CHANCE) {
      isJackpot = true;
    }
  }

  // ── Calculate final amounts ──
  const posScale = getPositionScale();
  const jackpotMult = isJackpot ? 2 : 1;
  const comboNitroMult = def.comboable ? _comboMultiplier : 1;

  const finalNitro = Math.round(def.nitro * comboNitroMult * posScale * jackpotMult);
  const finalCredits = Math.round(def.credits * jackpotMult);
  const finalXP = Math.round(def.xp * jackpotMult);

  // ── Apply rewards ──
  v.addNitro(finalNitro);

  if (finalCredits > 0 || finalXP > 0) {
    const progress = getProgress();
    progress.credits += finalCredits;
    progress.xp += finalXP;
    saveProgress();
  }

  _midRaceCredits += finalCredits;
  _midRaceXP += finalXP;

  // ── 5-Layer Juice ──

  // 1. Toast
  showToast(def, finalNitro, finalCredits, finalXP, isJackpot);

  // 2. SFX
  if (isJackpot) {
    playJackpotSFX();
  } else if (def.comboable) {
    playRewardSFX(_comboLength);
  }

  // 3. Haptic
  if (isJackpot) {
    haptic([20, 10, 20, 10, 20]);
  } else if (_comboMultiplier >= 3) {
    haptic([15, 8, 15]);
  } else {
    haptic(10);
  }

  // 4. Nitro bar pulse
  if (finalNitro > 0) pulseNitroBar();

  // 5. Edge vignette
  flashEdgeGlow(isJackpot ? 45 : def.hue);

  // Emit event for external consumers
  bus.emit('mid_race_reward', { type, nitro: finalNitro, credits: finalCredits, xp: finalXP, combo: _comboMultiplier, jackpot: isJackpot });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMBO BREAK (collision)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function breakCombo(): void {
  if (_comboTimer <= 0) return; // nothing to break

  // Bank XP: reward for chain length × variety
  const bankXP = Math.floor(_comboTypes.size * _comboLength * 2);
  if (bankXP > 0) {
    const progress = getProgress();
    progress.xp += bankXP;
    saveProgress();
    _midRaceXP += bankXP;
  }

  // Show "COMBO LOST" flash
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = 'reward-toast reward-combo-lost';
  toast.innerHTML = `<span class="reward-icon">💥</span><span class="reward-label">COMBO LOST</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('reward-toast--in'));
  setTimeout(() => {
    toast.classList.add('reward-toast--out');
    setTimeout(() => toast.remove(), 300);
  }, 1200);

  // SFX + haptic
  playComboLostSFX();
  haptic([20, 15, 20]);

  // Red edge flash
  flashEdgeGlow(0);

  // Reset combo state
  _comboTimer = 0;
  _comboMultiplier = 1;
  _comboLength = 0;
  _comboTypes.clear();
  _lastRewardType = null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PER-FRAME UPDATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function updateRewards(dt: number): void {
  // Combo timer decay
  if (_comboTimer > 0) {
    _comboTimer -= dt;
    if (_comboTimer <= 0) {
      // Natural expiry → bank XP
      const bankXP = Math.floor(_comboTypes.size * _comboLength * 2);
      if (bankXP > 0) {
        const progress = getProgress();
        progress.xp += bankXP;
        saveProgress();
        _midRaceXP += bankXP;
      }
      _comboTimer = 0;
      _comboMultiplier = 1;
      _comboLength = 0;
      _comboTypes.clear();
      _lastRewardType = null;
    }
  }

  // Nitro extends combo (Burnout mechanic)
  if (G.playerVehicle) {
    const nitroNow = G.playerVehicle.isNitroActive;
    if (nitroNow && !_wasNitroActive && _comboTimer > 0) {
      _comboTimer = Math.min(_comboTimer + NITRO_EXTEND, COMBO_DURATION + 1.5);
    }
    _wasNitroActive = nitroNow;
  }

  updateComboBarVisual();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIFECYCLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function resetRewards(): void {
  _comboTimer = 0;
  _comboMultiplier = 1;
  _comboLength = 0;
  _comboTypes.clear();
  _lastRewardType = null;
  _wasNitroActive = false;
  _midRaceCredits = 0;
  _midRaceXP = 0;
}

export function destroyRewards(): void {
  _toastContainer?.remove();
  _toastContainer = null;
  _comboBarEl?.remove();
  _comboBarEl = null;
  _comboBarFill = null;
  _edgeGlowEl?.remove();
  _edgeGlowEl = null;
}

export function getMidRaceCredits(): number { return _midRaceCredits; }
export function getMidRaceXP(): number { return _midRaceXP; }
