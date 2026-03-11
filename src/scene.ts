/* ── Hood Racer — Scene Setup + Environment Presets ── */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;

// Mutable references for environment theming
let hemiLight: THREE.HemisphereLight;
let dirLight: THREE.DirectionalLight;
let groundMesh: THREE.Mesh;
let skyMat: THREE.ShaderMaterial;

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
    fogColor: 0x1a1a2e, fogDensity: 0.0008,
    skyTop: 0x0d0d1a, skyBottom: 0x1a1a3a, skyHorizon: 0x2a1a30,
    hemiSky: 0x88aacc, hemiGround: 0x444422, hemiIntensity: 1.2,
    dirColor: 0xffeedd, dirIntensity: 2.5, dirPosition: [50, 80, 30],
    groundColor: 0x222228, exposure: 1.4,
  },
  {
    name: 'Desert Dawn',
    fogColor: 0xccaa66, fogDensity: 0.0006,
    skyTop: 0x1a0a2e, skyBottom: 0xff6633, skyHorizon: 0xffaa44,
    hemiSky: 0xffddaa, hemiGround: 0x886633, hemiIntensity: 1.6,
    dirColor: 0xffcc88, dirIntensity: 3.0, dirPosition: [80, 30, 50],
    groundColor: 0x8b7355, exposure: 1.6,
  },
  {
    name: 'Coastal Sunset',
    fogColor: 0x445577, fogDensity: 0.0007,
    skyTop: 0x0a1628, skyBottom: 0x2244aa, skyHorizon: 0xff6644,
    hemiSky: 0xaabbdd, hemiGround: 0x445566, hemiIntensity: 1.4,
    dirColor: 0xffaa77, dirIntensity: 3.0, dirPosition: [-60, 25, 60],
    groundColor: 0x2a3040, exposure: 1.5,
  },
];

export function initScene(container: HTMLElement) {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1a1a2e, 0.0008);

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

  const groundGeo = new THREE.PlaneGeometry(1200, 1200);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.85, metalness: 0.05 });
  groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.05;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  const skyGeo = new THREE.SphereGeometry(800, 32, 16);
  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x0d0d1a) },
      bottomColor: { value: new THREE.Color(0x1a1a3a) },
      horizonColor: { value: new THREE.Color(0x2a1a30) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 horizonColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 col = mix(horizonColor, bottomColor, smoothstep(0.0, -0.3, h));
        col = mix(col, topColor, smoothstep(0.0, 0.5, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
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
  (scene.fog as THREE.FogExp2).color.setHex(preset.fogColor);
  (scene.fog as THREE.FogExp2).density = preset.fogDensity;

  skyMat.uniforms.topColor.value.setHex(preset.skyTop);
  skyMat.uniforms.bottomColor.value.setHex(preset.skyBottom);
  skyMat.uniforms.horizonColor.value.setHex(preset.skyHorizon);

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
