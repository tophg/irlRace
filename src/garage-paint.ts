/* ── Hood Racer — Garage Paint System ──
 *
 * Extracted from garage.ts. Handles car body-panel recoloring
 * while preserving glass, trim, chrome, and named exclusions.
 */

import * as THREE from 'three/webgpu';

// Original material colors — stored on first paint so RESET is instant
const originalColors = new WeakMap<THREE.Material, THREE.Color>();

/** Determine if a material/mesh should be excluded from paint recoloring. */
export function shouldSkipForPaint(mat: any, meshName: string): boolean {
  // Glass / transparent
  if (mat.transparent && mat.opacity < 0.5) return true;
  // Lights (strong emissive color)
  if (mat.emissiveIntensity > 0.5 && mat.emissive && mat.emissive.getHex() > 0) return true;
  // Named exclusions (mesh or material name)
  const name = (mat.name || meshName || '').toLowerCase();
  if (/glass|window|windshield|tire|tyre|wheel|rubber|rim|chrome|logo|badge|grille|exhaust|mirror|light|lens|indicator/.test(name)) return true;
  // Very dark AND highly metallic (likely trim/unibody, not painted body)
  if (mat.color) {
    const hsl = { h: 0, s: 0, l: 0 };
    mat.color.getHSL(hsl);
    if (hsl.l < 0.05 && (mat.metalness ?? 0) > 0.85) return true;
  }
  return false;
}

/** Store original color for a material if not already stored. */
export function storeOriginal(mat: any) {
  if (!originalColors.has(mat) && mat.color) {
    originalColors.set(mat, mat.color.clone());
  }
}

/** Recolor a model's body panels with a hue (0–360). */
export function applyPaintToModel(model: THREE.Group | null, hue: number) {
  if (!model) return;
  const color = new THREE.Color().setHSL(hue / 360, 0.90, 0.15);
  model.traverse((child: any) => {
    if (!child.isMesh) return;
    if (!child.material) return;

    const mats = Array.isArray(child.material) ? child.material : [child.material];

    for (const mat of mats) {
      if (shouldSkipForPaint(mat, child.name)) continue;
      if (!mat.color) continue;
      storeOriginal(mat);
      mat.color.copy(color);
      if (mat.needsUpdate !== undefined) mat.needsUpdate = true;
      mat.version++; // Force WebGPU uniform re-upload
    }
  });
}

/** Restore all painted materials to their original colors. */
export function restoreOriginalColors(model: THREE.Group | null) {
  if (!model) return;
  model.traverse((child: any) => {
    if (!child.isMesh) return;
    if (!child.material) return;

    const mats = Array.isArray(child.material) ? child.material : [child.material];

    for (const mat of mats) {
      const orig = originalColors.get(mat);
      if (orig && mat.color) {
        mat.color.copy(orig);
        if (mat.emissive) {
          mat.emissive.set(0, 0, 0);
        }
        if (mat.needsUpdate !== undefined) mat.needsUpdate = true;
        mat.version++; // Force WebGPU uniform re-upload
      }
    }
  });
}
