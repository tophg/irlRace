/* ── IRL Race — Model Loaders ── */

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { detectLightPositions } from './light-detector';

const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
gltfLoader.setDRACOLoader(dracoLoader);

const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.175.0/examples/jsm/libs/basis/');

/** Call once with the renderer so KTX2Loader can detect GPU texture support. */
export function initKTX2(renderer: THREE.WebGPURenderer) {
  ktx2Loader.detectSupport(renderer);
  gltfLoader.setKTX2Loader(ktx2Loader);
}

const modelCache = new Map<string, THREE.Group>();

/** Load a GLB model, applying material enhancements for premium rendering. */
export async function loadCarModel(filename: string): Promise<THREE.Group> {
  const cached = modelCache.get(filename);
  if (cached) return deepCloneGroup(cached);

  const gltf = await gltfLoader.loadAsync(`/models/${filename}`);
  const wrapper = processCarModel(gltf.scene, filename);

  modelCache.set(filename, wrapper);
  return deepCloneGroup(wrapper);
}

/** Deep-clone a group, duplicating geometry AND materials so deformation/damage
 *  color changes don't corrupt the cache. */
function deepCloneGroup(source: THREE.Group): THREE.Group {
  const cloned = source.clone(true);
  cloned.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.geometry = mesh.geometry.clone();
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(m => m.clone());
      } else if (mesh.material) {
        mesh.material = mesh.material.clone();
      }
    }
  });
  return cloned;
}

/** Shared model post-processing: scale, center, material enhance, orientation wrap. */
function processCarModel(model: THREE.Group, filename = 'unknown'): THREE.Group {
  // Normalize scale — target ~4 units long
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 4.0 / maxDim;
  model.scale.setScalar(scale);

  // ── Per-model tire contact detection ──
  // Recompute bounding box after scale (only for actual car geometry, excluding shadow planes)
  const carOnlyBox = new THREE.Box3();
  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.Material;
      // Many low-poly cars have a baked drop-shadow plane with transparency or specific naming
      const isShadowPlane = mesh.name.toLowerCase().includes('shadow') || 
                            (mat && mat.transparent && mat.opacity < 1);
      
      if (!isShadowPlane) {
        const meshBox = new THREE.Box3().setFromObject(mesh);
        carOnlyBox.union(meshBox);
      }
    }
  });

  if (carOnlyBox.isEmpty()) {
    carOnlyBox.copy(box); // Fallback if everything was filtered out
  }

  const center = carOnlyBox.getCenter(new THREE.Vector3());
  const tireContactY = carOnlyBox.min.y;

  model.position.set(-center.x, -tireContactY, -center.z);

  // Material enhancements
  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      if (mesh.geometry) {
        // Only recompute normals if the geometry doesn't have them
        // (Draco-compressed models preserve authored normals — recomputing flattens them)
        if (!mesh.geometry.getAttribute('normal')) {
          mesh.geometry.computeVertexNormals();
        }
      }

      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat && mat.isMeshStandardMaterial) {
        mat.envMapIntensity = 1.0;
        mat.roughness = Math.max(mat.roughness * 0.6, 0.03);
        mat.needsUpdate = true;
      }
    }
  });

  // Orientation fix: GLTF cars are +X forward; physics uses +Z
  const wrapper = new THREE.Group();
  model.rotation.y = Math.PI / 2;
  wrapper.add(model);

  // Auto-detect light positions using texture analysis
  const autoLights = detectLightPositions(wrapper);
  wrapper.userData.autoLights = autoLights;

  return wrapper;
}

/** Load a GLB model with download progress callback. */
export function loadCarModelWithProgress(
  filename: string,
  onProgress?: (pct: number) => void,
): Promise<THREE.Group> {
  const cached = modelCache.get(filename);
  if (cached) {
    onProgress?.(1);
    return Promise.resolve(deepCloneGroup(cached));
  }

  return new Promise((resolve, reject) => {
    gltfLoader.load(
      `/models/${filename}`,
      (gltf) => {
        const wrapper = processCarModel(gltf.scene, filename);
        modelCache.set(filename, wrapper);
        onProgress?.(1);
        resolve(deepCloneGroup(wrapper));
      },
      (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress?.(event.loaded / event.total);
        }
      },
      (error) => reject(error),
    );
  });
}

export function clearModelCache() {
  modelCache.clear();
}

/** Load a raw GLB model (no car-specific processing). Returns the scene group. */
export async function loadGLB(url: string): Promise<THREE.Group> {
  const gltf = await gltfLoader.loadAsync(url);
  return gltf.scene;
}
