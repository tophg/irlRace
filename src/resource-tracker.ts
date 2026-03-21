/* ── IRL Race — Resource Tracker ──
 *
 * Centralized Three.js GPU resource tracking and bulk disposal.
 *
 * Usage:
 *   import { raceTracker } from './resource-tracker';
 *
 *   // During setup — register objects:
 *   const mesh = new THREE.Mesh(geo, mat);
 *   raceTracker.track(mesh);     // tracks mesh + geo + mat + textures
 *   scene.add(mesh);
 *
 *   // During teardown — dispose everything:
 *   raceTracker.disposeAll(scene);
 *
 * Scoped trackers can be created with `new ResourceTracker()` for
 * subsystem-specific lifecycle management (e.g., garage, title screen).
 */

import * as THREE from 'three/webgpu';

export class ResourceTracker {
  private _geometries = new Set<THREE.BufferGeometry>();
  private _materials = new Set<THREE.Material>();
  private _textures = new Set<THREE.Texture>();
  private _objects = new Set<THREE.Object3D>();
  private _renderTargets = new Set<THREE.WebGLRenderTarget>();
  private _disposables = new Set<{ dispose(): void }>();

  /** Track an Object3D and all its GPU resources (geometries, materials, textures). */
  track<T extends THREE.Object3D>(obj: T): T {
    this._objects.add(obj);
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine || (child as THREE.Points).isPoints) {
        const renderable = child as THREE.Mesh | THREE.Line | THREE.Points;

        // Geometry
        if (renderable.geometry) {
          this._geometries.add(renderable.geometry);
        }

        // Material(s)
        const mats = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
        for (const mat of mats) {
          if (!mat) continue;
          this._materials.add(mat);
          // Extract textures from standard material properties
          this._trackMaterialTextures(mat);
        }
      }
    });
    return obj;
  }

  /** Track a standalone geometry. */
  trackGeometry<T extends THREE.BufferGeometry>(geo: T): T {
    this._geometries.add(geo);
    return geo;
  }

  /** Track a standalone material. */
  trackMaterial<T extends THREE.Material>(mat: T): T {
    this._materials.add(mat);
    this._trackMaterialTextures(mat);
    return mat;
  }

  /** Track a standalone texture. */
  trackTexture<T extends THREE.Texture>(tex: T): T {
    this._textures.add(tex);
    return tex;
  }

  /** Track a render target. */
  trackRenderTarget<T extends THREE.WebGLRenderTarget>(rt: T): T {
    this._renderTargets.add(rt);
    return rt;
  }

  /** Track any object with a dispose() method. */
  trackDisposable<T extends { dispose(): void }>(obj: T): T {
    this._disposables.add(obj);
    return obj;
  }

  /**
   * Dispose all tracked resources and optionally remove Object3Ds from a scene.
   * After calling, the tracker is empty and ready for reuse.
   */
  disposeAll(scene?: THREE.Scene | THREE.Object3D) {
    // Remove Object3Ds from scene
    if (scene) {
      for (const obj of this._objects) {
        // Remove from any parent (not just direct scene children)
        obj.parent?.remove(obj);
      }
    }

    // Dispose render targets first (they reference textures internally)
    for (const rt of this._renderTargets) {
      try { rt.dispose(); } catch { /* already disposed */ }
    }

    // Dispose textures
    for (const tex of this._textures) {
      try { tex.dispose(); } catch { /* already disposed */ }
    }

    // Dispose materials
    for (const mat of this._materials) {
      try { mat.dispose(); } catch { /* already disposed */ }
    }

    // Dispose geometries
    for (const geo of this._geometries) {
      try { geo.dispose(); } catch { /* already disposed */ }
    }

    // Dispose InstancedMesh / other special objects
    for (const obj of this._objects) {
      if ((obj as THREE.InstancedMesh).isInstancedMesh) {
        try { (obj as THREE.InstancedMesh).dispose(); } catch { /* already disposed */ }
      }
    }

    // Dispose generic disposables
    for (const d of this._disposables) {
      try { d.dispose(); } catch { /* already disposed */ }
    }

    // Clear all sets
    this._geometries.clear();
    this._materials.clear();
    this._textures.clear();
    this._objects.clear();
    this._renderTargets.clear();
    this._disposables.clear();
  }

  /** Number of tracked resources (for debugging). */
  get size() {
    return this._geometries.size + this._materials.size + this._textures.size +
           this._objects.size + this._renderTargets.size + this._disposables.size;
  }

  // ── Internal ──

  private _trackMaterialTextures(mat: THREE.Material) {
    const std = mat as THREE.MeshStandardMaterial;
    const texProps = [
      'map', 'normalMap', 'aoMap', 'emissiveMap', 'envMap',
      'roughnessMap', 'metalnessMap', 'alphaMap', 'lightMap',
      'bumpMap', 'displacementMap',
    ] as const;
    for (const prop of texProps) {
      const tex = (std as any)[prop] as THREE.Texture | undefined;
      if (tex) this._textures.add(tex);
    }
  }
}

// ── Pre-built scoped trackers for major lifecycle boundaries ──

/** Tracks GPU resources created during a race. Disposed by clearRaceObjects(). */
export const raceTracker = new ResourceTracker();

/** Tracks GPU resources created for the title screen. Disposed by destroyTitleScene(). */
export const titleTracker = new ResourceTracker();

/** Tracks GPU resources created for the garage. Disposed by destroyGarage(). */
export const garageTracker = new ResourceTracker();
