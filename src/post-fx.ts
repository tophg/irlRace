/* ── Hood Racer — Post-Processing FX ──
 *
 * Cinematic post-processing using Three.js WebGPU RenderPipeline:
 *   • Bloom — makes sparks, headlights, and nitro glow pop
 *   • Speed vignette — darkens edges at high speed for tunnel-vision effect
 *
 * Usage:
 *   const pp = initPostFX(renderer, scene, camera);
 *   updatePostFX(speedRatio);  // 0..1
 *   pp.renderAsync();          // replaces renderer.render()
 */

import * as THREE from 'three/webgpu';
import { pass, uniform, float, screenUV, length, smoothstep, mix, vec4 } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';

let pipeline: THREE.RenderPipeline | null = null;
let vignetteStrength = uniform(0.0);

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

  // Bloom: subtle glow on bright elements (sparks, nitro flames, headlights)
  const bloomPass = bloom(scenePass, 0.4, 0.3, 0.85);

  // Combine scene + bloom
  const combined = scenePass.add(bloomPass);

  // Speed vignette: darken edges proportional to speed
  const uv = screenUV;
  const dist = length(uv.sub(0.5).mul(2.0));
  const vignette = smoothstep(0.4, 1.4, dist);
  const vignetted = mix(combined, combined.mul(float(1.0).sub(vignette.mul(vignetteStrength))), vignetteStrength);

  pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputNode = vignetted;

  return pipeline;
}

/**
 * Update speed-driven effects. Call each frame.
 * @param speedRatio 0..1 (current speed / max speed)
 */
export function updatePostFX(speedRatio: number) {
  // Vignette ramps up from 0.3 at rest to 0.7 at top speed
  vignetteStrength.value = 0.3 + speedRatio * 0.4;
}

/** Get the pipeline for rendering. */
export function getPostFXPipeline(): THREE.RenderPipeline | null {
  return pipeline;
}

export function destroyPostFX() {
  pipeline = null;
}
