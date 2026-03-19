import * as THREE from 'three/webgpu';
import { CarLightDef } from './car-lights';

/**
 * Analyzes a car model's baked texture to automatically find headlight and taillight positions.
 * This is a CPU-side operation to avoid WebGPU raytracing issues.
 */
export function detectLightPositions(model: THREE.Group): Partial<CarLightDef> {
  const result: Partial<CarLightDef> = {};
  
  // 1. Find the primary mesh and its baked texture
  let mesh: THREE.Mesh | null = null;
  let material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | null = null;
  let texture: THREE.Texture | null = null;

  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (!mesh) mesh = child; // Take first mesh as primary
      
      const mat = child.material;
      if (mat) {
        if (Array.isArray(mat)) {
          for (const m of mat) {
            const sm = m as THREE.MeshStandardMaterial;
            if (sm.map) {
              material = sm;
              texture = sm.map;
              break;
            }
          }
        } else {
          const sm = mat as THREE.MeshStandardMaterial;
          if (sm.map) {
            material = sm;
            texture = sm.map;
          }
        }
      }
    }
  });

  if (!mesh || !texture || !(texture as THREE.Texture).image) {
    console.warn('[LightDetector] Could not find mesh or baked texture for analysis');
    return result;
  }

  // 2. Render texture to offscreen canvas for CPU pixel access
  // Re-bind after null check (TS can't track closure mutations across traverse)
  const tex = texture as THREE.Texture;
  const img = tex.image as HTMLImageElement | ImageBitmap;
  // Handle case where image might be an ImageBitmap or HTMLImageElement
  const width = img.width || 1024;
  const height = img.height || 1024;
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  if (!ctx) {
    console.warn('[LightDetector] Failed to get 2D context');
    return result;
  }

  try {
    ctx.drawImage(img, 0, 0, width, height);
  } catch (e) {
    console.warn('[LightDetector] Could not draw texture to canvas:', e);
    return result;
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  // Helper to sample texture color at UV
  const sampleColor = (u: number, v: number): { r: number, g: number, b: number } => {
    // Clamp UVs
    u = Math.max(0, Math.min(1, u));
    v = Math.max(0, Math.min(1, v));
    
    // Convert to pixel coordinates (WebGL V is inverted relative to Canvas)
    const px = Math.floor(u * (width - 1));
    const py = Math.floor((1 - v) * (height - 1));
    
    const idx = (py * width + px) * 4;
    return {
      r: pixels[idx],
      g: pixels[idx + 1],
      b: pixels[idx + 2]
    };
  };

  // 3. Setup geometric bounds
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  
  const frontZ = box.max.z;
  const rearZ = box.min.z;
  const height_min = box.min.y + size.y * 0.2; // Skip wheels
  const height_max = box.min.y + size.y * 0.6; // Skip roof
  
  const geometry = (mesh as THREE.Mesh).geometry;
  if (!geometry || !geometry.attributes.position || !geometry.attributes.uv || !geometry.index) {
    console.warn('[LightDetector] Mesh missing required attributes (position, uv, index)');
    return result;
  }

  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const uvs = geometry.attributes.uv as THREE.BufferAttribute;
  const indices = geometry.index;
  
  // Transform positions to world/wrapper space for accurate evaluation
  (mesh as THREE.Mesh).updateMatrixWorld();
  const matrix = (mesh as THREE.Mesh).matrixWorld;

  // 4. Sample vertices in candidate regions
  const hlCandidates: { pos: THREE.Vector3, color: {r:number,g:number,b:number} }[] = [];
  const tlCandidates: { pos: THREE.Vector3, color: {r:number,g:number,b:number} }[] = [];

  const vA = new THREE.Vector3();
  const uvA = new THREE.Vector2();

  // Iterate over all triangles to find vertices in target zones
  for (let i = 0; i < positions.count; i++) {
    vA.fromBufferAttribute(positions, i).applyMatrix4(matrix);
    
    // Check height constraints first
    if (vA.y < height_min || vA.y > height_max) continue;
    
    // Exclude center-line to avoid grille/badge (abs(x) > 0.3)
    if (Math.abs(vA.x) < 0.3) continue;

    // Headlight zone (front 15% of car)
    if (vA.z > frontZ - size.z * 0.15) {
      uvA.fromBufferAttribute(uvs, i);
      const color = sampleColor(uvA.x, uvA.y);
      
      // Headlight criteria: Bright white/yellow
      const lum = color.r + color.g + color.b;
      if (lum > 600 && Math.abs(color.r - color.b) < 50) {
        hlCandidates.push({ pos: vA.clone(), color });
      }
    }
    
    // Taillight zone (rear 15% of car)
    else if (vA.z < rearZ + size.z * 0.15) {
      uvA.fromBufferAttribute(uvs, i);
      const color = sampleColor(uvA.x, uvA.y);
      
      // Taillight criteria: Dominantly red
      if (color.r > 150 && color.r > color.g * 1.5 && color.r > color.b * 1.5) {
        tlCandidates.push({ pos: vA.clone(), color });
      }
    }
  }

  // 5. Cluster candidates into Left and Right
  const clusterLights = (candidates: typeof hlCandidates) => {
    const left: THREE.Vector3[] = [];
    const right: THREE.Vector3[] = [];
    
    for (const c of candidates) {
      if (c.pos.x < 0) left.push(c.pos);
      else right.push(c.pos);
    }
    
    const avg = (points: THREE.Vector3[]) => {
      if (points.length === 0) return null;
      const sum = new THREE.Vector3();
      for (const p of points) sum.add(p);
      return sum.divideScalar(points.length);
    };
    
    return { left: avg(left), right: avg(right), leftCount: left.length, rightCount: right.length };
  };

  const hlClusters = clusterLights(hlCandidates);
  const tlClusters = clusterLights(tlCandidates);

  // 6. Refine and assign results
  // Enforce symmetry if only one side detected
  const enforceSymmetry = (clusters: ReturnType<typeof clusterLights>) => {
    let l = clusters.left;
    let r = clusters.right;
    
    if (l && !r) {
      r = new THREE.Vector3(-l.x, l.y, l.z);
    } else if (r && !l) {
      l = new THREE.Vector3(-r.x, r.y, r.z);
    } else if (l && r) {
      // Average their Y and Z, mirror X
      const avgY = (l.y + r.y) / 2;
      const avgZ = (l.z + r.z) / 2;
      const avgX = (Math.abs(l.x) + Math.abs(r.x)) / 2;
      l.set(-avgX, avgY, avgZ);
      r.set(avgX, avgY, avgZ);
    }
    return { l, r };
  };

  const finalHL = enforceSymmetry(hlClusters);
  const finalTL = enforceSymmetry(tlClusters);

  if (finalHL.l && finalHL.r) {
    result.headlightL = [finalHL.l.x, finalHL.l.y, finalHL.l.z];
    result.headlightR = [finalHL.r.x, finalHL.r.y, finalHL.r.z];
    
    // Estimate size based on point count (more points = bigger decal)
    const points = Math.max(hlClusters.leftCount, hlClusters.rightCount);
    const sizeEstimate = Math.min(0.3, Math.max(0.15, points * 0.005));
    result.headlightSize = [sizeEstimate, sizeEstimate * 0.6];
  }

  if (finalTL.l && finalTL.r) {
    result.taillightL = [finalTL.l.x, finalTL.l.y, finalTL.l.z];
    result.taillightR = [finalTL.r.x, finalTL.r.y, finalTL.r.z];
    
    const points = Math.max(tlClusters.leftCount, tlClusters.rightCount);
    const sizeEstimate = Math.min(0.4, Math.max(0.2, points * 0.008));
    result.taillightSize = [sizeEstimate, sizeEstimate * 0.3];
  }

  console.log('[LightDetector] Auto-detection results:', { hlCandidates: hlCandidates.length, tlCandidates: tlCandidates.length, result });
  
  return result;
}
