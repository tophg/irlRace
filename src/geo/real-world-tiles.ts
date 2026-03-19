/* ── IRL Race — Google 3D Photorealistic Tiles for Three.js ── */
/* Loads real-world buildings, trees, and terrain around a lat/lon center */

import * as THREE from 'three/webgpu';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/plugins';

/** Converts degrees to radians */
const DEG2RAD = Math.PI / 180;

/** WGS84 ellipsoid semi-major axis (meters) */
const WGS84_A = 6378137.0;
/** WGS84 ellipsoid semi-minor axis (meters) */
const WGS84_B = 6356752.3142;

/**
 * Compute the ECEF (Earth-Centered Earth-Fixed) position of a lat/lon point.
 * Used to position the 3D tileset so the player's address is at the Three.js origin.
 */
function latLonToECEF(latDeg: number, lonDeg: number, altM: number = 0): THREE.Vector3 {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const e2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);
  const N = WGS84_A / Math.sqrt(1 - e2 * sinLat * sinLat);

  return new THREE.Vector3(
    (N + altM) * cosLat * cosLon,
    (N + altM) * cosLat * sinLon,
    (N * (1 - e2) + altM) * sinLat,
  );
}

/**
 * Compute an ENU (East-North-Up) to ECEF rotation matrix at a given lat/lon.
 * This transforms from local game coordinates (x=east, y=up, z=south) to ECEF.
 */
function enuToECEFMatrix(latDeg: number, lonDeg: number): THREE.Matrix4 {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  // ENU axes in ECEF coordinates:
  // East  = [-sinLon, cosLon, 0]
  // North = [-sinLat*cosLon, -sinLat*sinLon, cosLat]
  // Up    = [cosLat*cosLon, cosLat*sinLon, sinLat]
  const m = new THREE.Matrix4();
  m.set(
    -sinLon, -sinLat * cosLon, cosLat * cosLon, 0,
    cosLon, -sinLat * sinLon, cosLat * sinLon, 0,
    0, cosLat, sinLat, 0,
    0, 0, 0, 1,
  );
  return m;
}

/**
 * Compute the full transform matrix that moves the Google 3D tileset
 * so that `centerLat/centerLon` sits at the Three.js world origin.
 *
 * The tileset is in ECEF coordinates. We need to:
 * 1. Translate so the center point is at origin
 * 2. Rotate so ENU (East-North-Up) aligns with Three.js axes
 *    (x=east, y=up, z=south matches Three.js convention)
 */
function computeTileTransform(centerLat: number, centerLon: number): THREE.Matrix4 {
  const ecefPos = latLonToECEF(centerLat, centerLon);
  const enuRot = enuToECEFMatrix(centerLat, centerLon);

  // Inverse of the ENU rotation (ECEF → ENU)
  const enuRotInv = enuRot.clone().invert();

  // Translate to move center point to origin, then rotate to ENU
  const translate = new THREE.Matrix4().makeTranslation(
    -ecefPos.x, -ecefPos.y, -ecefPos.z,
  );

  // Combined: first translate, then rotate
  const transform = new THREE.Matrix4().multiplyMatrices(enuRotInv, translate);

  // Finally, swap axes: ENU uses (East, North, Up) but Three.js uses (x=right, y=up, z=-forward)
  // ENU East → Three.js +X  (already correct)
  // ENU North → Three.js -Z (flip)
  // ENU Up → Three.js +Y    (swap Y↔Z)
  const axisSwap = new THREE.Matrix4().set(
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, -1, 0, 0,
    0, 0, 0, 1,
  );

  return new THREE.Matrix4().multiplyMatrices(axisSwap, transform);
}

export interface RealWorldTilesHandle {
  tiles: TilesRenderer;
  update: () => void;
  dispose: () => void;
}

/**
 * Load Google 3D photorealistic tiles centered on a lat/lon point.
 *
 * @param scene    Three.js scene to add tiles to
 * @param camera   Active camera (for LOD resolution)
 * @param center   Lat/lon center point (player's address)
 * @param apiKey   Google Maps API key
 * @returns        Handle with update() (call per frame) and dispose()
 */
export function loadRealWorldTiles(
  scene: THREE.Scene,
  camera: THREE.Camera,
  center: { lat: number; lon: number },
  apiKey: string,
): RealWorldTilesHandle {
  // Create tiles renderer with Google auth
  const tiles = new TilesRenderer();
  tiles.registerPlugin(new GoogleCloudAuthPlugin({
    apiToken: apiKey,
    autoRefreshToken: true,
    useRecommendedSettings: true,
  }));

  // Register camera for LOD
  tiles.setCamera(camera);

  // Set resolution manually (WebGPU renderer isn't directly supported)
  tiles.setResolution(camera, window.innerWidth, window.innerHeight);

  // Compute the transform that centers the tileset on the player's address
  const transform = computeTileTransform(center.lat, center.lon);
  tiles.group.applyMatrix4(transform);

  scene.add(tiles.group);

  // Handle window resize
  const onResize = () => {
    tiles.setResolution(camera, window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  return {
    tiles,
    update: () => {
      tiles.update();
    },
    dispose: () => {
      window.removeEventListener('resize', onResize);
      scene.remove(tiles.group);
      tiles.dispose();
    },
  };
}
