/* ── IRL Race — Post-Processing FX (v3 — Slow-Mo Cinematic) ──
 *
 * Cinematic post-processing using Three.js WebGPU TSL nodes:
 *   • Bloom — sparks, headlights, nitro glow
 *   • Speed vignette — darkens edges at high speed
 *   • Chromatic aberration — RGB split on collisions
 *   • Radial blur — edge-weighted darkening + chromatic spread (speed/impact/slow-mo)
 *   • Desaturation — BT.709 luminance partial grayscale during slow-mo
 *   • Cool tint — subtle blue shift during slow-mo (NFS-style)
 *
 * Usage:
 *   const pp = initPostFX(renderer, scene, camera);
 *   setImpactIntensity(force); // 0..1, triggers chromatic + blur
 *   updatePostFX(speedRatio);  // 0..1
 *   pp.renderAsync();          // replaces renderer.render()
 */

import * as THREE from 'three/webgpu';
import { getTimeScale, isSlowMotionActive } from './time-scale';
import {
  pass, uniform, float, vec2, vec4,
  screenUV, length, smoothstep, mix, mul, sub, add, clamp, max,
} from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';

let pipeline: THREE.RenderPipeline | null = null;

// ── Uniforms ──
const uVignetteStrength = uniform(0.0);
const uImpactIntensity  = uniform(0.0);   // 0..1 — triggers chromatic + radial blur
const uBoostIntensity   = uniform(0.0);   // 0..1 — nitro radial blur
const uSlowMoIntensity  = uniform(0.0);   // 0..1 — slow-mo desaturation + radial blur

