/* ── IRL Race — Geocoding (Nominatim) ── */

export interface GeoResult {
  lat: number;
  lon: number;
  displayName: string;
}

/**
 * Geocode a street address to lat/lon using OpenStreetMap Nominatim.
 * Free, no API key required. Rate limit: 1 req/sec.
 */
export async function geocodeAddress(address: string): Promise<GeoResult> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'HoodRacer/1.0 (https://hoodracer.com)' },
  });
  if (!resp.ok) throw new Error(`Geocode request failed: ${resp.status}`);

  const results = await resp.json();
  if (!results.length) throw new Error(`Address not found: "${address}"`);

  return {
    lat: parseFloat(results[0].lat),
    lon: parseFloat(results[0].lon),
    displayName: results[0].display_name ?? address,
  };
}

/**
 * Reverse geocode lat/lon to a human-readable place name.
 * Returns just the neighborhood/suburb name if available.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=16`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'HoodRacer/1.0 (https://hoodracer.com)' },
  });
  if (!resp.ok) return 'Unknown Hood';

  const data = await resp.json();
  // Prefer neighborhood/suburb name for "hood" flavor
  const addr = data.address ?? {};
  return addr.neighbourhood ?? addr.suburb ?? addr.city_district ?? addr.city ?? data.display_name ?? 'Unknown Hood';
}
