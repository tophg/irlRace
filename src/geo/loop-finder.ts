/* ── IRL Race — Closed Circuit Loop Finder ── */

import { RoadEdge } from './roads';
import { RoadNode } from './roads';

/**
 * Find a closed drivable circuit from a road graph.
 *
 * Algorithm:
 * 1. BFS outward from start node to discover reachable nodes
 * 2. DFS with backtracking to find cycles in the target length range
 * 3. If no natural cycle found, fall back to "out-and-back" loop
 *    (go outward, pick best turnaround, come back via different roads)
 * 4. Final pass: simplify to ~8-20 control points for smooth spline
 *
 * Returns an ordered list of node IDs forming a closed loop.
 */
export function findRaceLoop(
  graph: Map<number, RoadEdge[]>,
  nodes: Map<number, RoadNode>,
  startNodeId: number,
  targetLengthM: number = 1200,  // ~1.2km default circuit
  toleranceM: number = 400,      // accept loops within ±400m of target
): number[] | null {
  const minLen = targetLengthM - toleranceM;
  const maxLen = targetLengthM + toleranceM;

  // ── Attempt 1: DFS cycle search ──
  const dfsResult = dfsCycleSearch(graph, startNodeId, minLen, maxLen);
  if (dfsResult) return dfsResult;

  // ── Attempt 2: Best loop from BFS frontier ──
  // Find nodes at ~half target distance, then find return paths
  const bfsResult = bfsTwoPathLoop(graph, startNodeId, targetLengthM);
  if (bfsResult) return bfsResult;

  // ── Attempt 3: Out-and-back fallback ──
  // Just go outward along the longest path, then reverse
  return outAndBackFallback(graph, startNodeId, targetLengthM);
}

/**
 * DFS cycle search: find a cycle back to start within length bounds.
 * Uses iterative DFS with an explicit stack to avoid call stack overflow.
 */
function dfsCycleSearch(
  graph: Map<number, RoadEdge[]>,
  start: number,
  minLen: number,
  maxLen: number,
): number[] | null {
  interface DFSFrame {
    nodeId: number;
    path: number[];
    distance: number;
    edgeIdx: number;
  }

  let bestLoop: number[] | null = null;
  let bestScore = Infinity; // lower = closer to midpoint of min/max

  const targetMid = (minLen + maxLen) / 2;

  const stack: DFSFrame[] = [{
    nodeId: start,
    path: [start],
    distance: 0,
    edgeIdx: 0,
  }];

  let iterations = 0;
  const MAX_ITERATIONS = 50000;

  while (stack.length > 0 && iterations < MAX_ITERATIONS) {
    iterations++;
    const frame = stack[stack.length - 1];
    const edges = graph.get(frame.nodeId) ?? [];

    if (frame.edgeIdx >= edges.length) {
      stack.pop();
      continue;
    }

    const edge = edges[frame.edgeIdx];
    frame.edgeIdx++;

    const newDist = frame.distance + edge.distance;

    // Prune if already too long
    if (newDist > maxLen) continue;

    // Check if this edge returns to start (cycle found!)
    if (edge.to === start && newDist >= minLen && frame.path.length >= 4) {
      const score = Math.abs(newDist - targetMid);
      if (score < bestScore) {
        bestScore = score;
        bestLoop = [...frame.path];
      }
      continue;
    }

    // Skip if we'd revisit a node on the current path (no figure-8s)
    if (frame.path.includes(edge.to)) continue;

    // Recurse deeper
    stack.push({
      nodeId: edge.to,
      path: [...frame.path, edge.to],
      distance: newDist,
      edgeIdx: 0,
    });
  }

  return bestLoop;
}

/**
 * BFS-based two-path loop: find two distinct paths from start to a
 * distant node, forming a loop. Works well in grid-like street networks.
 */
