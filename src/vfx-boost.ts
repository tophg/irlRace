/* ── IRL Race — Boost & Nitro VFX ── */

import * as THREE from 'three/webgpu';
import { spawnGPUBackfire } from './gpu-particles';

// ── Nitrous Afterburner — Multi-Layer Exhaust System ──
// Layer 1: Inner Core (bright white-cyan, small cones, fast flicker)
// Layer 2: Outer Glow (larger, softer, blue-purple envelope)
// Layer 3: Ground Glow (additive circles on road surface)
// Lighting: SpotLights aimed downward for directional road illumination

let boostFlameL: THREE.Mesh | null = null;
let boostFlameR: THREE.Mesh | null = null;
let boostGlowL: THREE.Mesh | null = null;
let boostGlowR: THREE.Mesh | null = null;
let boostGroundL: THREE.Mesh | null = null;
let boostGroundR: THREE.Mesh | null = null;
let boostFlameScene: THREE.Scene | null = null;

export function initBoostFlame(scene: THREE.Scene): THREE.Mesh {
  boostFlameScene = scene;

  // ── Custom flame ShaderMaterial with FBM noise ──
  const flameVertShader = /* glsl */`
    uniform float uTime;
    varying vec2 vUv;
    varying float vDisplace;

    // Simplex-style hash noise
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 perm(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
    float noise3(vec3 p) {
      vec3 a = floor(p);
      vec3 d = p - a;
      d = d * d * (3.0 - 2.0 * d);
      vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
      vec4 k1 = perm(b.xyxy);
      vec4 k2 = perm(k1.xyxy + b.zzww);
      vec4 c = k2 + a.zzzz;
      vec4 k3 = perm(c);
      vec4 k4 = perm(c + 1.0);
      vec4 o1 = fract(k3 * (1.0 / 41.0));
      vec4 o2 = fract(k4 * (1.0 / 41.0));
      vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);
      vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);
      return o4.y * d.y + o4.x * (1.0 - d.y);
    }

    float fbm(vec3 p) {
      float v = 0.0;
      float a = 0.5;
      vec3 shift = vec3(100.0);
      for (int i = 0; i < 4; i++) {
        v += a * noise3(p);
        p = p * 2.0 + shift;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vUv = uv;
      vec3 pos = position;

      // Height along the cone (0 = base, 1 = tip)
      float h = clamp(uv.y, 0.0, 1.0);

      // Displace vertices more at the tip for a dancing flame
      float turbulence = fbm(vec3(pos.x * 4.0, pos.z * 4.0, uTime * 3.0));
      float displacement = turbulence * h * h * 0.35;
      pos.x += displacement * sin(uTime * 7.0 + pos.y * 5.0);
      pos.z += displacement * cos(uTime * 5.0 + pos.y * 3.0);

      // Stretch/compress the flame length with noise
      float lengthNoise = fbm(vec3(uTime * 2.0, 0.0, 0.0));
      pos.y *= 0.85 + lengthNoise * 0.3;

      vDisplace = displacement;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  const flameFragShader = /* glsl */`
    uniform float uTime;
    uniform float uIntensity;
    varying vec2 vUv;
    varying float vDisplace;

    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 perm(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
    float noise3(vec3 p) {
      vec3 a = floor(p);
      vec3 d = p - a;
      d = d * d * (3.0 - 2.0 * d);
      vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
      vec4 k1 = perm(b.xyxy);
      vec4 k2 = perm(k1.xyxy + b.zzww);
      vec4 c = k2 + a.zzzz;
      vec4 k3 = perm(c);
      vec4 k4 = perm(c + 1.0);
      vec4 o1 = fract(k3 * (1.0 / 41.0));
      vec4 o2 = fract(k4 * (1.0 / 41.0));
      vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);
      vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);
      return o4.y * d.y + o4.x * (1.0 - d.y);
    }

    float fbm(vec3 p) {
      float v = 0.0;
      float a = 0.5;
      vec3 shift = vec3(100.0);
      for (int i = 0; i < 5; i++) {
        v += a * noise3(p);
        p = p * 2.0 + shift;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      float h = clamp(vUv.y, 0.0, 1.0);

      // Scrolling noise coordinates for flame turbulence
      vec3 noiseCoord = vec3(vUv * 3.0, uTime * 2.5);
      float n1 = fbm(noiseCoord);
      float n2 = fbm(noiseCoord + vec3(1.7, 9.2, uTime * 1.3));

      // Combine noise with height falloff — brighter at base, fading at tip
      float baseMask = 1.0 - pow(h, 1.5);
      float noiseMask = (n1 + n2) * 0.5;

      // Radial falloff from UV center (cone unfolds linearly)
      float radial = abs(vUv.x - 0.5) * 2.0;
      float radialFade = 1.0 - smoothstep(0.0, 0.9, radial);

      float intensity = baseMask * (0.6 + noiseMask * 0.6) * radialFade * uIntensity;
      intensity *= 0.8 + sin(uTime * 30.0) * 0.1 + sin(uTime * 47.0) * 0.08;
      intensity = clamp(intensity, 0.0, 1.0);

      // Nitrous temperature color ramp: white-hot → cyan → blue → purple edge
      vec3 color;
      if (intensity > 0.8) {
        // White-hot core
        float t = (intensity - 0.8) / 0.2;
        color = mix(vec3(0.7, 0.95, 1.0), vec3(1.0, 1.0, 1.0), t);
      } else if (intensity > 0.55) {
        // Cyan hot zone
        float t = (intensity - 0.55) / 0.25;
        color = mix(vec3(0.2, 0.6, 1.0), vec3(0.7, 0.95, 1.0), t);
      } else if (intensity > 0.3) {
        // Blue mid zone
        float t = (intensity - 0.3) / 0.25;
        color = mix(vec3(0.15, 0.25, 0.9), vec3(0.2, 0.6, 1.0), t);
      } else if (intensity > 0.1) {
        // Purple edge
        float t = (intensity - 0.1) / 0.2;
        color = mix(vec3(0.3, 0.1, 0.5), vec3(0.15, 0.25, 0.9), t);
      } else {
        color = vec3(0.3, 0.1, 0.5);
      }

      // Alpha: sharp falloff at edges, fully transparent when intensity is near 0
      float alpha = smoothstep(0.02, 0.15, intensity) * intensity * 1.5;
      alpha = clamp(alpha, 0.0, 1.0);

      gl_FragColor = vec4(color * (1.0 + intensity * 0.5), alpha);
    }
  `;

  const flameUniforms = {
    uTime: { value: 0.0 },
    uIntensity: { value: 1.0 },
  };

  const flameMat = new THREE.ShaderMaterial({
    uniforms: JSON.parse(JSON.stringify(flameUniforms)),
    vertexShader: flameVertShader,
    fragmentShader: flameFragShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Higher-poly cone for smoother vertex displacement
  const flameGeo = new THREE.ConeGeometry(0.18, 2.0, 16, 12);

  boostFlameL = new THREE.Mesh(flameGeo, flameMat.clone());
  boostFlameR = new THREE.Mesh(flameGeo, flameMat.clone());
  boostFlameL.rotation.x = Math.PI / 2;
  boostFlameR.rotation.x = Math.PI / 2;
  boostFlameL.visible = false;
  boostFlameR.visible = false;
  scene.add(boostFlameL);
  scene.add(boostFlameR);

  // ── Outer glow envelope uses same shader with lower intensity ──
  const glowMat = new THREE.ShaderMaterial({
    uniforms: JSON.parse(JSON.stringify(flameUniforms)),
    vertexShader: flameVertShader,
    fragmentShader: flameFragShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  (glowMat.uniforms.uIntensity as any).value = 0.45;

  const glowGeo = new THREE.ConeGeometry(0.35, 2.8, 12, 8);
  boostGlowL = new THREE.Mesh(glowGeo, glowMat.clone());
  boostGlowR = new THREE.Mesh(glowGeo, glowMat.clone());
  boostGlowL.rotation.x = Math.PI / 2;
  boostGlowR.rotation.x = Math.PI / 2;
  boostGlowL.visible = false;
  boostGlowR.visible = false;
  scene.add(boostGlowL);
  scene.add(boostGlowR);

  // ── Layer 3: Ground Glow Decals (flat additive circles on road) ──
  const groundGeo = new THREE.CircleGeometry(1.2, 16);
  const groundMat = new THREE.MeshBasicMaterial({
    color: 0x3366ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  boostGroundL = new THREE.Mesh(groundGeo, groundMat.clone());
  boostGroundR = new THREE.Mesh(groundGeo, groundMat.clone());
  boostGroundL.rotation.x = -Math.PI / 2; // lay flat on road
  boostGroundR.rotation.x = -Math.PI / 2;
  boostGroundL.visible = false;
  boostGroundR.visible = false;
  scene.add(boostGroundL);
  scene.add(boostGroundR);

  // SpotLights removed — per-fragment GPU cost across entire scene;
  // ground glow circles already provide visual illumination.

  return boostFlameL; // backward compat — returns a mesh
}

// ── Flame Burst on Nitro Activation ──
let boostBurstScale = 1.0; // decays from 3.0 → 1.0

/** Call on nitro activation rising edge to trigger a flame burst. */
export function triggerBoostBurst() {
  boostBurstScale = 3.0;
}

/** Fire 3 rapid backfire pops on nitro deactivation (falling edge). */
export function triggerBackfireSequence(carPos: THREE.Vector3, heading: number) {
  const fire = (delay: number) => {
    setTimeout(() => {
      spawnGPUBackfire(carPos.clone(), heading);
    }, delay);
  };
  fire(0);
  fire(80);
  fire(180);
}

export function updateBoostFlame(
  active: boolean,
  carPos: THREE.Vector3,
  heading: number,
  time: number,
  engineHeat = 0,
  dt = 1 / 60,
) {
  if (!boostFlameL || !boostFlameR) return;

  // Toggle visibility for all layers
  const vis = active;
  boostFlameL.visible = vis;
  boostFlameR.visible = vis;
  if (boostGlowL) boostGlowL.visible = vis;
  if (boostGlowR) boostGlowR.visible = vis;
  if (boostGroundL) boostGroundL.visible = vis;
  if (boostGroundR) boostGroundR.visible = vis;
  if (!active) return;

  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  const exhaust = 2.3; // distance behind car
  const sideOffset = 0.4;

  // Compute exhaust positions (shared across all layers)
  const lx = carPos.x - sinH * exhaust - cosH * sideOffset;
  const ly = carPos.y + 0.45;
  const lz = carPos.z - cosH * exhaust + sinH * sideOffset;
  const rx = carPos.x - sinH * exhaust + cosH * sideOffset;
  const ry = ly;
  const rz = carPos.z - cosH * exhaust - sinH * sideOffset;

  // ── Layer 1: Inner Core — update shader uniforms ──
  boostFlameL.position.set(lx, ly, lz);
  boostFlameL.rotation.set(Math.PI / 2, heading, 0);
  boostFlameR.position.set(rx, ry, rz);
  boostFlameR.rotation.set(Math.PI / 2, heading, 0);

  // Update shader time uniform
  const coreMatL = boostFlameL.material as THREE.ShaderMaterial;
  const coreMatR = boostFlameR.material as THREE.ShaderMaterial;
  coreMatL.uniforms.uTime.value = time;
  coreMatR.uniforms.uTime.value = time;

  // Subtle scale breathing + burst scale on activation
  boostBurstScale += (1.0 - boostBurstScale) * (1 - Math.exp(-10 * dt)); // frame-rate-independent decay toward 1.0
  const coreFlicker = (0.85 + Math.sin(time * 18) * 0.1 + Math.sin(time * 31) * 0.05) * boostBurstScale;
  boostFlameL.scale.set(coreFlicker, coreFlicker, coreFlicker);
  boostFlameR.scale.set(coreFlicker, coreFlicker, coreFlicker);

  // ── Layer 2: Outer Glow — update shader uniforms ──
  if (boostGlowL && boostGlowR) {
    const glowOffset = 0.15;
    boostGlowL.position.set(lx - sinH * glowOffset, ly, lz - cosH * glowOffset);
    boostGlowL.rotation.set(Math.PI / 2, heading, 0);
    boostGlowR.position.set(rx - sinH * glowOffset, ry, rz - cosH * glowOffset);
    boostGlowR.rotation.set(Math.PI / 2, heading, 0);

    const glowMatL = boostGlowL.material as THREE.ShaderMaterial;
    const glowMatR = boostGlowR.material as THREE.ShaderMaterial;
    glowMatL.uniforms.uTime.value = time;
    glowMatR.uniforms.uTime.value = time;

    const glowFlicker = 0.9 + Math.sin(time * 12) * 0.08;
    boostGlowL.scale.set(glowFlicker, glowFlicker, glowFlicker);
    boostGlowR.scale.set(glowFlicker, glowFlicker, glowFlicker);
  }

  // ── Layer 3: Ground Glow — pulsing circles, color shifts with heat ──
  if (boostGroundL && boostGroundR) {
    boostGroundL.position.set(lx, carPos.y + 0.03, lz);
    boostGroundR.position.set(rx, carPos.y + 0.03, rz);

    const groundPulse = 0.6 + Math.sin(time * 20) * 0.2 + Math.sin(time * 31) * 0.1;
    boostGroundL.scale.setScalar(0.8 + groundPulse * 0.5);
    boostGroundR.scale.setScalar(0.8 + groundPulse * 0.5);

    const groundMatL = boostGroundL.material as THREE.MeshBasicMaterial;
    const groundMatR = boostGroundR.material as THREE.MeshBasicMaterial;
    groundMatL.opacity = 0.25 * groundPulse;
    groundMatR.opacity = 0.25 * groundPulse;

    // Heat-responsive ground glow color: blue → purple → orange
    const heatT = Math.min(engineHeat / 100, 1);
    const gr = 0.2 + heatT * 0.8;  // 0.2 → 1.0
    const gg = 0.5 - heatT * 0.3;  // 0.5 → 0.2
    const gb = 1.0 - heatT * 0.8;  // 1.0 → 0.2
    groundMatL.color.setRGB(gr, gg, gb);
    groundMatR.color.setRGB(gr, gg, gb);
  }

  }

// ── Nitrous Exhaust Trail (enhanced: 50 particles, color gradient, dual emission) ──

const NITRO_TRAIL_POOL = 50;
interface NitroParticle {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
}
let nitroTrailPool: THREE.Mesh[] = [];
const activeNitroTrail: NitroParticle[] = [];
let nitroTrailScene: THREE.Scene | null = null;

export function initNitroTrail(scene: THREE.Scene) {
  nitroTrailScene = scene;
  const geo = new THREE.SphereGeometry(0.12, 6, 4);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  nitroTrailPool = [];
  for (let i = 0; i < NITRO_TRAIL_POOL; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.visible = false;
    scene.add(m);
    nitroTrailPool.push(m);
  }
}

let nitroTrailIdx = 0;

/**
 * Spawn nitrous trail fire particles from both exhaust pipes.
 * Call every frame while nitrous is active.
 */
export function spawnNitroTrail(
  carPos: THREE.Vector3,
  heading: number,
  speed: number,
) {
  if (!nitroTrailScene || nitroTrailPool.length === 0) return;

  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  const exhaust = 2.4;
  const sideOffset = 0.4;

  // Spawn from both exhaust pipes (3 particles per frame for dense trail)
  for (let pipe = -1; pipe <= 1; pipe += 2) {
    const count = speed > 30 ? 2 : 1; // More particles at high speed
    for (let i = 0; i < count; i++) {
      const mesh = nitroTrailPool[nitroTrailIdx % NITRO_TRAIL_POOL];
      nitroTrailIdx++;

      const spread = (Math.random() - 0.5) * 0.15;
      mesh.position.set(
        carPos.x - sinH * exhaust + cosH * (sideOffset * pipe + spread),
        carPos.y + 0.4 + Math.random() * 0.15,
        carPos.z - cosH * exhaust - sinH * (sideOffset * pipe + spread),
      );
      mesh.scale.setScalar(0.6 + Math.random() * 0.6);
      mesh.visible = true;

      const maxLife = 0.25 + Math.random() * 0.35;
      // Velocity inherits from car speed for longer streaks at high speed
      const speedFactor = Math.max(0.2, speed * 0.01);
      activeNitroTrail.push({
        mesh,
        vx: -sinH * (-speed * 0.25 * speedFactor) + (Math.random() - 0.5) * 1.5,
        vy: 1.2 + Math.random() * 1.5,
        vz: -cosH * (-speed * 0.25 * speedFactor) + (Math.random() - 0.5) * 1.5,
        life: maxLife,
        maxLife,
      });
    }
  }
}

export function updateNitroTrail(dt: number) {
  let j = 0;
  while (j < activeNitroTrail.length) {
    const p = activeNitroTrail[j];
    p.life -= dt;
    if (p.life <= 0) {
      p.mesh.visible = false;
      activeNitroTrail[j] = activeNitroTrail[activeNitroTrail.length - 1];
      activeNitroTrail.pop();
      continue;
    }

    // Physics: drag + slight gravity
    p.vx *= 0.94;
    p.vy -= 2.5 * dt;
    p.vz *= 0.94;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;

    // Size-over-lifetime: grows then shrinks
    const t = p.life / p.maxLife;
    const sizeCurve = t > 0.7 ? (1 - t) / 0.3 : t / 0.7; // ramp up then sustain
    p.mesh.scale.setScalar(sizeCurve * 0.9);

    // Color-over-lifetime: white → cyan → blue → purple → transparent
    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = t * 0.85;
    if (t > 0.75) {
      // White core
      mat.color.setRGB(1, 1, 1);
    } else if (t > 0.5) {
      // Cyan
      const f = (t - 0.5) / 0.25;
      mat.color.setRGB(0.3 + f * 0.7, 0.8 + f * 0.2, 1);
    } else if (t > 0.25) {
      // Blue
      const f = (t - 0.25) / 0.25;
      mat.color.setRGB(0.2 + f * 0.1, 0.4 + f * 0.4, 1);
    } else {
      // Purple → fade
      const f = t / 0.25;
      mat.color.setRGB(0.5 + (1 - f) * 0.1, 0.2 * f, 0.7 + f * 0.3);
    }

    j++;
  }
}

// ── Nitrous Activation Shockwave — Dual-Ring + Screen Flash ──

let shockwaveInner: THREE.Mesh | null = null;
let shockwaveOuter: THREE.Mesh | null = null;
let shockwaveLife = 0;
const SHOCKWAVE_DURATION = 0.4;
let shockwaveScene: THREE.Scene | null = null;

// Nitro activation screen flash
let nitroFlashDiv: HTMLDivElement | null = null;
let nitroFlashLife = 0;
const NITRO_FLASH_DURATION = 0.2;

export function initBoostShockwave(scene: THREE.Scene) {
  shockwaveScene = scene;

  // Inner ring: tight, bright cyan, fast expand
  const innerGeo = new THREE.TorusGeometry(1, 0.06, 8, 32);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0x66ccff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  shockwaveInner = new THREE.Mesh(innerGeo, innerMat);
  shockwaveInner.rotation.x = -Math.PI / 2;
  shockwaveInner.visible = false;
  scene.add(shockwaveInner);

  // Outer ring: wider, softer purple, slower expand
  const outerGeo = new THREE.TorusGeometry(1, 0.04, 8, 32);
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0x8844cc,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  shockwaveOuter = new THREE.Mesh(outerGeo, outerMat);
  shockwaveOuter.rotation.x = -Math.PI / 2;
  shockwaveOuter.visible = false;
  scene.add(shockwaveOuter);
}

/** Initialize the nitro flash overlay. Call once during setup. */
export function initNitroFlash(container: HTMLElement) {
  nitroFlashDiv = document.createElement('div');
  nitroFlashDiv.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    pointer-events:none;z-index:15;opacity:0;
    background:radial-gradient(circle at 50% 60%, rgba(255,255,255,0.8), rgba(80,180,255,0.3) 60%, transparent 100%);
    transition:opacity 0.05s;
  `;
  container.appendChild(nitroFlashDiv);
}

