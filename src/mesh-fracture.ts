/* ── Hood Racer — Runtime Mesh Fracture ──
 *
 * Splits a single THREE.Mesh into N spatial fragments at runtime.
 * Used by the vehicle destruction system to break single-mesh GLB car
 * models into multiple flying pieces.
 *
 * Algorithm: spatial grid decomposition
 *   1. Compute bounding box of source mesh
 *   2. Divide bbox into a 3D grid (e.g. 3×2×2 = 12 cells)
 *   3. For each triangle, compute centroid → assign to grid cell
 *   4. Build a new BufferGeometry per non-empty cell
 *   5. Return fragment meshes with world-space positions
 *
 * This is fast (~1-2ms for typical car meshes) and produces natural-looking
 * fragments because different parts of the car naturally occupy different
 * spatial regions — the hood, doors, roof, trunk, bumpers all split apart.
 */

import * as THREE from 'three';

export interface MeshFragment {
  mesh: THREE.Mesh;
  /** Center of this fragment in world space (for blast direction calc). */
  center: THREE.Vector3;
}

// Temp vectors to avoid allocs in hot path
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _centroid = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _worldQuat = new THREE.Quaternion();
const _worldScale = new THREE.Vector3();

/**
 * Split a mesh into spatial grid fragments.
 * @param srcMesh The source mesh to fracture (must have indexed or non-indexed BufferGeometry).
 * @param gridX Number of divisions along X (default 3)
 * @param gridY Number of divisions along Y (default 2)
 * @param gridZ Number of divisions along Z (default 2)
 * @returns Array of fragment meshes positioned in world space.
 */
export function fractureMesh(
  srcMesh: THREE.Mesh,
  gridX = 3,
  gridY = 2,
  gridZ = 2,
): MeshFragment[] {
  const geo = srcMesh.geometry;
  if (!geo) return [];

  // Get world transform of the source mesh
  srcMesh.getWorldPosition(_worldPos);
  srcMesh.getWorldQuaternion(_worldQuat);
  srcMesh.getWorldScale(_worldScale);

  // Compute bounding box in local space
  geo.computeBoundingBox();
  const bbox = geo.boundingBox!;
  const min = bbox.min;
  const size = new THREE.Vector3();
  bbox.getSize(size);

  // Avoid division by zero for flat dimensions
  if (size.x < 0.001) size.x = 0.001;
  if (size.y < 0.001) size.y = 0.001;
  if (size.z < 0.001) size.z = 0.001;

  const totalCells = gridX * gridY * gridZ;

  // ── Collect triangles per cell ──
  const posAttr = geo.getAttribute('position');
  const normalAttr = geo.getAttribute('normal');
  const uvAttr = geo.getAttribute('uv');
  const colorAttr = geo.getAttribute('color');
  const index = geo.getIndex();

  const triCount = index ? index.count / 3 : posAttr.count / 3;

  // Per-cell triangle lists: store vertex data directly
  type TriData = {
    positions: number[];
    normals: number[];
    uvs: number[];
    colors: number[];
  };
  const cells: TriData[] = [];
  for (let i = 0; i < totalCells; i++) {
    cells.push({ positions: [], normals: [], uvs: [], colors: [] });
  }

  const hasNormals = !!normalAttr;
  const hasUVs = !!uvAttr;
  const hasColors = !!colorAttr;

  for (let t = 0; t < triCount; t++) {
    // Get vertex indices
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    // Get positions
    _v0.fromBufferAttribute(posAttr, i0);
    _v1.fromBufferAttribute(posAttr, i1);
    _v2.fromBufferAttribute(posAttr, i2);

    // Centroid in local space
    _centroid.copy(_v0).add(_v1).add(_v2).divideScalar(3);

    // Map centroid to grid cell
    const cx = Math.min(gridX - 1, Math.max(0, Math.floor((_centroid.x - min.x) / size.x * gridX)));
    const cy = Math.min(gridY - 1, Math.max(0, Math.floor((_centroid.y - min.y) / size.y * gridY)));
    const cz = Math.min(gridZ - 1, Math.max(0, Math.floor((_centroid.z - min.z) / size.z * gridZ)));
    const cellIdx = cx + cy * gridX + cz * gridX * gridY;

    const cell = cells[cellIdx];

    // Store vertex data for this triangle
    cell.positions.push(
      _v0.x, _v0.y, _v0.z,
      _v1.x, _v1.y, _v1.z,
      _v2.x, _v2.y, _v2.z,
    );

    if (hasNormals) {
      cell.normals.push(
        normalAttr.getX(i0), normalAttr.getY(i0), normalAttr.getZ(i0),
        normalAttr.getX(i1), normalAttr.getY(i1), normalAttr.getZ(i1),
        normalAttr.getX(i2), normalAttr.getY(i2), normalAttr.getZ(i2),
      );
    }

    if (hasUVs) {
      cell.uvs.push(
        uvAttr.getX(i0), uvAttr.getY(i0),
        uvAttr.getX(i1), uvAttr.getY(i1),
        uvAttr.getX(i2), uvAttr.getY(i2),
      );
    }

    if (hasColors) {
      const itemSize = colorAttr.itemSize;
      for (const idx of [i0, i1, i2]) {
        for (let c = 0; c < itemSize; c++) {
          cell.colors.push(colorAttr.getComponent(idx, c));
        }
      }
    }
  }

  // ── Build fragment meshes from non-empty cells ──
  const fragments: MeshFragment[] = [];
  const worldMatrix = new THREE.Matrix4().compose(_worldPos, _worldQuat, _worldScale);

  for (let c = 0; c < totalCells; c++) {
    const cell = cells[c];
    if (cell.positions.length === 0) continue; // empty cell

    const fragGeo = new THREE.BufferGeometry();
    fragGeo.setAttribute('position', new THREE.Float32BufferAttribute(cell.positions, 3));

    if (hasNormals && cell.normals.length > 0) {
      fragGeo.setAttribute('normal', new THREE.Float32BufferAttribute(cell.normals, 3));
    }
    if (hasUVs && cell.uvs.length > 0) {
      fragGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cell.uvs, 2));
    }
    if (hasColors && cell.colors.length > 0) {
      const itemSize = colorAttr!.itemSize;
      fragGeo.setAttribute('color', new THREE.Float32BufferAttribute(cell.colors, itemSize));
    }

    // Compute the center of this fragment (in local space)
    fragGeo.computeBoundingBox();
    const fragCenter = new THREE.Vector3();
    fragGeo.boundingBox!.getCenter(fragCenter);

    // Transform center to world space
    const worldCenter = fragCenter.clone().applyMatrix4(worldMatrix);

    // Clone material(s) from source mesh
    let material: THREE.Material | THREE.Material[];
    if (Array.isArray(srcMesh.material)) {
      material = srcMesh.material.map(m => {
        const c = m.clone();
        c.transparent = true;
        if ('emissive' in c) {
          (c as any).emissive = new THREE.Color(0xFF6600);
          (c as any).emissiveIntensity = 0.6;
        }
        return c;
      });
    } else {
      material = srcMesh.material.clone();
      material.transparent = true;
      if ('emissive' in material) {
        (material as any).emissive = new THREE.Color(0xFF6600);
        (material as any).emissiveIntensity = 0.6;
      }
    }

    const fragMesh = new THREE.Mesh(fragGeo, material);

    // Position at world-space center, with source rotation/scale
    fragMesh.position.copy(_worldPos);
    fragMesh.quaternion.copy(_worldQuat);
    fragMesh.scale.copy(_worldScale);

    fragments.push({
      mesh: fragMesh,
      center: worldCenter,
    });
  }

  return fragments;
}
