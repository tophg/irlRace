/* ── IRL Race — OSM Road Network Fetcher ── */

import { haversineM } from './projection';

/** A single node in the OSM road network */
export interface RoadNode {
  id: number;
  lat: number;
  lon: number;
}

/** An OSM way (road segment) composed of node references */
export interface RoadWay {
  id: number;
  nodeIds: number[];
  tags: Record<string, string>;
}

/** Complete road network around a point */
export interface RoadNetwork {
  nodes: Map<number, RoadNode>;
  ways: RoadWay[];
}

/**
 * Fetch drivable road geometry within `radiusM` of a lat/lon point.
 * Uses the free OSM Overpass API (no API key required).
 *
 * Queries primary, secondary, tertiary, residential, and unclassified roads.
 * Returns nodes and ways that can be assembled into a road graph.
 */
export async function fetchRoadNetwork(
  lat: number,
  lon: number,
  radiusM = 600,
): Promise<RoadNetwork> {
  // Overpass QL query: fetch drivable roads within radius
  const query = `
    [out:json][timeout:15];
    (
      way(around:${radiusM},${lat},${lon})["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"];
    );
    (._;>;);
    out body;
  `;

  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!resp.ok) throw new Error(`Overpass API error: ${resp.status}`);
  const data = await resp.json();

  // Parse elements into nodes and ways
  const nodes = new Map<number, RoadNode>();
  const ways: RoadWay[] = [];

  for (const el of data.elements) {
    if (el.type === 'node') {
      nodes.set(el.id, { id: el.id, lat: el.lat, lon: el.lon });
    } else if (el.type === 'way') {
      ways.push({
        id: el.id,
        nodeIds: el.nodes as number[],
        tags: el.tags ?? {},
      });
    }
  }

  return { nodes, ways };
}

/** Edge in the road graph (between two adjacent road nodes) */
export interface RoadEdge {
  from: number;
  to: number;
  distance: number;  // meters
  wayId: number;
}

/**
 * Build an adjacency-list graph from the road network.
 * Each node maps to its connected neighbors with edge distances.
 */
export function buildRoadGraph(network: RoadNetwork): Map<number, RoadEdge[]> {
  const graph = new Map<number, RoadEdge[]>();

  for (const way of network.ways) {
    const isOneway = way.tags.oneway === 'yes';

    for (let i = 0; i < way.nodeIds.length - 1; i++) {
      const fromId = way.nodeIds[i];
      const toId = way.nodeIds[i + 1];
      const fromNode = network.nodes.get(fromId);
      const toNode = network.nodes.get(toId);
      if (!fromNode || !toNode) continue;

      const dist = haversineM(fromNode.lat, fromNode.lon, toNode.lat, toNode.lon);

      // Forward edge
      if (!graph.has(fromId)) graph.set(fromId, []);
      graph.get(fromId)!.push({ from: fromId, to: toId, distance: dist, wayId: way.id });

      // Reverse edge (unless one-way)
      if (!isOneway) {
        if (!graph.has(toId)) graph.set(toId, []);
        graph.get(toId)!.push({ from: toId, to: fromId, distance: dist, wayId: way.id });
      }
    }
  }

  return graph;
}

/**
 * Find the OSM node nearest to a lat/lon point.
 */
export function findNearestNode(
  nodes: Map<number, RoadNode>,
  lat: number,
  lon: number,
): number {
  let bestId = -1;
  let bestDist = Infinity;

  for (const [id, node] of nodes) {
    const d = haversineM(lat, lon, node.lat, node.lon);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }

  return bestId;
}
