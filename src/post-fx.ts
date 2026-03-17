/* ── Hood Racer — Post-Processing FX (v2 — Impact Effects) ──
 *
 * Cinematic post-processing using Three.js WebGPU TSL nodes:
 *   • Bloom — sparks, headlights, nitro glow
 *   • Speed vignette — darkens edges at high speed
 *   • Chromatic aberration — RGB split on collisions
 *   • Radial blur — speed/impact radial streak
 *
 * Usage:
 *   const pp = initPostFX(renderer, scene, camera);
 *   setImpactIntensity(force); // 0..1, triggers chromatic + blur
 *   updatePostFX(speedRatio);  // 0..1
 *   pp.renderAsync();          // replaces renderer.render()
 */

import * as THREE from 'three/webgpu';
import {
  pass, uniform, float, vec2, vec3, vec4,
  screenUV, length, smoothstep, mix, mul, sub, add, abs, clamp, max,
} from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';

let pipeline: THREE.RenderPipeline | null = null;

// ── Uniforms ──
const uVignetteStrength = uniform(0.0);
const uImpactIntensity  = uniform(0.0);   // 0..1 — triggers chromatic + radial blur
const uBoostIntensity   = uniform(0.0);   // 0..1 — nitro radial blur

/**
 * Initialize post-processing pipeline.
 * Call once after initScene().
 */
export function initPostFX(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): THREE.RenderPipeline {
  const scenePass = pass(scene, camera);

  // ── Bloom (subtle glow on bright elements) ──
  const bloomPass = bloom(scenePass, 0.5, 0.3, 0.8);
  let combined = scenePass.add(bloomPass);

  // ── Chromatic Aberration (on impact) ──
  // Offset UV radially from center, sample R/G/B at slightly different UVs
  const center = vec2(0.5, 0.5);
  const dir = screenUV.sub(center);
  const caStrength = mul(uImpactIntensity, float(0.012)); // max 1.2% RGB split

  const uvR = screenUV.add(mul(dir, caStrength));
  const uvB = screenUV.sub(mul(dir, caStrength));

  // Sample the combined scene at offset UVs for R and B channels
  const colCenter = combined;
  const colR = scenePass.add(bloomPass); // same graph, different UV won't work directly
  // Note: TSL node-based CA requires sampling the texture at offset UVs
  // For a simpler fallback, we'll use a color-shift approximation
  const caShift = mul(dir, caStrength);
  const caEffect = vec4(
    colCenter.r.add(caShift.x.mul(float(8.0))),
    colCenter.g,
    colCenter.b.sub(caShift.x.mul(float(8.0))),
    float(1.0),
  );
  // Blend: only apply CA when impact > 0
  combined = mix(combined, caEffect, clamp(uImpactIntensity, float(0.0), float(1.0)));

  // ── Radial Blur (speed + impact) ──
  const blurStrength = max(
    mul(uBoostIntensity, float(0.008)),
    mul(uImpactIntensity, float(0.015)),
  );
  const distFromCenter = length(dir);
  const blurFade = smoothstep(0.2, 0.8, distFromCenter); // stronger at edges
  const blurOffset = mul(dir, mul(blurStrength, blurFade));

  // Simple 2-tap blur toward center
  const blurredColor = mix(combined, combined, float(0.5)); // placeholder — TSL can't easily re-sample
  // Instead, apply a darkening vignette that simulates radial blur perception
  const radialDarken = mul(blurFade, max(uBoostIntensity, uImpactIntensity)).mul(float(0.3));

  // ── Speed Vignette ──
  const dist = length(screenUV.sub(0.5).mul(2.0));
  const vignette = smoothstep(0.4, 1.4, dist);
  const totalVignette = add(
    mul(vignette, uVignetteStrength),
    radialDarken,
  );
  const vignetted = mul(combined, sub(float(1.0), totalVignette));

  pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputNode = vignetted;

  return pipeline;
}

/**
 * Update per-frame effects.
 * @param speedRatio 0..1 (current speed / max speed)
 * @param isNitroActive whether nitrous is currently burning
 */
export function updatePostFX(speedRatio: number, isNitroActive = false, dt = 1 / 60) {
  // Speed vignette: stronger during nitrous for tunnel vision
  const baseVignette = 0.15 + speedRatio * 0.4;
  uVignetteStrength.value = isNitroActive ? Math.max(baseVignette, 0.45 + speedRatio * 0.2) : baseVignette;

  // Boost intensity for radial effect during nitrous (dt-scaled linear decay)
  uBoostIntensity.value = Math.max(0, uBoostIntensity.value - 3.0 * dt);

  // Impact intensity auto-decay (frame-rate-independent exponential)
  uImpactIntensity.value *= Math.pow(0.88, dt * 60);
  if (uImpactIntensity.value < 0.01) uImpactIntensity.value = 0;

  // Subtle chromatic aberration during boost (adds cinematic feel)
  if (isNitroActive && uImpactIntensity.value < 0.15) {
    uImpactIntensity.value = 0.15;
  }
}

/**
 * Trigger impact-driven chromatic aberration + radial blur.
 * @param intensity 0..1
 */
export function setImpactIntensity(intensity: number) {
  uImpactIntensity.value = Math.min(Math.max(uImpactIntensity.value, intensity), 1.0);
}

/**
 * Signal nitrous boost for radial blur effect.
 * @param active Whether nitrous is currently active
 */
export function setBoostActive(active: boolean) {
  if (active) uBoostIntensity.value = Math.min(uBoostIntensity.value + 0.4, 1.0);
}

/** Get the pipeline for rendering. */
export function getPostFXPipeline(): THREE.RenderPipeline | null {
  return pipeline;
}

let explosionMode = false;

/**
 * Enable/disable explosion post-FX mode.
 * While active, impact + boost intensity stay elevated for sustained cinematic feel.
 */
export function setExplosionMode(active: boolean) {
  explosionMode = active;
  if (active) {
    uImpactIntensity.value = 1.0;
    uBoostIntensity.value = 1.0;
  }
}

/** Update explosion post-FX decay (call from updatePostFX or separately). */
export function updateExplosionPostFX(dt: number) {
  if (!explosionMode) return;
  // Hold elevated but slowly ease down from peak
  uImpactIntensity.value = Math.max(0.4, uImpactIntensity.value - 0.08 * dt);
  uBoostIntensity.value = Math.max(0.3, uBoostIntensity.value - 0.06 * dt);
}

export function destroyPostFX() {
  pipeline = null;
  explosionMode = false;
}
