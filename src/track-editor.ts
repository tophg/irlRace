/* ── Hood Racer — Track Editor ──
 *
 * Full-screen 2D canvas editor for designing custom race tracks.
 * Users place/drag/delete CatmullRom control points. A live 3D mini-preview
 * shows the compiled road mesh. Tracks can be saved, loaded, and test-driven.
 */

import * as THREE from 'three';
import { CustomTrackDef, TrackData } from './types';
import { buildTrackFromControlPoints } from './track';
import { saveCustomTrack, loadCustomTracks, deleteCustomTrack, exportTrackJSON, importTrackJSON } from './track-storage';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface EditorPoint { x: number; z: number; }

let editorCanvas: HTMLCanvasElement | null = null;
let editorCtx: CanvasRenderingContext2D | null = null;
let editorToolbar: HTMLDivElement | null = null;
let editorContainer: HTMLElement | null = null;

let controlPoints: EditorPoint[] = [];
let undoStack: EditorPoint[][] = [];
let redoStack: EditorPoint[][] = [];

// Viewport (pan + zoom)
let viewX = 0;   // world center X
let viewZ = 0;   // world center Z
let viewScale = 2.5; // pixels per world unit

// Interaction
let dragIdx = -1;
let isPanning = false;
let panStartX = 0;
let panStartZ = 0;
let panViewStartX = 0;
let panViewStartZ = 0;
let hoverIdx = -1;

// 3D Preview
let previewRenderer: THREE.WebGLRenderer | null = null;
let previewScene: THREE.Scene | null = null;
let previewCamera: THREE.OrthographicCamera | null = null;
let previewContainer: HTMLDivElement | null = null;
let previewTrackGroup: THREE.Group | null = null;
let previewRebuildTimer: ReturnType<typeof setTimeout> | null = null;

// Callbacks
let onTestDrive: ((track: TrackData) => void) | null = null;
let onRaceWithTrack: ((track: TrackData) => void) | null = null;
let onBack: (() => void) | null = null;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COORDINATE TRANSFORMS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function worldToScreen(wx: number, wz: number): [number, number] {
  if (!editorCanvas) return [0, 0];
  const cx = editorCanvas.width / 2;
  const cz = editorCanvas.height / 2;
  return [
    cx + (wx - viewX) * viewScale,
    cz + (wz - viewZ) * viewScale,
  ];
}

function screenToWorld(sx: number, sz: number): [number, number] {
  if (!editorCanvas) return [0, 0];
  const cx = editorCanvas.width / 2;
  const cz = editorCanvas.height / 2;
  return [
    viewX + (sx - cx) / viewScale,
    viewZ + (sz - cz) / viewScale,
  ];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUBLIC API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function showTrackEditor(
  container: HTMLElement,
  callbacks: {
    onTestDrive: (track: TrackData) => void;
    onRaceWithTrack: (track: TrackData) => void;
    onBack: () => void;
  },
) {
  editorContainer = container;
  onTestDrive = callbacks.onTestDrive;
  onRaceWithTrack = callbacks.onRaceWithTrack;
  onBack = callbacks.onBack;

  controlPoints = [];
  undoStack = [];
  redoStack = [];
  viewX = 0; viewZ = 0; viewScale = 2.5;
  dragIdx = -1; isPanning = false; hoverIdx = -1;

  // ── Create 2D canvas ──
  editorCanvas = document.createElement('canvas');
  editorCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:5;cursor:crosshair;';
  editorCanvas.width = window.innerWidth;
  editorCanvas.height = window.innerHeight;
  container.appendChild(editorCanvas);
  editorCtx = editorCanvas.getContext('2d')!;

  // ── Create toolbar ──
  buildToolbar(container);

  // ── Create 3D preview ──
  initPreview(container);

  // ── Attach events ──
  editorCanvas.addEventListener('mousedown', onMouseDown);
  editorCanvas.addEventListener('mousemove', onMouseMove);
  editorCanvas.addEventListener('mouseup', onMouseUp);
  editorCanvas.addEventListener('contextmenu', onContextMenu);
  editorCanvas.addEventListener('wheel', onWheel, { passive: false });
  editorCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
  editorCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
  editorCanvas.addEventListener('touchend', onTouchEnd);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);

  // Initial draw
  draw();
}

