/* ── Hood Racer — VFX (Particles & Effects) ── */

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, float, vec4, mul, max, sub, clamp, mix, uniform as tslUniform } from 'three/tsl';
import { spawnGPUSparks, spawnGPUBackfire } from './gpu-particles';

// ── Tire Smoke Pool ──
const SMOKE_POOL_SIZE = 60;
const smokePool: THREE.Mesh[] = [];
let smokeIdx = 0;
let smokeScene: THREE.Scene | null = null;

export function initVFX(scene: THREE.Scene) {
  smokeScene = scene;

  const smokeGeo = new THREE.SphereGeometry(0.4, 6, 4);
  const smokeMat = new THREE.MeshBasicMaterial({
    color: 0xcccccc,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  for (let i = 0; i < SMOKE_POOL_SIZE; i++) {
    const mesh = new THREE.Mesh(smokeGeo, smokeMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    smokePool.push(mesh);
  }
}

interface SmokeParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

const activeSmoke: SmokeParticle[] = [];

const SMOKE_VEL_POOL_SIZE = 30;
const smokeVelPool: THREE.Vector3[] = [];
for (let i = 0; i < SMOKE_VEL_POOL_SIZE; i++) smokeVelPool.push(new THREE.Vector3());
let smokeVelIdx = 0;

export function spawnTireSmoke(pos: THREE.Vector3, driftIntensity: number, isNitroActive = false) {
  if (!smokeScene || driftIntensity < 0.15) return;

  const count = Math.floor(driftIntensity * 3);
  for (let i = 0; i < count; i++) {
    const mesh = smokePool[smokeIdx % SMOKE_POOL_SIZE];
    smokeIdx++;

    mesh.position.copy(pos);
    mesh.position.x += (Math.random() - 0.5) * 0.5;
    mesh.position.y = pos.y + 0.1;
    mesh.scale.setScalar(0.5 + Math.random() * 0.5);
    mesh.visible = true;

    const mat = mesh.material as THREE.MeshBasicMaterial;
    // During nitro: cyan-tinted smoke with higher opacity
    if (isNitroActive) {
      mat.opacity = 0.35 + driftIntensity * 0.25;
      mat.color.setRGB(0.4 + Math.random() * 0.2, 0.7 + Math.random() * 0.15, 1);
    } else {
      mat.opacity = 0.25 + driftIntensity * 0.2;
      mat.color.setHex(0xcccccc);
    }

    const vel = smokeVelPool[smokeVelIdx % SMOKE_VEL_POOL_SIZE];
    smokeVelIdx++;
    vel.set(
      (Math.random() - 0.5) * 1.5,
      0.4 + Math.random() * 0.6,
      (Math.random() - 0.5) * 1.5,
    );

    const life = isNitroActive ? 1.0 + Math.random() * 0.5 : 0.8 + Math.random() * 0.6;
    activeSmoke.push({ mesh, velocity: vel, life, maxLife: life });
  }
}

export function updateVFX(dt: number) {
  // Swap-and-pop removal avoids O(N) splice shifts
  let i = 0;
  while (i < activeSmoke.length) {
    const p = activeSmoke[i];
    p.life -= dt;

    if (p.life <= 0) {
      p.mesh.visible = false;
      activeSmoke[i] = activeSmoke[activeSmoke.length - 1];
      activeSmoke.pop();
      continue;
    }

    p.mesh.position.addScaledVector(p.velocity, dt);
    p.velocity.y *= 0.98;

    const lifeFrac = p.life / p.maxLife;
    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = lifeFrac * 0.3;
    p.mesh.scale.setScalar(1.5 - lifeFrac * 0.8);
    i++;
  }

  // Metal debris (tumble, gravity, bounce)
  updateDebris(dt);
}

// ── Speed Lines (screen-space, canvas 2D overlay) ──
let speedLinesCanvas: HTMLCanvasElement | null = null;
let speedLinesCtx: CanvasRenderingContext2D | null = null;
let speedLinesResizeHandler: (() => void) | null = null;

export function initSpeedLines(container: HTMLElement) {
  // Clean up any existing handler first (safety against re-init without destroy)
  if (speedLinesResizeHandler) {
    window.removeEventListener('resize', speedLinesResizeHandler);
  }
  if (speedLinesCanvas) speedLinesCanvas.remove();

  speedLinesCanvas = document.createElement('canvas');
  speedLinesCanvas.style.cssText = `
    position: absolute; inset: 0; pointer-events: none;
    z-index: 5; opacity: 0; transition: opacity 0.3s;
  `;
  speedLinesCanvas.width = window.innerWidth;
  speedLinesCanvas.height = window.innerHeight;
  container.appendChild(speedLinesCanvas);
  speedLinesCtx = speedLinesCanvas.getContext('2d')!;

  speedLinesResizeHandler = () => {
    if (speedLinesCanvas) {
      speedLinesCanvas.width = window.innerWidth;
      speedLinesCanvas.height = window.innerHeight;
    }
  };
  window.addEventListener('resize', speedLinesResizeHandler);
}

export function updateSpeedLines(speedRatio: number, isNitroActive = false) {
  if (!speedLinesCanvas || !speedLinesCtx) return;

  // Fade in/out based on speed (lower threshold during nitrous)
  const threshold = isNitroActive ? 0.3 : 0.7;
  const fadeRange = isNitroActive ? 0.2 : 0.3;
  const opacity = speedRatio > threshold ? Math.min(1, (speedRatio - threshold) / fadeRange) : 0;
  speedLinesCanvas.style.opacity = opacity.toString();

  // Skip canvas work when invisible
  if (opacity <= 0) return;

  const ctx = speedLinesCtx;
  const w = speedLinesCanvas.width;
  const h = speedLinesCanvas.height;
  const cx = w / 2;
  const cy = h / 2;

  ctx.clearRect(0, 0, w, h);

  // During nitrous: 2× density, cyan tint, 1.5× length, higher opacity
  const numLines = isNitroActive ? 60 : 30;
  const lineAlpha = isNitroActive ? 0.14 : 0.08;
  const lengthMult = isNitroActive ? 1.5 : 1.0;
  ctx.strokeStyle = isNitroActive
    ? `rgba(100, 200, 255, ${lineAlpha})`
    : `rgba(255, 255, 255, ${lineAlpha})`;
  ctx.lineWidth = isNitroActive ? 1.5 : 1;

  for (let i = 0; i < numLines; i++) {
    const angle = (i / numLines) * Math.PI * 2 + performance.now() * 0.0005;
    // During nitrous: wider inner radius (tunnel vision — clear center)
    const baseInner = isNitroActive ? 60 : 80;
    const innerR = baseInner + Math.random() * 40;
    const outerR = innerR + (80 + Math.random() * 160) * lengthMult;

    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
    ctx.stroke();
  }
}

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
let boostLightL: THREE.SpotLight | null = null;
let boostLightR: THREE.SpotLight | null = null;
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

  // ── SpotLights aimed 45° downward for directional road illumination ──
  boostLightL = new THREE.SpotLight(0x3388ff, 0, 8, Math.PI / 5, 0.5, 2);
  boostLightR = new THREE.SpotLight(0x3388ff, 0, 8, Math.PI / 5, 0.5, 2);
  // Point spots downward — target will be repositioned each frame
  boostLightL.target.position.set(0, -1, 0);
  boostLightR.target.position.set(0, -1, 0);
  scene.add(boostLightL);
  scene.add(boostLightL.target);
  scene.add(boostLightR);
  scene.add(boostLightR.target);

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
  if (boostLightL) boostLightL.intensity = vis ? 5 : 0;
  if (boostLightR) boostLightR.intensity = vis ? 5 : 0;
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
  boostBurstScale += (1.0 - boostBurstScale) * 0.15; // decay toward 1.0 (~0.2s at 60fps)
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

  // ── SpotLights — aimed downward, color shifts with heat ──
  const heatT = Math.min(engineHeat / 100, 1);
  const lr = 0.2 + heatT * 0.8;
  const lg = 0.5 - heatT * 0.3;
  const lb = 1.0 - heatT * 0.8;
  if (boostLightL) {
    boostLightL.position.set(lx, ly + 0.3, lz);
    boostLightL.target.position.set(lx, carPos.y - 0.5, lz);
    boostLightL.color.setRGB(lr, lg, lb);
    boostLightL.intensity = (5 + engineHeat * 0.05) * coreFlicker;
  }
  if (boostLightR) {
    boostLightR.position.set(rx, ry + 0.3, rz);
    boostLightR.target.position.set(rx, carPos.y - 0.5, rz);
    boostLightR.color.setRGB(lr, lg, lb);
    boostLightR.intensity = (5 + engineHeat * 0.05) * coreFlicker;
  }
}

// ── Skid Marks (road-surface quads placed during drift) ──
const SKID_MAX_QUADS = 200;
const SKID_VERTS = SKID_MAX_QUADS * 6; // 2 triangles per quad = 6 verts
let skidMesh: THREE.Mesh | null = null;
let skidPositions: Float32Array | null = null;
let skidAlphas: Float32Array | null = null;
let skidAges: Float32Array | null = null; // per-vertex spawn timestamp
let skidIdx = 0;
let skidCount = 0;
const _skidRight = new THREE.Vector3();

// TSL uniform for current time — updated each frame via updateSkidGlowTime()
const uSkidTime = tslUniform(0.0);

/** Call once per frame before render to drive skid burn glow decay. */
export function updateSkidGlowTime() {
  uSkidTime.value = performance.now() / 1000;
}

export function initSkidMarks(scene: THREE.Scene) {
  const geo = new THREE.BufferGeometry();
  skidPositions = new Float32Array(SKID_VERTS * 3);
  skidAlphas = new Float32Array(SKID_VERTS);
  skidAges = new Float32Array(SKID_VERTS);
  geo.setAttribute('position', new THREE.BufferAttribute(skidPositions, 3));
  geo.setAttribute('alpha', new THREE.BufferAttribute(skidAlphas, 1));
  geo.setAttribute('spawnTime', new THREE.BufferAttribute(skidAges, 1));
  geo.setDrawRange(0, 0);

  const skidMat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  const vertAlpha = float(attribute('alpha'));

  // Burn glow: compute age from spawnTime, fade orange→dark over 0.8s
  const spawnT = float(attribute('spawnTime'));
  const age = max(sub(uSkidTime, spawnT), float(0));
  const glowFrac = clamp(sub(float(1), age.div(0.8)), 0, 1); // 1→0 over 0.8s
  const glowR = mix(float(0.08), float(1.0), glowFrac);
  const glowG = mix(float(0.08), float(0.45), glowFrac);
  const glowB = float(0.08);
  skidMat.colorNode = vec4(glowR, glowG, glowB, float(1));
  skidMat.opacityNode = mul(vertAlpha, 0.6);

  skidMesh = new THREE.Mesh(geo, skidMat);
  skidMesh.frustumCulled = false;
  scene.add(skidMesh);
}

export function addSkidQuad(
  posL: THREE.Vector3, posR: THREE.Vector3,
  prevL: THREE.Vector3, prevR: THREE.Vector3,
  alpha: number,
) {
  if (!skidPositions || !skidAlphas) return;

  const base = (skidIdx % SKID_MAX_QUADS) * 18; // 6 verts × 3 components
  const aBase = (skidIdx % SKID_MAX_QUADS) * 6;

  // Triangle 1: prevL, prevR, posL
  skidPositions[base]     = prevL.x; skidPositions[base + 1] = prevL.y + 0.02; skidPositions[base + 2] = prevL.z;
  skidPositions[base + 3] = prevR.x; skidPositions[base + 4] = prevR.y + 0.02; skidPositions[base + 5] = prevR.z;
  skidPositions[base + 6] = posL.x;  skidPositions[base + 7] = posL.y + 0.02;  skidPositions[base + 8] = posL.z;
  // Triangle 2: prevR, posR, posL
  skidPositions[base + 9]  = prevR.x; skidPositions[base + 10] = prevR.y + 0.02; skidPositions[base + 11] = prevR.z;
  skidPositions[base + 12] = posR.x;  skidPositions[base + 13] = posR.y + 0.02;  skidPositions[base + 14] = posR.z;
  skidPositions[base + 15] = posL.x;  skidPositions[base + 16] = posL.y + 0.02;  skidPositions[base + 17] = posL.z;

  const a = Math.min(alpha, 1);
  for (let i = 0; i < 6; i++) skidAlphas[aBase + i] = a;

  // Record spawn timestamp for burn glow decay
  const now = performance.now() / 1000;
  for (let i = 0; i < 6; i++) skidAges![aBase + i] = now;

  skidIdx++;
  skidCount = Math.min(skidCount + 1, SKID_MAX_QUADS);

  const geo = skidMesh!.geometry;
  geo.setDrawRange(0, skidCount * 6);
  (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  (geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  (geo.attributes.spawnTime as THREE.BufferAttribute).needsUpdate = true;
}

const _skidPrevL = new THREE.Vector3();
const _skidPrevR = new THREE.Vector3();
const _skidCurL = new THREE.Vector3();
const _skidCurR = new THREE.Vector3();
let _skidHasPrev = false;

export function updateSkidMarks(
  carPos: THREE.Vector3, heading: number,
  driftIntensity: number, carY: number,
) {
  if (!skidMesh || driftIntensity < 0.15) {
    _skidHasPrev = false;
    return;
  }

  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  const rearX = carPos.x - sinH * 1.3;
  const rearZ = carPos.z - cosH * 1.3;

  _skidRight.set(cosH * 0.7, 0, -sinH * 0.7);
  _skidCurL.set(rearX - _skidRight.x, carY, rearZ - _skidRight.z);
  _skidCurR.set(rearX + _skidRight.x, carY, rearZ + _skidRight.z);

  if (_skidHasPrev) {
    addSkidQuad(_skidCurL, _skidCurR, _skidPrevL, _skidPrevR, driftIntensity);
  }

  _skidPrevL.copy(_skidCurL);
  _skidPrevR.copy(_skidCurR);
  _skidHasPrev = true;
}

export function destroySkidMarks() {
  if (skidMesh) {
    skidMesh.parent?.remove(skidMesh);
    skidMesh.geometry.dispose();
    (skidMesh.material as THREE.Material).dispose();
    skidMesh = null;
  }
  skidPositions = null;
  skidAlphas = null;
  skidAges = null;
  skidIdx = 0;
  skidCount = 0;
  _skidHasPrev = false;
}

// ── Remote player name tags ──
export function createNameTag(name: string, scene: THREE.Scene): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  // Background pill
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 56, 28);
  ctx.fill();

  // Name text
  ctx.fillStyle = '#ff6a2a';
  ctx.font = 'bold 28px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.substring(0, 14), 128, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.5, 0.9, 1);
  scene.add(sprite);
  return sprite;
}

export function updateNameTag(sprite: THREE.Sprite, pos: THREE.Vector3) {
  sprite.position.set(pos.x, pos.y + 3.5, pos.z);
}

// ── Collision Sparks ──
// ── Damage Smoke ──
let damageSmokeCooldown = 0;

export function spawnDamageSmoke(pos: THREE.Vector3, intensity: number, dt = 0.016) {
  if (!smokeScene || intensity < 0.1) return;
  damageSmokeCooldown -= dt;
  if (damageSmokeCooldown > 0) return;
  damageSmokeCooldown = 0.15 - intensity * 0.1;

  if (smokePool.length === 0) return;
  const mesh = smokePool[smokeIdx % SMOKE_POOL_SIZE];
  smokeIdx++;
  mesh.position.copy(pos);
  mesh.position.y += 1.5;
  mesh.position.x += (Math.random() - 0.5) * 0.8;
  mesh.scale.setScalar(0.6 + intensity * 0.5);
  mesh.visible = true;
  const mat = mesh.material as THREE.MeshBasicMaterial;
  mat.opacity = 0.3;
  mat.color.setHex(0x333333);

  const vel = smokeVelPool[smokeVelIdx % SMOKE_VEL_POOL_SIZE];
  smokeVelIdx++;
  vel.set((Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5);
  activeSmoke.push({ mesh, velocity: vel, life: 1.2, maxLife: 1.2 });
}

// ── Damage Flames (persistent fire on critically damaged zones) ──
let flameCooldown = 0;

export function spawnFlameParticle(pos: THREE.Vector3, intensity: number, dt = 0.016) {
  if (!smokeScene || intensity < 0.1) return;
  flameCooldown -= dt;
  if (flameCooldown > 0) return;
  flameCooldown = 0.03; // ~33 particles/sec at full intensity

  if (smokePool.length === 0) return;
  const count = Math.ceil(intensity * 2);
  for (let n = 0; n < count; n++) {
    const mesh = smokePool[smokeIdx % SMOKE_POOL_SIZE];
    smokeIdx++;
    mesh.position.copy(pos);
    mesh.position.x += (Math.random() - 0.5) * 0.6;
    mesh.position.y += 0.3 + Math.random() * 0.3;
    mesh.position.z += (Math.random() - 0.5) * 0.6;
    mesh.scale.setScalar(0.3 + intensity * 0.3);
    mesh.visible = true;

    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.7;
    // Cycle orange to yellow
    const r = 1.0;
    const g = 0.2 + Math.random() * 0.6;
    mat.color.setRGB(r, g, 0);

    const vel = smokeVelPool[smokeVelIdx % SMOKE_VEL_POOL_SIZE];
    smokeVelIdx++;
    vel.set(
      (Math.random() - 0.5) * 1.5,
      1.5 + Math.random() * 2.0,
      (Math.random() - 0.5) * 1.5,
    );
    activeSmoke.push({ mesh, velocity: vel, life: 0.3 + Math.random() * 0.2, maxLife: 0.5 });
  }
}

// ── Metal Debris (tumbling rectangular shards on heavy impacts) ──

const DEBRIS_POOL_SIZE = 30;
const debrisPool: THREE.Mesh[] = [];
let debrisIdx = 0;

interface DebrisParticle {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  ax: number; ay: number; az: number;  // angular velocity
  life: number;
  bounced: boolean;
  active: boolean;
}

// Pre-allocated debris state pool (avoids per-spawn object allocation)
const debrisStates: DebrisParticle[] = [];
let debrisStatesReady = false;

function ensureDebrisStates() {
  if (debrisStatesReady) return;
  for (let i = 0; i < DEBRIS_POOL_SIZE; i++) {
    debrisStates.push({
      mesh: null!,
      vx: 0, vy: 0, vz: 0,
      ax: 0, ay: 0, az: 0,
      life: 0,
      bounced: false,
      active: false,
    });
  }
  debrisStatesReady = true;
}

function ensureDebrisPool() {
  if (debrisPool.length > 0 || !smokeScene) return;
  const geo = new THREE.BoxGeometry(0.12, 0.04, 0.08);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x999999,
    roughness: 0.4,
    metalness: 0.8,
    transparent: true,
    opacity: 1,
  });
  for (let i = 0; i < DEBRIS_POOL_SIZE; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.visible = false;
    smokeScene.add(m);
    debrisPool.push(m);
  }
  ensureDebrisStates();
}

/** Eagerly initialize debris pool at race start (avoids lazy-init stall on first explosion). */
export function warmupVFX() {
  ensureDebrisPool();
}

/** Spawn metal debris particles at impact point. force controls count + speed. */
export function spawnDebris(pos: THREE.Vector3, force: number, carVelX = 0, carVelZ = 0) {
  if (!smokeScene) return;
  ensureDebrisPool();

  const count = Math.min(Math.floor(force * 0.3), 8);
  for (let i = 0; i < count; i++) {
    const meshSlot = debrisIdx % DEBRIS_POOL_SIZE;
    const mesh = debrisPool[meshSlot];
    const state = debrisStates[meshSlot];
    debrisIdx++;
    mesh.position.copy(pos);
    mesh.position.x += (Math.random() - 0.5) * 0.5;
    mesh.position.y += 0.3 + Math.random() * 0.3;
    mesh.position.z += (Math.random() - 0.5) * 0.5;
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    mesh.scale.set(0.5 + Math.random(), 0.5 + Math.random(), 0.5 + Math.random());
    mesh.visible = true;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.opacity = 1;

    // Inherit car velocity + random burst
    const speed = 3 + Math.random() * force * 0.5;
    const theta = Math.random() * Math.PI * 2;
    // Reuse pre-allocated state (zero allocation)
    state.mesh = mesh;
    state.vx = carVelX * 0.3 + Math.cos(theta) * speed;
    state.vy = 2 + Math.random() * 4;
    state.vz = carVelZ * 0.3 + Math.sin(theta) * speed;
    state.ax = (Math.random() - 0.5) * 15;
    state.ay = (Math.random() - 0.5) * 15;
    state.az = (Math.random() - 0.5) * 15;
    state.life = 2.0 + Math.random() * 1.5;
    state.bounced = false;
    state.active = true;
  }
}

/** Update debris physics (gravity, ground bounce, fade). Call in updateVFX. */
function updateDebris(dt: number) {
  for (let i = 0; i < DEBRIS_POOL_SIZE; i++) {
    const d = debrisStates[i];
    if (!d || !d.active) continue;
    d.life -= dt;
    if (d.life <= 0) {
      d.mesh.visible = false;
      d.active = false;
      continue;
    }

    // Gravity
    d.vy -= 12 * dt;

    // Position
    d.mesh.position.x += d.vx * dt;
    d.mesh.position.y += d.vy * dt;
    d.mesh.position.z += d.vz * dt;

    // Rotation (tumble)
    d.mesh.rotation.x += d.ax * dt;
    d.mesh.rotation.y += d.ay * dt;
    d.mesh.rotation.z += d.az * dt;

    // Ground bounce
    if (d.mesh.position.y < 0.05) {
      d.mesh.position.y = 0.05;
      d.vy = Math.abs(d.vy) * 0.3;
      d.vx *= 0.7;
      d.vz *= 0.7;
      d.ax *= 0.5;
      d.ay *= 0.5;
      d.az *= 0.5;
      d.bounced = true;
    }

    // Fade out in last 0.5s
    if (d.life < 0.5) {
      (d.mesh.material as THREE.MeshStandardMaterial).opacity = d.life * 2;
    }
  }
}

// ── Sustained Damage Zone Smoke (continuous trail from critically damaged zones) ──
let dmgSmokeCd = 0;

/**
 * Spawn continuous dark smoke from a critically damaged zone.
 * Call every frame for each zone with HP < 30%.
 * @param pos — world position of the damaged zone
 * @param severity — 0..1 (1 = zone at 0 HP)
 */
export function spawnDamageZoneSmoke(pos: THREE.Vector3, severity: number, dt: number) {
  if (!smokeScene || severity < 0.3) return;
  dmgSmokeCd -= dt;
  if (dmgSmokeCd > 0) return;
  dmgSmokeCd = 0.06; // ~16 puffs/sec

  if (smokePool.length === 0) return;
  const mesh = smokePool[smokeIdx % SMOKE_POOL_SIZE];
  smokeIdx++;
  mesh.position.copy(pos);
  mesh.position.x += (Math.random() - 0.5) * 0.4;
  mesh.position.y += 0.3;
  mesh.position.z += (Math.random() - 0.5) * 0.4;
  mesh.scale.setScalar(0.3 + severity * 0.5);
  mesh.visible = true;

  const mat = mesh.material as THREE.MeshBasicMaterial;
  mat.opacity = 0.3 + severity * 0.2;
  // Black smoke at severe damage, grey at moderate
  const grey = 0.15 + (1 - severity) * 0.2;
  mat.color.setRGB(grey, grey, grey);

  const vel = smokeVelPool[smokeVelIdx % SMOKE_VEL_POOL_SIZE];
  smokeVelIdx++;
  vel.set((Math.random() - 0.5) * 0.5, 0.5 + severity * 1.5, (Math.random() - 0.5) * 0.5);
  activeSmoke.push({ mesh, velocity: vel, life: 0.6 + severity * 0.4, maxLife: 1.0 });
}



// ── Tire Blowout VFX ──

/**
 * Spawn rubber debris particles at a blown tire position.
 * Uses the existing smoke pool with dark color for rubber chunks.
 */
export function spawnTireBlowout(pos: THREE.Vector3) {
  if (!smokeScene) return;

  // Dark rubber chunks
  for (let i = 0; i < 8; i++) {
    if (smokePool.length === 0) return;
    const mesh = smokePool[smokeIdx % SMOKE_POOL_SIZE];
    smokeIdx++;
    mesh.position.copy(pos);
    mesh.position.x += (Math.random() - 0.5) * 0.8;
    mesh.position.y += 0.2 + Math.random() * 0.3;
    mesh.position.z += (Math.random() - 0.5) * 0.8;
    mesh.scale.setScalar(0.3 + Math.random() * 0.4);
    mesh.visible = true;

    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.8;
    mat.color.setRGB(0.1, 0.1, 0.1); // Black rubber

    const vel = smokeVelPool[smokeVelIdx % SMOKE_VEL_POOL_SIZE];
    smokeVelIdx++;
    vel.set(
      (Math.random() - 0.5) * 6,
      2 + Math.random() * 4,
      (Math.random() - 0.5) * 6,
    );
    activeSmoke.push({ mesh, velocity: vel, life: 1.2, maxLife: 1.2 });
  }
}

// ── Rain Screen Droplets (canvas overlay with sliding water drops) ──

let rainDropCanvas: HTMLCanvasElement | null = null;
let rainDropCtx: CanvasRenderingContext2D | null = null;
let rainDropResizeHandler: (() => void) | null = null;

interface ScreenDroplet {
  x: number; y: number;
  speed: number;
  size: number;
  opacity: number;
  streak: number; // tail length
}
const screenDroplets: ScreenDroplet[] = [];
let rainDropActive = false;

export function initRainDroplets(container: HTMLElement) {
  rainDropCanvas = document.createElement('canvas');
  rainDropCanvas.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    pointer-events:none;z-index:11;opacity:0;
  `;
  rainDropCanvas.width = window.innerWidth;
  rainDropCanvas.height = window.innerHeight;
  container.appendChild(rainDropCanvas);
  rainDropCtx = rainDropCanvas.getContext('2d')!;
  screenDroplets.length = 0;
  rainDropActive = false;

  rainDropResizeHandler = () => {
    if (rainDropCanvas) {
      rainDropCanvas.width = window.innerWidth;
      rainDropCanvas.height = window.innerHeight;
    }
  };
  window.addEventListener('resize', rainDropResizeHandler);
}

/**
 * Update rain screen droplets. Call every frame during rain.
 * @param intensity 0 = no rain, 0.3 = light, 0.5 = heavy
 * @param dt frame delta in seconds
 */
export function updateRainDroplets(intensity: number, dt: number) {
  if (!rainDropCanvas || !rainDropCtx) return;

  if (intensity <= 0) {
    rainDropCanvas.style.opacity = '0';
    rainDropActive = false;
    screenDroplets.length = 0;
    return;
  }

  rainDropActive = true;
  rainDropCanvas.style.opacity = Math.min(intensity * 1.5, 0.7).toString();

  const ctx = rainDropCtx;
  const w = rainDropCanvas.width;
  const h = rainDropCanvas.height;
  ctx.clearRect(0, 0, w, h);

  // Spawn new droplets
  const spawnRate = intensity * 8; // drops per frame
  for (let i = 0; i < spawnRate; i++) {
    if (screenDroplets.length >= 80) break;
    screenDroplets.push({
      x: Math.random() * w,
      y: -10 - Math.random() * 30,
      speed: 150 + Math.random() * 250,
      size: 1.5 + Math.random() * 3,
      opacity: 0.3 + Math.random() * 0.5,
      streak: 8 + Math.random() * 20,
    });
  }

  // Update and draw droplets
  let j = 0;
  while (j < screenDroplets.length) {
    const d = screenDroplets[j];
    d.y += d.speed * dt;

    // Slight horizontal wobble
    d.x += (Math.random() - 0.5) * 0.5;

    if (d.y > h + 20) {
      screenDroplets[j] = screenDroplets[screenDroplets.length - 1];
      screenDroplets.pop();
      continue;
    }

    // Draw droplet body (circular highlight)
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, d.size * 0.6, d.size, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180, 210, 255, ${d.opacity * 0.6})`;
    ctx.fill();

    // Draw streak (water trail behind droplet)
    const grad = ctx.createLinearGradient(d.x, d.y - d.streak, d.x, d.y);
    grad.addColorStop(0, `rgba(180, 210, 255, 0)`);
    grad.addColorStop(1, `rgba(180, 210, 255, ${d.opacity * 0.3})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = d.size * 0.4;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y - d.streak);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();

    // Highlight dot (refraction point)
    ctx.beginPath();
    ctx.arc(d.x - d.size * 0.2, d.y - d.size * 0.2, d.size * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${d.opacity * 0.5})`;
    ctx.fill();

    j++;
  }
}

// ── Impact Flash Overlay (full-screen white flash on heavy collisions) ──

let impactFlashDiv: HTMLDivElement | null = null;
let impactFlashIntensity = 0;

export function initImpactFlash(container: HTMLElement) {
  impactFlashDiv = document.createElement('div');
  impactFlashDiv.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    pointer-events:none;z-index:13;
    background:white;opacity:0;
    transition:opacity 0.05s ease-out;
  `;
  container.appendChild(impactFlashDiv);
  impactFlashIntensity = 0;
}

/**
 * Trigger a screen flash on heavy impact.
 * @param force — impact force (0..1)
 */
export function triggerImpactFlash(force: number) {
  if (!impactFlashDiv || force < 0.3) return;
  impactFlashIntensity = Math.min(force, 0.8);
  impactFlashDiv.style.opacity = impactFlashIntensity.toString();
}

/** Call each frame to decay the flash. */
export function updateImpactFlash(dt: number) {
  if (!impactFlashDiv || impactFlashIntensity <= 0) return;
  impactFlashIntensity *= Math.exp(-15 * dt); // fast exponential decay
  if (impactFlashIntensity < 0.01) impactFlashIntensity = 0;
  impactFlashDiv.style.opacity = impactFlashIntensity.toString();
}

// ── Neon Underglow (colored PointLight under car body) ──

const UNDERGLOW_COLORS = [
  0x00aaff, // Blue
  0xff00aa, // Pink
  0x00ffaa, // Cyan-green
  0xff6600, // Orange
  0xaa00ff, // Purple
  0xff0044, // Red
];

export function createUnderglow(carGroup: THREE.Group, colorIndex: number): THREE.PointLight {
  const color = UNDERGLOW_COLORS[colorIndex % UNDERGLOW_COLORS.length];
  const light = new THREE.PointLight(color, 2.5, 8, 2);
  light.position.set(0, -0.3, 0); // Under the car body
  carGroup.add(light);
  return light;
}

/**
 * Update underglow pulsing effect.
 * @param light — the PointLight from createUnderglow
 * @param speed — current car speed (for intensity variation)
 * @param time — current timestamp in seconds
 * @param isNitroActive — whether nitrous is currently burning
 */
export function updateUnderglow(light: THREE.PointLight, speed: number, time: number, isNitroActive = false) {
  const speedFactor = Math.min(Math.abs(speed) / 40, 1);

  if (isNitroActive) {
    // Nitrous mode: shift to bright cyan-blue, 3× intensity, 8Hz rapid pulse
    const pulse = 0.8 + Math.sin(time * 8) * 0.15 + Math.sin(time * 13) * 0.05;
    light.intensity = (4.5 + speedFactor * 3.0) * pulse;
    light.distance = 10 + speedFactor * 5;
    light.color.lerp(new THREE.Color(0x44aaff), 0.15); // Smooth shift to cyan
  } else {
    // Normal mode: gentle pulse
    const pulse = 0.7 + Math.sin(time * 3) * 0.15 + Math.sin(time * 7.3) * 0.08;
    light.intensity = (1.5 + speedFactor * 2.0) * pulse;
    light.distance = 6 + speedFactor * 4;
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

// ── Continuous Rim Sparks (persistent sparking on blown tires) ──

const RIM_SPARK_POOL = 20;
interface RimSpark {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number;
}
let rimSparkPool: THREE.Mesh[] = [];
const activeRimSparks: RimSpark[] = [];
let rimSparkScene: THREE.Scene | null = null;

export function initRimSparks(scene: THREE.Scene) {
  rimSparkScene = scene;
  const geo = new THREE.SphereGeometry(0.04, 4, 3);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffaa44,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
  });
  rimSparkPool = [];
  for (let i = 0; i < RIM_SPARK_POOL; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.visible = false;
    scene.add(m);
    rimSparkPool.push(m);
  }
}

let rimSparkIdx = 0;

/**
 * Spawn continuous rim sparks at a blown tire position.
 * Call every frame for each blown tire while car is moving.
 */
export function spawnRimSparks(pos: THREE.Vector3, speed: number) {
  if (!rimSparkScene || rimSparkPool.length === 0 || Math.abs(speed) < 3) return;

  // Spawn 2-3 sparks per frame based on speed
  const count = Math.abs(speed) > 15 ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const mesh = rimSparkPool[rimSparkIdx % RIM_SPARK_POOL];
    rimSparkIdx++;

    mesh.position.copy(pos);
    mesh.position.y += 0.1;
    mesh.scale.setScalar(0.6 + Math.random() * 0.8);
    mesh.visible = true;

    activeRimSparks.push({
      mesh,
      vx: (Math.random() - 0.5) * 6,
      vy: 1 + Math.random() * 4,
      vz: (Math.random() - 0.5) * 6,
      life: 0.15 + Math.random() * 0.2,
    });
  }
}

export function updateRimSparks(dt: number) {
  let j = 0;
  while (j < activeRimSparks.length) {
    const s = activeRimSparks[j];
    s.life -= dt;
    if (s.life <= 0) {
      s.mesh.visible = false;
      activeRimSparks[j] = activeRimSparks[activeRimSparks.length - 1];
      activeRimSparks.pop();
      continue;
    }

    // Physics: gravity + bounce
    s.vy -= 15 * dt;
    s.mesh.position.x += s.vx * dt;
    s.mesh.position.y += s.vy * dt;
    s.mesh.position.z += s.vz * dt;

    // Bounce off ground
    if (s.mesh.position.y < 0.05) {
      s.mesh.position.y = 0.05;
      s.vy = Math.abs(s.vy) * 0.3;
    }

    const mat = s.mesh.material as THREE.MeshBasicMaterial;
    const t = s.life / 0.35;
    mat.opacity = t;
    // Orange → red as sparks cool
    mat.color.setRGB(1, 0.4 * t + 0.2, 0.1 * t);

    j++;
  }
}

// ── Exhaust Backfire Flames (burst from exhaust on decel/gear shift) ──

const BACKFIRE_POOL = 12;
interface BackfireFlame {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
}
let backfirePool: THREE.Mesh[] = [];
const activeBackfires: BackfireFlame[] = [];
let backfireScene: THREE.Scene | null = null;

export function initBackfire(scene: THREE.Scene) {
  backfireScene = scene;
  const geo = new THREE.SphereGeometry(0.15, 6, 4);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff4400,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  backfirePool = [];
  for (let i = 0; i < BACKFIRE_POOL; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.visible = false;
    scene.add(m);
    backfirePool.push(m);
  }
}

let backfireIdx = 0;

/**
 * Trigger an exhaust backfire burst.
 * Call on gear shift or deceleration events.
 */
export function spawnBackfire(carPos: THREE.Vector3, heading: number) {
  if (!backfireScene || backfirePool.length === 0) return;

  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);

  // Spawn 4-6 flame particles from the exhaust
  const count = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const mesh = backfirePool[backfireIdx % BACKFIRE_POOL];
    backfireIdx++;

    const spread = (Math.random() - 0.5) * 0.3;
    mesh.position.set(
      carPos.x - sinH * 2.5 + cosH * spread,
      carPos.y + 0.35 + Math.random() * 0.15,
      carPos.z - cosH * 2.5 - sinH * spread,
    );
    mesh.scale.setScalar(0.5 + Math.random() * 0.8);
    mesh.visible = true;

    const maxLife = 0.1 + Math.random() * 0.15;
    activeBackfires.push({
      mesh,
      vx: -sinH * (-3 + Math.random() * 4) + (Math.random() - 0.5) * 2,
      vy: 0.5 + Math.random() * 1.5,
      vz: -cosH * (-3 + Math.random() * 4) + (Math.random() - 0.5) * 2,
      life: maxLife,
      maxLife,
    });
  }
}

export function updateBackfire(dt: number) {
  let j = 0;
  while (j < activeBackfires.length) {
    const p = activeBackfires[j];
    p.life -= dt;
    if (p.life <= 0) {
      p.mesh.visible = false;
      activeBackfires[j] = activeBackfires[activeBackfires.length - 1];
      activeBackfires.pop();
      continue;
    }

    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;

    const t = p.life / p.maxLife;
    p.mesh.scale.setScalar(t * 1.2);

    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = t * 0.95;
    // Orange → blue flame tip transition
    mat.color.setRGB(1, 0.3 * t, 0.1 + (1 - t) * 0.6);

    j++;
  }
}

// ── Brake Disc Glow (temperature accumulation model) ──

let _brakeTemp = 0; // 0..1 accumulated thermal energy
const _darkRed = new THREE.Color(0x8b0000);
const _brightOrange = new THREE.Color(0xff6600);
const _brakeEmissiveColor = new THREE.Color();

/**
 * Add brake disc glow meshes to a car's body group.
 * Returns array of 4 disc materials (FL, FR, RL, RR) for per-frame intensity control.
 */
export function createBrakeDiscs(bodyGroup: THREE.Group): THREE.MeshStandardMaterial[] {
  const discGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.03, 12);
  const materials: THREE.MeshStandardMaterial[] = [];

  // Approximate wheel positions (from vehicle.ts bounding box logic)
  const positions = [
    { x: -0.6, z: 0.9 },  // FL
    { x: 0.6, z: 0.9 },   // FR
    { x: -0.6, z: -0.9 }, // RL
    { x: 0.6, z: -0.9 },  // RR
  ];

  for (const pos of positions) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      emissive: 0xff2200,
      emissiveIntensity: 0,
      roughness: 0.4,
      metalness: 0.8,
    });
    const disc = new THREE.Mesh(discGeo, mat);
    disc.rotation.z = Math.PI / 2;
    disc.position.set(pos.x, 0.22, pos.z);
    bodyGroup.add(disc);
    materials.push(mat);
  }

  _brakeTemp = 0;
  return materials;
}

/**
 * Update brake disc glow using a temperature accumulation model.
 * Heat builds with braking force × speed and decays exponentially.
 * @param discMats — array of 4 materials from createBrakeDiscs
 * @param brakeForce — 0..1 brake input
 * @param speed — current speed
 * @param dt — frame delta in seconds
 * @param maxSpeed — car's max speed for ratio computation
 * @param carPos — car position for hot spark spawning
 */
export function updateBrakeDiscs(
  discMats: THREE.MeshStandardMaterial[],
  brakeForce: number,
  speed: number,
  dt: number,
  maxSpeed: number,
  carPos?: THREE.Vector3,
) {
  const absSpeed = Math.abs(speed);
  const speedRatio = Math.min(absSpeed / Math.max(maxSpeed, 1), 1);

  // Accumulate heat: brake force × speed ratio
  if (brakeForce > 0.1 && absSpeed > 5) {
    _brakeTemp = Math.min(_brakeTemp + brakeForce * speedRatio * dt * 3, 1);
  }
  // Thermal decay (exponential cooling)
  _brakeTemp *= Math.exp(-2 * dt);
  if (_brakeTemp < 0.005) _brakeTemp = 0;

  // Emissive intensity driven by temperature
  const glowIntensity = _brakeTemp * 4.0;

  // Color ramp: dark red → bright orange based on temperature
  _brakeEmissiveColor.copy(_darkRed).lerp(_brightOrange, _brakeTemp);

  for (const mat of discMats) {
    mat.emissiveIntensity = glowIntensity;
    mat.emissive.copy(_brakeEmissiveColor);
  }

  // Hot sparks at high temperature + high speed
  if (_brakeTemp > 0.6 && speedRatio > 0.7 && carPos) {
    // Spawn 1-2 sparks from a random wheel position
    const count = Math.random() > 0.5 ? 2 : 1;
    const positions = [
      { x: -0.6, z: 0.9 }, { x: 0.6, z: 0.9 },
      { x: -0.6, z: -0.9 }, { x: 0.6, z: -0.9 },
    ];
    for (let i = 0; i < count; i++) {
      const wp = positions[Math.floor(Math.random() * 4)];
      _brakeSparksPos.set(carPos.x + wp.x, carPos.y + 0.22, carPos.z + wp.z);
      spawnGPUSparks(_brakeSparksPos, 8 + _brakeTemp * 12);
    }
  }
}
const _brakeSparksPos = new THREE.Vector3();

// ── Shoulder Dust (dirt particles when car rides on road edge) ──

const DUST_POOL = 25;
interface DustParticle {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
}
let dustPool: THREE.Mesh[] = [];
const activeDust: DustParticle[] = [];
let dustScene: THREE.Scene | null = null;

export function initShoulderDust(scene: THREE.Scene) {
  dustScene = scene;
  const geo = new THREE.SphereGeometry(0.1, 5, 4);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x886644,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  dustPool = [];
  for (let i = 0; i < DUST_POOL; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.visible = false;
    scene.add(m);
    dustPool.push(m);
  }
}

let dustIdx = 0;

/**
 * Spawn shoulder dust at car wheels when riding on road edge.
 * @param pos — car position
 * @param speed — car speed
 * @param side — 'left' or 'right' (which side is on the shoulder)
 */
export function spawnShoulderDust(pos: THREE.Vector3, speed: number, heading: number) {
  if (!dustScene || dustPool.length === 0 || Math.abs(speed) < 8) return;

  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);

  // Spawn 1-2 dust puffs from rear wheels
  const count = Math.abs(speed) > 20 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const mesh = dustPool[dustIdx % DUST_POOL];
    dustIdx++;

    const side = (Math.random() > 0.5 ? 1 : -1);
    mesh.position.set(
      pos.x - sinH * (-1.2) + cosH * side * 0.8,
      pos.y + 0.1,
      pos.z - cosH * (-1.2) - sinH * side * 0.8,
    );
    mesh.scale.setScalar(0.3 + Math.random() * 0.5);
    mesh.visible = true;

    const maxLife = 0.5 + Math.random() * 0.5;
    activeDust.push({
      mesh,
      vx: (Math.random() - 0.5) * 3,
      vy: 0.5 + Math.random() * 1.5,
      vz: (Math.random() - 0.5) * 3,
      life: maxLife,
      maxLife,
    });
  }
}

export function updateShoulderDust(dt: number) {
  let j = 0;
  while (j < activeDust.length) {
    const p = activeDust[j];
    p.life -= dt;
    if (p.life <= 0) {
      p.mesh.visible = false;
      activeDust[j] = activeDust[activeDust.length - 1];
      activeDust.pop();
      continue;
    }

    // Physics: expand + float upward
    p.vx *= 0.97;
    p.vy -= 0.5 * dt;
    p.vz *= 0.97;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;

    const t = p.life / p.maxLife;
    // Expand as cloud dissipates
    p.mesh.scale.setScalar((1 - t) * 1.5 + 0.3);

    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = t * 0.4;
    // Brown → tan as dust thins out
    const shade = 0.4 + (1 - t) * 0.3;
    mat.color.setRGB(shade, shade * 0.7, shade * 0.4);

    j++;
  }
}

// ── Ambient Floating Particles (dust motes / embers drifting in scene) ──

const AMBIENT_COUNT = 50;
let ambientParticles: THREE.Points | null = null;
let ambientPositions: Float32Array | null = null;
let ambientVelocities: Float32Array | null = null;
let ambientScene: THREE.Scene | null = null;

export function initAmbientParticles(scene: THREE.Scene) {
  ambientScene = scene;
  const count = AMBIENT_COUNT;
  ambientPositions = new Float32Array(count * 3);
  ambientVelocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    ambientPositions[i * 3]     = (Math.random() - 0.5) * 80;
    ambientPositions[i * 3 + 1] = 1 + Math.random() * 12;
    ambientPositions[i * 3 + 2] = (Math.random() - 0.5) * 80;
    // Gentle drift velocities
    ambientVelocities[i * 3]     = (Math.random() - 0.5) * 0.8;
    ambientVelocities[i * 3 + 1] = (Math.random() - 0.5) * 0.3;
    ambientVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(ambientPositions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xffaa66,
    size: 0.15,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    sizeAttenuation: true,
  });

  ambientParticles = new THREE.Points(geo, mat);
  ambientParticles.frustumCulled = false;
  scene.add(ambientParticles);
}

export function updateAmbientParticles(dt: number, playerPos: THREE.Vector3) {
  if (!ambientPositions || !ambientVelocities || !ambientParticles) return;

  const count = AMBIENT_COUNT;
  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    // Wind drift
    ambientPositions[idx]     += ambientVelocities[idx] * dt;
    ambientPositions[idx + 1] += ambientVelocities[idx + 1] * dt;
    ambientPositions[idx + 2] += ambientVelocities[idx + 2] * dt;

    // Add gentle sine wobble
    ambientPositions[idx]     += Math.sin(performance.now() * 0.001 + i) * 0.02 * dt;
    ambientPositions[idx + 1] += Math.cos(performance.now() * 0.0015 + i * 0.7) * 0.01 * dt;

    // Reset if too far from player
    const dx = ambientPositions[idx] - playerPos.x;
    const dz = ambientPositions[idx + 2] - playerPos.z;
    if (dx * dx + dz * dz > 50 * 50 || ambientPositions[idx + 1] < 0) {
      ambientPositions[idx]     = playerPos.x + (Math.random() - 0.5) * 60;
      ambientPositions[idx + 1] = 1 + Math.random() * 12;
      ambientPositions[idx + 2] = playerPos.z + (Math.random() - 0.5) * 60;
    }
  }

  (ambientParticles.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
}

// ── Heat Shimmer (canvas overlay for exhaust distortion at high speed) ──

let shimmerCanvas: HTMLCanvasElement | null = null;
let shimmerCtx: CanvasRenderingContext2D | null = null;
let shimmerResizeHandler: (() => void) | null = null;

export function initHeatShimmer(container: HTMLElement) {
  shimmerCanvas = document.createElement('canvas');
  shimmerCanvas.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    pointer-events:none;z-index:10;opacity:0;
    mix-blend-mode:overlay;
  `;
  shimmerCanvas.width = window.innerWidth;
  shimmerCanvas.height = window.innerHeight;
  container.appendChild(shimmerCanvas);
  shimmerCtx = shimmerCanvas.getContext('2d')!;

  shimmerResizeHandler = () => {
    if (shimmerCanvas) {
      shimmerCanvas.width = window.innerWidth;
      shimmerCanvas.height = window.innerHeight;
    }
  };
  window.addEventListener('resize', shimmerResizeHandler);
}

/**
 * Update heat shimmer overlay. Draws wavering distortion lines.
 * Now nitro-aware: activates earlier during nitro and shows orange tint at high heat.
 * @param speedRatio — 0..1 current speed / max speed
 * @param isNitro — whether nitro is currently active
 * @param engineHeat — 0-100 engine temperature
 */
export function updateHeatShimmer(speedRatio: number, isNitro = false, engineHeat = 0) {
  if (!shimmerCanvas || !shimmerCtx) return;

  const threshold = isNitro ? 0.2 : 0.5;
  if (speedRatio < threshold && engineHeat < 50) {
    shimmerCanvas.style.opacity = '0';
    return;
  }

  const baseIntensity = speedRatio >= threshold ? (speedRatio - threshold) / (1 - threshold) : 0;
  const heatIntensity = Math.max(0, (engineHeat - 40) / 60); // 0 at 40, 1 at 100
  const intensity = Math.min(1, Math.max(baseIntensity, heatIntensity));
  const maxOpacity = isNitro ? 0.35 : 0.15;
  shimmerCanvas.style.opacity = (intensity * maxOpacity).toString();

  const ctx = shimmerCtx;
  const w = shimmerCanvas.width;
  const h = shimmerCanvas.height;
  ctx.clearRect(0, 0, w, h);

  const time = performance.now() * 0.003;
  const lineCount = 8 + Math.floor(intensity * 12);
  const cx = w / 2;
  const bottomY = h * 0.75;
  const spread = isNitro ? 200 : 120; // wider during nitro

  for (let i = 0; i < lineCount; i++) {
    const y = bottomY - i * (h * 0.05);
    const amplitude = (3 + intensity * 8) * (1 - i / lineCount);
    const freq = 0.02 + i * 0.005;

    ctx.beginPath();
    ctx.moveTo(cx - spread, y);
    for (let x = cx - spread; x < cx + spread; x += 4) {
      const waveY = y + Math.sin(x * freq + time + i * 1.3) * amplitude;
      ctx.lineTo(x, waveY);
    }
    // Orange tint at high heat, warm white normally
    const heatTint = Math.min(engineHeat / 100, 1);
    const r = 255;
    const g = Math.floor(245 - heatTint * 100);
    const b = Math.floor(220 - heatTint * 180);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.06 * (1 - i / lineCount)})`;
    ctx.lineWidth = 2 + intensity * 2;
    ctx.stroke();
  }
}

// ── Lens Flare Sprites (billboard sprites at street light positions) ──

let flareSprites: THREE.Sprite[] = [];
let flareLightPositions: THREE.Vector3[] = [];

export function initLensFlares(scene: THREE.Scene, lightPositions: THREE.Vector3[]) {
  flareLightPositions = lightPositions;
  flareSprites = [];

  // Create canvas texture for flare
  const flareCanvas = document.createElement('canvas');
  flareCanvas.width = 64;
  flareCanvas.height = 64;
  const ctx = flareCanvas.getContext('2d')!;

  // Radial gradient — bright center, soft falloff
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 240, 200, 0.9)');
  grad.addColorStop(0.2, 'rgba(255, 220, 150, 0.4)');
  grad.addColorStop(0.5, 'rgba(255, 200, 100, 0.1)');
  grad.addColorStop(1, 'rgba(255, 180, 80, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const flareTex = new THREE.CanvasTexture(flareCanvas);
  const flareMat = new THREE.SpriteMaterial({
    map: flareTex,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  for (const pos of lightPositions) {
    const sprite = new THREE.Sprite(flareMat.clone());
    sprite.position.copy(pos);
    sprite.scale.set(4, 4, 1);
    scene.add(sprite);
    flareSprites.push(sprite);
  }
}

/**
 * Update lens flare intensity based on camera distance and angle.
 */
export function updateLensFlares(cameraPos: THREE.Vector3, time: number) {
  for (let i = 0; i < flareSprites.length; i++) {
    const sprite = flareSprites[i];
    const pos = flareLightPositions[i];
    const dx = cameraPos.x - pos.x;
    const dy = cameraPos.y - pos.y;
    const dz = cameraPos.z - pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Fade based on distance — brighter when closer
    const distFade = Math.max(0, 1 - dist / 50);
    // Gentle pulsing
    const pulse = 0.8 + Math.sin(time * 2 + i * 1.7) * 0.15;

    const mat = sprite.material as THREE.SpriteMaterial;
    mat.opacity = distFade * pulse * 0.3;

    // Scale up when closer for bloom effect
    const scale = 2 + distFade * 2.5;
    sprite.scale.set(scale, scale, 1);
  }
}

// ── Lightning Flashes (screen + scene flash during storms) ──

let lightningDiv: HTMLDivElement | null = null;
let lightningIntensity = 0;
let lightningTimer = 0;
let lightningInterval = 5; // seconds between flashes
let lightningEnabled = false;

export function initLightning(container: HTMLElement) {
  lightningDiv = document.createElement('div');
  lightningDiv.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    pointer-events:none;z-index:12;
    background:rgba(200,210,255,0);opacity:0;
  `;
  container.appendChild(lightningDiv);
  lightningIntensity = 0;
  lightningTimer = 2 + Math.random() * 3;
  lightningEnabled = false;
}

