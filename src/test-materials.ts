import * as THREE from 'three';
export function debugMaterials(model: THREE.Group) {
  model.traverse((child) => {
    if ((child as any).isMesh) {
      console.log('Mesh:', child.name, 'Material is array?', Array.isArray((child as any).material));
    }
  });
}