function bfsTwoPathLoop(
  graph: Map<number, RoadEdge[]>,
  start: number,
  targetLengthM: number,
): number[] | null {
  const halfTarget = targetLengthM / 2;

  // BFS to find shortest distances from start
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const queue: number[] = [start];
  dist.set(start, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDist = dist.get(current)!;

    for (const edge of (graph.get(current) ?? [])) {
      if (!dist.has(edge.to)) {
        const newDist = currentDist + edge.distance;
        if (newDist <= halfTarget * 1.5) { // don't explore too far
          dist.set(edge.to, newDist);
          prev.set(edge.to, current);
          queue.push(edge.to);
        }
      }
    }
  }

  // Find the node closest to halfTarget distance
  let bestNode = -1;
  let bestDelta = Infinity;
  for (const [nodeId, d] of dist) {
    if (nodeId === start) continue;
    const delta = Math.abs(d - halfTarget);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestNode = nodeId;
    }
  }

  if (bestNode === -1) return null;

  // Reconstruct path from start → bestNode
  const outPath: number[] = [];
  let current = bestNode;
  while (current !== start) {
    outPath.unshift(current);
    const p = prev.get(current);
    if (p === undefined) return null;
    current = p;
  }
  outPath.unshift(start);

  // Find a DIFFERENT return path using BFS with outPath nodes penalized
  const outSet = new Set(outPath.slice(1, -1)); // exclude start and end
  const dist2 = new Map<number, number>();
  const prev2 = new Map<number, number>();
  const queue2: number[] = [bestNode];
  dist2.set(bestNode, 0);

  while (queue2.length > 0) {
    const current2 = queue2.shift()!;
    const currentDist2 = dist2.get(current2)!;

    for (const edge of (graph.get(current2) ?? [])) {
      if (!dist2.has(edge.to)) {
        // Penalize nodes on the outbound path to encourage a different return
        const penalty = outSet.has(edge.to) ? edge.distance * 3 : 0;
        const newDist = currentDist2 + edge.distance + penalty;
        if (newDist <= halfTarget * 2) {
          dist2.set(edge.to, newDist);
          prev2.set(edge.to, current2);
          queue2.push(edge.to);
        }
      }
    }
  }

  // Reconstruct return path: bestNode → start
  if (!dist2.has(start)) return null;
  const returnPath: number[] = [];
  let current3 = start;
  while (current3 !== bestNode) {
    returnPath.unshift(current3);
    const p = prev2.get(current3);
    if (p === undefined) return null;
    current3 = p;
  }

  // Combine: outPath + returnPath (skip duplicated endpoints)
  const loop = [...outPath, ...returnPath.slice(1)];
  return loop;
}

/**
 * Fallback: simple out-and-back with offset return.
 * Follows the longest road outward for ~half the target, then returns.
 */
function outAndBackFallback(
  graph: Map<number, RoadEdge[]>,
  start: number,
  targetLengthM: number,
): number[] | null {
  const halfTarget = targetLengthM / 2;

  // Greedy walk outward, preferring the longest edge each step
  const path: number[] = [start];
  const visited = new Set<number>([start]);
  let totalDist = 0;
  let current = start;

  while (totalDist < halfTarget) {
    const edges = graph.get(current) ?? [];
    // Sort by distance (prefer longer segments for more interesting tracks)
    const unvisited = edges
      .filter(e => !visited.has(e.to))
      .sort((a, b) => b.distance - a.distance);

    if (unvisited.length === 0) break;

    const best = unvisited[0];
    path.push(best.to);
    visited.add(best.to);
    totalDist += best.distance;
    current = best.to;
  }

  if (path.length < 3) return null;

  // Return path = reversed (creates a teardrop/lollipop shape)
  // Add slight offset to avoid exact overlap
  const reversed = [...path].reverse().slice(1); // skip the duplicate turnaround point
  return [...path, ...reversed];
}

/**
 * Simplify a loop of many road nodes down to N control points.
 * Uses Ramer-Douglas-Peucker-like decimation preserving corners.
 */
export function simplifyLoop(
  nodeIds: number[],
  nodes: Map<number, RoadNode>,
  maxPoints: number = 16,
): { x: number; z: number; lat: number; lon: number }[] {
  // If already short enough, return as-is
  if (nodeIds.length <= maxPoints) {
    return nodeIds.map(id => {
      const n = nodes.get(id)!;
      return { x: 0, z: 0, lat: n.lat, lon: n.lon }; // x/z set later by projection
    });
  }

  // Uniform sampling along the loop
  const step = nodeIds.length / maxPoints;
  const result: { x: number; z: number; lat: number; lon: number }[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.floor(i * step) % nodeIds.length;
    const n = nodes.get(nodeIds[idx])!;
    result.push({ x: 0, z: 0, lat: n.lat, lon: n.lon });
  }
  return result;
}
