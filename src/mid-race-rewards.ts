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
// Audit fix #1: removed getProgress/saveProgress — mid-race rewards no longer
// mutate progression directly (double-count fix).
import { haptic } from './input';
import type { Vehicle } from './vehicle';
import { emitCurrencyBurst, emitComboShockwave, emitJackpotRain, emitBrokenGlass } from './reward-particles';
import { SHAKE } from './screen-shake';

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

/** Animated counter roll for toast amounts (200ms — fast & punchy). */
function toastCounterRoll(el: HTMLElement, target: number, prefix: string, suffix: string) {
  const start = performance.now();
  const dur = 200;
  function frame(now: number) {
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = `${prefix}${Math.round(target * eased)}${suffix}`;
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function showToast(def: RewardDef, finalNitro: number, finalCredits: number, finalXP: number, isJackpot: boolean) {
  const container = ensureToastContainer();

  // Enforce max toasts
  while (container.children.length >= MAX_TOASTS) {
    container.removeChild(container.firstChild!);
  }

  const toast = document.createElement('div');

  // 3-Tier toast hierarchy: Ping (tactical) → Chime (skill) → Fanfare (milestone/jackpot)
  let cls = 'reward-toast';
  if (isJackpot) cls += ' reward-jackpot reward-tier-fanfare';
  else if (def.category === 'milestone') cls += ' reward-milestone reward-tier-fanfare';
  else if (def.category === 'skill') cls += ' reward-tier-chime';
  else cls += ' reward-tier-ping';
  // Combo tier styling (×2=tier-2 ... ×5=tier-5)
  if (_comboMultiplier >= 2) cls += ` reward-tier-${Math.min(Math.floor(_comboMultiplier), 5)}`;
  toast.className = cls;
  toast.style.setProperty('--reward-hue', String(isJackpot ? 45 : def.hue));

  // Combo badge with tier color
  let comboBadgeCls = 'reward-combo-badge';
  if (_comboMultiplier >= 5) comboBadgeCls += ' reward-combo-max';
  else if (_comboMultiplier >= 4) comboBadgeCls += ' reward-combo-gold';
  else if (_comboMultiplier >= 3) comboBadgeCls += ' reward-combo-hot';
  const displayCombo = Math.floor(_comboMultiplier);
  const comboHtml = displayCombo > 1
    ? `<span class="${comboBadgeCls}">×${displayCombo}</span>`
    : '';

  // Build amount containers (values filled by counter-roll animation)
  let amtIdx = 0;
  let amountsHtml = '';
  if (finalNitro > 0) { amountsHtml += `<span class="reward-amt reward-amt-nitro reward-amt-${amtIdx}" data-target="${finalNitro}" data-prefix="⛽+" data-suffix=""></span>`; amtIdx++; }
  if (finalCredits > 0) { amountsHtml += `<span class="reward-amt reward-amt-credits reward-amt-${amtIdx}" data-target="${finalCredits}" data-prefix="💰+" data-suffix=""></span>`; amtIdx++; }
  if (finalXP > 0) { amountsHtml += `<span class="reward-amt reward-amt-xp reward-amt-${amtIdx}" data-target="${finalXP}" data-prefix="+" data-suffix=" XP"></span>`; amtIdx++; }

  toast.innerHTML = `
    <span class="reward-icon">${isJackpot ? '💥' : def.icon}</span>
    <span class="reward-label">${isJackpot ? 'JACKPOT!' : def.label}</span>
    <span class="reward-amounts">${amountsHtml}</span>
    ${comboHtml}
  `;

  container.appendChild(toast);

  // Trigger enter animation + glow pulse + particle effects
  // Audit fix #9: getBoundingClientRect inside rAF so toast has been painted
  const savedComboMult = _comboMultiplier; // capture current combo state
  requestAnimationFrame(() => {
    toast.classList.add('reward-toast--in');
    toast.classList.add('reward-toast--glow');
    setTimeout(() => toast.classList.remove('reward-toast--glow'), 400);

    // ── Particle effects based on reward tier (moved here from below) ──
    const toastRect = toast.getBoundingClientRect();
    const cx = toastRect.left + toastRect.width / 2;
    const cy = toastRect.top + toastRect.height / 2;

    if (isJackpot) {
      emitJackpotRain();
      SHAKE.jackpot();
    } else if (def.category === 'milestone') {
      emitCurrencyBurst(cx, cy, def.hue);
    } else if (savedComboMult >= 3) {
      emitComboShockwave(def.hue);
      if (savedComboMult >= 4) SHAKE.comboHigh();
    } else {
      emitCurrencyBurst(cx, cy, def.hue);
    }
  });

  // Start animated counter rolls on each amount span
  toast.querySelectorAll('.reward-amt[data-target]').forEach(el => {
    const span = el as HTMLElement;
    const target = parseInt(span.dataset.target || '0', 10);
    const prefix = span.dataset.prefix || '';
    const suffix = span.dataset.suffix || '';
    toastCounterRoll(span, target, prefix, suffix);
  });

  // Remove after lifespan
  const lifespan = isJackpot ? 2200 : (def.category === 'milestone' ? 2000 : TOAST_LIFESPAN);
  setTimeout(() => {
    toast.classList.add('reward-toast--out');
    setTimeout(() => toast.remove(), 300);
  }, lifespan);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMBO TIMER BAR (Zeigarnik visible drain)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let _comboBarEl: HTMLDivElement | null = null;
let _comboBarFill: HTMLDivElement | null = null;

let _comboBarLabel: HTMLDivElement | null = null;

function ensureComboBar(): void {
  if (_comboBarEl && _comboBarEl.parentNode) return;
  _comboBarEl = document.createElement('div');
  _comboBarEl.className = 'reward-combo-bar';
  _comboBarFill = document.createElement('div');
  _comboBarFill.className = 'reward-combo-bar-fill';
  _comboBarLabel = document.createElement('div');
  _comboBarLabel.className = 'reward-combo-bar-label';
  _comboBarEl.appendChild(_comboBarFill);
  _comboBarEl.appendChild(_comboBarLabel);
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
    // Glow intensifies with multiplier (dopamine anticipation visualization)
    const glow = Math.min(12, (_comboMultiplier - 1) * 4);
    _comboBarFill.style.boxShadow = `0 0 ${glow}px hsl(${Math.max(0, hue)}, 80%, 55%)`;
  }
  // Update multiplier label
  if (_comboBarLabel) {
    if (_comboMultiplier > 1) {
      _comboBarLabel.textContent = `×${_comboMultiplier}`;
      _comboBarLabel.style.opacity = '1';
    } else {
      _comboBarLabel.style.opacity = '0';
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUDIO ENGINE (layered oscillators + ADSR + reverb)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Audit fix #4: Share AudioContext from audio.ts instead of creating a private one
// (Safari enforces a max of 6 concurrent AudioContexts).
let _audioCtx: AudioContext | null = null;
let _reverbNode: ConvolverNode | null = null;
let _reverbGain: GainNode | null = null;

/** Provide the shared AudioContext (call from audio.ts initAudio). */
export function setRewardAudioContext(ctx: AudioContext) {
  _audioCtx = ctx;
}

function getAudioCtx(): AudioContext | null {
  return _audioCtx;
}

/** Generate a short procedural reverb impulse response (0.3s decay). */
function createReverbImpulse(ctx: AudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * 0.3);
  const buf = ctx.createBuffer(1, len, rate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
}

function ensureReverb(ctx: AudioContext): GainNode {
  if (_reverbGain) return _reverbGain;
  _reverbNode = ctx.createConvolver();
  _reverbNode.buffer = createReverbImpulse(ctx);
  _reverbGain = ctx.createGain();
  _reverbGain.gain.value = 0.25; // 25% wet mix
  _reverbNode.connect(_reverbGain).connect(ctx.destination);
  return _reverbGain;
}

/** Play a single oscillator with ADSR envelope. */
function playTone(
  freq: number, duration: number, gain: number,
  waveform: OscillatorType = 'sine', useReverb = true,
) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = waveform;
    osc.frequency.value = freq;

    const g = ctx.createGain();
    // ADSR: attack 5ms → peak → decay 30ms → sustain 70% → release
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);          // attack
    g.gain.linearRampToValueAtTime(gain * 0.7, t + 0.035);    // decay → sustain
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);  // release

    osc.connect(g);
    // Dry path
    g.connect(ctx.destination);
    // Wet reverb path
    if (useReverb) {
      const rev = ensureReverb(ctx);
      g.connect(_reverbNode!);
    }

    osc.start(t);
    osc.stop(t + duration + 0.05);
  } catch { /* audio may be blocked */ }
}

/** Play a layered two-oscillator chord tone. */
function playLayeredTone(
  freq: number, duration: number, gain: number,
  harmonyInterval = 7, // semitones above (7 = perfect 5th)
  harmonyWave: OscillatorType = 'triangle',
) {
  playTone(freq, duration, gain, 'sine');
  playTone(freq * Math.pow(2, harmonyInterval / 12), duration, gain * 0.3, harmonyWave);
}

/** Per-category sound profiles. */
function playRewardSFX(comboCount: number, category: 'tactical' | 'skill' | 'milestone') {
  const semitoneShift = Math.min(comboCount, 12);

  switch (category) {
    case 'tactical': {
      // Sharp alert ping — E5 base, sine + triangle 5th
      const base = 659.3 * Math.pow(2, semitoneShift / 12);
      playLayeredTone(base, 0.06, 0.12, 7, 'triangle');
      break;
    }
    case 'skill': {
      // Musical rewarding chord — C5 base, sine + sine 5th
      const base = 523.3 * Math.pow(2, semitoneShift / 12);
      playLayeredTone(base, 0.1, 0.14, 7, 'sine');
      break;
    }
    case 'milestone': {
      // Achievement chime — 3-note ascending (root → 3rd → 5th)
      const base = 392.0; // G4
      playTone(base, 0.18, 0.14, 'sine');
      setTimeout(() => playTone(base * Math.pow(2, 4 / 12), 0.15, 0.12, 'sine'), 70);
      setTimeout(() => playTone(base * Math.pow(2, 7 / 12), 0.2, 0.13, 'triangle'), 140);
      break;
    }
  }
}

function playJackpotSFX() {
  // Ascending major triad arpeggio: C5 → E5 → G5 → C6
  const base = 523.3;
  playTone(base, 0.12, 0.16, 'sine');
  setTimeout(() => playTone(base * Math.pow(2, 4 / 12), 0.12, 0.14, 'sine'), 70);
  setTimeout(() => playTone(base * Math.pow(2, 7 / 12), 0.15, 0.15, 'triangle'), 140);
  setTimeout(() => playTone(base * 2, 0.25, 0.13, 'sine'), 210);
}

function playComboLostSFX() {
  // Metallic descending minor 3rd — sawtooth + sine
  playTone(330, 0.12, 0.10, 'sawtooth');
  playTone(330, 0.12, 0.06, 'sine');
  setTimeout(() => {
    playTone(277, 0.18, 0.09, 'sawtooth');
    playTone(277, 0.18, 0.05, 'sine');
  }, 80);
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

  // Audit fix #1: Do NOT mutate progress.credits/xp directly here.
  // They are tracked in accumulators and applied once at race end
  // via processRaceRewards() to avoid double-counting.
  _midRaceCredits += finalCredits;
  _midRaceXP += finalXP;

  // ── 5-Layer Juice ──

  // 1. Toast
  showToast(def, finalNitro, finalCredits, finalXP, isJackpot);

  // 2. SFX
  if (isJackpot) {
    playJackpotSFX();
  } else if (def.comboable) {
    playRewardSFX(_comboLength, def.category);
  } else if (def.category === 'milestone') {
    playRewardSFX(0, 'milestone');
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

  const lostMultiplier = _comboMultiplier;

  // Bank XP: reward for chain length × variety
  // Audit fix #6: track in accumulator only — applied at race end, not mid-race
  const bankXP = Math.floor(_comboTypes.size * _comboLength * 2);
  if (bankXP > 0) {
    _midRaceXP += bankXP;
  }

  // Show "×N COMBO LOST" — loss aversion: show what was lost (Kahneman)
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = 'reward-toast reward-combo-lost';
    toast.innerHTML = `
    <span class="reward-icon">💥</span>
    <span class="reward-label">×${Math.floor(lostMultiplier)} COMBO LOST</span>
    ${bankXP > 0 ? `<span class="reward-amt reward-amt-xp" style="opacity:0.7">Banked +${bankXP} XP</span>` : ''}
  `;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('reward-toast--in'));
  setTimeout(() => {
    toast.classList.add('reward-toast--out');
    setTimeout(() => toast.remove(), 300);
  }, 1400);

  // Broken glass particles (loss aversion amplification)
  const barRect = _comboBarEl?.getBoundingClientRect();
  if (barRect) {
    emitBrokenGlass(barRect.left + barRect.width / 2, barRect.top + barRect.height / 2);
  }

  // Screen shake at ×3+ (proportional to loss magnitude)
  if (lostMultiplier >= 3) SHAKE.comboBreak();

  // SFX + haptic
  playComboLostSFX();
  haptic([20, 15, 20]);

  // Red edge flash (extended for loss aversion — 0.4s)
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
      // Audit fix #6: track in accumulator only — applied at race end
      const expiredMultiplier = _comboMultiplier;
      const bankXP = Math.floor(_comboTypes.size * _comboLength * 2);
      if (bankXP > 0) {
        _midRaceXP += bankXP;
      }

      // Near-miss framing: if combo expired at ×3+, show "CLOSE!" ghost
      // (Psychology: near-miss effect — "I almost had the jackpot")
      if (expiredMultiplier >= 3) {
        const container = ensureToastContainer();
        const ghost = document.createElement('div');
        ghost.className = 'reward-toast reward-near-miss';
        ghost.innerHTML = `<span class="reward-icon">😤</span><span class="reward-label">×${Math.floor(expiredMultiplier)} CLOSE!</span>`;
        container.appendChild(ghost);
        requestAnimationFrame(() => ghost.classList.add('reward-toast--in'));
        setTimeout(() => {
          ghost.classList.add('reward-toast--out');
          setTimeout(() => ghost.remove(), 300);
        }, 900);
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
  _comboBarLabel = null;
  _edgeGlowEl?.remove();
  _edgeGlowEl = null;
}

export function getMidRaceCredits(): number { return _midRaceCredits; }
export function getMidRaceXP(): number { return _midRaceXP; }
