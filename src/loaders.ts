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
  const wrapper = processCarModel(gltf.scene);

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
function processCarModel(model: THREE.Group): THREE.Group {
  // Normalize scale — target ~4 units long
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 4.0 / maxDim;
  model.scale.setScalar(scale);

  // Recompute bounding box after scale
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());

  // ── Per-model tire contact detection ──
  // GLTF models face +X. After rotation.y = PI/2 (applied later), local +X becomes +Z.
  // But at THIS point the model is still in raw GLTF orientation (+X forward).
  // Wheel corners in model-local space (pre-rotation):
  //   frontZ in physics = +X in GLTF,  sideX in physics = ±Z in GLTF
  const wheelProbes = [
    { x:  1.3, z: -0.85 },  // front-left  (GLTF: +X forward, -Z left)
    { x:  1.3, z:  0.85 },  // front-right (GLTF: +X forward, +Z right)
    { x: -1.3, z: -0.85 },  // rear-left
    { x: -1.3, z:  0.85 },  // rear-right
  ];

  // Raycast downward at each wheel position to find actual tire contact Y
  const probeRaycaster = new THREE.Raycaster();
  probeRaycaster.far = 10;
  const downDir = new THREE.Vector3(0, -1, 0);
  const meshes: THREE.Mesh[] = [];
  model.traverse(c => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh); });

  let tireContactY = box.min.y; // fallback to bounding box bottom
  const wheelHits: number[] = [];

  for (const probe of wheelProbes) {
    const origin = new THREE.Vector3(
      center.x + probe.x,
      box.max.y + 1, // start well above the model
      center.z + probe.z,
    );
    probeRaycaster.set(origin, downDir);
    let bestY = box.min.y;
    for (const mesh of meshes) {
      const hits = probeRaycaster.intersectObject(mesh, false);
      if (hits.length > 0) {
        // Take the LOWEST hit (closest to ground) at this wheel position
        const lowestHit = hits[hits.length - 1].point.y;
        if (lowestHit > bestY) bestY = lowestHit; // actually we want the highest "lowest" — the tire bottom
      }
    }
    wheelHits.push(bestY);
  }

  if (wheelHits.length > 0) {
    // Use the average of wheel contact points as ground reference
    tireContactY = wheelHits.reduce((a, b) => a + b, 0) / wheelHits.length;
  }

  model.position.set(-center.x, -tireContactY, -center.z);

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
        mat.envMapIntensity = 0.6;
        mat.roughness = Math.max(mat.roughness * 0.7, 0.05);
        mat.needsUpdate = true;
      }
    }
  });

  // Orientation fix: GLTF cars are +X forward; physics uses +Z
  const wrapper = new THREE.Group();
  model.rotation.y = Math.PI / 2;
  wrapper.add(model);
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
        const wrapper = processCarModel(gltf.scene);
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
