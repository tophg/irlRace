/* ── IRL Race — Facade Atlas Constants ──
 *
 * Shared constants for the facade atlas grid layout.
 * Atlas layout: 8 cols × 5 rows = 40 tiles per environment.
 *
 *   Row 0: Window variants (per-column style)
 *   Row 1: Wall pier variants (windowless wall surfaces)
 *   Row 2: Ground floor variants (storefronts, doors, bases — per archetype)
 *   Row 3: Transition band (cornice, balcony, ductwork — per archetype)
 *   Row 4: Roof cap variants (parapet, roof edge, flat surface)
 */

export const FACADE_ATLAS_SIZE = 2048;
export const FACADE_COLS = 8;
export const FACADE_ROWS = 5;
export const FACADE_TILE_W = FACADE_ATLAS_SIZE / FACADE_COLS;  // 256
export const FACADE_TILE_H = Math.floor(FACADE_ATLAS_SIZE / FACADE_ROWS);  // 409