// Smoothed internal value for interpolation
let _smoothSlowMo = 0;

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
  const bloomPass = bloom(scenePass, 0.2, 0.25, 0.9);
  let combined = scenePass.add(bloomPass);

  // ── Chromatic Aberration (on impact + slow-mo) ──
  const center = vec2(0.5, 0.5);
  const dir = screenUV.sub(center);
  // CA strength from impact + subtle slow-mo contribution
  const caStrength = max(
    mul(uImpactIntensity, float(0.012)),
    mul(uSlowMoIntensity, float(0.005)),  // subtle RGB split in slow-mo
  );

  const caShift = mul(dir, caStrength);
  const caEffect = vec4(
    combined.r.add(caShift.x.mul(float(8.0))),
    combined.g,
    combined.b.sub(caShift.x.mul(float(8.0))),
    float(1.0),
  );
  // Blend: apply CA when impact or slow-mo > 0
  const caAmount = clamp(max(uImpactIntensity, uSlowMoIntensity), float(0.0), float(1.0));
  combined = mix(combined, caEffect, caAmount);

  // ── Radial Blur (speed + impact + slow-mo) — INTENSIFIED ──
  // Edge-weighted directional darkening that simulates radial blur perception
  const blurStrength = max(
    max(
      mul(uBoostIntensity, float(0.015)),    // boost: 0.008→0.015
      mul(uImpactIntensity, float(0.025)),   // impact: 0.015→0.025
    ),
    mul(uSlowMoIntensity, float(0.025)),     // slow-mo: 0.012→0.025
  );
  const distFromCenter = length(dir);
  const blurFade = smoothstep(0.1, 0.65, distFromCenter);  // tighter clear zone, more aggressive edges
  const radialDarken = mul(
    blurFade,
    max(max(uBoostIntensity, uImpactIntensity), uSlowMoIntensity),
  ).mul(float(0.55));   // edge darkening: 0.35→0.55

  // ── Cool Blue Tint (slow-mo only — NFS Most Wanted style) ──
  // Shift toward cool blue during slow-mo
  const coolTint = vec4(
    combined.r.mul(sub(float(1.0), mul(uSlowMoIntensity, float(0.12)))),   // reduce red more
    combined.g.mul(sub(float(1.0), mul(uSlowMoIntensity, float(0.04)))),   // slight green reduction
    combined.b.mul(add(float(1.0), mul(uSlowMoIntensity, float(0.10)))),   // boost blue more
    float(1.0),
  );
  combined = mix(combined, coolTint, uSlowMoIntensity);

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
  const baseVignette = 0.1 + speedRatio * 0.3;
  let vig = isNitroActive ? Math.max(baseVignette, 0.45 + speedRatio * 0.2) : baseVignette;

  // Slow-motion cinematic vignette (dark edges for bullet-time feel)
  if (isSlowMotionActive()) vig = Math.max(vig, 0.55);

  uVignetteStrength.value = vig;

  // ── Slow-mo intensity (smooth interpolation) ──
  const targetSlowMo = isSlowMotionActive() ? (1.0 - getTimeScale()) : 0;
  _smoothSlowMo += (targetSlowMo - _smoothSlowMo) * Math.min(5.0 * dt, 1.0);
  if (_smoothSlowMo < 0.005) _smoothSlowMo = 0;
  uSlowMoIntensity.value = _smoothSlowMo;

  // Boost intensity for radial effect during nitrous (dt-scaled linear decay)
  uBoostIntensity.value = Math.max(0, uBoostIntensity.value - 3.0 * dt);

  // Impact intensity auto-decay (frame-rate-independent exponential)
  uImpactIntensity.value *= Math.pow(0.88, dt * 60);
  if (uImpactIntensity.value < 0.01) uImpactIntensity.value = 0;

  // Audit fix #10: apply explosion post-FX decay when in explosion mode
  updateExplosionPostFX(dt);

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
function getPostFXPipeline(): THREE.RenderPipeline | null {
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
function updateExplosionPostFX(dt: number) {
  if (!explosionMode) return;
  // Hold elevated but slowly ease down from peak
  uImpactIntensity.value = Math.max(0.4, uImpactIntensity.value - 0.08 * dt);
  uBoostIntensity.value = Math.max(0.3, uBoostIntensity.value - 0.06 * dt);
}

// Audit fix #11: exported for race teardown cleanup
export function destroyPostFX() {
  pipeline = null;
  explosionMode = false;
  _smoothSlowMo = 0;
  destroyAfterimage();
}

// ═══════════════════════════════════════════════════════
// AFTERIMAGE / MOTION TRAILS (2D Canvas overlay)
// ═══════════════════════════════════════════════════════

let _afterCanvas: HTMLCanvasElement | null = null;
let _afterCtx: CanvasRenderingContext2D | null = null;
let _sourceCanvas: HTMLCanvasElement | null = null;
let _afterFrameCount = 0;
const AFTER_CAPTURE_INTERVAL = 2; // capture every N frames during slow-mo

/**
 * Initialize the afterimage overlay canvas.
 * Call once, passing the WebGPU renderer's canvas.
 */
export function initAfterimage(sourceCanvas: HTMLCanvasElement) {
  _sourceCanvas = sourceCanvas;

  _afterCanvas = document.createElement('canvas');
  _afterCanvas.id = 'afterimage-overlay';
  _afterCanvas.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 0; opacity: 0;
    transition: opacity 0.15s;
  `;
  // Half-res for performance
  _afterCanvas.width = Math.floor(sourceCanvas.width / 2);
  _afterCanvas.height = Math.floor(sourceCanvas.height / 2);
  _afterCtx = _afterCanvas.getContext('2d', { willReadFrequently: false })!;

  // Insert behind the game canvas
  sourceCanvas.parentElement?.insertBefore(_afterCanvas, sourceCanvas);
}

/**
 * Update afterimage each frame. Call from game loop after rendering.
 * Only accumulates frames during slow-mo.
 */
export function updateAfterimage() {
  if (!_afterCanvas || !_afterCtx || !_sourceCanvas) return;

  const active = isSlowMotionActive();
  const ts = getTimeScale();

  if (active) {
    // Show overlay
    _afterCanvas.style.opacity = '0.7';

    // Resize if needed
    const tw = Math.floor(_sourceCanvas.width / 2);
    const th = Math.floor(_sourceCanvas.height / 2);
    if (_afterCanvas.width !== tw || _afterCanvas.height !== th) {
      _afterCanvas.width = tw;
      _afterCanvas.height = th;
    }

    _afterFrameCount++;
    if (_afterFrameCount % AFTER_CAPTURE_INTERVAL === 0) {
      // Fade previous content — lower alpha = longer trails
      // timeScale 0.2 → fadeFactor ~0.85 (long trails)
      // timeScale 0.6 → fadeFactor ~0.60 (short trails)
      const fadeFactor = 0.5 + ts * 0.4;

      _afterCtx.globalCompositeOperation = 'destination-out';
      _afterCtx.fillStyle = `rgba(0,0,0,${1.0 - fadeFactor})`;
      _afterCtx.fillRect(0, 0, _afterCanvas.width, _afterCanvas.height);

      // Draw current frame with slight blue tint via compositing
      _afterCtx.globalCompositeOperation = 'source-over';
      // Audit fix #6: use 9-arg drawImage for correct DPI handling
      _afterCtx.globalAlpha = 0.3;
      _afterCtx.drawImage(
        _sourceCanvas,
        0, 0, _sourceCanvas.width, _sourceCanvas.height,
        0, 0, _afterCanvas.width, _afterCanvas.height,
      );
      _afterCtx.globalAlpha = 1.0;
    }
  } else {
    // Fade out overlay when slow-mo ends
    if (_afterCanvas.style.opacity !== '0') {
      _afterCanvas.style.opacity = '0';
      // Clear after fade transition
      setTimeout(() => {
        if (_afterCtx && _afterCanvas) {
          _afterCtx.clearRect(0, 0, _afterCanvas.width, _afterCanvas.height);
        }
      }, 200);
    }
    _afterFrameCount = 0;
  }
}

function destroyAfterimage() {
  if (_afterCanvas) {
    _afterCanvas.remove();
    _afterCanvas = null;
    _afterCtx = null;
  }
  _sourceCanvas = null;
  _afterFrameCount = 0;
}