export function setLightningEnabled(enabled: boolean) {
  lightningEnabled = enabled;
  if (!enabled && lightningDiv) lightningDiv.style.opacity = '0';
}

/**
 * Update lightning. Returns true momentarily when a flash occurs
 * (so caller can boost scene lights if desired).
 */
export function updateLightning(dt: number): boolean {
  if (!lightningDiv || !lightningEnabled) return false;

  lightningTimer -= dt;
  let flashed = false;

  if (lightningTimer <= 0) {
    // Flash!
    lightningIntensity = 0.5 + Math.random() * 0.4;
    lightningDiv.style.opacity = lightningIntensity.toString();
    lightningDiv.style.background = `rgba(200, 210, 255, ${lightningIntensity})`;
    lightningTimer = 3 + Math.random() * 5; // Next flash in 3-8 seconds
    flashed = true;

    // Double flash (common in real lightning)
    if (Math.random() > 0.5) {
      setTimeout(() => {
        if (lightningDiv) {
          lightningDiv.style.opacity = (lightningIntensity * 0.6).toString();
        }
      }, 80);
    }
  }

  // Decay
  if (lightningIntensity > 0) {
    lightningIntensity *= Math.exp(-8 * dt);
    if (lightningIntensity < 0.01) lightningIntensity = 0;
    lightningDiv.style.opacity = lightningIntensity.toString();
  }

  return flashed;
}

