/* ── Hood Racer — Scene Setup ── */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;

export function initScene(container: HTMLElement) {
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Scene
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1a1a2e, 0.0025);

  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 10, 20);

  // Environment map for car reflections
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envMap = pmremGenerator.fromScene(new RoomEnvironment()).texture;
  scene.environment = envMap;
  pmremGenerator.dispose();

  // Lighting
  const hemiLight = new THREE.HemisphereLight(0x88aacc, 0x444422, 1.0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffeedd, 2.0);
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

  // Ground plane (asphalt)
  const groundGeo = new THREE.PlaneGeometry(600, 600);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x222228,
    roughness: 0.85,
    metalness: 0.05,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  // Sky gradient
  const skyGeo = new THREE.SphereGeometry(800, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
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
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // Handle resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera };
}

export function getRenderer() { return renderer; }
export function getScene() { return scene; }
export function getCamera() { return camera; }