export function destroyTrackEditor() {
  if (editorCanvas) {
    editorCanvas.removeEventListener('mousedown', onMouseDown);
    editorCanvas.removeEventListener('mousemove', onMouseMove);
    editorCanvas.removeEventListener('mouseup', onMouseUp);
    editorCanvas.removeEventListener('contextmenu', onContextMenu);
    editorCanvas.removeEventListener('wheel', onWheel);
    editorCanvas.removeEventListener('touchstart', onTouchStart);
    editorCanvas.removeEventListener('touchmove', onTouchMove);
    editorCanvas.removeEventListener('touchend', onTouchEnd);
    editorCanvas.remove();
    editorCanvas = null;
    editorCtx = null;
  }
  if (editorToolbar) { editorToolbar.remove(); editorToolbar = null; }
  window.removeEventListener('resize', onResize);
  window.removeEventListener('keydown', onKeyDown);

  // Cleanup 3D preview
  if (previewRenderer) {
    previewRenderer.dispose();
    previewRenderer = null;
  }
  if (previewContainer) { previewContainer.remove(); previewContainer = null; }
  previewScene = null;
  previewCamera = null;
  previewTrackGroup = null;
  if (previewRebuildTimer) clearTimeout(previewRebuildTimer);

  controlPoints = [];
  undoStack = []; redoStack = [];
  onTestDrive = null; onRaceWithTrack = null; onBack = null;
  editorContainer = null;
}