/** Trigger one-shot shockwave + screen flash. Call on nitrous activation only. */
export function triggerBoostShockwave(carPos: THREE.Vector3, heading: number) {
  const sx = carPos.x - Math.sin(heading) * 1.5;
  const sy = carPos.y + 0.3;
  const sz = carPos.z - Math.cos(heading) * 1.5;

  if (shockwaveInner) {
    shockwaveInner.position.set(sx, sy, sz);
    shockwaveInner.visible = true;
    shockwaveInner.scale.setScalar(0.1);
  }
  if (shockwaveOuter) {
    shockwaveOuter.position.set(sx, sy, sz);
    shockwaveOuter.visible = true;
    shockwaveOuter.scale.setScalar(0.05);
  }
  shockwaveLife = SHOCKWAVE_DURATION;

  // Trigger screen flash
  nitroFlashLife = NITRO_FLASH_DURATION;
  if (nitroFlashDiv) nitroFlashDiv.style.opacity = '0.7';
}

export function updateBoostShockwave(dt: number) {
  // Update dual-ring shockwave
  if (shockwaveLife > 0) {
    shockwaveLife -= dt;
    if (shockwaveLife <= 0) {
      if (shockwaveInner) shockwaveInner.visible = false;
      if (shockwaveOuter) shockwaveOuter.visible = false;
    } else {
      const t = 1 - shockwaveLife / SHOCKWAVE_DURATION; // 0→1

      // Inner ring: fast ease-out expansion
      if (shockwaveInner) {
        const innerScale = t * t * 4.0;
        shockwaveInner.scale.setScalar(innerScale);
        const innerMat = shockwaveInner.material as THREE.MeshBasicMaterial;
        innerMat.opacity = (1 - t) * 0.8;
        innerMat.color.setRGB(0.4 + (1 - t) * 0.6, 0.8 + (1 - t) * 0.2, 1);
      }

      // Outer ring: slower, staggered expansion (starts at t=0.15)
      if (shockwaveOuter) {
        const outerT = Math.max(0, (t - 0.15) / 0.85);
        const outerScale = Math.pow(outerT, 1.5) * 6.0;
        shockwaveOuter.scale.setScalar(outerScale);
        const outerMat = shockwaveOuter.material as THREE.MeshBasicMaterial;
        outerMat.opacity = (1 - outerT) * 0.5;
        // Color: purple → blue fade
        outerMat.color.setRGB(0.5 + (1 - outerT) * 0.2, 0.2 + outerT * 0.3, 0.8 + (1 - outerT) * 0.2);
      }
    }
  }

  // Update screen flash (CSS-driven fade)
  if (nitroFlashLife > 0) {
    nitroFlashLife -= dt;
    if (nitroFlashLife <= 0 && nitroFlashDiv) {
      nitroFlashDiv.style.opacity = '0';
    } else if (nitroFlashDiv) {
      // Rapid fade: exponential decay
      const flashT = nitroFlashLife / NITRO_FLASH_DURATION;
      nitroFlashDiv.style.opacity = (flashT * flashT * 0.7).toString();
    }
  }
}