// ── Near-Miss Screen Streaks (screen edge flash on close passes) ──

let nearMissCanvas: HTMLCanvasElement | null = null;
let nearMissCtx: CanvasRenderingContext2D | null = null;
let nearMissResizeHandler: (() => void) | null = null;

interface NearMissStreak {
  side: 'left' | 'right';
  intensity: number;
  life: number;
}
const activeStreaks: NearMissStreak[] = [];

export function initNearMissStreaks(container: HTMLElement) {
  nearMissCanvas = document.createElement('canvas');
  nearMissCanvas.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    pointer-events:none;z-index:11;opacity:1;
  `;
  nearMissCanvas.width = window.innerWidth;
  nearMissCanvas.height = window.innerHeight;
  container.appendChild(nearMissCanvas);
  nearMissCtx = nearMissCanvas.getContext('2d')!;
  activeStreaks.length = 0;

  nearMissResizeHandler = () => {
    if (nearMissCanvas) {
      nearMissCanvas.width = window.innerWidth;
      nearMissCanvas.height = window.innerHeight;
    }
  };
  window.addEventListener('resize', nearMissResizeHandler);
}

/**
 * Trigger a near-miss streak on one side of the screen.
 * @param side — which side the AI car passed on
 */
export function triggerNearMiss(side: 'left' | 'right') {
  activeStreaks.push({
    side,
    intensity: 0.8 + Math.random() * 0.2,
    life: 0.3,
  });
}

export function updateNearMissStreaks(dt: number) {
  if (!nearMissCanvas || !nearMissCtx) return;
  if (activeStreaks.length === 0) return;

  const ctx = nearMissCtx;
  const w = nearMissCanvas.width;
  const h = nearMissCanvas.height;
  ctx.clearRect(0, 0, w, h);

  let j = 0;
  while (j < activeStreaks.length) {
    const s = activeStreaks[j];
    s.life -= dt;
    if (s.life <= 0) {
      activeStreaks[j] = activeStreaks[activeStreaks.length - 1];
      activeStreaks.pop();
      continue;
    }

    const t = s.life / 0.3;
    const alpha = t * s.intensity * 0.4;

    // Draw gradient streak on the corresponding side
    const gradient = s.side === 'left'
      ? ctx.createLinearGradient(0, 0, w * 0.15, 0)
      : ctx.createLinearGradient(w, 0, w * 0.85, 0);

    gradient.addColorStop(0, `rgba(255, 220, 100, ${alpha})`);
    gradient.addColorStop(0.5, `rgba(255, 200, 80, ${alpha * 0.3})`);
    gradient.addColorStop(1, 'rgba(255, 200, 80, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    j++;
  }
}

// ── Near-Miss 3D Whoosh Mesh (air-displacement planes that sweep past camera) ──

let whooshMeshL: THREE.Mesh | null = null;
let whooshMeshR: THREE.Mesh | null = null;
let whooshLifeL = 0;
let whooshLifeR = 0;
const WHOOSH_DURATION = 0.3;
let whooshScene: THREE.Scene | null = null;

export function initNearMissWhoosh(scene: THREE.Scene) {
  whooshScene = scene;
  const geo = new THREE.PlaneGeometry(2.5, 6);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  whooshMeshL = new THREE.Mesh(geo, mat.clone());
  whooshMeshR = new THREE.Mesh(geo, mat.clone());
  whooshMeshL.visible = false;
  whooshMeshR.visible = false;
  scene.add(whooshMeshL);
  scene.add(whooshMeshR);
}

export function triggerNearMissWhoosh(side: 'left' | 'right', cameraPos: THREE.Vector3, cameraHeading: number) {
  const mesh = side === 'left' ? whooshMeshL : whooshMeshR;
  if (!mesh) return;

  const sideSign = side === 'left' ? -1 : 1;
  const cosH = Math.cos(cameraHeading);
  const sinH = Math.sin(cameraHeading);
  // Start behind the camera, offset to the side
  mesh.position.set(
    cameraPos.x + cosH * sideSign * 3 - sinH * (-4),
    cameraPos.y + 0.5,
    cameraPos.z - sinH * sideSign * 3 - cosH * (-4),
  );
  mesh.rotation.y = cameraHeading + sideSign * 0.3;
  mesh.scale.set(0.5, 1, 1);
  mesh.visible = true;

  if (side === 'left') whooshLifeL = WHOOSH_DURATION;
  else whooshLifeR = WHOOSH_DURATION;
}

export function updateNearMissWhoosh(dt: number, cameraPos: THREE.Vector3, cameraHeading: number) {
  const sinH = Math.sin(cameraHeading);
  const cosH = Math.cos(cameraHeading);

  // Left whoosh
  if (whooshLifeL > 0 && whooshMeshL) {
    whooshLifeL -= dt;
    const t = 1 - whooshLifeL / WHOOSH_DURATION; // 0→1
    if (whooshLifeL <= 0) {
      whooshMeshL.visible = false;
    } else {
      // Sweep forward past camera
      const fwd = -4 + t * 12; // behind → ahead
      whooshMeshL.position.set(
        cameraPos.x + cosH * (-3) - sinH * fwd,
        cameraPos.y + 0.5,
        cameraPos.z - sinH * (-3) - cosH * fwd,
      );
      whooshMeshL.scale.set(0.5 + t * 1.5, 1 + t * 0.5, 1);
      const mat = whooshMeshL.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.15;
    }
  }

  // Right whoosh
  if (whooshLifeR > 0 && whooshMeshR) {
    whooshLifeR -= dt;
    const t = 1 - whooshLifeR / WHOOSH_DURATION;
    if (whooshLifeR <= 0) {
      whooshMeshR.visible = false;
    } else {
      const fwd = -4 + t * 12;
      whooshMeshR.position.set(
        cameraPos.x + cosH * 3 - sinH * fwd,
        cameraPos.y + 0.5,
        cameraPos.z - sinH * 3 - cosH * fwd,
      );
      whooshMeshR.scale.set(0.5 + t * 1.5, 1 + t * 0.5, 1);
      const mat = whooshMeshR.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.15;
    }
  }
}

// ── Victory Confetti (colorful particles on race finish) ──

const CONFETTI_COUNT = 80;
interface ConfettiParticle {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  spin: number; spinAxis: number;
  life: number;
}
let confettiPool: THREE.Mesh[] = [];
const activeConfetti: ConfettiParticle[] = [];
let confettiScene: THREE.Scene | null = null;
let _confettiContinuous = false;
let _confettiSpawnPos: THREE.Vector3 | null = null;
let _confettiPoolIdx = 0;

const CONFETTI_COLORS = [
  0xff4444, 0x44ff44, 0x4488ff,
  0xffaa00, 0xff44ff, 0x44ffff,
  0xffff44, 0xff8800, 0x88ff44,
];

export function initVictoryConfetti(scene: THREE.Scene) {
  confettiScene = scene;
  const geo = new THREE.PlaneGeometry(0.15, 0.25);
  confettiPool = [];

  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    scene.add(m);
    confettiPool.push(m);
  }
}

/**
 * Trigger confetti burst at a position (call once on race finish).
 */
export function spawnVictoryConfetti(pos: THREE.Vector3) {
  if (!confettiScene) return;

  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const mesh = confettiPool[i];
    mesh.position.set(
      pos.x + (Math.random() - 0.5) * 6,
      pos.y + 2 + Math.random() * 3,
      pos.z + (Math.random() - 0.5) * 6,
    );
    mesh.scale.setScalar(0.5 + Math.random() * 1.0);
    mesh.visible = true;

    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 1.0;
    mat.color.setHex(CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]);

    activeConfetti.push({
      mesh,
      vx: (Math.random() - 0.5) * 8,
      vy: 5 + Math.random() * 8,
      vz: (Math.random() - 0.5) * 8,
      spin: (Math.random() - 0.5) * 10,
      spinAxis: Math.random() * 3,
      life: 3 + Math.random() * 2,
    });
  }
}

/** Enable/disable continuous confetti rain during results screen. */
export function setConfettiContinuous(enabled: boolean, pos?: THREE.Vector3) {
  _confettiContinuous = enabled;
  _confettiSpawnPos = pos ? pos.clone() : null;
}

export function updateVictoryConfetti(dt: number) {
  // Continuous rain: spawn 2 particles per frame while active
  if (_confettiContinuous && confettiPool.length > 0 && _confettiSpawnPos) {
    for (let n = 0; n < 2; n++) {
      const mesh = confettiPool[_confettiPoolIdx % confettiPool.length];
      _confettiPoolIdx++;
      mesh.position.set(
        _confettiSpawnPos.x + (Math.random() - 0.5) * 10,
        _confettiSpawnPos.y + 6 + Math.random() * 4,
        _confettiSpawnPos.z + (Math.random() - 0.5) * 10,
      );
      mesh.scale.setScalar(0.5 + Math.random() * 0.8);
      mesh.visible = true;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 1.0;
      mat.color.setHex(CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]);
      activeConfetti.push({
        mesh,
        vx: (Math.random() - 0.5) * 3,
        vy: -1 - Math.random() * 2, // gentle downward
        vz: (Math.random() - 0.5) * 3,
        spin: (Math.random() - 0.5) * 8,
        spinAxis: Math.random() * 3,
        life: 3 + Math.random() * 2,
      });
    }
  }

  let j = 0;
  while (j < activeConfetti.length) {
    const p = activeConfetti[j];
    p.life -= dt;
    if (p.life <= 0) {
      p.mesh.visible = false;
      activeConfetti[j] = activeConfetti[activeConfetti.length - 1];
      activeConfetti.pop();
      continue;
    }

    // Physics: gravity + air drag + flutter
    p.vy -= 6 * dt;
    p.vx *= 0.99;
    p.vz *= 0.99;
    // Flutter effect (confetti tumble)
    p.vx += Math.sin(performance.now() * 0.005 + j) * 0.3 * dt;
    p.vz += Math.cos(performance.now() * 0.004 + j * 0.7) * 0.3 * dt;

    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;

    // Spinning
    if (p.spinAxis < 1) p.mesh.rotation.x += p.spin * dt;
    else if (p.spinAxis < 2) p.mesh.rotation.y += p.spin * dt;
    else p.mesh.rotation.z += p.spin * dt;

    // Fade out in last second
    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = p.life < 1 ? p.life : 1;

    // Floor bounce
    if (p.mesh.position.y < 0.05) {
      p.mesh.position.y = 0.05;
      p.vy = Math.abs(p.vy) * 0.2;
    }

    j++;
  }
}

// ── Glass Shard Burst VFX ──
interface GlassShard {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number;
}
const glassShards: GlassShard[] = [];
let _glassScene: THREE.Scene | null = null;
const _glassGeo = new THREE.PlaneGeometry(0.08, 0.08);
const _glassMat = new THREE.MeshStandardMaterial({
  color: 0xaaddff,
  transparent: true,
  opacity: 0.6,
  side: THREE.DoubleSide,
  roughness: 0.1,
  metalness: 0.8,
});

export function triggerGlassShardBurst(scene: THREE.Scene, x: number, y: number, z: number) {
  _glassScene = scene;
  const SHARD_COUNT = 10;
  for (let i = 0; i < SHARD_COUNT; i++) {
    const mesh = new THREE.Mesh(_glassGeo, _glassMat.clone());
    mesh.position.set(x, y, z);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    mesh.scale.setScalar(0.5 + Math.random() * 1.5);
    scene.add(mesh);
    glassShards.push({
      mesh,
      vx: (Math.random() - 0.5) * 6,
      vy: 2 + Math.random() * 4,
      vz: (Math.random() - 0.5) * 6,
      life: 1.5,
    });
  }
}

export function updateGlassShards(dt: number) {
  for (let i = glassShards.length - 1; i >= 0; i--) {
    const s = glassShards[i];
    s.life -= dt;
    if (s.life <= 0) {
      if (_glassScene) _glassScene.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
      glassShards.splice(i, 1);
      continue;
    }
    s.vy -= 9.8 * dt; // gravity
    s.mesh.position.x += s.vx * dt;
    s.mesh.position.y += s.vy * dt;
    s.mesh.position.z += s.vz * dt;
    s.mesh.rotation.x += dt * 5;
    s.mesh.rotation.z += dt * 3;
    (s.mesh.material as THREE.MeshStandardMaterial).opacity = Math.min(0.6, s.life / 0.5);
  }
}

// ── Engine Smoke VFX ──
interface EngineSmokeParticle {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number;
  maxLife: number;
}
const engineSmokeParticles: EngineSmokeParticle[] = [];
let _smokeEngScene: THREE.Scene | null = null;
const _smokeEngGeo = new THREE.PlaneGeometry(0.5, 0.5);
const _smokeEngMat = new THREE.MeshStandardMaterial({
  color: 0xcccccc,
  transparent: true,
  opacity: 0.2,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const SMOKE_POOL_MAX = 30;

export function updateEngineSmoke(
  scene: THREE.Scene,
  dt: number,
  frontHP: number,
  carX: number, carY: number, carZ: number,
  heading: number,
) {
  _smokeEngScene = scene;

  // Emit new smoke if front HP < 30%
  if (frontHP < 30 && engineSmokeParticles.length < SMOKE_POOL_MAX) {
    const severity = 1 - frontHP / 30; // 0 at 30%, 1 at 0%
    // Emit 1-3 particles per frame based on severity
    const emitCount = Math.min(1 + Math.floor(severity * 2), 3);
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    // Hood position: slightly forward and up from CG
    const hoodX = carX + sinH * (-1.0);
    const hoodZ = carZ + cosH * (-1.0);
    const hoodY = carY + 1.2;

    for (let e = 0; e < emitCount; e++) {
      const mesh = new THREE.Mesh(_smokeEngGeo, _smokeEngMat.clone());
      mesh.position.set(
        hoodX + (Math.random() - 0.5) * 0.4,
        hoodY,
        hoodZ + (Math.random() - 0.5) * 0.4,
      );
      mesh.rotation.z = Math.random() * Math.PI;
      scene.add(mesh);
      const maxLife = 1.0 + Math.random() * 0.8;
      engineSmokeParticles.push({
        mesh,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 2 + Math.random() * 2,
        vz: (Math.random() - 0.5) * 0.8,
        life: maxLife,
        maxLife,
      });
    }
  }

  // Update existing smoke
  for (let i = engineSmokeParticles.length - 1; i >= 0; i--) {
    const p = engineSmokeParticles[i];
    p.life -= dt;
    if (p.life <= 0) {
      if (_smokeEngScene) _smokeEngScene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
      engineSmokeParticles.splice(i, 1);
      continue;
    }
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    // Grow over lifetime
    const age = 1 - p.life / p.maxLife;
    p.mesh.scale.setScalar(0.3 + age * 1.5);
    // Fade out
    const mat = p.mesh.material as THREE.MeshStandardMaterial;
    mat.opacity = (1 - age) * 0.25;
    // Grey-shift over time (white → dark grey)
    const grey = 0.8 - age * 0.4;
    mat.color.setRGB(grey, grey, grey);
  }
}

/** Remove all VFX objects from the scene and DOM. Call between races. */
export function destroyVFX() {
  const sceneRef = smokeScene;

  // Clear smoke particles
  for (const p of activeSmoke) p.mesh.visible = false;
  activeSmoke.length = 0;

  // Clear debris
  for (const d of debrisStates) {
    if (d.active && d.mesh) d.mesh.visible = false;
    d.active = false;
  }
  if (sceneRef) {
    for (const mesh of debrisPool) {
      sceneRef.remove(mesh);
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
  }
  debrisPool.length = 0;
  debrisIdx = 0;

  damageSmokeCooldown = 0;
  flameCooldown = 0;

  if (sceneRef) {
    for (const mesh of smokePool) {
      sceneRef.remove(mesh);
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
  }
  smokePool.length = 0;
  smokeIdx = 0;
  smokeScene = null;

  // Remove speed lines canvas + resize listener
  if (speedLinesResizeHandler) {
    window.removeEventListener('resize', speedLinesResizeHandler);
    speedLinesResizeHandler = null;
  }
  if (speedLinesCanvas) {
    speedLinesCanvas.remove();
    speedLinesCanvas = null;
    speedLinesCtx = null;
  }

  // Remove boost flames + glow + ground decals + lights
  for (const mesh of [boostFlameL, boostFlameR, boostGlowL, boostGlowR, boostGroundL, boostGroundR]) {
    if (mesh) {
      mesh.parent?.remove(mesh);
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
  }
  boostFlameL = null;
  boostFlameR = null;
  boostGlowL = null;
  boostGlowR = null;
  boostGroundL = null;
  boostGroundR = null;
  for (const light of [boostLightL, boostLightR]) {
    if (light) {
      light.target?.parent?.remove(light.target);
      light.parent?.remove(light);
    }
  }
  boostLightL = null;
  boostLightR = null;
  boostFlameScene = null;



  // Remove rain droplets overlay
  screenDroplets.length = 0;
  rainDropActive = false;
  if (rainDropResizeHandler) {
    window.removeEventListener('resize', rainDropResizeHandler);
    rainDropResizeHandler = null;
  }
  if (rainDropCanvas) {
    rainDropCanvas.remove();
    rainDropCanvas = null;
    rainDropCtx = null;
  }

  // Remove impact flash
  impactFlashIntensity = 0;
  if (impactFlashDiv) {
    impactFlashDiv.remove();
    impactFlashDiv = null;
  }

  // Remove shockwave dual-ring meshes
  for (const sw of [shockwaveInner, shockwaveOuter]) {
    if (sw) {
      sw.parent?.remove(sw);
      sw.geometry?.dispose();
      (sw.material as THREE.Material)?.dispose();
    }
  }
  shockwaveInner = null;
  shockwaveOuter = null;
  shockwaveLife = 0;
  shockwaveScene = null;

  // Remove nitro flash overlay
  nitroFlashLife = 0;
  if (nitroFlashDiv) {
    nitroFlashDiv.remove();
    nitroFlashDiv = null;
  }

  // Clear nitro trail
  for (const p of activeNitroTrail) p.mesh.visible = false;
  activeNitroTrail.length = 0;
  if (nitroTrailScene) {
    for (const m of nitroTrailPool) {
      nitroTrailScene.remove(m);
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }
  nitroTrailPool = [];
  nitroTrailIdx = 0;
  nitroTrailScene = null;

  // Clear rim sparks
  for (const s of activeRimSparks) s.mesh.visible = false;
  activeRimSparks.length = 0;
  if (rimSparkScene) {
    for (const m of rimSparkPool) {
      rimSparkScene.remove(m);
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }
  rimSparkPool = [];
  rimSparkIdx = 0;
  rimSparkScene = null;

  // Clear backfire flames
  for (const p of activeBackfires) p.mesh.visible = false;
  activeBackfires.length = 0;
  if (backfireScene) {
    for (const m of backfirePool) {
      backfireScene.remove(m);
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }
  backfirePool = [];
  backfireIdx = 0;
  backfireScene = null;

  // Clear shoulder dust
  for (const p of activeDust) p.mesh.visible = false;
  activeDust.length = 0;
  if (dustScene) {
    for (const m of dustPool) {
      dustScene.remove(m);
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }
  dustPool = [];
  dustIdx = 0;
  dustScene = null;

  // Clear ambient particles
  if (ambientParticles && ambientScene) {
    ambientScene.remove(ambientParticles);
    ambientParticles.geometry?.dispose();
    (ambientParticles.material as THREE.Material)?.dispose();
  }
  ambientParticles = null;
  ambientPositions = null;
  ambientVelocities = null;
  ambientScene = null;

  // Clear heat shimmer
  if (shimmerResizeHandler) {
    window.removeEventListener('resize', shimmerResizeHandler);
    shimmerResizeHandler = null;
  }
  if (shimmerCanvas) {
    shimmerCanvas.remove();
    shimmerCanvas = null;
    shimmerCtx = null;
  }

  // Clear lens flares
  for (const sprite of flareSprites) {
    sprite.parent?.remove(sprite);
    (sprite.material as THREE.Material)?.dispose();
  }
  flareSprites = [];
  flareLightPositions = [];

  // Clear lightning
  lightningIntensity = 0;
  lightningTimer = 0;
  lightningEnabled = false;
  if (lightningDiv) {
    lightningDiv.remove();
    lightningDiv = null;
  }

  // Clear near-miss streaks
  activeStreaks.length = 0;
  if (nearMissResizeHandler) {
    window.removeEventListener('resize', nearMissResizeHandler);
    nearMissResizeHandler = null;
  }
  if (nearMissCanvas) {
    nearMissCanvas.remove();
    nearMissCanvas = null;
    nearMissCtx = null;
  }

  // Clear near-miss whoosh meshes
  for (const wm of [whooshMeshL, whooshMeshR]) {
    if (wm) {
      wm.parent?.remove(wm);
      wm.geometry?.dispose();
      (wm.material as THREE.Material)?.dispose();
    }
  }
  whooshMeshL = null;
  whooshMeshR = null;
  whooshLifeL = 0;
  whooshLifeR = 0;
  whooshScene = null;

  // Clear victory confetti
  _confettiContinuous = false;
  _confettiSpawnPos = null;
  _confettiPoolIdx = 0;
  for (const p of activeConfetti) p.mesh.visible = false;
  activeConfetti.length = 0;
  if (confettiScene) {
    for (const m of confettiPool) {
      confettiScene.remove(m);
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }
  confettiPool = [];
  confettiScene = null;
}
