/* ── Hood Racer — Scene Setup + Environment Presets ──
 *
 * Uses WebGPURenderer (auto-fallback to WebGL2).
 * Sky dome uses TSL NodeMaterial instead of raw GLSL.
 */

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { mix, smoothstep, normalWorld, uniform, vec3 } from 'three/tsl';
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

// ── Environment Presets ──
export interface EnvironmentPreset {
  name: string;
  fogColor: number;
  fogDensity: number;
  skyTop: number;
  skyBottom: number;
  skyHorizon: number;
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
    hemiSky: 0x88aacc, hemiGround: 0x444422, hemiIntensity: 1.2,
    dirColor: 0xffeedd, dirIntensity: 2.5, dirPosition: [50, 80, 30],
    groundColor: 0x222228, exposure: 1.4,
  },
  {
    name: 'Desert Dawn',
    fogColor: 0xccaa66, fogDensity: 0.00025,
    skyTop: 0x1a0a2e, skyBottom: 0xff6633, skyHorizon: 0xffaa44,
    hemiSky: 0xffddaa, hemiGround: 0x886633, hemiIntensity: 1.6,
    dirColor: 0xffcc88, dirIntensity: 3.0, dirPosition: [80, 30, 50],
    groundColor: 0x3a3530, exposure: 1.6,
  },
  {
    name: 'Coastal Sunset',
    fogColor: 0x445577, fogDensity: 0.0003,
    skyTop: 0x0a1628, skyBottom: 0x2244aa, skyHorizon: 0xff6644,
    hemiSky: 0xaabbdd, hemiGround: 0x445566, hemiIntensity: 1.4,
    dirColor: 0xffaa77, dirIntensity: 3.0, dirPosition: [-60, 25, 60],
    groundColor: 0x1a2030, exposure: 1.5,
  },
  {
    name: 'Neon City',
    fogColor: 0x0a0a1e, fogDensity: 0.0004,
    skyTop: 0x050510, skyBottom: 0x0a0a2a, skyHorizon: 0x1a0530,
    hemiSky: 0x4488ff, hemiGround: 0x220044, hemiIntensity: 0.8,
    dirColor: 0xcc44ff, dirIntensity: 2.0, dirPosition: [30, 60, -40],
    groundColor: 0x0a0a14, exposure: 1.8,
  },
  {
    name: 'Thunder Storm',
    fogColor: 0x1a2020, fogDensity: 0.0005,
    skyTop: 0x0a0f0f, skyBottom: 0x1a2525, skyHorizon: 0x2a3535,
    hemiSky: 0x556666, hemiGround: 0x222222, hemiIntensity: 0.6,
    dirColor: 0x8899aa, dirIntensity: 1.5, dirPosition: [40, 50, 20],
    groundColor: 0x151a1a, exposure: 1.1,
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
  renderer.toneMappingExposure = 1.4;

  // Async init — requests GPU adapter/device (falls back to WebGL2 automatically)
  await renderer.init();
  console.log(`[scene] Renderer backend: ${renderer.backend?.constructor?.name ?? 'unknown'}`);

  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = null;

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 10, 20);

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envMap = pmremGenerator.fromScene(new RoomEnvironment()).texture;
  scene.environment = envMap;
  pmremGenerator.dispose();

  hemiLight = new THREE.HemisphereLight(0x88aacc, 0x444422, 1.2);
  scene.add(hemiLight);

  dirLight = new THREE.DirectionalLight(0xffeedd, 2.5);
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

  const groundGeo = new THREE.PlaneGeometry(1200, 1200);
  const groundTex = createGroundTexture();
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.85, metalness: 0.05, map: groundTex });
  groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -30;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // ── Sky dome (TSL NodeMaterial) ──
  // Replaces the old GLSL ShaderMaterial with a TSL-based gradient
  const skyGeo = new THREE.SphereGeometry(800, 32, 16);
  const skyMat = new MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false });

  // Use world-space normalized Y to blend between horizon, bottom, and top colors
  const h = normalWorld.y;
  const col1 = mix(uSkyHorizon, uSkyBottom, smoothstep(0.0, -0.3, h));
  const skyColor = mix(col1, uSkyTop, smoothstep(0.0, 0.5, h));
  skyMat.colorNode = skyColor;

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
  uSkyTop.value.setHex(preset.skyTop);
  uSkyBottom.value.setHex(preset.skyBottom);
  uSkyHorizon.value.setHex(preset.skyHorizon);

  hemiLight.color.setHex(preset.hemiSky);
  hemiLight.groundColor.setHex(preset.hemiGround);
  hemiLight.intensity = preset.hemiIntensity;

  dirLight.color.setHex(preset.dirColor);
  dirLight.intensity = preset.dirIntensity;
  dirLight.position.set(...preset.dirPosition);

  (groundMesh.material as THREE.MeshStandardMaterial).color.setHex(preset.groundColor);

  renderer.toneMappingExposure = preset.exposure;
}

/** Pick environment deterministically from seed. */
export function getEnvironmentForSeed(seed: number): EnvironmentPreset {
  return ENVIRONMENTS[seed % ENVIRONMENTS.length];
}

export function getRenderer() { return renderer; }
export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getDirLight() { return dirLight; }