/** Cleanup all boost/nitro VFX. Called by destroyVFX(). */
export function destroyBoostVFX() {
  for (const mesh of [boostFlameL, boostFlameR, boostGlowL, boostGlowR, boostGroundL, boostGroundR]) {
    if (mesh) {
      mesh.parent?.remove(mesh);
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
  }
  boostFlameL = null; boostFlameR = null;
  boostGlowL = null; boostGlowR = null;
  boostGroundL = null; boostGroundR = null;
  boostFlameScene = null;

  for (const sw of [shockwaveInner, shockwaveOuter]) {
    if (sw) { sw.parent?.remove(sw); sw.geometry?.dispose(); (sw.material as THREE.Material)?.dispose(); }
  }
  shockwaveInner = null; shockwaveOuter = null;
  shockwaveLife = 0; shockwaveScene = null;

  nitroFlashLife = 0;
  if (nitroFlashDiv) { nitroFlashDiv.remove(); nitroFlashDiv = null; }

  for (const p of activeNitroTrail) p.mesh.visible = false;
  activeNitroTrail.length = 0;
  if (nitroTrailScene) {
    for (const m of nitroTrailPool) { nitroTrailScene.remove(m); m.geometry?.dispose(); (m.material as THREE.Material)?.dispose(); }
  }
  nitroTrailPool = []; nitroTrailIdx = 0; nitroTrailScene = null;
}
