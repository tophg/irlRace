/* ── Hood Racer — Hood Generator (Orchestrator) ── */
/* Address → Playable TrackData */

import { geocodeAddress, reverseGeocode, GeoResult } from './geocode';
import { fetchRoadNetwork, buildRoadGraph, findNearestNode } from './roads';
import { findRaceLoop, simplifyLoop } from './loop-finder';
import { latLonToXZ } from './projection';
import { buildTrackFromControlPoints } from '../track';
import type { TrackData } from '../types';

export interface HoodTrackResult {
  trackData: TrackData;
  hoodName: string;
  center: { lat: number; lon: number };
  loopCoords: { lat: number; lon: number }[];
}

/**
 * Generate a playable track from a street address.
 *
 * Pipeline:
 *   address → geocode → fetch roads → find loop → project → build track
 *
 * @param address  Free-text address (e.g. "123 Main St, Springfield, IL")
 * @param options  Optional tuning parameters
 * @returns        A playable TrackData plus metadata
 */
export async function generateHoodTrack(
  address: string,
  options: {
    radiusM?: number;       // Road search radius (default 600m)
    targetLengthM?: number; // Target circuit length (default 1200m)
    maxControlPoints?: number; // Max spline control points (default 16)
  } = {},
): Promise<HoodTrackResult> {
  const {
    radiusM = 600,
    targetLengthM = 1200,
    maxControlPoints = 16,
  } = options;

  console.log(`[HoodRacer] Generating track for: "${address}"`);

  // ── Step 1: Geocode ──
  const geo = await geocodeAddress(address);
  console.log(`[HoodRacer] Geocoded to: ${geo.lat.toFixed(5)}, ${geo.lon.toFixed(5)}`);

  // ── Step 2: Get hood name ──
  const hoodName = await reverseGeocode(geo.lat, geo.lon);
  console.log(`[HoodRacer] Hood: ${hoodName}`);

  // ── Step 3: Fetch road network ──
  const network = await fetchRoadNetwork(geo.lat, geo.lon, radiusM);
  console.log(`[HoodRacer] Fetched ${network.nodes.size} nodes, ${network.ways.length} ways`);

  if (network.ways.length === 0) {
    throw new Error(`No drivable roads found near "${address}". Try a different address.`);
  }

  // ── Step 4: Build graph and find nearest start node ──
  const graph = buildRoadGraph(network);
  const startNode = findNearestNode(network.nodes, geo.lat, geo.lon);

  if (startNode === -1 || !graph.has(startNode)) {
    throw new Error(`Could not find a road node near "${address}".`);
  }

  console.log(`[HoodRacer] Graph: ${graph.size} nodes, start=${startNode}`);

  // ── Step 5: Find a closed loop ──
  const loopNodeIds = findRaceLoop(graph, network.nodes, startNode, targetLengthM);

  if (!loopNodeIds || loopNodeIds.length < 4) {
    throw new Error(`Could not find a suitable race circuit near "${address}". Try a busier area.`);
  }

  console.log(`[HoodRacer] Found loop with ${loopNodeIds.length} nodes`);

  // ── Step 6: Simplify to control points ──
  const simplified = simplifyLoop(loopNodeIds, network.nodes, maxControlPoints);

  // ── Step 7: Project lat/lon → local x/z meters ──
  const center = { lat: geo.lat, lon: geo.lon };
  const controlPoints = simplified.map(p => {
    const projected = latLonToXZ(p.lat, p.lon, center.lat, center.lon);
    return { x: projected.x, z: projected.z };
  });

  console.log(`[HoodRacer] ${controlPoints.length} control points, building track...`);

  // ── Step 8: Build track using existing pipeline ──
  const trackData = buildTrackFromControlPoints(controlPoints);

  const loopCoords = simplified.map(p => ({ lat: p.lat, lon: p.lon }));

  console.log(`[HoodRacer] Track built! Length: ${trackData.totalLength.toFixed(0)}m`);

  return {
    trackData,
    hoodName,
    center,
    loopCoords,
  };
}
