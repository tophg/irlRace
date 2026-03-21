/* ── IRL Race — Scene Setup + Environment Presets ──
 *
 * Uses WebGPURenderer (auto-fallback to WebGL2).
 * Sky dome uses TSL NodeMaterial with animated gradient, stars, and cloud wisps.
 * Ground uses vertex-displaced terrain with noise-based rolling hills.
 */

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  mix, smoothstep, normalWorld, uniform, vec3, vec2, vec4, float,
  sin, cos, mul, add, fract, max,
  step, positionLocal, positionWorld, dot, floor, texture,
} from 'three/tsl';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

let renderer: THREE.WebGPURenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;

/** True when the renderer is using the native WebGPU backend (not WebGL2 fallback). */
let _backendIsWebGPU = false;

/** Check if the renderer is using the native WebGPU backend.
 *  When false, compute shaders and RenderPipeline are unavailable. */
export function isWebGPUBackend(): boolean { return _backendIsWebGPU; }

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

// Ground atlas textures (updated per-environment and per-track)
// Use mutable THREE.Texture references; the shader's TextureNodes hold refs to these.
export let _dftTexture: THREE.Texture = (() => {
  // Pre-size at 256×256 so the GPU backing texture never needs resizing.
  // Default fill 0 = "on track" (shoulder zone shows as fallback).
  const DFT_SIZE = 256;
  const t = new THREE.DataTexture(new Uint8Array(DFT_SIZE * DFT_SIZE).fill(0), DFT_SIZE, DFT_SIZE, THREE.RedFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
})();
export let _groundAtlasTexture: THREE.Texture = (() => {
  // Pre-size at 4×4 with alpha=0 so the shader falls back to uGroundColor
  // via mix(groundColor, atlas, atlas.a). Alpha=0 → 100% groundColor.
  const t = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(0), 4, 4, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();

// Ground atlas paths per environment name
const GROUND_ATLAS: Record<string, string> = {
  'Gaza City':       '/ground/ground_atlas_gaza.png',
  'Shanghai':        '/ground/ground_atlas_shanghai.png',
  'Kiev':            '/ground/ground_atlas_kiev.png',
};

// ── Scenery Theme (controls visual identity of track-side props) ──
export interface SceneryTheme {
  roadColor: number;
  roadRoughness: number;
  barrierColor: number;
  buildingPalette: number[];
  buildingHeightRange: [number, number];
  windowLitChance: number;
  windowColor: number;
  treeTrunkColor: number;
  treeCanopyColor: number;
  treeCanopyStyle: 'sphere' | 'cone' | 'none';
  treeCount: number;
  billboardStyle: 'neon' | 'minimal' | 'none';
  streetLightColor: number;
  streetLightDensity: number;
  groundTexture: 'grass' | 'sand' | 'snow' | 'concrete' | 'dirt';
  kerbColor: number;
  shoulderColor: number;
  // Phase 2 additions
  mountainColor: number;
  mountainHeight: number;   // 0=none, 1=normal, 2=tall
  cloudOpacity: number;     // 0=none, 0.5=normal
  cloudTint: number;
  fenceDensity: number;      // 0=none, 1=normal
  rockDensity: number;       // 0=none, 1=normal
  rockColor: number;
  bushDensity: number;       // 0=none, 1=normal
  spectatorDensity: number;  // 0=none, 1=normal
  accentProps: string[];
  // Phase 3 additions — per-environment nuance
  roadDecals?: string[];           // e.g. ['puddle', 'crack', 'lane_paint', 'manhole', 'frost', 'sand_drift']
  atmosphericEffects?: string[];   // e.g. ['fireflies', 'leaves', 'steam', 'dust', 'snow_extra', 'embers', 'fog_wisps']
  buildingStyle?: string;          // e.g. 'modern', 'adobe', 'beach_house', 'cyberpunk', 'weathered', 'chalet', 'warehouse', 'concrete', 'bamboo_lodge'
  buildingModels?: string[];       // GLB filenames under /buildings/ (e.g. ['skyscraper.glb', 'office.glb'])
  buildingDensity?: number;        // 0=none, 1=normal, 2=dense city (default 1.0)
  buildingRowCount?: number;       // 1-3 depth rows from road (default 2)
  buildingGapChance?: number;      // 0-0.5 probability of skipping a slot (default 0.15)
  treeModels?: string[];           // GLB filenames under /trees/ (e.g. ['red_maple.glb', 'pine.glb'])
  treeVariant?: string;            // e.g. 'standard', 'joshua', 'layered_pine', 'palm_frond', 'snow_capped'
  ambientLights?: string[];        // e.g. ['neon_edge', 'hazard_flasher', 'neon_pool', 'window_spill', 'torch_glow']
  landmarks?: string[];             // GLB filenames under /buildings/ placed at unique trackside positions
  grandstandModel?: string;          // GLB filename under /buildings/ to replace default spectator stand
}

// ── Environment Presets ──
export interface EnvironmentPreset {
  name: string;
  fogColor: number;
  fogDensity: number;
  skyTop: number;
  skyBottom: number;
  skyHorizon: number;
  skyMid?: number;
  horizonGlow?: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  dirColor: number;
  dirIntensity: number;
  dirPosition: [number, number, number];
  groundColor: number;
  exposure: number;
  scenery: SceneryTheme;
}

export const ENVIRONMENTS: EnvironmentPreset[] = [
  // ── Washington D.C. — Government district, marble and stone under city lights ──
  {
    name: 'Washington D.C.',
    fogColor: 0x1a1a2e, fogDensity: 0.00025,
    skyTop: 0x0d0d1a, skyBottom: 0x1a1a3a, skyHorizon: 0x2a1a30,
    hemiSky: 0x88aacc, hemiGround: 0x444422, hemiIntensity: 1.0,
    dirColor: 0xffeedd, dirIntensity: 1.8, dirPosition: [50, 80, 30],
    groundColor: 0x1a2a1a, exposure: 1.1,
    scenery: {
      roadColor: 0x2a2a30, roadRoughness: 0.85,
      barrierColor: 0x444450,
      buildingPalette: [0x1a1a2e, 0x22223a, 0x2a2a45, 0x181830],
      buildingHeightRange: [8, 25],
      windowLitChance: 0.6, windowColor: 0xffcc66,
      treeTrunkColor: 0x332211, treeCanopyColor: 0x1a3a1a,
      treeCanopyStyle: 'sphere', treeCount: 30,
      billboardStyle: 'neon',
      streetLightColor: 0xffdd88, streetLightDensity: 1.0,
      groundTexture: 'grass',
      kerbColor: 0x888888, shoulderColor: 0x333333,
      mountainColor: 0x1a1a2e, mountainHeight: 1, cloudOpacity: 0.3, cloudTint: 0x2a2a40,
      fenceDensity: 1.0, rockDensity: 0.3, rockColor: 0x444450, bushDensity: 0.3,
      spectatorDensity: 1.0, accentProps: ['traffic_cone', 'dumpster', 'debris'],
      roadDecals: ['lane_paint', 'manhole', 'puddle'], buildingStyle: 'modern', treeVariant: 'standard',
      buildingModels: [],
      buildingDensity: 2.0, buildingRowCount: 3, buildingGapChance: 0.08,
      treeModels: ['red_maple.glb', 'red_maple_b.glb', 'dogwood.glb', 'walnut.glb', 'walnut_b.glb', 'oak.glb'],
      ambientLights: ['window_spill', 'hazard_flasher'],
      landmarks: ['us_capitol.glb', 'washington_monument.glb', 'lincoln_memorial.glb'],
    },
  },



  // ── Havana — Tropical Caribbean coast, golden hour, lush palms ──
  {
    name: 'Havana',
    fogColor: 0x3a4a44, fogDensity: 0.00020,
    skyTop: 0x0a1628, skyBottom: 0x2244aa, skyHorizon: 0xff6644,
    hemiSky: 0xaabbdd, hemiGround: 0x445544, hemiIntensity: 1.0,
    dirColor: 0xffaa77, dirIntensity: 2.0, dirPosition: [-60, 25, 60],
    groundColor: 0x1a2820, exposure: 1.1,
    scenery: {
      roadColor: 0x353540, roadRoughness: 0.75,
      barrierColor: 0x556677,
      buildingPalette: [0x556688, 0x668899, 0x445566, 0x778899, 0x2a3a30, 0x405540],
      buildingHeightRange: [3, 7],
      windowLitChance: 0.4, windowColor: 0xffdd77,
      treeTrunkColor: 0x554422, treeCanopyColor: 0x2a5a2a,
      treeCanopyStyle: 'cone', treeCount: 55,
      billboardStyle: 'minimal',
      streetLightColor: 0xffcc66, streetLightDensity: 0.5,
      groundTexture: 'grass',
      kerbColor: 0x778877, shoulderColor: 0x445544,
      mountainColor: 0x334455, mountainHeight: 0.8, cloudOpacity: 0.35, cloudTint: 0xff8866,
      fenceDensity: 0.4, rockDensity: 0.5, rockColor: 0x556655, bushDensity: 1.5,
      spectatorDensity: 0.8, accentProps: ['palm_trunk', 'tiki_torch'],
      roadDecals: ['puddle', 'lane_paint'], atmosphericEffects: ['fireflies', 'leaves', 'fog_wisps'],
      buildingStyle: 'beach_house', treeVariant: 'palm_frond',
      buildingModels: [],
      buildingDensity: 1.0, buildingRowCount: 2, buildingGapChance: 0.2,
      treeModels: ['palm_tree.glb', 'palm_tree_b.glb', 'palm_tree_c.glb', 'palm_trees_cluster.glb'],
      ambientLights: ['torch_glow', 'window_spill'],
    },
  },




  // ── Gaza City — Dense Levantine, dry Mediterranean dusk ──
  {
    name: 'Gaza City',
    fogColor: 0x8a7a60, fogDensity: 0.00022,
    skyTop: 0x1a1428, skyBottom: 0xcc8844, skyHorizon: 0xeebb66,
    skyMid: 0x664422, horizonGlow: 0xffaa55,
    hemiSky: 0xddbb88, hemiGround: 0x665533, hemiIntensity: 1.0,
    dirColor: 0xffcc88, dirIntensity: 1.7, dirPosition: [-50, 35, 60],
    groundColor: 0x3a3525, exposure: 1.05,
    scenery: {
      roadColor: 0x4a4238, roadRoughness: 0.85,
      barrierColor: 0x7a7060,
      buildingPalette: [0x8a7a60, 0x9a8a70, 0x706050, 0xaa9a80],
      buildingHeightRange: [4, 14],
      windowLitChance: 0.35, windowColor: 0xffcc66,
      treeTrunkColor: 0x554433, treeCanopyColor: 0x4a6a2a,
      treeCanopyStyle: 'sphere', treeCount: 12,
      billboardStyle: 'minimal',
      streetLightColor: 0xffcc66, streetLightDensity: 0.6,
      groundTexture: 'sand',
      kerbColor: 0x998877, shoulderColor: 0x665544,
      mountainColor: 0x7a6a50, mountainHeight: 0.6,
      cloudOpacity: 0.15, cloudTint: 0xeebb66,
      fenceDensity: 0.5, rockDensity: 0.8,
      rockColor: 0x8a7a60, bushDensity: 0.2,
      spectatorDensity: 0.6,
      accentProps: ['traffic_cone', 'debris'],
      roadDecals: ['crack', 'sand_drift'],
      atmosphericEffects: ['dust'],
      buildingStyle: 'levantine',
      buildingModels: [],
      buildingDensity: 2.2, buildingRowCount: 3, buildingGapChance: 0.06,
      treeModels: [],
      ambientLights: ['window_spill'],
    },
  },

  // ── Kiev — Soviet & Classical Eastern European cityscape, cold dusk ──
  {
    name: 'Kiev',
    fogColor: 0x2a2a3a, fogDensity: 0.00022,
    skyTop: 0x1a1a30, skyBottom: 0x3a3a55, skyHorizon: 0x554a40,
    skyMid: 0x2a2a44,
    hemiSky: 0x8899bb, hemiGround: 0x445544, hemiIntensity: 0.9,
    dirColor: 0xeeddcc, dirIntensity: 1.5, dirPosition: [40, 30, 60],
    groundColor: 0x1a2a20, exposure: 1.05,
    scenery: {
      roadColor: 0x2a2a35, roadRoughness: 0.8,
      barrierColor: 0x555560,
      buildingPalette: [0x3a3a4a, 0x44445a, 0x2a2a3a, 0x505060, 0x383845, 0x4a4a5a],
      buildingHeightRange: [6, 22],
      windowLitChance: 0.55, windowColor: 0xffdd88,
      treeTrunkColor: 0x443322, treeCanopyColor: 0x2a4a2a,
      treeCanopyStyle: 'sphere', treeCount: 40,
      billboardStyle: 'minimal',
      streetLightColor: 0xffddaa, streetLightDensity: 0.8,
      groundTexture: 'grass',
      kerbColor: 0x777788, shoulderColor: 0x333340,
      mountainColor: 0x2a2a3a, mountainHeight: 0.8, cloudOpacity: 0.45, cloudTint: 0x3a3a50,
      fenceDensity: 0.6, rockDensity: 0.2, rockColor: 0x555566, bushDensity: 0.6,
      spectatorDensity: 0.7, accentProps: ['traffic_cone', 'debris'],
      roadDecals: ['lane_paint', 'puddle', 'crack'],
      atmosphericEffects: ['fog_wisps'],
      buildingStyle: 'soviet_bloc', treeVariant: 'standard',
      buildingModels: [],
      buildingDensity: 1.8, buildingRowCount: 3, buildingGapChance: 0.1,
      treeModels: ['red_maple.glb', 'red_maple_b.glb', 'oak.glb', 'walnut.glb'],
      ambientLights: ['window_spill'],
    },
  },

  // ── Baghdad — Mesopotamian capital, golden dust haze ──
  {
    name: 'Baghdad',
    fogColor: 0x9a8a60, fogDensity: 0.00025,
    skyTop: 0x1a1020, skyBottom: 0xbb8833, skyHorizon: 0xddaa44,
    skyMid: 0x775522, horizonGlow: 0xeeaa33,
    hemiSky: 0xddcc88, hemiGround: 0x776633, hemiIntensity: 1.0,
    dirColor: 0xffcc77, dirIntensity: 1.8, dirPosition: [-40, 40, 50],
    groundColor: 0x3a3020, exposure: 1.05,
    scenery: {
      roadColor: 0x4a4030, roadRoughness: 0.9,
      barrierColor: 0x887766,
      buildingPalette: [0x9a8a60, 0xaa9a70, 0x807050, 0xbbaa80],
      buildingHeightRange: [5, 16],
      windowLitChance: 0.3, windowColor: 0xffcc55,
      treeTrunkColor: 0x554433, treeCanopyColor: 0x4a6a2a,
      treeCanopyStyle: 'sphere', treeCount: 8,
      billboardStyle: 'minimal',
      streetLightColor: 0xffcc55, streetLightDensity: 0.5,
      groundTexture: 'sand',
      kerbColor: 0xaa9977, shoulderColor: 0x776644,
      mountainColor: 0x8a7a50, mountainHeight: 0.4,
      cloudOpacity: 0.1, cloudTint: 0xddaa55,
      fenceDensity: 0.4, rockDensity: 0.6,
      rockColor: 0x9a8a60, bushDensity: 0.1,
      spectatorDensity: 0.5,
      accentProps: ['traffic_cone', 'debris'],
      roadDecals: ['crack', 'sand_drift'],
      atmosphericEffects: ['dust'],
      buildingStyle: 'mesopotamian',
      buildingModels: [],
      buildingDensity: 2.0, buildingRowCount: 3, buildingGapChance: 0.08,
      treeModels: [],
      ambientLights: ['window_spill'],
    },
  },

  // ── Damascus — Ancient Levantine, ablaq stone and jasmine ──
  {
    name: 'Damascus',
    fogColor: 0x7a6a55, fogDensity: 0.00020,
    skyTop: 0x1a1428, skyBottom: 0xbb7744, skyHorizon: 0xddaa55,
    skyMid: 0x664422, horizonGlow: 0xeebb55,
    hemiSky: 0xccbb88, hemiGround: 0x665533, hemiIntensity: 1.1,
    dirColor: 0xffbb77, dirIntensity: 1.6, dirPosition: [-50, 30, 55],
    groundColor: 0x3a3020, exposure: 1.0,
    scenery: {
      roadColor: 0x454038, roadRoughness: 0.85,
      barrierColor: 0x7a6a55,
      buildingPalette: [0x8a7a55, 0x9a8a65, 0x706045, 0xaa9a75],
      buildingHeightRange: [4, 12],
      windowLitChance: 0.35, windowColor: 0xffcc66,
      treeTrunkColor: 0x554433, treeCanopyColor: 0x3a5a2a,
      treeCanopyStyle: 'sphere', treeCount: 15,
      billboardStyle: 'minimal',
      streetLightColor: 0xffcc55, streetLightDensity: 0.5,
      groundTexture: 'sand',
      kerbColor: 0x998866, shoulderColor: 0x665544,
      mountainColor: 0x7a6a50, mountainHeight: 0.8,
      cloudOpacity: 0.12, cloudTint: 0xddbb55,
      fenceDensity: 0.4, rockDensity: 0.7,
      rockColor: 0x8a7a55, bushDensity: 0.3,
      spectatorDensity: 0.5,
      accentProps: ['traffic_cone', 'debris'],
      roadDecals: ['crack', 'sand_drift'],
      atmosphericEffects: ['dust'],
      buildingStyle: 'damascene',
      buildingModels: [],
      buildingDensity: 2.5, buildingRowCount: 3, buildingGapChance: 0.05,
      treeModels: [],
      ambientLights: ['window_spill'],
    },
  },

  // ── Beirut — Mediterranean jewel, scarred resilience ──
  {
    name: 'Beirut',
    fogColor: 0x5a6a7a, fogDensity: 0.00018,
    skyTop: 0x0a1628, skyBottom: 0x3366aa, skyHorizon: 0xff7744,
    skyMid: 0x224488, horizonGlow: 0xffaa55,
    hemiSky: 0xaabbdd, hemiGround: 0x556655, hemiIntensity: 1.1,
    dirColor: 0xffaa77, dirIntensity: 1.9, dirPosition: [-60, 25, 50],
    groundColor: 0x2a3028, exposure: 1.1,
    scenery: {
      roadColor: 0x3a3a40, roadRoughness: 0.8,
      barrierColor: 0x667788,
      buildingPalette: [0x7a7a88, 0x8a8a98, 0x6a6a78, 0x9a9aa8],
      buildingHeightRange: [4, 18],
      windowLitChance: 0.45, windowColor: 0xffdd77,
      treeTrunkColor: 0x554422, treeCanopyColor: 0x2a5a2a,
      treeCanopyStyle: 'sphere', treeCount: 20,
      billboardStyle: 'minimal',
      streetLightColor: 0xffcc66, streetLightDensity: 0.7,
      groundTexture: 'concrete',
      kerbColor: 0x889988, shoulderColor: 0x556655,
      mountainColor: 0x445566, mountainHeight: 1.2,
      cloudOpacity: 0.25, cloudTint: 0xff8866,
      fenceDensity: 0.5, rockDensity: 0.4,
      rockColor: 0x778877, bushDensity: 0.5,
      spectatorDensity: 0.7,
      accentProps: ['traffic_cone', 'debris'],
      roadDecals: ['crack', 'puddle'],
      atmosphericEffects: ['fog_wisps'],
      buildingStyle: 'levantine_med',
      buildingModels: [],
      buildingDensity: 2.2, buildingRowCount: 3, buildingGapChance: 0.06,
      treeModels: [],
      ambientLights: ['window_spill'],
    },
  },

  // ── Tripoli — North African coast, Italian-Ottoman crossroads ──
  {
    name: 'Tripoli',
    fogColor: 0x6a7a8a, fogDensity: 0.00018,
    skyTop: 0x0a1830, skyBottom: 0x4488cc, skyHorizon: 0xff8855,
    skyMid: 0x3366aa, horizonGlow: 0xffbb66,
    hemiSky: 0xbbccee, hemiGround: 0x667766, hemiIntensity: 1.1,
    dirColor: 0xffbb88, dirIntensity: 1.8, dirPosition: [-55, 30, 60],
    groundColor: 0x2a3525, exposure: 1.1,
    scenery: {
      roadColor: 0x3a3a3a, roadRoughness: 0.75,
      barrierColor: 0x778888,
      buildingPalette: [0x8a8a7a, 0x9a9a8a, 0x7a7a6a, 0xaaaa9a],
      buildingHeightRange: [3, 12],
      windowLitChance: 0.4, windowColor: 0xffdd88,
      treeTrunkColor: 0x554433, treeCanopyColor: 0x3a5a2a,
      treeCanopyStyle: 'cone', treeCount: 18,
      billboardStyle: 'minimal',
      streetLightColor: 0xffcc66, streetLightDensity: 0.6,
      groundTexture: 'sand',
      kerbColor: 0x99aa88, shoulderColor: 0x667755,
      mountainColor: 0x556666, mountainHeight: 0.5,
      cloudOpacity: 0.2, cloudTint: 0xffaa66,
      fenceDensity: 0.4, rockDensity: 0.5,
      rockColor: 0x8a8a7a, bushDensity: 0.3,
      spectatorDensity: 0.6,
      accentProps: ['traffic_cone', 'debris'],
      roadDecals: ['crack', 'sand_drift'],
      atmosphericEffects: ['dust'],
      buildingStyle: 'north_african',
      buildingModels: [],
      buildingDensity: 1.8, buildingRowCount: 2, buildingGapChance: 0.1,
      treeModels: [],
      ambientLights: ['window_spill'],
    },
  },

  // ── Mogadishu — Indian Ocean port, coral stone and sea breeze ──
  {
    name: 'Mogadishu',
    fogColor: 0x8a9a9a, fogDensity: 0.00015,
    skyTop: 0x0a1830, skyBottom: 0x55aadd, skyHorizon: 0xff9966,
    skyMid: 0x3388bb, horizonGlow: 0xffbb77,
    hemiSky: 0xccddee, hemiGround: 0x777766, hemiIntensity: 1.2,
    dirColor: 0xffcc88, dirIntensity: 2.0, dirPosition: [-40, 45, 50],
    groundColor: 0x3a3520, exposure: 1.15,
    scenery: {
      roadColor: 0x4a4538, roadRoughness: 0.9,
      barrierColor: 0x999988,
      buildingPalette: [0x9a9a88, 0xaaaa98, 0x8a8a78, 0xbbbbaa],
      buildingHeightRange: [3, 10],
      windowLitChance: 0.25, windowColor: 0xffcc55,
      treeTrunkColor: 0x554433, treeCanopyColor: 0x3a6a2a,
      treeCanopyStyle: 'sphere', treeCount: 10,
      billboardStyle: 'minimal',
      streetLightColor: 0xffcc55, streetLightDensity: 0.4,
      groundTexture: 'sand',
      kerbColor: 0xaa9977, shoulderColor: 0x776644,
      mountainColor: 0x8a8a70, mountainHeight: 0.3,
      cloudOpacity: 0.2, cloudTint: 0xffbb77,
      fenceDensity: 0.3, rockDensity: 0.6,
      rockColor: 0x9a9a88, bushDensity: 0.15,
      spectatorDensity: 0.4,
      accentProps: ['traffic_cone', 'debris'],
      roadDecals: ['crack', 'sand_drift'],
      atmosphericEffects: ['dust'],
      buildingStyle: 'somali_coastal',
      buildingModels: [],
      buildingDensity: 1.5, buildingRowCount: 2, buildingGapChance: 0.15,
      treeModels: [],
      ambientLights: ['window_spill'],
    },
  },

  // ── Tehran — Persian capital, Alborz mountain backdrop ──
  {
    name: 'Tehran',
    fogColor: 0x6a6a7a, fogDensity: 0.00022,
    skyTop: 0x0a0a1a, skyBottom: 0x884466, skyHorizon: 0xcc7755,
    skyMid: 0x553355, horizonGlow: 0xddaa66,
    hemiSky: 0xbbaacc, hemiGround: 0x555544, hemiIntensity: 1.0,
    dirColor: 0xffbb88, dirIntensity: 1.6, dirPosition: [50, 35, -40],
    groundColor: 0x2a2a25, exposure: 1.05,
    scenery: {
      roadColor: 0x3a3838, roadRoughness: 0.8,
      barrierColor: 0x666677,
      buildingPalette: [0x7a7a7a, 0x8a8a8a, 0x6a6a6a, 0x9a9a9a],
      buildingHeightRange: [5, 20],
      windowLitChance: 0.5, windowColor: 0xffdd88,
      treeTrunkColor: 0x443322, treeCanopyColor: 0x2a4a2a,
      treeCanopyStyle: 'sphere', treeCount: 18,
      billboardStyle: 'minimal',
      streetLightColor: 0xffcc66, streetLightDensity: 0.7,
      groundTexture: 'concrete',
      kerbColor: 0x888888, shoulderColor: 0x555555,
      mountainColor: 0x556688, mountainHeight: 2.5,
      cloudOpacity: 0.15, cloudTint: 0xcc8866,
      fenceDensity: 0.6, rockDensity: 0.5,
      rockColor: 0x777788, bushDensity: 0.3,
      spectatorDensity: 0.6,
      accentProps: ['traffic_cone', 'debris'],
      roadDecals: ['crack', 'manhole'],
      atmosphericEffects: ['dust', 'fog_wisps'],
      buildingStyle: 'persian',
      buildingModels: [],
      buildingDensity: 2.2, buildingRowCount: 3, buildingGapChance: 0.06,
      treeModels: [],
      ambientLights: ['window_spill'],
    },
  },

  // ── Khartoum — Nile confluence, red brick and white dust ──
  {
    name: 'Khartoum',
    fogColor: 0x9a8a70, fogDensity: 0.00028,
    skyTop: 0x1a1020, skyBottom: 0xcc8833, skyHorizon: 0xeeaa44,
    skyMid: 0x885522, horizonGlow: 0xffbb44,
    hemiSky: 0xddcc88, hemiGround: 0x886644, hemiIntensity: 1.1,
    dirColor: 0xffcc77, dirIntensity: 1.9, dirPosition: [-30, 50, 40],
    groundColor: 0x3a2a18, exposure: 1.1,
    scenery: {
      roadColor: 0x4a3a2a, roadRoughness: 0.9,
      barrierColor: 0x887755,
      buildingPalette: [0x8a6a45, 0x9a7a55, 0x7a5a35, 0xaa8a65],
      buildingHeightRange: [3, 10],
      windowLitChance: 0.25, windowColor: 0xffcc55,
      treeTrunkColor: 0x554433, treeCanopyColor: 0x4a7a2a,
      treeCanopyStyle: 'sphere', treeCount: 8,
      billboardStyle: 'minimal',
      streetLightColor: 0xffcc55, streetLightDensity: 0.4,
      groundTexture: 'sand',
      kerbColor: 0xaa8866, shoulderColor: 0x775533,
      mountainColor: 0x8a7a50, mountainHeight: 0.3,
      cloudOpacity: 0.08, cloudTint: 0xddaa44,
      fenceDensity: 0.3, rockDensity: 0.5,
      rockColor: 0x8a6a45, bushDensity: 0.1,
      spectatorDensity: 0.4,
      accentProps: ['traffic_cone', 'debris'],
      roadDecals: ['crack', 'sand_drift'],
      atmosphericEffects: ['dust'],
      buildingStyle: 'nile_brick',
      buildingModels: [],
      buildingDensity: 1.5, buildingRowCount: 2, buildingGapChance: 0.12,
      treeModels: [],
      ambientLights: ['window_spill'],
    },
  },

  // ── Chennai — South Indian tropical metropolis, monsoon dusk ──
  {
    name: 'Chennai',
    fogColor: 0x5a6a55, fogDensity: 0.00022,
    skyTop: 0x0a1428, skyBottom: 0x884455, skyHorizon: 0xff7744,
    skyMid: 0x553344, horizonGlow: 0xffaa55,
    hemiSky: 0xccbbaa, hemiGround: 0x665544, hemiIntensity: 1.1,
    dirColor: 0xffbb77, dirIntensity: 1.8, dirPosition: [-50, 30, 55],
    groundColor: 0x2a2820, exposure: 1.1,
    scenery: {
      roadColor: 0x3a3530, roadRoughness: 0.85,
      barrierColor: 0x776655,
      buildingPalette: [0x8a7a55, 0x9a8a65, 0x706045, 0xaa9a75],
      buildingHeightRange: [4, 14],
      windowLitChance: 0.4, windowColor: 0xffcc66,
      treeTrunkColor: 0x554433, treeCanopyColor: 0x2a5a2a,
      treeCanopyStyle: 'sphere', treeCount: 25,
      billboardStyle: 'minimal',
      streetLightColor: 0xffcc55, streetLightDensity: 0.6,
      groundTexture: 'concrete',
      kerbColor: 0x998877, shoulderColor: 0x665544,
      mountainColor: 0x556644, mountainHeight: 0.3,
      cloudOpacity: 0.3, cloudTint: 0xff8866,
      fenceDensity: 0.5, rockDensity: 0.3,
      rockColor: 0x887766, bushDensity: 0.6,
      spectatorDensity: 0.7,
      accentProps: ['traffic_cone', 'debris'],
      roadDecals: ['crack', 'puddle'],
      atmosphericEffects: ['fog_wisps'],
      buildingStyle: 'levantine', // placeholder — reuse Gaza atlas
      buildingModels: [],
      buildingDensity: 2.0, buildingRowCount: 3, buildingGapChance: 0.08,
      treeModels: [],
      ambientLights: ['window_spill'],
    },
  },

  // ── Sukhumi — War-scarred Black Sea resort, overgrown ruins ──
  {
    name: 'Sukhumi',
    fogColor: 0x5a6a6a, fogDensity: 0.00025,
    skyTop: 0x1a2030, skyBottom: 0x4a6a7a, skyHorizon: 0x8a9aaa,
    skyMid: 0x3a5060, horizonGlow: 0xaabbcc,
    hemiSky: 0xaabbcc, hemiGround: 0x556655, hemiIntensity: 0.9,
    dirColor: 0xddeeff, dirIntensity: 1.3, dirPosition: [40, 35, 50],
    groundColor: 0x2a3a2a, exposure: 1.0,
    scenery: {
      roadColor: 0x3a3a38, roadRoughness: 0.9,
      barrierColor: 0x667766,
      buildingPalette: [0x7a8a7a, 0x8a9a8a, 0x6a7a6a, 0x9aaa9a],
      buildingHeightRange: [3, 10],
      windowLitChance: 0.2, windowColor: 0xffddaa,
      treeTrunkColor: 0x443322, treeCanopyColor: 0x2a5a2a,
      treeCanopyStyle: 'sphere', treeCount: 40,
      billboardStyle: 'none',
      streetLightColor: 0xddddcc, streetLightDensity: 0.3,
      groundTexture: 'grass',
      kerbColor: 0x778877, shoulderColor: 0x556655,
      mountainColor: 0x445566, mountainHeight: 1.5,
      cloudOpacity: 0.4, cloudTint: 0xaabbcc,
      fenceDensity: 0.3, rockDensity: 0.8,
      rockColor: 0x778877, bushDensity: 1.0,
      spectatorDensity: 0.3,
      accentProps: ['debris'],
      roadDecals: ['crack', 'puddle'],
      atmosphericEffects: ['fog_wisps', 'leaves'],
      buildingStyle: 'weathered', // placeholder — reuse weathered atlas
      buildingModels: [],
      buildingDensity: 1.2, buildingRowCount: 2, buildingGapChance: 0.25,
      treeModels: [],
      ambientLights: ['window_spill'],
    },
  },

  // ── Shanghai — Bund Art Deco meets Pudong supertalls ──
  {
    name: 'Shanghai',
    fogColor: 0x1a1a2e, fogDensity: 0.00020,
    skyTop: 0x050510, skyBottom: 0x0a1a3a, skyHorizon: 0x2a2040,
    skyMid: 0x101530, horizonGlow: 0x3a2050,
    hemiSky: 0x5588cc, hemiGround: 0x222244, hemiIntensity: 0.8,
    dirColor: 0xddbbff, dirIntensity: 1.6, dirPosition: [30, 60, -40],
    groundColor: 0x0a0a14, exposure: 1.15,
    scenery: {
      roadColor: 0x1a1a22, roadRoughness: 0.4,
      barrierColor: 0x2a2a40,
      buildingPalette: [0x1a1a30, 0x222240, 0x151535, 0x2a2a45],
      buildingHeightRange: [10, 35],
      windowLitChance: 0.75, windowColor: 0x55aaff,
      treeTrunkColor: 0x111111, treeCanopyColor: 0x001122,
      treeCanopyStyle: 'none', treeCount: 5,
      billboardStyle: 'neon',
      streetLightColor: 0xcc88ff, streetLightDensity: 1.2,
      groundTexture: 'concrete',
      kerbColor: 0x333355, shoulderColor: 0x111122,
      mountainColor: 0x0a0a1a, mountainHeight: 0.3,
      cloudOpacity: 0.15, cloudTint: 0x2a2040,
      fenceDensity: 1.0, rockDensity: 0.0, rockColor: 0x111122, bushDensity: 0.0,
      spectatorDensity: 0.6,
      accentProps: ['neon_strip', 'traffic_cone'],
      roadDecals: ['lane_paint', 'manhole', 'puddle'],
      atmosphericEffects: ['steam', 'fog_wisps'],
      buildingStyle: 'shanghai',
      buildingModels: [],
      buildingDensity: 2.5, buildingRowCount: 3, buildingGapChance: 0.05,
      treeModels: [],
      ambientLights: ['neon_edge', 'window_spill'],
    },
  },

  // ── Sochi — Black Sea resort town, subtropical coastline ──
  {
    name: 'Sochi',
    fogColor: 0x5a7a8a, fogDensity: 0.00018,
    skyTop: 0x0a1830, skyBottom: 0x3388bb, skyHorizon: 0xff8855,
    skyMid: 0x2266aa, horizonGlow: 0xffaa66,
    hemiSky: 0xbbddee, hemiGround: 0x557766, hemiIntensity: 1.1,
    dirColor: 0xffbb88, dirIntensity: 1.9, dirPosition: [-60, 28, 55],
    groundColor: 0x1a2a20, exposure: 1.1,
    scenery: {
      roadColor: 0x3a3a40, roadRoughness: 0.7,
      barrierColor: 0x667788,
      buildingPalette: [0x7a8a8a, 0x8a9a9a, 0x6a7a7a, 0x9aaaaa],
      buildingHeightRange: [4, 14],
      windowLitChance: 0.5, windowColor: 0xffdd88,
      treeTrunkColor: 0x554422, treeCanopyColor: 0x2a5a2a,
      treeCanopyStyle: 'sphere', treeCount: 35,
      billboardStyle: 'minimal',
      streetLightColor: 0xffcc66, streetLightDensity: 0.6,
      groundTexture: 'grass',
      kerbColor: 0x889988, shoulderColor: 0x557766,
      mountainColor: 0x446666, mountainHeight: 1.8,
      cloudOpacity: 0.25, cloudTint: 0xff9966,
      fenceDensity: 0.4, rockDensity: 0.5,
      rockColor: 0x778888, bushDensity: 0.7,
      spectatorDensity: 0.6,
      accentProps: ['traffic_cone', 'debris'],
      roadDecals: ['puddle', 'lane_paint'],
      atmosphericEffects: ['fog_wisps', 'leaves'],
      buildingStyle: 'soviet_bloc', // placeholder — reuse Kiev atlas
      buildingModels: [],
      buildingDensity: 1.8, buildingRowCount: 2, buildingGapChance: 0.12,
      treeModels: [],
      ambientLights: ['window_spill'],
    },
  },

  // ── Tokyo — Neon-drenched megacity, wet reflective streets ──
  {
    name: 'Tokyo',
    fogColor: 0x0a0a1e, fogDensity: 0.00030,
    skyTop: 0x050510, skyBottom: 0x0a0a2a, skyHorizon: 0x1a0530,
    hemiSky: 0x4488ff, hemiGround: 0x220044, hemiIntensity: 0.65,
    dirColor: 0xcc44ff, dirIntensity: 1.5, dirPosition: [30, 60, -40],
    groundColor: 0x0a0a14, exposure: 1.15,
    scenery: {
      roadColor: 0x121218, roadRoughness: 0.35,
      barrierColor: 0x1a1a30,
      buildingPalette: [0x0a0a1a, 0x101025, 0x0d0d20, 0x151530, 0x0a1020, 0x152030],
      buildingHeightRange: [12, 35],
      windowLitChance: 0.8, windowColor: 0x44aaff,
      treeTrunkColor: 0x111111, treeCanopyColor: 0x001122,
      treeCanopyStyle: 'none', treeCount: 0,
      billboardStyle: 'neon',
      streetLightColor: 0xcc44ff, streetLightDensity: 1.5,
      groundTexture: 'concrete',
      kerbColor: 0x333355, shoulderColor: 0x111122,
      mountainColor: 0x050510, mountainHeight: 0.5, cloudOpacity: 0.1, cloudTint: 0x1a0530,
      fenceDensity: 1.2, rockDensity: 0.0, rockColor: 0x111122, bushDensity: 0.0,
      spectatorDensity: 0.5,
      accentProps: ['neon_strip', 'traffic_cone', 'smokestack'],
      roadDecals: ['lane_paint', 'manhole', 'frost'],
      atmosphericEffects: ['steam', 'embers'],
      buildingStyle: 'modern', // placeholder — reuse DC atlas
      buildingModels: [],
      buildingDensity: 2.5, buildingRowCount: 3, buildingGapChance: 0.05,
      treeModels: [],
      ambientLights: ['neon_edge', 'neon_pool'],
    },
  },

  // ── Montclair — Virginia suburban, strip malls and colonial brick ──
  {
    name: 'Montclair',
    fogColor: 0x2a3a4a, fogDensity: 0.00020,
    skyTop: 0x0d1020, skyBottom: 0x1a2a3a, skyHorizon: 0x2a2030,
    hemiSky: 0x88aacc, hemiGround: 0x445533, hemiIntensity: 1.0,
    dirColor: 0xffeedd, dirIntensity: 1.6, dirPosition: [50, 60, 30],
    groundColor: 0x1a2a1a, exposure: 1.05,
    scenery: {
      roadColor: 0x2a2a30, roadRoughness: 0.7,
      barrierColor: 0x555560,
      buildingPalette: [0x3a2a20, 0x4a3a30, 0x554433, 0x665544],
      buildingHeightRange: [3, 8],
      windowLitChance: 0.55, windowColor: 0xffddaa,
      treeTrunkColor: 0x443322, treeCanopyColor: 0x2a4a2a,
      treeCanopyStyle: 'sphere', treeCount: 40,
      billboardStyle: 'minimal',
      streetLightColor: 0xffdd88, streetLightDensity: 0.8,
      groundTexture: 'grass',
      kerbColor: 0x888888, shoulderColor: 0x444444,
      mountainColor: 0x2a3a2a, mountainHeight: 0.5, cloudOpacity: 0.3, cloudTint: 0x3a3a50,
      fenceDensity: 0.8, rockDensity: 0.2, rockColor: 0x555555, bushDensity: 0.8,
      spectatorDensity: 0.8,
      accentProps: ['traffic_cone', 'dumpster'],
      roadDecals: ['lane_paint', 'manhole', 'puddle'],
      buildingStyle: 'modern', // placeholder — reuse DC atlas
      buildingModels: [],
      buildingDensity: 1.5, buildingRowCount: 2, buildingGapChance: 0.15,
      treeModels: [],
      ambientLights: ['window_spill'],
    },
  },

  // ── Lille — Flemish Baroque, red brick and ornate gables ──
  {
    name: 'Lille',
    fogColor: 0x3a3a4a, fogDensity: 0.00025,
    skyTop: 0x1a2030, skyBottom: 0x3a4050, skyHorizon: 0x5a5a6a,
    skyMid: 0x2a3040, horizonGlow: 0x6a6a7a,
    hemiSky: 0x99aabb, hemiGround: 0x554433, hemiIntensity: 0.9,
    dirColor: 0xeeddcc, dirIntensity: 1.4, dirPosition: [40, 35, 50],
    groundColor: 0x1a1a18, exposure: 1.0,
    scenery: {
      roadColor: 0x2a2a28, roadRoughness: 0.7,
      barrierColor: 0x555555,
      buildingPalette: [0x5a3a2a, 0x6a4a3a, 0x7a5a4a, 0x8a6a5a],
      buildingHeightRange: [4, 12],
      windowLitChance: 0.55, windowColor: 0xffddaa,
      treeTrunkColor: 0x443322, treeCanopyColor: 0x2a4a2a,
      treeCanopyStyle: 'sphere', treeCount: 25,
      billboardStyle: 'minimal',
      streetLightColor: 0xeeddcc, streetLightDensity: 0.7,
      groundTexture: 'concrete',
      kerbColor: 0x777777, shoulderColor: 0x444444,
      mountainColor: 0x3a3a4a, mountainHeight: 0.3, cloudOpacity: 0.45, cloudTint: 0x5a5a6a,
      fenceDensity: 0.6, rockDensity: 0.2, rockColor: 0x555555, bushDensity: 0.4,
      spectatorDensity: 0.7,
      accentProps: ['traffic_cone', 'dumpster'],
      roadDecals: ['lane_paint', 'manhole', 'puddle'],
      atmosphericEffects: ['fog_wisps'],
      buildingStyle: 'modern', // placeholder — reuse DC atlas
      buildingModels: [],
      buildingDensity: 2.0, buildingRowCount: 3, buildingGapChance: 0.08,
      treeModels: [],
      ambientLights: ['window_spill'],
    },
  },

  // ── Nuuk — Arctic Greenlandic capital, fjord ice and northern lights ──
  {
    name: 'Nuuk',
    fogColor: 0x4a5a6a, fogDensity: 0.00030,
    skyTop: 0x050818, skyBottom: 0x1a3050, skyHorizon: 0x2a5a4a,
    skyMid: 0x102838, horizonGlow: 0x3a8a6a,
    hemiSky: 0x5588aa, hemiGround: 0x334455, hemiIntensity: 0.8,
    dirColor: 0xaaddee, dirIntensity: 1.2, dirPosition: [60, 20, 40],
    groundColor: 0x1a2a3a, exposure: 1.0,
    scenery: {
      roadColor: 0x2a3040, roadRoughness: 0.5,
      barrierColor: 0x556677,
      buildingPalette: [0x3a4a5a, 0x4a5a6a, 0x5a6a7a, 0x6a7a8a],
      buildingHeightRange: [3, 7],
      windowLitChance: 0.7, windowColor: 0xffddaa,
      treeTrunkColor: 0x333333, treeCanopyColor: 0x1a3a2a,
      treeCanopyStyle: 'none', treeCount: 3,
      billboardStyle: 'none',
      streetLightColor: 0xaaddee, streetLightDensity: 0.6,
      groundTexture: 'snow',
      kerbColor: 0x667788, shoulderColor: 0x445566,
      mountainColor: 0x3a5a7a, mountainHeight: 2.5, cloudOpacity: 0.3, cloudTint: 0x4a6a7a,
      fenceDensity: 0.3, rockDensity: 1.2, rockColor: 0x4a5a6a, bushDensity: 0.0,
      spectatorDensity: 0.3,
      accentProps: ['snow_bollard', 'debris'],
      roadDecals: ['frost'],
      atmosphericEffects: ['snow_extra', 'fog_wisps'],
      buildingStyle: 'weathered', // placeholder — reuse weathered atlas
      buildingModels: [],
      buildingDensity: 0.6, buildingRowCount: 1, buildingGapChance: 0.35,
      treeModels: [],
      ambientLights: ['hazard_flasher'],
    },
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
  const backendName = (renderer as any).backend?.constructor?.name ?? 'unknown';
  _backendIsWebGPU = backendName.includes('WebGPU');
  console.log(`[scene] Renderer backend: ${backendName} (WebGPU: ${_backendIsWebGPU})`);

  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = null;

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 10, 20);

  const isMobileScene = window.matchMedia('(pointer: coarse)').matches;

  // Subtle IBL for material reflections — skip on mobile (too heavy for 4GB devices)
  if (!isMobileScene) {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envMap = pmremGenerator.fromScene(new RoomEnvironment()).texture;
    scene.environment = envMap;
    scene.environmentIntensity = 0.35;
    pmremGenerator.dispose();
  }

  hemiLight = new THREE.HemisphereLight(0x88aacc, 0x444422, 1.0);
  scene.add(hemiLight);

  dirLight = new THREE.DirectionalLight(0xffeedd, 2.0);
  dirLight.position.set(50, 80, 30);
  dirLight.castShadow = !isMobileScene; // Disable shadows on mobile entirely
  if (dirLight.castShadow) {
    const shadowRes = 2048;
    dirLight.shadow.mapSize.set(shadowRes, shadowRes);
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 200;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
  }
  scene.add(dirLight);
  scene.add(dirLight.target);

  // ── Ground terrain (TSL NodeMaterial with vertex displacement) ──
  // Round 2 fix: 256×256 subdivisions (was 128) — finer displacement at road edges
  const groundGeo = new THREE.PlaneGeometry(1200, 1200, 256, 256);
  const _groundTex = createGroundTexture();
  const groundMat = new MeshStandardNodeMaterial({
    roughness: 0.85, metalness: 0.05,
  });
  // ── Ground colorNode: distance-based 4-zone atlas blending ──
  // Blends 4 terrain zones (shoulder/urban/open/far) by sampling
  // a baked distance-from-spline texture. Falls back to flat
  // uGroundColor when the 1x1 default atlas is loaded.

  const worldXZ = positionWorld.xz;

  // Sample distance field with custom UVs
  const dfUV = vec2(add(mul(worldXZ.x, 1.0 / 1200), 0.5), add(mul(worldXZ.y, 1.0 / 1200), 0.5));
  const dist = texture(_dftTexture, dfUV).x;

  // Zone thresholds
  const t01 = smoothstep(0.05, 0.12, dist);  // shoulder → urban
  const t12 = smoothstep(0.15, 0.25, dist);  // urban → open
  const t23 = smoothstep(0.45, 0.65, dist);  // open → far

  // Position-based hash for variant blending (soft 0→1 instead of hard step)
  const cellXZ = floor(mul(worldXZ, 0.08));  // ~12.5m cells
  const hashVal = fract(mul(sin(add(mul(cellXZ.x, 127.1), mul(cellXZ.y, 311.7))), 43758.5453));
  const variant = smoothstep(0.3, 0.7, hashVal);  // soft blend between A/B tiles

  // Per-cell UV rotation to break axis-aligned grid repetition
  const rotAngle = mul(fract(mul(sin(add(mul(cellXZ.x, 43.7), mul(cellXZ.y, 89.3))), 9381.7)), 6.283);
  const cosR = cos(rotAngle);
  const sinR = sin(rotAngle);

  // Per-zone tiling scales (tighter near road, larger far away)
  const tileUV0 = fract(mul(worldXZ, 0.18));  // shoulder: tight detail
  const tileUV1 = fract(mul(worldXZ, 0.14));  // urban: medium
  const tileUV2 = fract(mul(worldXZ, 0.10));  // open: looser
  const tileUV3 = fract(mul(worldXZ, 0.07));  // far: sparse, large tiles

  // Rotate UV around (0.5, 0.5) center per cell
  const doRotUV = (uvIn: typeof tileUV0) => {
    const cx = add(uvIn.x, -0.5);
    const cy = add(uvIn.y, -0.5);
    return vec2(add(add(mul(cx, cosR), mul(mul(cy, sinR), -1)), 0.5),
                add(add(mul(cx, sinR), mul(cy, cosR)), 0.5));
  };
  const ruv0 = doRotUV(tileUV0);
  const ruv1 = doRotUV(tileUV1);
  const ruv2 = doRotUV(tileUV2);
  const ruv3 = doRotUV(tileUV3);

  const tw = float(0.125);  // 1/8 atlas width per tile

  // Sample atlas tiles — per-zone UVs, soft A/B variant blending
  const c0a = texture(_groundAtlasTexture, vec2(add(mul(ruv0.x, tw), mul(tw, 0)), ruv0.y));
  const c0b = texture(_groundAtlasTexture, vec2(add(mul(ruv0.x, tw), mul(tw, 1)), ruv0.y));
  const c0 = mix(c0a, c0b, variant);
  const c1a = texture(_groundAtlasTexture, vec2(add(mul(ruv1.x, tw), mul(tw, 2)), ruv1.y));
  const c1b = texture(_groundAtlasTexture, vec2(add(mul(ruv1.x, tw), mul(tw, 3)), ruv1.y));
  const c1 = mix(c1a, c1b, variant);
  const c2a = texture(_groundAtlasTexture, vec2(add(mul(ruv2.x, tw), mul(tw, 4)), ruv2.y));
  const c2b = texture(_groundAtlasTexture, vec2(add(mul(ruv2.x, tw), mul(tw, 5)), ruv2.y));
  const c2 = mix(c2a, c2b, variant);
  const c3a = texture(_groundAtlasTexture, vec2(add(mul(ruv3.x, tw), mul(tw, 6)), ruv3.y));
  const c3b = texture(_groundAtlasTexture, vec2(add(mul(ruv3.x, tw), mul(tw, 7)), ruv3.y));
  const c3 = mix(c3a, c3b, variant);

  // Blend zones
  const atlasColor = mix(mix(mix(c0, c1, t01), c2, t12), c3, t23);

  // Per-cell subtle color variation (±5% luminance jitter)
  const cellLum = add(0.95, mul(fract(mul(sin(add(mul(cellXZ.x, 71.3), mul(cellXZ.y, 173.9))), 28571.3)), 0.10));
  const tintedAtlas = mul(atlasColor.xyz, cellLum);

  // Mix with fallback ground color (atlas alpha controls blend)
  groundMat.colorNode = mix(vec3(uGroundColor), tintedAtlas, atlasColor.a);

  // Vertex displacement: gentle rolling terrain via layered sine noise
  // Operates in the XZ plane of the undisplaced geometry (before rotation)
  const gx = positionLocal.x;
  const gz = positionLocal.y; // PlaneGeometry lies in XY, rotated to XZ
  const hill1 = sin(mul(gx, 0.008)).mul(cos(mul(gz, 0.012))).mul(2.0);
  const hill2 = sin(mul(gx, 0.022).add(3.7)).mul(sin(mul(gz, 0.018).add(1.2))).mul(1.0);
  const hill3 = cos(mul(gx, 0.045).add(7.1)).mul(sin(mul(gz, 0.035).add(5.3))).mul(0.5);
  const terrain = add(add(hill1, hill2), hill3);
  // Round 3: dead zone pushed far out — hills don't start until ~117 units from road center
  const dispDamp = smoothstep(0.35, 0.60, dist);
  // Round 3: deep trench (-2.0) around the road. At dist≈0.15 the ground is forced
  // 2.0 units below the base plane, guaranteeing it stays well under the road surface
  // even on flat sections. The bell shape fades back to 0 by dist≈0.40.
  const transitionDip = mul(mul(smoothstep(0.0, 0.15, dist), smoothstep(0.45, 0.15, dist)), -2.5);
  const dampedTerrain = add(mul(terrain, dispDamp), transitionDip);
  // Displace along Z (which becomes Y after -90° X rotation)
  groundMat.positionNode = add(positionLocal, vec3(0, 0, dampedTerrain));

  // polygonOffset: GPU depth-bias to resolve any remaining Z-fighting
  groundMat.polygonOffset = true;
  groundMat.polygonOffsetFactor = 5;
  groundMat.polygonOffsetUnits = 5;

  groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  // Round 3: ground base at Y=-0.5 — full half-meter below road surface
  groundMesh.position.y = -0.6;
  groundMesh.receiveShadow = true;
  groundMesh.renderOrder = -1;
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

/** Update the baked distance field texture for ground zone blending.
 *  Call after track generation with the DFT from TrackData.
 *  Copies data into the existing texture object because TSL texture() nodes
 *  capture the object reference at material creation time. */
export function updateGroundDistanceField(dft: THREE.DataTexture) {
  // Copy image data into the existing texture (TSL holds a ref to the original object)
  _dftTexture.image = dft.image;
  _dftTexture.format = dft.format;
  _dftTexture.type = dft.type;
  _dftTexture.needsUpdate = true;
  // Force material rebuild with new DFT
  if (groundMesh) {
    (groundMesh.material as MeshStandardNodeMaterial).needsUpdate = true;
  }
}

/** CPU-side terrain height at world (x, z) — matches GPU vertex displacement.
 *  Note: does NOT apply DFT damping (GPU-only). Buildings are placed far from
 *  the road, so they should always be in the fully-displaced region. */
export function getTerrainHeight(x: number, z: number): number {
  const h1 = Math.sin(x * 0.008) * Math.cos(z * 0.012) * 2.0;
  const h2 = Math.sin(x * 0.022 + 3.7) * Math.sin(z * 0.018 + 1.2) * 1.0;
  const h3 = Math.cos(x * 0.045 + 7.1) * Math.sin(z * 0.035 + 5.3) * 0.5;
  return h1 + h2 + h3; // ground mesh at y=0, displacement is relative
}

/** Apply an environment preset to the scene. Call after initScene. */
export function applyEnvironment(preset: EnvironmentPreset) {
  _currentPreset = preset;
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
    _tmpColorA.setHex(preset.skyTop);
    _tmpColorB.setHex(preset.skyHorizon);
    uSkyMid.value.copy(_tmpColorA).lerp(_tmpColorB, 0.4);
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

  // Load ground atlas texture for this environment (if available)
  const atlasPath = GROUND_ATLAS[preset.name];
  if (atlasPath) {
    new THREE.TextureLoader().load(atlasPath, (tex) => {
      // Convert loaded image (HTMLImageElement) to pixel data so we can
      // keep _groundAtlasTexture as a DataTexture. WebGPU crashes if a
      // DataTexture's image is swapped to an HTMLImageElement mid-flight.
      const img = tex.image as HTMLImageElement;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Replace DataTexture internals with matching-format pixel data
      const dt = _groundAtlasTexture as THREE.DataTexture;
      dt.image = { data: new Uint8Array(imageData.data.buffer), width: canvas.width, height: canvas.height };
      dt.format = THREE.RGBAFormat;
      dt.type = THREE.UnsignedByteType;
      dt.wrapS = THREE.RepeatWrapping;
      dt.wrapT = THREE.RepeatWrapping;
      dt.magFilter = THREE.LinearFilter;
      dt.minFilter = THREE.LinearMipmapLinearFilter;
      dt.anisotropy = 4;
      dt.generateMipmaps = true;
      dt.needsUpdate = true;
      // Dispose the loader's temp texture (we only needed its image data)
      tex.dispose();
      // Force material rebuild
      if (groundMesh) {
        (groundMesh.material as MeshStandardNodeMaterial).needsUpdate = true;
      }
    });
  } else {
    // No atlas for this environment — reset to transparent so groundColor shows
    const dt = _groundAtlasTexture as THREE.DataTexture;
    dt.image = { data: new Uint8Array(4 * 4 * 4).fill(0), width: 4, height: 4 };
    dt.needsUpdate = true;
    if (groundMesh) (groundMesh.material as MeshStandardNodeMaterial).needsUpdate = true;
  }

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

function getRenderer() { return renderer; }
export function getScene() { return scene; }
function getCamera() { return camera; }
export function getDirLight() { return dirLight; }

// Reusable temp Colors for applyEnvironment derivations
const _tmpColorA = new THREE.Color();
const _tmpColorB = new THREE.Color();

let _currentPreset: EnvironmentPreset = ENVIRONMENTS[0];

/** Get the currently active scenery theme. */
export function getCurrentTheme(): SceneryTheme { return _currentPreset.scenery; }
/** Get the currently active environment preset. */
function getCurrentPreset(): EnvironmentPreset { return _currentPreset; }

/**
 * Darken sky and lighting for rain/storm weather.
 * Call AFTER applyEnvironment() + initWeather().
 */
export function applyWeatherSkyDarkening(weather: string) {
  // Darkening amounts by weather type
  const darken: Record<string, number> = {
    light_rain: 0.15, heavy_rain: 0.30, snow: 0.10, blizzard: 0.40,
  };
  const amount = darken[weather] ?? 0;
  if (amount === 0) return;

  // Darken sky uniforms
  uSkyTop.value.offsetHSL(0, 0, -amount * 0.5);
  uSkyBottom.value.offsetHSL(0, 0, -amount * 0.4);
  uSkyHorizon.value.offsetHSL(0, 0, -amount * 0.3);
  uSkyMid.value.offsetHSL(0, 0, -amount * 0.4);

  // Reduce directional light (sun dimmed by clouds)
  dirLight.intensity *= (1 - amount * 0.6);

  // Slightly boost hemisphere ambient for moody overcast feel
  hemiLight.intensity *= (1 + amount * 0.3);

  // Increase fog density slightly for rain haze
  if (scene.fog && scene.fog instanceof THREE.FogExp2) {
    scene.fog.density *= (1 + amount * 0.5);
  }
}
