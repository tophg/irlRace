/* ── IRL Race — Coordinate Projection ── */
/* Adapted from SABLE core/utils.js haversineKm / bearingDeg */

const R_EARTH = 6371000; // Earth radius in meters
const DEG2RAD = Math.PI / 180;

/**
 * Project a lat/lon point to local x/z meters relative to a center point.
 * Uses equirectangular approximation — accurate within ~5km of center.
 *
 * Convention: +x = east, +z = south (Three.js default)
 */
export function latLonToXZ(
  lat: number, lon: number,
  centerLat: number, centerLon: number,
): { x: number; z: number } {
  const x = (lon - centerLon) * DEG2RAD * R_EARTH * Math.cos(centerLat * DEG2RAD);
  const z = -(lat - centerLat) * DEG2RAD * R_EARTH;
  return { x, z };
}

/**
 * Inverse projection: local x/z meters back to lat/lon.
 */
export function xzToLatLon(
  x: number, z: number,
  centerLat: number, centerLon: number,
): { lat: number; lon: number } {
  const lat = centerLat + (-z / (R_EARTH * DEG2RAD));
  const lon = centerLon + (x / (R_EARTH * Math.cos(centerLat * DEG2RAD) * DEG2RAD));
  return { lat, lon };
}

/**
 * Haversine great-circle distance between two points.
 * Adapted from SABLE core/utils.js:42
 */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) *
    Math.sin(dLon / 2) ** 2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Initial bearing between two points in degrees (0-360, clockwise from north).
 * Adapted from SABLE core/utils.js:60
 */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * DEG2RAD;
  const lat1R = lat1 * DEG2RAD;
  const lat2R = lat2 * DEG2RAD;
  const y = Math.sin(dLon) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) -
    Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}
