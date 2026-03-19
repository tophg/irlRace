/* ── Hood Racer — Scene Setup + Environment Presets ──
 *
 * Uses WebGPURenderer (auto-fallback to WebGL2).
 * Sky dome uses TSL NodeMaterial with animated gradient, stars, and cloud wisps.
 * Ground uses vertex-displaced terrain with noise-based rolling hills.
 */

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  mix, smoothstep, normalWorld, uniform, vec3, float,
  sin, cos, mul, add, fract, max,
  step, positionLocal,
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
  treeVariant?: string;            // e.g. 'standard', 'joshua', 'layered_pine', 'palm_frond', 'snow_capped'
  ambientLights?: string[];        // e.g. ['neon_edge', 'hazard_flasher', 'neon_pool', 'window_spill', 'torch_glow']
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
  {
    name: 'Urban Night',
    fogColor: 0x1a1a2e, fogDensity: 0.0003,
    skyTop: 0x0d0d1a, skyBottom: 0x1a1a3a, skyHorizon: 0x2a1a30,
    hemiSky: 0x88aacc, hemiGround: 0x444422, hemiIntensity: 1.0,
    dirColor: 0xffeedd, dirIntensity: 2.0, dirPosition: [50, 80, 30],
    groundColor: 0x1a2a1a, exposure: 1.15,
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
      groundTexture: 'concrete',
      kerbColor: 0x888888, shoulderColor: 0x333333,
      mountainColor: 0x1a1a2e, mountainHeight: 1, cloudOpacity: 0.3, cloudTint: 0x2a2a40,
      fenceDensity: 1.0, rockDensity: 0.3, rockColor: 0x444450, bushDensity: 0.3,
      spectatorDensity: 1.0, accentProps: ['traffic_cone', 'dumpster'],
      roadDecals: ['lane_paint', 'manhole'], buildingStyle: 'modern', treeVariant: 'standard',
      buildingModels: ['skyscraper.glb', 'nyc_skyscraper.glb', 'nyc_apartment.glb', 'nyc_apartment_b.glb', 'nyc_apartment_c.glb'],
      ambientLights: ['window_spill'],
    },
  },
  {
    name: 'Desert Dawn',
    fogColor: 0xccaa66, fogDensity: 0.00025,
    skyTop: 0x1a0a2e, skyBottom: 0xff6633, skyHorizon: 0xffaa44,
    hemiSky: 0xffddaa, hemiGround: 0x886633, hemiIntensity: 1.2,
    dirColor: 0xffcc88, dirIntensity: 2.2, dirPosition: [80, 30, 50],
    groundColor: 0x3a3520, exposure: 1.3,
    scenery: {
      roadColor: 0x4a4035, roadRoughness: 0.9,
      barrierColor: 0x887755,
      buildingPalette: [0x8a7755, 0x997766, 0x6a5540, 0xa08860],
      buildingHeightRange: [3, 8],
      windowLitChance: 0.2, windowColor: 0xffaa44,
      treeTrunkColor: 0x554433, treeCanopyColor: 0x5a7a3a,
      treeCanopyStyle: 'none', treeCount: 8,
      billboardStyle: 'minimal',
      streetLightColor: 0xffaa55, streetLightDensity: 0.4,
      groundTexture: 'sand',
      kerbColor: 0xaa9966, shoulderColor: 0x665533,
      mountainColor: 0x6a5533, mountainHeight: 1.5, cloudOpacity: 0.15, cloudTint: 0xffcc88,
      fenceDensity: 0.3, rockDensity: 1.5, rockColor: 0x8a7755, bushDensity: 0.0,
      spectatorDensity: 0.5, accentProps: ['cactus'],
      roadDecals: ['crack', 'sand_drift'], atmosphericEffects: ['dust'], buildingStyle: 'adobe', treeVariant: 'joshua',
      buildingModels: ['skyscraper.glb'],
    },
  },
  {
    name: 'Coastal Sunset',
    fogColor: 0x445577, fogDensity: 0.0003,
    skyTop: 0x0a1628, skyBottom: 0x2244aa, skyHorizon: 0xff6644,
    hemiSky: 0xaabbdd, hemiGround: 0x445566, hemiIntensity: 1.1,
    dirColor: 0xffaa77, dirIntensity: 2.2, dirPosition: [-60, 25, 60],
    groundColor: 0x1a2820, exposure: 1.25,
    scenery: {
      roadColor: 0x353540, roadRoughness: 0.75,
      barrierColor: 0x556677,
      buildingPalette: [0x556688, 0x668899, 0x445566, 0x778899],
      buildingHeightRange: [3, 6],
      windowLitChance: 0.3, windowColor: 0xffcc88,
      treeTrunkColor: 0x664422, treeCanopyColor: 0x2a6a2a,
      treeCanopyStyle: 'cone', treeCount: 35,
      billboardStyle: 'minimal',
      streetLightColor: 0xffcc77, streetLightDensity: 0.6,
      groundTexture: 'grass',
      kerbColor: 0x778877, shoulderColor: 0x445544,
      mountainColor: 0x334455, mountainHeight: 0.8, cloudOpacity: 0.4, cloudTint: 0xff8866,
      fenceDensity: 0.5, rockDensity: 0.5, rockColor: 0x556655, bushDensity: 1.0,
      spectatorDensity: 0.8, accentProps: ['palm_trunk'],
      atmosphericEffects: ['fireflies', 'leaves'], buildingStyle: 'beach_house', treeVariant: 'layered_pine',
      buildingModels: ['coastal_a.glb', 'coastal_b.glb'],
      ambientLights: ['window_spill'],
    },
  },
  {
    name: 'Neon City',
    fogColor: 0x0a0a1e, fogDensity: 0.0004,
    skyTop: 0x050510, skyBottom: 0x0a0a2a, skyHorizon: 0x1a0530,
    hemiSky: 0x4488ff, hemiGround: 0x220044, hemiIntensity: 0.7,
    dirColor: 0xcc44ff, dirIntensity: 1.8, dirPosition: [30, 60, -40],
    groundColor: 0x0a0a14, exposure: 1.5,
    scenery: {
      roadColor: 0x151520, roadRoughness: 0.5,
      barrierColor: 0x1a1a30,
      buildingPalette: [0x0a0a1a, 0x101025, 0x0d0d20, 0x151530],
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
      spectatorDensity: 0.5, accentProps: ['neon_strip'],
      roadDecals: ['lane_paint', 'manhole'], buildingStyle: 'cyberpunk',
      buildingModels: ['skyscraper.glb', 'nyc_skyscraper.glb', 'office.glb', 'nyc_apartment_b.glb'],
      ambientLights: ['neon_edge', 'neon_pool'],
    },
  },
  {
    name: 'Thunder Storm',
    fogColor: 0x1a2020, fogDensity: 0.0005,
    skyTop: 0x0a0f0f, skyBottom: 0x1a2525, skyHorizon: 0x2a3535,
    hemiSky: 0x556666, hemiGround: 0x222222, hemiIntensity: 0.55,
    dirColor: 0x8899aa, dirIntensity: 1.3, dirPosition: [40, 50, 20],
    groundColor: 0x152018, exposure: 1.0,
    scenery: {
      roadColor: 0x252530, roadRoughness: 0.6,
      barrierColor: 0x3a3a40,
      buildingPalette: [0x2a2a30, 0x333338, 0x252530, 0x3a3a44],
      buildingHeightRange: [6, 18],
      windowLitChance: 0.4, windowColor: 0xccbb88,
      treeTrunkColor: 0x221a11, treeCanopyColor: 0x1a2a18,
      treeCanopyStyle: 'sphere', treeCount: 25,
      billboardStyle: 'minimal',
      streetLightColor: 0xccaa77, streetLightDensity: 0.8,
      groundTexture: 'dirt',
      kerbColor: 0x555555, shoulderColor: 0x2a2a2a,
      mountainColor: 0x1a2020, mountainHeight: 1.2, cloudOpacity: 0.6, cloudTint: 0x2a3030,
      fenceDensity: 0.8, rockDensity: 0.8, rockColor: 0x3a3a40, bushDensity: 0.5,
      spectatorDensity: 0.3, accentProps: ['debris'],
      roadDecals: ['puddle', 'crack'], atmosphericEffects: ['leaves', 'fog_wisps'], buildingStyle: 'weathered',
      buildingModels: ['nyc_apartment.glb', 'nyc_apartment_b.glb', 'nyc_apartment_c.glb', 'skyscraper.glb', 'office.glb'],
      ambientLights: ['hazard_flasher'],
    },
  },
  {
    name: 'Alpine Snow',
    fogColor: 0xccccdd, fogDensity: 0.0004,
    skyTop: 0x889099, skyBottom: 0xbbc0cc, skyHorizon: 0xdde0e8,
    hemiSky: 0xccddee, hemiGround: 0x667788, hemiIntensity: 1.1,
    dirColor: 0xeeeeff, dirIntensity: 1.6, dirPosition: [60, 40, 40],
    groundColor: 0x334455, exposure: 1.1,
    scenery: {
      roadColor: 0x556068, roadRoughness: 0.7,
      barrierColor: 0x889099,
      buildingPalette: [0x8899aa, 0x99aabb, 0x7788aa, 0xaabbcc],
      buildingHeightRange: [3, 7],
      windowLitChance: 0.7, windowColor: 0xffddaa,
      treeTrunkColor: 0x443322, treeCanopyColor: 0x1a4a2a,
      treeCanopyStyle: 'cone', treeCount: 40,
      billboardStyle: 'none',
      streetLightColor: 0xeeeeff, streetLightDensity: 0.6,
      groundTexture: 'snow',
      kerbColor: 0xaabbcc, shoulderColor: 0x778899,
      mountainColor: 0x556688, mountainHeight: 2.0, cloudOpacity: 0.3, cloudTint: 0xddddee,
      fenceDensity: 0.5, rockDensity: 1.0, rockColor: 0x8899aa, bushDensity: 0.5,
      spectatorDensity: 0.8, accentProps: ['snow_bollard'],
      roadDecals: ['frost'], buildingStyle: 'chalet', treeVariant: 'snow_capped',
      buildingModels: ['skyscraper.glb'],
    },
  },
  {
    name: 'Blizzard',
    fogColor: 0xaaaabb, fogDensity: 0.0008,
    skyTop: 0x999aa5, skyBottom: 0xaaaaba, skyHorizon: 0xbbbbcc,
    hemiSky: 0xaabbcc, hemiGround: 0x556677, hemiIntensity: 0.7,
    dirColor: 0xccccdd, dirIntensity: 0.9, dirPosition: [30, 60, 20],
    groundColor: 0x2a3040, exposure: 0.9,
    scenery: {
      roadColor: 0x667078, roadRoughness: 0.55,
      barrierColor: 0x8899aa,
      buildingPalette: [0x778899, 0x8899aa, 0x667788],
      buildingHeightRange: [2, 5],
      windowLitChance: 0.5, windowColor: 0xffcc88,
      treeTrunkColor: 0x554433, treeCanopyColor: 0x88aa99,
      treeCanopyStyle: 'cone', treeCount: 20,
      billboardStyle: 'none',
      streetLightColor: 0xddddee, streetLightDensity: 0.4,
      groundTexture: 'snow',
      kerbColor: 0x99aabb, shoulderColor: 0x667788,
      mountainColor: 0x778899, mountainHeight: 1.5, cloudOpacity: 0.8, cloudTint: 0xbbbbcc,
      fenceDensity: 0.3, rockDensity: 0.5, rockColor: 0x8899aa, bushDensity: 0.3,
      spectatorDensity: 0.2, accentProps: [],
      roadDecals: ['frost'], atmosphericEffects: ['snow_extra', 'fog_wisps'], buildingStyle: 'chalet', treeVariant: 'snow_capped',
      buildingModels: ['skyscraper.glb'],
      ambientLights: ['hazard_flasher'],
    },
  },
  {
    name: 'Black Ice',
    fogColor: 0x0a1020, fogDensity: 0.0003,
    skyTop: 0x050810, skyBottom: 0x101828, skyHorizon: 0x1a2540,
    hemiSky: 0x4466aa, hemiGround: 0x111122, hemiIntensity: 0.8,
    dirColor: 0x88aadd, dirIntensity: 1.8, dirPosition: [50, 70, -30],
    groundColor: 0x0a0e18, exposure: 1.2,
    scenery: {
      roadColor: 0x101820, roadRoughness: 0.3,
      barrierColor: 0x1a2535,
      buildingPalette: [0x0a1020, 0x101828, 0x0d1525, 0x152030],
      buildingHeightRange: [10, 28],
      windowLitChance: 0.3, windowColor: 0x4488cc,
      treeTrunkColor: 0x111118, treeCanopyColor: 0x0a1a2a,
      treeCanopyStyle: 'sphere', treeCount: 10,
      billboardStyle: 'minimal',
      streetLightColor: 0x88aadd, streetLightDensity: 0.7,
      groundTexture: 'concrete',
      kerbColor: 0x2a3a4a, shoulderColor: 0x0a1520,
      mountainColor: 0x0a1020, mountainHeight: 1.0, cloudOpacity: 0.2, cloudTint: 0x1a2540,
      fenceDensity: 0.8, rockDensity: 0.3, rockColor: 0x1a2535, bushDensity: 0.2,
      spectatorDensity: 0.5, accentProps: [],
      roadDecals: ['frost'], buildingStyle: 'concrete',
      buildingModels: ['skyscraper.glb', 'nyc_skyscraper.glb', 'office.glb'],
    },
  },
  // ── 4 New Environments ──
  {
    name: 'Tropical Night',
    fogColor: 0x1a2a20, fogDensity: 0.00035,
    skyTop: 0x0a0a1a, skyBottom: 0x0a1a15, skyHorizon: 0x1a3530,
    hemiSky: 0x66aa88, hemiGround: 0x334422, hemiIntensity: 0.8,
    dirColor: 0xaaddcc, dirIntensity: 1.5, dirPosition: [40, 60, 30],
    groundColor: 0x1a2a18, exposure: 1.1,
    scenery: {
      roadColor: 0x2a2a2e, roadRoughness: 0.65,
      barrierColor: 0x3a4a3a,
      buildingPalette: [0x2a3a30, 0x344a38, 0x1a2a22, 0x405540],
      buildingHeightRange: [3, 8],
      windowLitChance: 0.4, windowColor: 0xffdd77,
      treeTrunkColor: 0x554422, treeCanopyColor: 0x2a5a2a,
      treeCanopyStyle: 'cone', treeCount: 50,
      billboardStyle: 'minimal',
      streetLightColor: 0xffcc66, streetLightDensity: 0.5,
      groundTexture: 'grass',
      kerbColor: 0x557755, shoulderColor: 0x2a3a2a,
      mountainColor: 0x1a2a20, mountainHeight: 1.0, cloudOpacity: 0.3, cloudTint: 0x1a3530,
      fenceDensity: 0.4, rockDensity: 0.5, rockColor: 0x3a4a3a, bushDensity: 1.5,
      spectatorDensity: 0.5, accentProps: ['tiki_torch'],
      roadDecals: ['puddle'], atmosphericEffects: ['fireflies', 'fog_wisps'], buildingStyle: 'bamboo_lodge', treeVariant: 'palm_frond',
      buildingModels: ['coastal_a.glb', 'coastal_b.glb'],
      ambientLights: ['torch_glow'],
    },
  },
  {
    name: 'Industrial Zone',
    fogColor: 0x332a1a, fogDensity: 0.0005,
    skyTop: 0x1a1510, skyBottom: 0x2a2215, skyHorizon: 0x443520,
    hemiSky: 0xaa8855, hemiGround: 0x332211, hemiIntensity: 0.6,
    dirColor: 0xff8833, dirIntensity: 1.5, dirPosition: [30, 40, 40],
    groundColor: 0x1a1510, exposure: 1.0,
    scenery: {
      roadColor: 0x333030, roadRoughness: 0.95,
      barrierColor: 0x555045,
      buildingPalette: [0x3a3530, 0x4a4440, 0x554f48, 0x2a2520],
      buildingHeightRange: [8, 22],
      windowLitChance: 0.2, windowColor: 0xff8833,
      treeTrunkColor: 0x2a2218, treeCanopyColor: 0x2a3a20,
      treeCanopyStyle: 'sphere', treeCount: 8,
      billboardStyle: 'minimal',
      streetLightColor: 0xff8833, streetLightDensity: 1.2,
      groundTexture: 'dirt',
      kerbColor: 0x555544, shoulderColor: 0x2a2a22,
      mountainColor: 0x332a1a, mountainHeight: 0.5, cloudOpacity: 0.5, cloudTint: 0x443520,
      fenceDensity: 1.5, rockDensity: 0.3, rockColor: 0x555045, bushDensity: 0.2,
      spectatorDensity: 0.3, accentProps: ['smokestack'],
      roadDecals: ['crack', 'manhole'], atmosphericEffects: ['steam', 'embers'], buildingStyle: 'warehouse',
      buildingModels: ['office.glb', 'nyc_apartment.glb', 'nyc_apartment_c.glb'],
      ambientLights: ['torch_glow'],
    },
  },
  {
    name: 'Highway Sunrise',
    fogColor: 0xddaa66, fogDensity: 0.00015,
    skyTop: 0x2244aa, skyBottom: 0xff8844, skyHorizon: 0xffcc55,
    hemiSky: 0xffeecc, hemiGround: 0x886644, hemiIntensity: 1.4,
    dirColor: 0xffcc66, dirIntensity: 2.5, dirPosition: [90, 15, 60],
    groundColor: 0x2a3a20, exposure: 1.4,
    scenery: {
      roadColor: 0x3a3a3e, roadRoughness: 0.8,
      barrierColor: 0x778877,
      buildingPalette: [0x778877, 0x889988],
      buildingHeightRange: [2, 4],
      windowLitChance: 0.1, windowColor: 0xffcc88,
      treeTrunkColor: 0x553322, treeCanopyColor: 0x3a6a2a,
      treeCanopyStyle: 'sphere', treeCount: 45,
      billboardStyle: 'minimal',
      streetLightColor: 0xffddaa, streetLightDensity: 0.3,
      groundTexture: 'grass',
      kerbColor: 0x778866, shoulderColor: 0x445533,
      mountainColor: 0x445533, mountainHeight: 1.5, cloudOpacity: 0.25, cloudTint: 0xffcc88,
      fenceDensity: 0.6, rockDensity: 0.5, rockColor: 0x667755, bushDensity: 1.0,
      spectatorDensity: 0.5, accentProps: ['wind_turbine'],
      roadDecals: ['lane_paint'], atmosphericEffects: ['dust'], buildingStyle: 'beach_house',
      buildingModels: ['coastal_a.glb', 'coastal_b.glb'],
    },
  },
  {
    name: 'Underground',
    fogColor: 0x0a0a0a, fogDensity: 0.001,
    skyTop: 0x050505, skyBottom: 0x0a0a0a, skyHorizon: 0x111111,
    hemiSky: 0x333333, hemiGround: 0x111111, hemiIntensity: 0.3,
    dirColor: 0xffffff, dirIntensity: 0.8, dirPosition: [0, 80, 0],
    groundColor: 0x0a0a0a, exposure: 1.3,
    scenery: {
      roadColor: 0x222225, roadRoughness: 0.7,
      barrierColor: 0x333338,
      buildingPalette: [0x1a1a1e, 0x222228, 0x2a2a30],
      buildingHeightRange: [4, 8],
      windowLitChance: 0.0, windowColor: 0x000000,
      treeTrunkColor: 0x111111, treeCanopyColor: 0x111111,
      treeCanopyStyle: 'none', treeCount: 0,
      billboardStyle: 'neon',
      streetLightColor: 0xffffff, streetLightDensity: 2.0,
      groundTexture: 'concrete',
      kerbColor: 0x444448, shoulderColor: 0x1a1a1e,
      mountainColor: 0x050505, mountainHeight: 0.0, cloudOpacity: 0.0, cloudTint: 0x111111,
      fenceDensity: 1.5, rockDensity: 0.0, rockColor: 0x222228, bushDensity: 0.0,
      spectatorDensity: 0.0, accentProps: ['ceiling_panel'],
      roadDecals: ['manhole'], atmosphericEffects: ['steam', 'embers'], buildingStyle: 'concrete',
      buildingModels: ['office.glb', 'skyscraper.glb'],
      ambientLights: ['neon_pool'],
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
  const _groundTex = createGroundTexture();
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

// Reusable temp Colors for applyEnvironment derivations
const _tmpColorA = new THREE.Color();
const _tmpColorB = new THREE.Color();

let _currentPreset: EnvironmentPreset = ENVIRONMENTS[0];

/** Get the currently active scenery theme. */
export function getCurrentTheme(): SceneryTheme { return _currentPreset.scenery; }
/** Get the currently active environment preset. */
export function getCurrentPreset(): EnvironmentPreset { return _currentPreset; }
