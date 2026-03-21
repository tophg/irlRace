/* ── IRL Race — Shared Color Palette ──
 *
 * Single source of truth for all color constants used across the game.
 * Matches the CSS custom properties in index.css where applicable.
 *
 * Usage:
 *   import { COLORS } from './colors';
 *   ctx.fillStyle = COLORS.ACCENT;
 *   new THREE.Color(COLORS.GOLD);
 */

// ── Brand / UI ──
export const COLORS = {
  /** Primary accent — track editor, HUD highlights, minimap */
  ACCENT:        '#ff6600',
  ACCENT_GLOW:   '#ff8833',
  ACCENT_DARK:   '#ff4400',

  /** Gold — 1st place, rewards, achievements */
  GOLD:          '#ffd700',
  /** Yellow — general emphasis, lap counter, warnings */
  YELLOW:        '#ffcc00',
  /** Orange warm — secondary accent */
  ORANGE:        '#ffaa00',

  /** Red — damage, errors, wrong-way */
  RED:           '#ff4444',
  RED_HOT:       '#ff2200',
  RED_SUBTLE:    '#ff1100',

  /** Green — success, ready states, positive */
  GREEN:         '#44ff88',
  /** Blue — info, cooldown, network */
  BLUE:          '#44aaff',
  BLUE_SKY:      '#4fc3f7',
  BLUE_BRIGHT:   '#0088ff',

  /** Cyan — speed, HUD chrome */
  CYAN:          '#00ffff',

  /** Neutrals */
  WHITE:         '#ffffff',
  PANEL_BG:      '#111111',
  DARK_SURFACE:  '#3e3e48',
  MID_GRAY:      '#333333',
} as const;

/** Type for any color key in the palette */
export type ColorKey = keyof typeof COLORS;
