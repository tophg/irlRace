/* ── Hood Racer — Minimap (Canvas-Based Track Radar) ── */

import * as THREE from 'three';

// ── Configuration ──
const MAP_SIZE = 160;        // px (square canvas)
const MAP_MARGIN = 14;       // px from screen edge
const TRACK_SAMPLES = 200;   // polyline resolution
const PLAYER_DOT = 6;        // radius px
const AI_DOT = 4;
const _DOT_TRAIL_LEN = 3;     // frames of motion trail

// Precomputed track polyline (screen-space)
let trackPoints: { x: number; y: number }[] = [];
let mapCanvas: HTMLCanvasElement | null = null;
let mapCtx: CanvasRenderingContext2D | null = null;
let offscreenCanvas: HTMLCanvasElement | null = null;

// Bounding box for world → minimap transform
let minX = Infinity, maxX = -Infinity;
let minZ = Infinity, maxZ = -Infinity;
let scaleX = 1, scaleZ = 1, padX = 0, padZ = 0;

/** Draw the track circuit to an offscreen canvas context. */
function drawTrackToOffscreen(ctx: CanvasRenderingContext2D, size: number) {
  ctx.clearRect(0, 0, size, size);
  // Track outline
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < trackPoints.length; i++) {
    const p = trackPoints[i];
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  if (trackPoints.length > 0) ctx.lineTo(trackPoints[0].x, trackPoints[0].y);
  ctx.stroke();
  // Brighter racing line
  ctx.strokeStyle = 'rgba(255, 140, 0, 0.2)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let i = 0; i < trackPoints.length; i++) {
    const p = trackPoints[i];
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  if (trackPoints.length > 0) ctx.lineTo(trackPoints[0].x, trackPoints[0].y);
  ctx.stroke();
}

/** Initialize the minimap for a given track spline. Call once per race. */
export function initTrackRadar(
  spline: THREE.CatmullRomCurve3,
  container: HTMLElement,
) {
  destroyTrackRadar();

  // Sample the spline into a polyline
  const raw = spline.getSpacedPoints(TRACK_SAMPLES);

  // Compute bounding box
  minX = Infinity; maxX = -Infinity;
  minZ = Infinity; maxZ = -Infinity;
  for (const p of raw) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }

  // Add 10% padding
  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;
  const maxRange = Math.max(rangeX, rangeZ);
  const pad = maxRange * 0.1;
  padX = (maxRange - rangeX) / 2 + pad;
  padZ = (maxRange - rangeZ) / 2 + pad;
  scaleX = (MAP_SIZE - 16) / (maxRange + pad * 2);
  scaleZ = (MAP_SIZE - 16) / (maxRange + pad * 2);

  trackPoints = raw.map(p => ({
    x: (p.x - minX + padX) * scaleX + 8,
    y: (p.z - minZ + padZ) * scaleZ + 8,
  }));

  // Create off-screen canvas for static track
  offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = MAP_SIZE * 2;
  offscreenCanvas.height = MAP_SIZE * 2;
  const offCtx = offscreenCanvas.getContext('2d')!;
  offCtx.scale(2, 2);
  drawTrackToOffscreen(offCtx, MAP_SIZE);

  // Create main canvas element
  mapCanvas = document.createElement('canvas');
  const computedSize = Math.min(Math.max(window.innerWidth * 0.22, 100), MAP_SIZE);
  mapCanvas.width = computedSize * 2;  // 2x for retina
  mapCanvas.height = computedSize * 2;
  mapCanvas.className = 'track-radar-canvas';
  mapCanvas.style.width = `${computedSize}px`;
  mapCanvas.style.height = `${computedSize}px`;
  container.appendChild(mapCanvas);

  mapCtx = mapCanvas.getContext('2d')!;
  mapCtx.scale(2, 2); // retina scaling

  // Recompute on resize/orientation change
  const onResize = () => {
    if (!mapCanvas || !mapCtx) return;
    const newSize = Math.min(Math.max(window.innerWidth * 0.22, 100), MAP_SIZE);
    mapCanvas.width = newSize * 2;
    mapCanvas.height = newSize * 2;
    mapCanvas.style.width = `${newSize}px`;
    mapCanvas.style.height = `${newSize}px`;
    mapCtx.setTransform(1, 0, 0, 1, 0, 0);
    mapCtx.scale(2, 2);
    // Rebuild offscreen cache at new size
    if (offscreenCanvas) {
      offscreenCanvas.width = newSize * 2;
      offscreenCanvas.height = newSize * 2;
      const offCtx = offscreenCanvas.getContext('2d')!;
      offCtx.setTransform(1, 0, 0, 1, 0, 0);
      offCtx.scale(2, 2);
      drawTrackToOffscreen(offCtx, newSize);
    }
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  (mapCanvas as any)._onResize = onResize;
}

/** Convert world XZ position to minimap pixel coordinates. */
function worldToMap(x: number, z: number): { mx: number; my: number } {
  return {
    mx: (x - minX + padX) * scaleX + 8,
    my: (z - minZ + padZ) * scaleZ + 8,
  };
}

/** Draw one frame of the minimap. Call every render frame. */
export function updateTrackRadar(
  playerPos: THREE.Vector3,
  playerHeading: number,
  aiPositions: { pos: THREE.Vector3; id: string }[],
) {
  if (!mapCtx || !mapCanvas) return;
  const ctx = mapCtx;
  const W = MAP_SIZE;

  // Clear with semi-transparent dark background
  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = 'rgba(8, 8, 20, 0.75)';
  ctx.beginPath();
  ctx.roundRect(0, 0, W, W, 12);
  ctx.fill();

  // Draw cached static track
  if (offscreenCanvas) {
    ctx.drawImage(offscreenCanvas, 0, 0, W, W);
  }

  // Draw AI dots
  for (const ai of aiPositions) {
    const { mx, my } = worldToMap(ai.pos.x, ai.pos.z);
    // Outer glow
    ctx.fillStyle = 'rgba(180, 180, 200, 0.3)';
    ctx.beginPath();
    ctx.arc(mx, my, AI_DOT + 2, 0, Math.PI * 2);
    ctx.fill();
    // Dot
    ctx.fillStyle = '#99aacc';
    ctx.beginPath();
    ctx.arc(mx, my, AI_DOT, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw player dot (with heading indicator)
  const { mx: px, my: py } = worldToMap(playerPos.x, playerPos.z);

  // Direction triangle
  const arrowLen = PLAYER_DOT + 5;
  // heading is in radians, translate to canvas coords (Z is forward in world)
  const dx = Math.sin(playerHeading) * arrowLen;
  const dy = Math.cos(playerHeading) * arrowLen;
  ctx.strokeStyle = '#ff6600';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + dx, py + dy);
  ctx.stroke();

  // Player glow
  ctx.fillStyle = 'rgba(255, 102, 0, 0.3)';
  ctx.beginPath();
  ctx.arc(px, py, PLAYER_DOT + 3, 0, Math.PI * 2);
  ctx.fill();

  // Player dot
  ctx.fillStyle = '#ff6600';
  ctx.beginPath();
  ctx.arc(px, py, PLAYER_DOT, 0, Math.PI * 2);
  ctx.fill();

  // White center pip
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(px, py, 2, 0, Math.PI * 2);
  ctx.fill();
}

/** Remove the minimap from DOM. */
export function destroyTrackRadar() {
  if (mapCanvas) {
    const onResize = (mapCanvas as any)._onResize;
    if (onResize) {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    }
    mapCanvas.remove();
    mapCanvas = null;
    mapCtx = null;
  }
  offscreenCanvas = null;
  trackPoints = [];
}