/** Compile editor control points into a playable TrackData. Returns null if < 4 points. */
export function compileEditorTrack(): TrackData | null {
  if (controlPoints.length < 4) return null;
  try {
    return buildTrackFromControlPoints(controlPoints);
  } catch {
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOOLBAR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildToolbar(container: HTMLElement) {
  editorToolbar = document.createElement('div');
  editorToolbar.style.cssText = `
    position:fixed;top:0;left:0;right:0;z-index:10;
    display:flex;align-items:center;gap:8px;padding:10px 16px;
    background:linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 100%);
    backdrop-filter:blur(8px);font-family:'Inter',sans-serif;
  `;

  const title = el('span', '🏁 TRACK EDITOR', 'color:#fff;font-size:16px;font-weight:700;letter-spacing:2px;margin-right:8px;');
  editorToolbar.appendChild(title);

  const sep = () => { const s = el('span', '', 'width:1px;height:24px;background:rgba(255,255,255,0.15);'); return s; };

  editorToolbar.appendChild(btn('NEW', () => { pushUndo(); controlPoints = []; redoStack = []; schedulePreviewRebuild(); draw(); }));
  editorToolbar.appendChild(btn('UNDO', () => undo()));
  editorToolbar.appendChild(btn('REDO', () => redo()));
  editorToolbar.appendChild(sep());

  // Save
  editorToolbar.appendChild(btn('SAVE', () => showSaveDialog()));
  editorToolbar.appendChild(btn('LOAD', () => showLoadDialog()));
  editorToolbar.appendChild(btn('EXPORT', () => {
    if (controlPoints.length < 4) return;
    const def: CustomTrackDef = { name: `Track_${Date.now()}`, controlPoints: [...controlPoints], createdAt: Date.now() };
    exportTrackJSON(def);
  }));
  editorToolbar.appendChild(btn('IMPORT', () => showImportDialog()));
  editorToolbar.appendChild(sep());

  // Action buttons
  editorToolbar.appendChild(btn('🏎️ TEST DRIVE', () => {
    const track = compileEditorTrack();
    if (track && onTestDrive) onTestDrive(track);
    else showToast('Need at least 4 points!');
  }, true));
  editorToolbar.appendChild(btn('🏁 RACE', () => {
    const track = compileEditorTrack();
    if (track && onRaceWithTrack) onRaceWithTrack(track);
    else showToast('Need at least 4 points!');
  }, true));
  editorToolbar.appendChild(sep());
  editorToolbar.appendChild(btn('← BACK', () => { if (onBack) onBack(); }));

  // Point counter
  const counter = el('span', '', 'color:rgba(255,255,255,0.5);font-size:12px;margin-left:auto;');
  counter.id = 'editor-counter';
  editorToolbar.appendChild(counter);

  container.appendChild(editorToolbar);
}

function el(tag: string, text: string, style: string): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = text;
  e.style.cssText = style;
  return e;
}

function btn(label: string, onClick: () => void, accent = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = `
    padding:6px 12px;border-radius:4px;border:1px solid ${accent ? '#ff6600' : 'rgba(255,255,255,0.2)'};
    background:${accent ? 'rgba(255,102,0,0.2)' : 'rgba(255,255,255,0.05)'};
    color:${accent ? '#ff8833' : '#ccc'};cursor:pointer;font-size:12px;font-weight:600;
    letter-spacing:1px;font-family:'Inter',sans-serif;transition:background 0.15s;
  `;
  b.addEventListener('mouseenter', () => { b.style.background = accent ? 'rgba(255,102,0,0.4)' : 'rgba(255,255,255,0.15)'; });
  b.addEventListener('mouseleave', () => { b.style.background = accent ? 'rgba(255,102,0,0.2)' : 'rgba(255,255,255,0.05)'; });
  b.addEventListener('click', onClick);
  return b;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SAVE / LOAD / IMPORT DIALOGS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function showSaveDialog() {
  if (controlPoints.length < 4) { showToast('Need at least 4 points!'); return; }
  const name = prompt('Track name:');
  if (!name) return;
  const def: CustomTrackDef = { name, controlPoints: [...controlPoints], createdAt: Date.now() };
  saveCustomTrack(def);
  showToast(`Saved "${name}"`);
}

function showLoadDialog() {
  const tracks = loadCustomTracks();
  if (tracks.length === 0) { showToast('No saved tracks'); return; }

  // Create overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;z-index:20;
    background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;
    font-family:'Inter',sans-serif;
  `;
  const panel = document.createElement('div');
  panel.style.cssText = `
    background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);border-radius:8px;
    padding:20px;min-width:280px;max-height:400px;overflow-y:auto;
  `;
  panel.innerHTML = '<div style="color:#fff;font-size:16px;font-weight:700;margin-bottom:12px;">LOAD TRACK</div>';

  for (const t of tracks) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    const loadBtn = btn(t.name, () => {
      pushUndo();
      controlPoints = t.controlPoints.map(p => ({ ...p }));
      redoStack = [];
      schedulePreviewRebuild();
      draw();
      overlay.remove();
      showToast(`Loaded "${t.name}"`);
    });
    loadBtn.style.flex = '1';
    row.appendChild(loadBtn);
    const delBtn = btn('✕', () => {
      deleteCustomTrack(t.name);
      row.remove();
      if (panel.querySelectorAll('div[style*="flex"]').length === 0) {
        overlay.remove();
        showToast('All tracks deleted');
      }
    });
    delBtn.style.cssText += 'color:#ff4444;border-color:#ff4444;padding:6px 8px;';
    row.appendChild(delBtn);
    panel.appendChild(row);
  }

  const closeBtn = btn('CANCEL', () => overlay.remove());
  closeBtn.style.marginTop = '12px';
  closeBtn.style.width = '100%';
  panel.appendChild(closeBtn);
  overlay.appendChild(panel);
  editorContainer?.appendChild(overlay);
}

function showImportDialog() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const def = importTrackJSON(reader.result as string);
      if (def) {
        pushUndo();
        controlPoints = def.controlPoints.map(p => ({ ...p }));
        redoStack = [];
        schedulePreviewRebuild();
        draw();
        showToast(`Imported "${def.name}"`);
      } else {
        showToast('Invalid track file!');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

function showToast(msg: string) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:30;
    background:rgba(0,0,0,0.8);color:#fff;padding:10px 20px;border-radius:6px;
    font-family:'Inter',sans-serif;font-size:14px;pointer-events:none;
    animation:fadeInUp 0.3s ease-out;
  `;
  editorContainer?.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UNDO / REDO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function pushUndo() {
  undoStack.push(controlPoints.map(p => ({ ...p })));
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(controlPoints.map(p => ({ ...p })));
  controlPoints = undoStack.pop()!;
  schedulePreviewRebuild();
  draw();
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(controlPoints.map(p => ({ ...p })));
  controlPoints = redoStack.pop()!;
  schedulePreviewRebuild();
  draw();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INPUT HANDLERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const HANDLE_RADIUS = 10;

function findPointAt(sx: number, sy: number): number {
  for (let i = 0; i < controlPoints.length; i++) {
    const [px, py] = worldToScreen(controlPoints[i].x, controlPoints[i].z);
    const dx = sx - px, dy = sy - py;
    if (dx * dx + dy * dy < HANDLE_RADIUS * HANDLE_RADIUS * 1.5) return i;
  }
  return -1;
}

function onMouseDown(e: MouseEvent) {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    // Middle-click or Alt+click → pan
    isPanning = true;
    panStartX = e.clientX; panStartZ = e.clientY;
    panViewStartX = viewX; panViewStartZ = viewZ;
    if (editorCanvas) editorCanvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button === 0) {
    const idx = findPointAt(e.clientX, e.clientY);
    if (idx >= 0) {
      // Start dragging
      pushUndo();
      dragIdx = idx;
      if (editorCanvas) editorCanvas.style.cursor = 'grab';
    } else {
      // Add new point
      pushUndo();
      const [wx, wz] = screenToWorld(e.clientX, e.clientY);
      controlPoints.push({ x: wx, z: wz });
      schedulePreviewRebuild();
      draw();
    }
  }
}

function onMouseMove(e: MouseEvent) {
  if (isPanning) {
    const dx = e.clientX - panStartX;
    const dz = e.clientY - panStartZ;
    viewX = panViewStartX - dx / viewScale;
    viewZ = panViewStartZ - dz / viewScale;
    draw();
    return;
  }
  if (dragIdx >= 0) {
    const [wx, wz] = screenToWorld(e.clientX, e.clientY);
    controlPoints[dragIdx].x = wx;
    controlPoints[dragIdx].z = wz;
    schedulePreviewRebuild();
    draw();
    return;
  }
  // Hover highlight
  const newHover = findPointAt(e.clientX, e.clientY);
  if (newHover !== hoverIdx) {
    hoverIdx = newHover;
    if (editorCanvas) editorCanvas.style.cursor = hoverIdx >= 0 ? 'pointer' : 'crosshair';
    draw();
  }
}

function onMouseUp(_e: MouseEvent) {
  if (isPanning) {
    isPanning = false;
    if (editorCanvas) editorCanvas.style.cursor = 'crosshair';
    return;
  }
  if (dragIdx >= 0) {
    dragIdx = -1;
    if (editorCanvas) editorCanvas.style.cursor = 'crosshair';
  }
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  const idx = findPointAt(e.clientX, e.clientY);
  if (idx >= 0 && controlPoints.length > 0) {
    pushUndo();
    controlPoints.splice(idx, 1);
    schedulePreviewRebuild();
    draw();
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  // Zoom toward cursor
  const [wx, wz] = screenToWorld(e.clientX, e.clientY);
  viewScale *= zoomFactor;
  viewScale = Math.max(0.3, Math.min(20, viewScale));
  // Adjust view center so point under cursor stays
  const [nx, nz] = screenToWorld(e.clientX, e.clientY);
  viewX -= (nx - wx);
  viewZ -= (nz - wz);
  draw();
}

// ── Touch support ──
let touchStartId = -1;
let touchStartTime = 0;

function onTouchStart(e: TouchEvent) {
  e.preventDefault();
  if (e.touches.length === 1) {
    const t = e.touches[0];
    touchStartId = t.identifier;
    touchStartTime = performance.now();
    const idx = findPointAt(t.clientX, t.clientY);
    if (idx >= 0) {
      pushUndo();
      dragIdx = idx;
    } else {
      isPanning = true;
      panStartX = t.clientX; panStartZ = t.clientY;
      panViewStartX = viewX; panViewStartZ = viewZ;
    }
  }
}

function onTouchMove(e: TouchEvent) {
  e.preventDefault();
  const t = Array.from(e.touches).find(tt => tt.identifier === touchStartId);
  if (!t) return;
  if (dragIdx >= 0) {
    const [wx, wz] = screenToWorld(t.clientX, t.clientY);
    controlPoints[dragIdx].x = wx;
    controlPoints[dragIdx].z = wz;
    schedulePreviewRebuild();
    draw();
  } else if (isPanning) {
    const dx = t.clientX - panStartX;
    const dz = t.clientY - panStartZ;
    viewX = panViewStartX - dx / viewScale;
    viewZ = panViewStartZ - dz / viewScale;
    draw();
  }
}

function onTouchEnd(e: TouchEvent) {
  const wasShortTap = performance.now() - touchStartTime < 300;
  if (dragIdx >= 0) {
    dragIdx = -1;
  } else if (isPanning && wasShortTap && e.changedTouches.length > 0) {
    // Short tap without drag → add point
    isPanning = false;
    const t = e.changedTouches[0];
    pushUndo();
    const [wx, wz] = screenToWorld(t.clientX, t.clientY);
    controlPoints.push({ x: wx, z: wz });
    schedulePreviewRebuild();
    draw();
  } else {
    isPanning = false;
  }
  touchStartId = -1;
}

function onResize() {
  if (editorCanvas) {
    editorCanvas.width = window.innerWidth;
    editorCanvas.height = window.innerHeight;
  }
  draw();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
    e.preventDefault(); undo();
  } else if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === 'y' && (e.ctrlKey || e.metaKey))) {
    e.preventDefault(); redo();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (hoverIdx >= 0) {
      pushUndo();
      controlPoints.splice(hoverIdx, 1);
      hoverIdx = -1;
      schedulePreviewRebuild();
      draw();
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2D CANVAS DRAWING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function draw() {
  if (!editorCanvas || !editorCtx) return;
  const ctx = editorCtx;
  const w = editorCanvas.width;
  const h = editorCanvas.height;

  // ── Background ──
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, w, h);

  // ── Grid ──
  drawGrid(ctx, w, h);

  // ── Spline + road ribbon ──
  if (controlPoints.length >= 2) {
    drawSplinePreview(ctx);
  }

  // ── Control points ──
  for (let i = 0; i < controlPoints.length; i++) {
    const p = controlPoints[i];
    const [sx, sy] = worldToScreen(p.x, p.z);

    // Connection line to next point
    if (controlPoints.length >= 2) {
      const next = controlPoints[(i + 1) % controlPoints.length];
      const [nx, ny] = worldToScreen(next.x, next.z);
      ctx.beginPath();
      ctx.moveTo(sx, sy); ctx.lineTo(nx, ny);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Handle
    const isHover = i === hoverIdx;
    const isDrag = i === dragIdx;
    const isFirst = i === 0;

    ctx.beginPath();
    ctx.arc(sx, sy, isDrag ? 10 : isHover ? 9 : 7, 0, Math.PI * 2);
    ctx.fillStyle = isFirst ? '#ffcc00' : isDrag ? '#ff6600' : isHover ? '#ff8833' : '#44aaff';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isFirst ? 'S' : `${i}`, sx, sy + 3.5);
  }

  // ── Help text ──
  if (controlPoints.length < 4) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';
    const msgs = [
      'Click to place control points (min. 4)',
      'Right-click to delete • Scroll to zoom • Alt+drag to pan',
    ];
    msgs.forEach((m, i) => ctx.fillText(m, w / 2, h / 2 + i * 22 - 11));
  }

  // Update counter
  const counter = document.getElementById('editor-counter');
  if (counter) {
    const valid = controlPoints.length >= 4;
    counter.textContent = `${controlPoints.length} point${controlPoints.length !== 1 ? 's' : ''}${valid ? ' ✓' : ' (need 4+)'}`;
    counter.style.color = valid ? '#44ff88' : 'rgba(255,255,255,0.4)';
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const gridSpacing = 20; // world units
  const pixelSpacing = gridSpacing * viewScale;

  if (pixelSpacing < 5) return; // too zoomed out

  // World-space bounds visible on screen
  const [wLeft, wTop] = screenToWorld(0, 0);
  const [wRight, wBottom] = screenToWorld(w, h);

  const startX = Math.floor(wLeft / gridSpacing) * gridSpacing;
  const startZ = Math.floor(wTop / gridSpacing) * gridSpacing;

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;

  for (let gx = startX; gx <= wRight; gx += gridSpacing) {
    const [sx] = worldToScreen(gx, 0);
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
  }
  for (let gz = startZ; gz <= wBottom; gz += gridSpacing) {
    const [, sy] = worldToScreen(0, gz);
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
  }

  // Origin cross
  const [ox, oy] = worldToScreen(0, 0);
  ctx.strokeStyle = 'rgba(255,100,100,0.2)';
  ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, h); ctx.stroke();
  ctx.strokeStyle = 'rgba(100,100,255,0.2)';
  ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(w, oy); ctx.stroke();
}

function drawSplinePreview(ctx: CanvasRenderingContext2D) {
  if (controlPoints.length < 2) return;

  const pts3D = controlPoints.map(p => new THREE.Vector3(p.x, 0, p.z));
  const closed = controlPoints.length >= 3;
  const spline = new THREE.CatmullRomCurve3(pts3D, closed, 'centripetal', 0.5);

  const samples = Math.max(controlPoints.length * 20, 100);
  const splinePoints = spline.getSpacedPoints(samples);

  const ROAD_HALF = 7;

  // Road ribbon (filled)
  ctx.beginPath();
  for (let i = 0; i < splinePoints.length; i++) {
    const p = splinePoints[i];
    const next = splinePoints[(i + 1) % splinePoints.length];
    const dx = next.x - p.x;
    const dz = next.z - p.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = -dz / len, nz = dx / len;
    const [sx, sy] = worldToScreen(p.x + nx * ROAD_HALF, p.z + nz * ROAD_HALF);
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  for (let i = splinePoints.length - 1; i >= 0; i--) {
    const p = splinePoints[i];
    const next = splinePoints[(i + 1) % splinePoints.length];
    const dx = next.x - p.x;
    const dz = next.z - p.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = -dz / len, nz = dx / len;
    const [sx, sy] = worldToScreen(p.x - nx * ROAD_HALF, p.z - nz * ROAD_HALF);
    ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(60,60,80,0.4)';
  ctx.fill();

  // Centerline with curvature coloring
  ctx.lineWidth = 2;
  for (let i = 0; i < splinePoints.length - 1; i++) {
    const t = i / samples;
    // Estimate curvature from angle change
    const p0 = splinePoints[Math.max(0, i - 1)];
    const p1 = splinePoints[i];
    const p2 = splinePoints[Math.min(splinePoints.length - 1, i + 1)];
    const a1 = Math.atan2(p1.z - p0.z, p1.x - p0.x);
    const a2 = Math.atan2(p2.z - p1.z, p2.x - p1.x);
    let dAngle = Math.abs(a2 - a1);
    if (dAngle > Math.PI) dAngle = Math.PI * 2 - dAngle;
    const curvature = Math.min(dAngle * 10, 1); // 0=straight, 1=tight

    const r = Math.floor(80 + curvature * 175);
    const g = Math.floor(200 - curvature * 180);
    const b = Math.floor(80);

    const [sx, sy] = worldToScreen(p1.x, p1.z);
    const [nx, ny] = worldToScreen(p2.x, p2.z);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(nx, ny);
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.stroke();
  }

  // Direction arrows
  const arrowCount = Math.floor(samples / 15);
  for (let i = 0; i < arrowCount; i++) {
    const sampleIdx = Math.floor((i / arrowCount) * splinePoints.length);
    const p = splinePoints[sampleIdx];
    const next = splinePoints[(sampleIdx + 2) % splinePoints.length];
    const dx = next.x - p.x;
    const dz = next.z - p.z;
    const angle = Math.atan2(dz, dx);

    const [sx, sy] = worldToScreen(p.x, p.z);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(6, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fill();
    ctx.restore();
  }

  // Start/finish marker
  if (controlPoints.length >= 4) {
    const startPt = splinePoints[0];
    const [sx, sy] = worldToScreen(startPt.x, startPt.z);
    ctx.fillStyle = '#ffcc00';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🏁 START/FINISH', sx, sy - 18);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3D MINI-PREVIEW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function initPreview(container: HTMLElement) {
  previewContainer = document.createElement('div');
  previewContainer.style.cssText = `
    position:fixed;bottom:16px;right:16px;width:320px;height:220px;z-index:10;
    border:1px solid rgba(255,255,255,0.15);border-radius:8px;overflow:hidden;
    background:#0a0a14;box-shadow:0 4px 20px rgba(0,0,0,0.5);
  `;
  const label = document.createElement('div');
  label.textContent = '3D PREVIEW';
  label.style.cssText = `
    position:absolute;top:6px;left:10px;z-index:1;
    color:rgba(255,255,255,0.4);font-size:10px;font-weight:600;letter-spacing:1px;
    font-family:'Inter',sans-serif;
  `;
  previewContainer.appendChild(label);
  container.appendChild(previewContainer);

  previewScene = new THREE.Scene();
  previewScene.background = new THREE.Color(0x0a0a14);

  // Lighting
  const amb = new THREE.AmbientLight(0xffffff, 0.6);
  previewScene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(100, 200, 50);
  previewScene.add(dir);

  // Orthographic camera — top-down
  previewCamera = new THREE.OrthographicCamera(-150, 150, 100, -100, 1, 2000);
  previewCamera.position.set(0, 500, 0);
  previewCamera.lookAt(0, 0, 0);

  previewRenderer = new THREE.WebGLRenderer({ antialias: true });
  previewRenderer.setSize(320, 220);
  previewRenderer.setPixelRatio(window.devicePixelRatio);
  previewContainer.appendChild(previewRenderer.domElement);

  previewTrackGroup = new THREE.Group();
  previewScene.add(previewTrackGroup);
}

function schedulePreviewRebuild() {
  if (previewRebuildTimer) clearTimeout(previewRebuildTimer);
  previewRebuildTimer = setTimeout(() => rebuildPreview(), 300);
}

function rebuildPreview() {
  if (!previewScene || !previewCamera || !previewRenderer || !previewTrackGroup) return;

  // Clear old meshes
  while (previewTrackGroup.children.length > 0) {
    const child = previewTrackGroup.children[0];
    previewTrackGroup.remove(child);
    if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
  }

  if (controlPoints.length < 4) {
    previewRenderer.render(previewScene, previewCamera);
    return;
  }

  try {
    const trackData = buildTrackFromControlPoints(controlPoints);
    previewTrackGroup.add(trackData.roadMesh.clone());
    previewTrackGroup.add(trackData.barrierLeft.clone());
    previewTrackGroup.add(trackData.barrierRight.clone());

    // Fit camera to track bounds
    const box = new THREE.Box3().setFromObject(previewTrackGroup);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.z) * 0.6;

    previewCamera.left = -maxDim;
    previewCamera.right = maxDim;
    previewCamera.top = maxDim * (220 / 320);
    previewCamera.bottom = -maxDim * (220 / 320);
    previewCamera.position.set(center.x, 500, center.z);
    previewCamera.lookAt(center.x, 0, center.z);
    previewCamera.updateProjectionMatrix();

    // Dispose source meshes (we cloned them)
    trackData.roadMesh.geometry.dispose();
    trackData.barrierLeft.geometry.dispose();
    trackData.barrierRight.geometry.dispose();
    trackData.shoulderMesh.geometry.dispose();
    trackData.kerbGroup.traverse(c => { if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose(); });
    trackData.sceneryGroup.traverse(c => { if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose(); });
  } catch {
    // Track compilation failed — silently skip
  }

  previewRenderer.render(previewScene, previewCamera);
}
