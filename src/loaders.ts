/* ── Hood Racer — Model Loaders ── */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const gltfLoader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
gltfLoader.setDRACOLoader(dracoLoader);

const modelCache = new Map<string, THREE.Group>();

/** Load a GLB model, applying material enhancements for premium rendering. */
export async function loadCarModel(filename: string): Promise<THREE.Group> {
  const cached = modelCache.get(filename);
  if (cached) return deepCloneGroup(cached);

  const gltf = await gltfLoader.loadAsync(`/models/${filename}`);
  const model = gltf.scene;

  // Normalize scale — target ~4 units long
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 4.0 / maxDim;
  model.scale.setScalar(scale);

  // Center the model
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  model.position.y -= box.min.y; // sit on ground

  // Material enhancements
  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      if (mesh.geometry) {
        mesh.geometry.computeVertexNormals();
      }

      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat && mat.isMeshStandardMaterial) {
        mat.envMapIntensity = 1.2;
        mat.roughness = Math.max(mat.roughness * 0.7, 0.05);
        mat.needsUpdate = true;
      }
    }
  });

  // ── Orientation fix ──
  // GLTF car models have their forward along +X; our physics uses +Z as forward.
  // Wrap the raw model in a group rotated 90° on Y to align it correctly.
  const wrapper = new THREE.Group();
  model.rotation.y = Math.PI / 2;
  wrapper.add(model);

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
        const model = gltf.scene;
        // Same processing as loadCarModel
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 4.0 / maxDim;
        model.scale.setScalar(scale);
        box.setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        model.position.y -= box.min.y;

        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            if (mesh.geometry) mesh.geometry.computeVertexNormals();
            const mat = mesh.material as THREE.MeshStandardMaterial;
            if (mat && mat.isMeshStandardMaterial) {
              mat.envMapIntensity = 1.2;
              mat.roughness = Math.max(mat.roughness * 0.7, 0.05);
              mat.needsUpdate = true;
            }
          }
        });

        const wrapper = new THREE.Group();
        model.rotation.y = Math.PI / 2;
        wrapper.add(model);
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
