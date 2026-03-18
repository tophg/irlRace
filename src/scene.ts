/* ── Hood Racer — Scene Setup + Environment Presets ──
 *
 * Uses WebGPURenderer (auto-fallback to WebGL2).
 * Sky dome uses TSL NodeMaterial with animated gradient, stars, and cloud wisps.
 * Ground uses vertex-displaced terrain with noise-based rolling hills.
 */

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  mix, smoothstep, normalWorld, uniform, vec3, vec4, float,
  sin, cos, mul, add, sub, fract, dot, abs, max, min, clamp,
  step, positionLocal, positionWorld,
} from 'three/tsl';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

let renderer: THREE.WebGPURenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;

// Mutable references for environment theming
let hemiLight: THREE.HemisphereLight;
let dirLight: THREE.DirectionalLight;
let groundMesh: THREE.Mesh;

// Sky uniforms (mutable for environment preset changes)
const uSkyTop = uniform(new THREE.Color(0x0d0d1a));
const uSkyBottom = uniform(new THREE.Color(0x1a1a3a));
const uSkyHorizon = uniform(new THREE.Color(0x2a1a30));
const uSkyMid = uniform(new THREE.Color(0x151530));       // mid-sky tint zone
const uHorizonGlow = uniform(new THREE.Color(0x3a2040));   // warm horizon glow band
const uSkyTime = uniform(0.0);                              // animated time for stars/wisps
const uGroundColor = uniform(new THREE.Color(0x222228));    // ground terrain color

// ── Environment Presets ──
export interface EnvironmentPreset {
  name: string;
  fogColor: number;
  fogDensity: number;
  skyTop: number;
  skyBottom: number;
  skyHorizon: number;
  skyMid?: number;        // optional — auto-derived from skyTop/skyHorizon blend
  horizonGlow?: number;   // optional — auto-derived from skyHorizon brightened
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  dirColor: number;
  dirIntensity: number;
  dirPosition: [number, number, number];
  groundColor: number;
  exposure: number;
}

export const ENVIRONMENTS: EnvironmentPreset[] = [
  {
    name: 'Urban Night',
    fogColor: 0x1a1a2e, fogDensity: 0.0003,
    skyTop: 0x0d0d1a, skyBottom: 0x1a1a3a, skyHorizon: 0x2a1a30,
    hemiSky: 0x88aacc, hemiGround: 0x444422, hemiIntensity: 1.0,
    dirColor: 0xffeedd, dirIntensity: 2.0, dirPosition: [50, 80, 30],
    groundColor: 0x222228, exposure: 1.15,
  },
  {
    name: 'Desert Dawn',
    fogColor: 0xccaa66, fogDensity: 0.00025,
    skyTop: 0x1a0a2e, skyBottom: 0xff6633, skyHorizon: 0xffaa44,
    hemiSky: 0xffddaa, hemiGround: 0x886633, hemiIntensity: 1.2,
    dirColor: 0xffcc88, dirIntensity: 2.2, dirPosition: [80, 30, 50],
    groundColor: 0x3a3530, exposure: 1.3,
  },
  {
    name: 'Coastal Sunset',
    fogColor: 0x445577, fogDensity: 0.0003,
    skyTop: 0x0a1628, skyBottom: 0x2244aa, skyHorizon: 0xff6644,
    hemiSky: 0xaabbdd, hemiGround: 0x445566, hemiIntensity: 1.1,
    dirColor: 0xffaa77, dirIntensity: 2.2, dirPosition: [-60, 25, 60],
    groundColor: 0x1a2030, exposure: 1.25,
  },
  {
    name: 'Neon City',
    fogColor: 0x0a0a1e, fogDensity: 0.0004,
    skyTop: 0x050510, skyBottom: 0x0a0a2a, skyHorizon: 0x1a0530,
    hemiSky: 0x4488ff, hemiGround: 0x220044, hemiIntensity: 0.7,
    dirColor: 0xcc44ff, dirIntensity: 1.8, dirPosition: [30, 60, -40],
    groundColor: 0x0a0a14, exposure: 1.5,
  },
  {
    name: 'Thunder Storm',
    fogColor: 0x1a2020, fogDensity: 0.0005,
    skyTop: 0x0a0f0f, skyBottom: 0x1a2525, skyHorizon: 0x2a3535,
    hemiSky: 0x556666, hemiGround: 0x222222, hemiIntensity: 0.55,
    dirColor: 0x8899aa, dirIntensity: 1.3, dirPosition: [40, 50, 20],
    groundColor: 0x151a1a, exposure: 1.0,
  },
  {
    name: 'Alpine Snow',
    fogColor: 0xccccdd, fogDensity: 0.0004,
    skyTop: 0x889099, skyBottom: 0xbbc0cc, skyHorizon: 0xdde0e8,
    hemiSky: 0xccddee, hemiGround: 0x667788, hemiIntensity: 1.1,
    dirColor: 0xeeeeff, dirIntensity: 1.6, dirPosition: [60, 40, 40],
    groundColor: 0x334455, exposure: 1.1,
  },
  {
    name: 'Blizzard',
    fogColor: 0xaaaabb, fogDensity: 0.0008,
    skyTop: 0x999aa5, skyBottom: 0xaaaaba, skyHorizon: 0xbbbbcc,
    hemiSky: 0xaabbcc, hemiGround: 0x556677, hemiIntensity: 0.7,
    dirColor: 0xccccdd, dirIntensity: 0.9, dirPosition: [30, 60, 20],
    groundColor: 0x2a3040, exposure: 0.9,
  },
  {
    name: 'Black Ice',
    fogColor: 0x0a1020, fogDensity: 0.0003,
    skyTop: 0x050810, skyBottom: 0x101828, skyHorizon: 0x1a2540,
    hemiSky: 0x4466aa, hemiGround: 0x111122, hemiIntensity: 0.8,
    dirColor: 0x88aadd, dirIntensity: 1.8, dirPosition: [50, 70, -30],
    groundColor: 0x0a0e18, exposure: 1.2,
  },
];

function createGroundTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#282830';
  ctx.fillRect(0, 0, size, size);

  // Subtle grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  const step = 32;
  for (let x = 0; x <= size; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
  }
  for (let y = 0; y <= size; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  return tex;
}

export async function initScene(container: HTMLElement) {
  renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  // Async init — requests GPU adapter/device (falls back to WebGL2 automatically)
  await renderer.init();
  console.log(`[scene] Renderer backend: ${renderer.backend?.constructor?.name ?? 'unknown'}`);

  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = null;

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 10, 20);

  // Subtle IBL for material reflections (low intensity to avoid white wash)
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envMap = pmremGenerator.fromScene(new RoomEnvironment()).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.35;
  pmremGenerator.dispose();

  hemiLight = new THREE.HemisphereLight(0x88aacc, 0x444422, 1.0);
  scene.add(hemiLight);

  dirLight = new THREE.DirectionalLight(0xffeedd, 2.0);
  dirLight.position.set(50, 80, 30);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 200;
  dirLight.shadow.camera.left = -100;
  dirLight.shadow.camera.right = 100;
  dirLight.shadow.camera.top = 100;
  dirLight.shadow.camera.bottom = -100;
  scene.add(dirLight);
  scene.add(dirLight.target);

  // ── Ground terrain (TSL NodeMaterial with vertex displacement) ──
  const groundGeo = new THREE.PlaneGeometry(1200, 1200, 128, 128);
  const groundTex = createGroundTexture();
  const groundMat = new MeshStandardNodeMaterial({
    roughness: 0.85, metalness: 0.05,
  });
  groundMat.colorNode = vec3(uGroundColor);

  // Vertex displacement: gentle rolling terrain via layered sine noise
  // Operates in the XZ plane of the undisplaced geometry (before rotation)
  const gx = positionLocal.x;
  const gz = positionLocal.y; // PlaneGeometry lies in XY, rotated to XZ
  const hill1 = sin(mul(gx, 0.008)).mul(cos(mul(gz, 0.012))).mul(2.0);
  const hill2 = sin(mul(gx, 0.022).add(3.7)).mul(sin(mul(gz, 0.018).add(1.2))).mul(1.0);
  const hill3 = cos(mul(gx, 0.045).add(7.1)).mul(sin(mul(gz, 0.035).add(5.3))).mul(0.5);
  const terrain = add(add(hill1, hill2), hill3);
  // Displace along Z (which becomes Y after -90° X rotation)
  groundMat.positionNode = add(positionLocal, vec3(0, 0, terrain));

  groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -5;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // ── Sky dome (TSL NodeMaterial — animated 5-zone gradient + stars + wisps) ──
  const skyGeo = new THREE.SphereGeometry(800, 32, 16);
  const skyMat = new MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false });

  // 5-zone sky gradient using world-space normalized Y
  const h = normalWorld.y;
  const band0 = mix(uSkyHorizon, uSkyBottom, smoothstep(0.0, -0.3, h)); // below horizon
  const band1 = mix(band0, uHorizonGlow, smoothstep(-0.02, 0.05, h).mul(smoothstep(0.15, 0.05, h))); // horizon glow band
  const band2 = mix(band1, uSkyMid, smoothstep(0.05, 0.25, h));         // mid sky
  const band3 = mix(band2, uSkyTop, smoothstep(0.25, 0.6, h));          // upper sky

  // Procedural star field (upper hemisphere only)
  // Hash function: fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)
  const nx = normalWorld.x;
  const nz = normalWorld.z;
  const starDot = add(mul(nx, 127.1), mul(nz, 311.7));
  const starHash = fract(mul(sin(starDot), 43758.5453));
  const starBright = step(0.997, starHash); // ~0.3% of sky has a star
  const starFade = smoothstep(0.15, 0.4, h); // only visible above low sky
  // Twinkle: modulate with time
  const twinkle = add(0.6, mul(0.4, sin(add(mul(uSkyTime, 2.0), mul(starHash, 100.0)))));
  const starColor = vec3(mul(starBright, mul(starFade, twinkle)));

  // Noise-based cloud wisps (scrolling along X with time)
  const wispX = add(mul(nx, 3.0), mul(uSkyTime, 0.02));
  const wispZ = mul(nz, 4.0);
  const wisp1 = sin(mul(wispX, 5.0)).mul(cos(mul(wispZ, 4.0)));
  const wisp2 = sin(mul(wispX, 11.0).add(2.3)).mul(cos(mul(wispZ, 8.0).add(1.7)));
  const wispNoise = add(mul(wisp1, 0.5), mul(wisp2, 0.3));
  const wispMask = smoothstep(0.05, 0.35, h).mul(smoothstep(0.6, 0.35, h)); // mid-sky band
  const wispAlpha = max(float(0), wispNoise).mul(wispMask).mul(0.08); // very subtle
  const wispColor = mix(uSkyHorizon, vec3(1, 1, 1), 0.3); // slightly brighter than horizon

  // Composite: gradient + stars + wisps
  const finalSky = add(add(band3, starColor), mul(wispColor, wispAlpha));
  skyMat.colorNode = finalSky;

  scene.add(new THREE.Mesh(skyGeo, skyMat));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera };
}

/** Apply an environment preset to the scene. Call after initScene. */
export function applyEnvironment(preset: EnvironmentPreset) {
  // Configure fog from preset
  scene.fog = new THREE.FogExp2(preset.fogColor, preset.fogDensity);

  uSkyTop.value.setHex(preset.skyTop);
  uSkyBottom.value.setHex(preset.skyBottom);
  uSkyHorizon.value.setHex(preset.skyHorizon);

  // Auto-derive mid-sky and horizon glow if not specified
  if (preset.skyMid) {
    uSkyMid.value.setHex(preset.skyMid);
  } else {
    // Blend between skyTop and skyHorizon at 40% toward top
    const _t = new THREE.Color(preset.skyTop);
    const _h = new THREE.Color(preset.skyHorizon);
    uSkyMid.value.copy(_t).lerp(_h, 0.4);
  }
  if (preset.horizonGlow) {
    uHorizonGlow.value.setHex(preset.horizonGlow);
  } else {
    // Brighten horizon color slightly for glow band
    uHorizonGlow.value.setHex(preset.skyHorizon);
    uHorizonGlow.value.offsetHSL(0, 0.05, 0.08);
  }

  hemiLight.color.setHex(preset.hemiSky);
  hemiLight.groundColor.setHex(preset.hemiGround);
  hemiLight.intensity = preset.hemiIntensity;

  dirLight.color.setHex(preset.dirColor);
  dirLight.intensity = preset.dirIntensity;
  dirLight.position.set(...preset.dirPosition);

  uGroundColor.value.setHex(preset.groundColor);

  renderer.toneMappingExposure = preset.exposure;

  // ── Enhancement 7: Fake godray light shafts ──
  // Remove previous godrays
  const oldGodrays = scene.getObjectByName('godrays');
  if (oldGodrays) scene.remove(oldGodrays);

  // Only add godrays for sunlit presets (high directional intensity, low position = dramatic)
  const sunlit = preset.dirIntensity >= 1.6 && preset.dirPosition[1] <= 50;
  if (sunlit) {
    const godrayGroup = new THREE.Group();
    godrayGroup.name = 'godrays';

    const coneGeo = new THREE.ConeGeometry(25, 120, 6);
    const coneMat = new THREE.MeshBasicMaterial({
      color: preset.dirColor,
      transparent: true,
      opacity: 0.025,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < 4; i++) {
      const cone = new THREE.Mesh(coneGeo, coneMat.clone());
      // Spread cones around the light direction
      const angle = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      const spread = 15;
      const sx = preset.dirPosition[0] + Math.cos(angle) * spread;
      const sz = preset.dirPosition[2] + Math.sin(angle) * spread;
      cone.position.set(sx, preset.dirPosition[1] + 60, sz);
      cone.lookAt(0, -20, 0);
      godrayGroup.add(cone);
    }
    scene.add(godrayGroup);
  }
}

/** Update sky animation time. Call once per frame from the main loop. */
export function updateSkyTime(timestamp: number) {
  uSkyTime.value = timestamp * 0.001; // seconds
}

/** Pick environment deterministically from seed. */
export function getEnvironmentForSeed(seed: number): EnvironmentPreset {
  return ENVIRONMENTS[seed % ENVIRONMENTS.length];
}

export function getEnvironmentByName(name: string): EnvironmentPreset {
  return ENVIRONMENTS.find(e => e.name === name) ?? ENVIRONMENTS[0];
}

export function getRenderer() { return renderer; }
export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getDirLight() { return dirLight; }
