/* ── Hood Racer — Track Editor ──
 *
 * Split-view editor: 2D canvas (left) + full 3D viewport (right).
 * Users place/drag/delete CatmullRom control points on the 2D canvas,
 * with real-time 3D rendering of the compiled track including scenery,
 * lighting, and interactive orbit controls. Tab toggles view modes.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CustomTrackDef, TrackData } from './types';
import { buildTrackFromControlPoints } from './track';
import { saveCustomTrack, loadCustomTracks, deleteCustomTrack, exportTrackJSON, importTrackJSON } from './track-storage';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface EditorPoint { x: number; z: number; y: number; }

// DOM
let editorRoot: HTMLDivElement | null = null;
let editorCanvas: HTMLCanvasElement | null = null;
let editorCtx: CanvasRenderingContext2D | null = null;
let editorToolbar: HTMLDivElement | null = null;
let editorContainer: HTMLElement | null = null;
let leftPane: HTMLDivElement | null = null;
let rightPane: HTMLDivElement | null = null;
let dividerBar: HTMLDivElement | null = null;

// Data
let controlPoints: EditorPoint[] = [];
let undoStack: EditorPoint[][] = [];
let redoStack: EditorPoint[][] = [];

// 2D Viewport (pan + zoom)
let viewX = 0;
let viewZ = 0;
let viewScale = 2.5;

// Elevation editing tool
type EditorTool = 'layout' | 'elevation';
let editorTool: EditorTool = 'layout';
let elevDragStartY = 0;
let elevDragStartVal = 0;
const ELEV_MIN = -5;
const ELEV_MAX = 25;
const ELEV_SENSITIVITY = 0.15; // world units per pixel
let elevToolBtn: HTMLButtonElement | null = null;
let selectedIdx = -1; // for elevation profile interaction

// 2D Interaction
let dragIdx = -1;
let isPanning = false;
let panStartX = 0;
let panStartZ = 0;
let panViewStartX = 0;
let panViewStartZ = 0;
let hoverIdx = -1;

// 3D Viewport
let renderer3D: THREE.WebGLRenderer | null = null;
let scene3D: THREE.Scene | null = null;
let camera3D: THREE.PerspectiveCamera | null = null;
let orbitControls: OrbitControls | null = null;
let trackGroup3D: THREE.Group | null = null;
let gizmoGroup: THREE.Group | null = null;
let groundMesh: THREE.Mesh | null = null;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
let rafId: number | null = null;
let lastTrackData: TrackData | null = null;

// 3D Interaction (full-3D mode)
let isDragging3D = false;
let drag3DIdx = -1;
let dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();

// Fly-through
let flyThroughActive = false;
let flyThroughT = 0;
let flyThroughSpline: THREE.CatmullRomCurve3 | null = null;

// Layout
type ViewMode = 'split' | 'full-2d' | 'full-3d';
let viewMode: ViewMode = 'split';
let splitRatio = 0.45; // left pane fraction
let isDividerDrag = false;

// Callbacks
let onTestDrive: ((track: TrackData) => void) | null = null;
let onRaceWithTrack: ((track: TrackData) => void) | null = null;
let onBack: (() => void) | null = null;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COORDINATE TRANSFORMS (2D)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function worldToScreen(wx: number, wz: number): [number, number] {
  if (!editorCanvas) return [0, 0];
  const cx = editorCanvas.width / 2;
  const cz = editorCanvas.height / 2;
  return [cx + (wx - viewX) * viewScale, cz + (wz - viewZ) * viewScale];
}

function screenToWorld(sx: number, sz: number): [number, number] {
  if (!editorCanvas) return [0, 0];
  const cx = editorCanvas.width / 2;
  const cz = editorCanvas.height / 2;
  return [viewX + (sx - cx) / viewScale, viewZ + (sz - cz) / viewScale];
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
  undoStack = []; redoStack = [];
  viewX = 0; viewZ = 0; viewScale = 2.5;
  dragIdx = -1; isPanning = false; hoverIdx = -1;
  editorTool = 'layout'; selectedIdx = -1;
  viewMode = 'split'; splitRatio = 0.45;
  flyThroughActive = false; lastTrackData = null;

  // ── Root flex container ──
  editorRoot = document.createElement('div');
  editorRoot.style.cssText = 'position:fixed;top:44px;left:0;right:0;bottom:0;display:flex;z-index:5;';
  container.appendChild(editorRoot);

  // ── Left pane (2D canvas) ──
  leftPane = document.createElement('div');
  leftPane.style.cssText = `position:relative;overflow:hidden;`;
  editorRoot.appendChild(leftPane);

  editorCanvas = document.createElement('canvas');
  editorCanvas.style.cssText = 'width:100%;height:100%;cursor:crosshair;display:block;';
  leftPane.appendChild(editorCanvas);
  editorCtx = editorCanvas.getContext('2d')!;

  // ── Divider ──
  dividerBar = document.createElement('div');
  dividerBar.style.cssText = `
    width:6px;cursor:col-resize;background:rgba(255,255,255,0.08);
    flex-shrink:0;transition:background 0.15s;z-index:2;
  `;
  dividerBar.addEventListener('mouseenter', () => { if (dividerBar) dividerBar.style.background = 'rgba(255,102,0,0.4)'; });
  dividerBar.addEventListener('mouseleave', () => { if (dividerBar && !isDividerDrag) dividerBar.style.background = 'rgba(255,255,255,0.08)'; });
  dividerBar.addEventListener('mousedown', onDividerDown);
  editorRoot.appendChild(dividerBar);

  // ── Right pane (3D viewport) ──
  rightPane = document.createElement('div');
  rightPane.style.cssText = `position:relative;overflow:hidden;`;
  editorRoot.appendChild(rightPane);

  // ── Toolbar ──
  buildToolbar(container);

  // ── Init 3D viewport ──
  init3DViewport();

  // ── Attach 2D events ──
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

  // Apply layout + initial draw
  applyLayout();
  draw();
  startRenderLoop();
}

export function destroyTrackEditor() {
  stopRenderLoop();
  if (editorCanvas) {
    editorCanvas.removeEventListener('mousedown', onMouseDown);
    editorCanvas.removeEventListener('mousemove', onMouseMove);
    editorCanvas.removeEventListener('mouseup', onMouseUp);
    editorCanvas.removeEventListener('contextmenu', onContextMenu);
    editorCanvas.removeEventListener('wheel', onWheel);
    editorCanvas.removeEventListener('touchstart', onTouchStart);
    editorCanvas.removeEventListener('touchmove', onTouchMove);
    editorCanvas.removeEventListener('touchend', onTouchEnd);
    editorCanvas = null; editorCtx = null;
  }
  if (editorToolbar) { editorToolbar.remove(); editorToolbar = null; }
  if (editorRoot) { editorRoot.remove(); editorRoot = null; }
  leftPane = null; rightPane = null; dividerBar = null;
  window.removeEventListener('resize', onResize);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('mousemove', onDividerMove);
  window.removeEventListener('mouseup', onDividerUp);

  if (renderer3D) { renderer3D.dispose(); renderer3D = null; }
  if (orbitControls) { orbitControls.dispose(); orbitControls = null; }
  scene3D = null; camera3D = null; trackGroup3D = null; gizmoGroup = null; groundMesh = null;
  if (rebuildTimer) clearTimeout(rebuildTimer);
  lastTrackData = null;
  flyThroughActive = false; flyThroughSpline = null;

  controlPoints = []; undoStack = []; redoStack = [];
  onTestDrive = null; onRaceWithTrack = null; onBack = null;
  editorContainer = null;
}

export function compileEditorTrack(): TrackData | null {
  if (controlPoints.length < 4) return null;
  try {
    const elevations = controlPoints.map(p => p.y);
    return buildTrackFromControlPoints(controlPoints, elevations);
  } catch { return null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LAYOUT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function applyLayout() {
  if (!leftPane || !rightPane || !dividerBar || !editorRoot) return;
  const hide2D = viewMode === 'full-3d';
  const hide3D = viewMode === 'full-2d';

  leftPane.style.display = hide2D ? 'none' : 'block';
  dividerBar.style.display = viewMode === 'split' ? 'block' : 'none';
  rightPane.style.display = hide3D ? 'none' : 'block';

  if (viewMode === 'split') {
    leftPane.style.flex = `0 0 ${splitRatio * 100}%`;
    rightPane.style.flex = '1 1 0';
  } else if (viewMode === 'full-2d') {
    leftPane.style.flex = '1 1 100%';
  } else {
    rightPane.style.flex = '1 1 100%';
  }

  // Resize canvases
  requestAnimationFrame(() => {
    resize2DCanvas();
    resize3DViewport();
    draw();
  });
}

function resize2DCanvas() {
  if (!editorCanvas || !leftPane) return;
  const rect = leftPane.getBoundingClientRect();
  editorCanvas.width = rect.width * window.devicePixelRatio;
  editorCanvas.height = rect.height * window.devicePixelRatio;
  editorCanvas.style.width = rect.width + 'px';
  editorCanvas.style.height = rect.height + 'px';
  if (editorCtx) editorCtx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

function resize3DViewport() {
  if (!renderer3D || !camera3D || !rightPane) return;
  const rect = rightPane.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return;
  renderer3D.setSize(rect.width, rect.height);
  camera3D.aspect = rect.width / rect.height;
  camera3D.updateProjectionMatrix();
}

function cycleViewMode() {
  const modes: ViewMode[] = ['split', 'full-2d', 'full-3d'];
  const idx = modes.indexOf(viewMode);
  viewMode = modes[(idx + 1) % modes.length];
  applyLayout();
  updateViewModeBtn();
}

let viewModeBtn: HTMLButtonElement | null = null;
function updateViewModeBtn() {
  if (!viewModeBtn) return;
  const labels: Record<ViewMode, string> = { 'split': '◫ SPLIT', 'full-2d': '▣ 2D', 'full-3d': '▣ 3D' };
  viewModeBtn.textContent = labels[viewMode];
}

// ── Divider drag ──
function onDividerDown(e: MouseEvent) {
  e.preventDefault();
  isDividerDrag = true;
  window.addEventListener('mousemove', onDividerMove);
  window.addEventListener('mouseup', onDividerUp);
}

function onDividerMove(e: MouseEvent) {
  if (!isDividerDrag || !editorRoot) return;
  const rect = editorRoot.getBoundingClientRect();
  splitRatio = Math.max(0.2, Math.min(0.8, (e.clientX - rect.left) / rect.width));
  applyLayout();
}

function onDividerUp() {
  isDividerDrag = false;
  if (dividerBar) dividerBar.style.background = 'rgba(255,255,255,0.08)';
  window.removeEventListener('mousemove', onDividerMove);
  window.removeEventListener('mouseup', onDividerUp);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOOLBAR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildToolbar(container: HTMLElement) {
  editorToolbar = document.createElement('div');
  editorToolbar.style.cssText = `
    position:fixed;top:0;left:0;right:0;z-index:10;height:44px;
    display:flex;align-items:center;gap:6px;padding:0 12px;
    background:linear-gradient(180deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.7) 100%);
    backdrop-filter:blur(8px);font-family:'Inter',sans-serif;
  `;

  const title = el('span', '🏁 TRACK EDITOR', 'color:#fff;font-size:14px;font-weight:700;letter-spacing:2px;margin-right:6px;');
  editorToolbar.appendChild(title);
  const sep = () => el('span', '', 'width:1px;height:24px;background:rgba(255,255,255,0.12);flex-shrink:0;');

  editorToolbar.appendChild(btn('NEW', () => { pushUndo(); controlPoints = []; redoStack = []; scheduleRebuild(); draw(); }));
  editorToolbar.appendChild(btn('UNDO', () => undo()));
  editorToolbar.appendChild(btn('REDO', () => redo()));
  editorToolbar.appendChild(sep());
  editorToolbar.appendChild(btn('SAVE', () => showSaveDialog()));
  editorToolbar.appendChild(btn('LOAD', () => showLoadDialog()));
  editorToolbar.appendChild(btn('EXPORT', () => {
    if (controlPoints.length < 4) return;
    const elevations = controlPoints.map(p => p.y);
    exportTrackJSON({ name: `Track_${Date.now()}`, controlPoints: [...controlPoints], elevations, createdAt: Date.now() });
  }));
  editorToolbar.appendChild(btn('IMPORT', () => showImportDialog()));
  editorToolbar.appendChild(sep());

  elevToolBtn = btn('⛰️ ELEV', () => toggleElevationTool());
  editorToolbar.appendChild(elevToolBtn);
  viewModeBtn = btn('◫ SPLIT', () => cycleViewMode());
  editorToolbar.appendChild(viewModeBtn);
  editorToolbar.appendChild(btn('🎥 FLY', () => startFlyThrough()));
  editorToolbar.appendChild(sep());

  editorToolbar.appendChild(btn('🏎️ TEST', () => {
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

  const counter = el('span', '', 'color:rgba(255,255,255,0.5);font-size:11px;margin-left:auto;');
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
    padding:5px 10px;border-radius:4px;border:1px solid ${accent ? '#ff6600' : 'rgba(255,255,255,0.18)'};
    background:${accent ? 'rgba(255,102,0,0.15)' : 'rgba(255,255,255,0.04)'};
    color:${accent ? '#ff8833' : '#bbb'};cursor:pointer;font-size:11px;font-weight:600;
    letter-spacing:0.5px;font-family:'Inter',sans-serif;transition:background 0.15s;
  `;
  b.addEventListener('mouseenter', () => { b.style.background = accent ? 'rgba(255,102,0,0.35)' : 'rgba(255,255,255,0.12)'; });
  b.addEventListener('mouseleave', () => { b.style.background = accent ? 'rgba(255,102,0,0.15)' : 'rgba(255,255,255,0.04)'; });
  b.addEventListener('click', onClick);
  return b;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SAVE / LOAD / IMPORT DIALOGS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function toggleElevationTool() {
  editorTool = editorTool === 'layout' ? 'elevation' : 'layout';
  updateElevToolBtn();
  if (editorCanvas) editorCanvas.style.cursor = editorTool === 'elevation' ? 'ns-resize' : 'crosshair';
  draw();
}

function updateElevToolBtn() {
  if (!elevToolBtn) return;
  const active = editorTool === 'elevation';
  elevToolBtn.style.background = active ? 'rgba(255,102,0,0.35)' : 'rgba(255,255,255,0.04)';
  elevToolBtn.style.color = active ? '#ff8833' : '#bbb';
  elevToolBtn.style.borderColor = active ? '#ff6600' : 'rgba(255,255,255,0.18)';
}

function showSaveDialog() {
  if (controlPoints.length < 4) { showToast('Need at least 4 points!'); return; }
  const name = prompt('Track name:');
  if (!name) return;
  const elevations = controlPoints.map(p => p.y);
  saveCustomTrack({ name, controlPoints: [...controlPoints], elevations, createdAt: Date.now() });
  showToast(`Saved "${name}"`);
}

function showLoadDialog() {
  const tracks = loadCustomTracks();
  if (tracks.length === 0) { showToast('No saved tracks'); return; }
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;z-index:20;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;font-family:'Inter',sans-serif;`;
  const panel = document.createElement('div');
  panel.style.cssText = `background:#1a1a2e;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:20px;min-width:280px;max-height:400px;overflow-y:auto;`;
  panel.innerHTML = '<div style="color:#fff;font-size:16px;font-weight:700;margin-bottom:12px;">LOAD TRACK</div>';
  for (const t of tracks) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    const loadBtn = btn(t.name, () => {
      pushUndo();
      controlPoints = t.controlPoints.map((p, i) => ({ x: p.x, z: p.z, y: t.elevations?.[i] ?? 0 }));
      redoStack = [];
      scheduleRebuild(); draw(); overlay.remove(); showToast(`Loaded "${t.name}"`);
    });
    loadBtn.style.flex = '1';
    row.appendChild(loadBtn);
    const delBtn = btn('✕', () => { deleteCustomTrack(t.name); row.remove(); });
    delBtn.style.cssText += 'color:#ff4444;border-color:#ff4444;padding:5px 8px;';
    row.appendChild(delBtn);
    panel.appendChild(row);
  }
  const closeBtn = btn('CANCEL', () => overlay.remove());
  closeBtn.style.marginTop = '12px'; closeBtn.style.width = '100%';
  panel.appendChild(closeBtn);
  overlay.appendChild(panel);
  editorContainer?.appendChild(overlay);
}

function showImportDialog() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const def = importTrackJSON(reader.result as string);
      if (def) { pushUndo(); controlPoints = def.controlPoints.map((p, i) => ({ ...p, y: def.elevations?.[i] ?? (p as any).y ?? 0 })); redoStack = []; scheduleRebuild(); draw(); showToast(`Imported "${def.name}"`); }
      else showToast('Invalid track file!');
    };
    reader.readAsText(file);
  });
  input.click();
}

function showToast(msg: string) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:30;background:rgba(0,0,0,0.85);color:#fff;padding:10px 20px;border-radius:6px;font-family:'Inter',sans-serif;font-size:13px;pointer-events:none;`;
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
  scheduleRebuild(); draw();
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(controlPoints.map(p => ({ ...p })));
  controlPoints = redoStack.pop()!;
  scheduleRebuild(); draw();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2D INPUT HANDLERS
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

function canvasLocalXY(e: MouseEvent): [number, number] {
  if (!editorCanvas) return [e.clientX, e.clientY];
  const rect = editorCanvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

function onMouseDown(e: MouseEvent) {
  const [lx, ly] = canvasLocalXY(e);
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true;
    panStartX = lx; panStartZ = ly;
    panViewStartX = viewX; panViewStartZ = viewZ;
    if (editorCanvas) editorCanvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button === 0) {
    const idx = findPointAt(lx, ly);
    if (idx >= 0) {
      pushUndo(); dragIdx = idx;
      if (editorTool === 'elevation') {
        elevDragStartY = ly;
        elevDragStartVal = controlPoints[idx].y;
        selectedIdx = idx;
        if (editorCanvas) editorCanvas.style.cursor = 'ns-resize';
      } else {
        if (editorCanvas) editorCanvas.style.cursor = 'grab';
      }
    } else if (editorTool === 'layout') {
      pushUndo(); const [wx, wz] = screenToWorld(lx, ly); controlPoints.push({ x: wx, z: wz, y: 0 }); scheduleRebuild(); draw();
    }
  }
}

function onMouseMove(e: MouseEvent) {
  const [lx, ly] = canvasLocalXY(e);
  if (isPanning) {
    viewX = panViewStartX - (lx - panStartX) / viewScale;
    viewZ = panViewStartZ - (ly - panStartZ) / viewScale;
    draw(); return;
  }
  if (dragIdx >= 0) {
    if (editorTool === 'elevation') {
      // Vertical drag changes elevation
      const dy = elevDragStartY - ly; // up = higher
      controlPoints[dragIdx].y = Math.max(ELEV_MIN, Math.min(ELEV_MAX, elevDragStartVal + dy * ELEV_SENSITIVITY));
      scheduleRebuild(); draw(); return;
    }
    const [wx, wz] = screenToWorld(lx, ly);
    controlPoints[dragIdx].x = wx; controlPoints[dragIdx].z = wz;
    scheduleRebuild(); draw(); return;
  }
  const newHover = findPointAt(lx, ly);
  if (newHover !== hoverIdx) {
    hoverIdx = newHover;
    if (editorCanvas) editorCanvas.style.cursor = hoverIdx >= 0 ? 'pointer' : 'crosshair';
    draw();
  }
}

function onMouseUp() {
  if (isPanning) { isPanning = false; if (editorCanvas) editorCanvas.style.cursor = 'crosshair'; return; }
  if (dragIdx >= 0) { dragIdx = -1; if (editorCanvas) editorCanvas.style.cursor = 'crosshair'; }
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  const [lx, ly] = canvasLocalXY(e);
  const idx = findPointAt(lx, ly);
  if (idx >= 0) { pushUndo(); controlPoints.splice(idx, 1); scheduleRebuild(); draw(); }
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const [lx, ly] = canvasLocalXY(e);
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  const [wx, wz] = screenToWorld(lx, ly);
  viewScale = Math.max(0.3, Math.min(20, viewScale * factor));
  const [nx, nz] = screenToWorld(lx, ly);
  viewX -= (nx - wx); viewZ -= (nz - wz);
  draw();
}

// Touch
let touchStartId = -1;
let touchStartTime = 0;
function onTouchStart(e: TouchEvent) {
  e.preventDefault();
  if (e.touches.length === 1) {
    const t = e.touches[0]; touchStartId = t.identifier; touchStartTime = performance.now();
    const rect = editorCanvas?.getBoundingClientRect();
    const lx = t.clientX - (rect?.left ?? 0), ly = t.clientY - (rect?.top ?? 0);
    const idx = findPointAt(lx, ly);
    if (idx >= 0) { pushUndo(); dragIdx = idx; }
    else { isPanning = true; panStartX = lx; panStartZ = ly; panViewStartX = viewX; panViewStartZ = viewZ; }
  }
}
function onTouchMove(e: TouchEvent) {
  e.preventDefault();
  const t = Array.from(e.touches).find(tt => tt.identifier === touchStartId); if (!t) return;
  const rect = editorCanvas?.getBoundingClientRect();
  const lx = t.clientX - (rect?.left ?? 0), ly = t.clientY - (rect?.top ?? 0);
  if (dragIdx >= 0) { const [wx, wz] = screenToWorld(lx, ly); controlPoints[dragIdx].x = wx; controlPoints[dragIdx].z = wz; scheduleRebuild(); draw(); }
  else if (isPanning) { viewX = panViewStartX - (lx - panStartX) / viewScale; viewZ = panViewStartZ - (ly - panStartZ) / viewScale; draw(); }
}
function onTouchEnd(e: TouchEvent) {
  const wasShortTap = performance.now() - touchStartTime < 300;
  if (dragIdx >= 0) { dragIdx = -1; }
  else if (isPanning && wasShortTap && e.changedTouches.length > 0) {
    isPanning = false; const t = e.changedTouches[0];
    const rect = editorCanvas?.getBoundingClientRect();
    const lx = t.clientX - (rect?.left ?? 0), ly = t.clientY - (rect?.top ?? 0);
    pushUndo(); const [wx, wz] = screenToWorld(lx, ly); controlPoints.push({ x: wx, z: wz, y: 0 }); scheduleRebuild(); draw();
  } else { isPanning = false; }
  touchStartId = -1;
}

function onResize() {
  resize2DCanvas(); resize3DViewport(); draw();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Tab') { e.preventDefault(); cycleViewMode(); return; }
  if (e.key === 'e' || e.key === 'E') { if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); toggleElevationTool(); return; } }
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === 'y' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); redo(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && hoverIdx >= 0) {
    pushUndo(); controlPoints.splice(hoverIdx, 1); hoverIdx = -1; scheduleRebuild(); draw();
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2D CANVAS DRAWING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function draw() {
  if (!editorCanvas || !editorCtx) return;
  const ctx = editorCtx;
  const w = editorCanvas.width / window.devicePixelRatio;
  const h = editorCanvas.height / window.devicePixelRatio;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, w, h);

  drawGrid(ctx, w, h);
  if (controlPoints.length >= 2) drawSplinePreview(ctx);

  for (let i = 0; i < controlPoints.length; i++) {
    const p = controlPoints[i];
    const [sx, sy] = worldToScreen(p.x, p.z);
    if (controlPoints.length >= 2) {
      const next = controlPoints[(i + 1) % controlPoints.length];
      const [nx, ny] = worldToScreen(next.x, next.z);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(nx, ny);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; ctx.stroke();
    }
    const isHover = i === hoverIdx, isDrag = i === dragIdx, isFirst = i === 0, isSel = i === selectedIdx;
    ctx.beginPath(); ctx.arc(sx, sy, isDrag ? 10 : isHover ? 9 : 7, 0, Math.PI * 2);

    // Color by elevation in elevation mode
    let pointColor: string;
    if (editorTool === 'elevation') {
      const t = Math.max(0, Math.min(1, (p.y - ELEV_MIN) / (ELEV_MAX - ELEV_MIN)));
      const r = Math.round(80 + t * 175);
      const g = Math.round(180 - t * 160);
      const b = Math.round(80 - t * 60);
      pointColor = isSel ? '#ff6600' : `rgb(${r},${g},${b})`;
    } else {
      pointColor = isFirst ? '#ffcc00' : isDrag ? '#ff6600' : isHover ? '#ff8833' : '#44aaff';
    }
    ctx.fillStyle = pointColor;
    ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();

    // Label: index or elevation
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Inter, sans-serif'; ctx.textAlign = 'center';
    if (editorTool === 'elevation') {
      ctx.fillText(`${p.y.toFixed(1)}`, sx, sy + 3.5);
      // Height tag above point
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '9px Inter, sans-serif';
      ctx.fillText(`h:${p.y.toFixed(1)}`, sx, sy - 14);
    } else {
      ctx.fillText(isFirst ? 'S' : `${i}`, sx, sy + 3.5);
    }
  }

  if (controlPoints.length < 4) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '14px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Click to place control points (min. 4)', w / 2, h / 2 - 11);
    ctx.fillText('Right-click to delete · Scroll to zoom · Alt+drag to pan', w / 2, h / 2 + 11);
  }

  // ── Elevation Profile Strip ──
  if (editorTool === 'elevation' && controlPoints.length >= 4) {
    drawElevationProfile(ctx, w, h);
  }

  const counter = document.getElementById('editor-counter');
  if (counter) {
    const valid = controlPoints.length >= 4;
    counter.textContent = `${controlPoints.length} pts${valid ? ' ✓' : ''}  |  Tab: ${viewMode}`;
    counter.style.color = valid ? '#44ff88' : 'rgba(255,255,255,0.4)';
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const gridSpacing = 20;
  if (gridSpacing * viewScale < 5) return;
  const [wLeft, wTop] = screenToWorld(0, 0);
  const [wRight, wBottom] = screenToWorld(w, h);
  const startX = Math.floor(wLeft / gridSpacing) * gridSpacing;
  const startZ = Math.floor(wTop / gridSpacing) * gridSpacing;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  for (let gx = startX; gx <= wRight; gx += gridSpacing) { const [sx] = worldToScreen(gx, 0); ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke(); }
  for (let gz = startZ; gz <= wBottom; gz += gridSpacing) { const [, sy] = worldToScreen(0, gz); ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke(); }
  const [ox, oy] = worldToScreen(0, 0);
  ctx.strokeStyle = 'rgba(255,100,100,0.2)'; ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, h); ctx.stroke();
  ctx.strokeStyle = 'rgba(100,100,255,0.2)'; ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(w, oy); ctx.stroke();
}

function drawSplinePreview(ctx: CanvasRenderingContext2D) {
  if (controlPoints.length < 2) return;
  const pts3D = controlPoints.map(p => new THREE.Vector3(p.x, 0, p.z));
  const closed = controlPoints.length >= 3;
  const spline = new THREE.CatmullRomCurve3(pts3D, closed, 'centripetal', 0.5);
  const samples = Math.max(controlPoints.length * 20, 100);
  const splinePoints = spline.getSpacedPoints(samples);
  const ROAD_HALF = 7;

  // Road ribbon
  ctx.beginPath();
  for (let i = 0; i < splinePoints.length; i++) {
    const p = splinePoints[i]; const next = splinePoints[(i + 1) % splinePoints.length];
    const dx = next.x - p.x, dz = next.z - p.z, len = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = -dz / len, nz = dx / len;
    const [sx, sy] = worldToScreen(p.x + nx * ROAD_HALF, p.z + nz * ROAD_HALF);
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  for (let i = splinePoints.length - 1; i >= 0; i--) {
    const p = splinePoints[i]; const next = splinePoints[(i + 1) % splinePoints.length];
    const dx = next.x - p.x, dz = next.z - p.z, len = Math.sqrt(dx * dx + dz * dz) || 1;
    const nx = -dz / len, nz = dx / len;
    const [sx, sy] = worldToScreen(p.x - nx * ROAD_HALF, p.z - nz * ROAD_HALF);
    ctx.lineTo(sx, sy);
  }
  ctx.closePath(); ctx.fillStyle = 'rgba(60,60,80,0.4)'; ctx.fill();

  // Curvature centerline
  ctx.lineWidth = 2;
  for (let i = 0; i < splinePoints.length - 1; i++) {
    const p0 = splinePoints[Math.max(0, i - 1)], p1 = splinePoints[i], p2 = splinePoints[Math.min(splinePoints.length - 1, i + 1)];
    const a1 = Math.atan2(p1.z - p0.z, p1.x - p0.x), a2 = Math.atan2(p2.z - p1.z, p2.x - p1.x);
    let dAngle = Math.abs(a2 - a1); if (dAngle > Math.PI) dAngle = Math.PI * 2 - dAngle;
    const curv = Math.min(dAngle * 10, 1);
    const [sx, sy] = worldToScreen(p1.x, p1.z), [nx, ny] = worldToScreen(p2.x, p2.z);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(nx, ny);
    ctx.strokeStyle = `rgb(${80 + curv * 175},${200 - curv * 180},80)`; ctx.stroke();
  }

  // Direction arrows
  const arrowCount = Math.floor(samples / 15);
  for (let i = 0; i < arrowCount; i++) {
    const sIdx = Math.floor((i / arrowCount) * splinePoints.length);
    const p = splinePoints[sIdx], next = splinePoints[(sIdx + 2) % splinePoints.length];
    const angle = Math.atan2(next.z - p.z, next.x - p.x);
    const [sx, sy] = worldToScreen(p.x, p.z);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(angle);
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill(); ctx.restore();
  }

  if (controlPoints.length >= 4) {
    const [sx, sy] = worldToScreen(splinePoints[0].x, splinePoints[0].z);
    ctx.fillStyle = '#ffcc00'; ctx.font = 'bold 12px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('🏁 START/FINISH', sx, sy - 18);
  }
}

// ── Elevation Profile Sparkline ──
function drawElevationProfile(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const STRIP_H = 80;
  const STRIP_Y = h - STRIP_H - 10;
  const STRIP_X = 30;
  const STRIP_W = w - 60;

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(STRIP_X - 5, STRIP_Y - 5, STRIP_W + 10, STRIP_H + 20);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(STRIP_X - 5, STRIP_Y - 5, STRIP_W + 10, STRIP_H + 20);

  // Title
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('ELEVATION PROFILE', STRIP_X, STRIP_Y - 8);

  // Zero line
  const zeroLineY = STRIP_Y + STRIP_H * (1 - (0 - ELEV_MIN) / (ELEV_MAX - ELEV_MIN));
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(STRIP_X, zeroLineY); ctx.lineTo(STRIP_X + STRIP_W, zeroLineY); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '8px Inter, sans-serif'; ctx.textAlign = 'right';
  ctx.fillText('0', STRIP_X - 3, zeroLineY + 3);

  // Plot elevation line
  ctx.beginPath();
  for (let i = 0; i <= controlPoints.length; i++) {
    const p = controlPoints[i % controlPoints.length];
    const px = STRIP_X + (i / controlPoints.length) * STRIP_W;
    const t = (p.y - ELEV_MIN) / (ELEV_MAX - ELEV_MIN);
    const py = STRIP_Y + STRIP_H * (1 - t);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = '#44ff88'; ctx.lineWidth = 2; ctx.stroke();

  // Fill under curve
  ctx.lineTo(STRIP_X + STRIP_W, zeroLineY);
  ctx.lineTo(STRIP_X, zeroLineY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(68,255,136,0.1)'; ctx.fill();

  // Point dots
  for (let i = 0; i < controlPoints.length; i++) {
    const p = controlPoints[i];
    const px = STRIP_X + (i / controlPoints.length) * STRIP_W;
    const t = (p.y - ELEV_MIN) / (ELEV_MAX - ELEV_MIN);
    const py = STRIP_Y + STRIP_H * (1 - t);
    ctx.beginPath(); ctx.arc(px, py, i === selectedIdx ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = i === selectedIdx ? '#ff6600' : '#44ff88';
    ctx.fill();
  }
}

function init3DViewport() {
  if (!rightPane) return;

  scene3D = new THREE.Scene();
  scene3D.background = new THREE.Color(0x111122);
  scene3D.fog = new THREE.Fog(0x111122, 200, 800);

  // Lighting
  const hemiLight = new THREE.HemisphereLight(0x8899cc, 0x334455, 0.5);
  scene3D.add(hemiLight);
  const sunLight = new THREE.DirectionalLight(0xffeedd, 0.9);
  sunLight.position.set(100, 200, 80);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.far = 500;
  sunLight.shadow.camera.left = -200; sunLight.shadow.camera.right = 200;
  sunLight.shadow.camera.top = 200; sunLight.shadow.camera.bottom = -200;
  scene3D.add(sunLight);
  const ambLight = new THREE.AmbientLight(0x404060, 0.3);
  scene3D.add(ambLight);

  // Ground plane
  const groundGeo = new THREE.PlaneGeometry(2000, 2000);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2a, roughness: 0.95, metalness: 0.0 });
  groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.5;
  groundMesh.receiveShadow = true;
  scene3D.add(groundMesh);

  // Ground grid helper
  const gridHelper = new THREE.GridHelper(1000, 50, 0x333355, 0x222233);
  gridHelper.position.y = -0.4;
  scene3D.add(gridHelper);

  // Track group
  trackGroup3D = new THREE.Group();
  scene3D.add(trackGroup3D);

  // Gizmo group (control point spheres)
  gizmoGroup = new THREE.Group();
  scene3D.add(gizmoGroup);

  // Camera
  camera3D = new THREE.PerspectiveCamera(50, 1, 1, 2000);
  camera3D.position.set(0, 200, 250);
  camera3D.lookAt(0, 0, 0);

  // Renderer
  renderer3D = new THREE.WebGLRenderer({ antialias: true });
  renderer3D.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer3D.shadowMap.enabled = true;
  renderer3D.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer3D.toneMapping = THREE.ACESFilmicToneMapping;
  renderer3D.toneMappingExposure = 1.2;
  rightPane.appendChild(renderer3D.domElement);
  renderer3D.domElement.style.cssText = 'width:100%;height:100%;display:block;';

  // OrbitControls
  orbitControls = new OrbitControls(camera3D, renderer3D.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.minDistance = 30;
  orbitControls.maxDistance = 600;
  orbitControls.maxPolarAngle = Math.PI / 2 - 0.05;
  orbitControls.target.set(0, 0, 0);

  // 3D interaction events
  renderer3D.domElement.addEventListener('mousedown', on3DMouseDown);
  renderer3D.domElement.addEventListener('mousemove', on3DMouseMove);
  renderer3D.domElement.addEventListener('mouseup', on3DMouseUp);
  renderer3D.domElement.addEventListener('contextmenu', on3DContextMenu);
}

// ── Render loop ──
function startRenderLoop() {
  function loop() {
    rafId = requestAnimationFrame(loop);
    if (flyThroughActive) updateFlyThrough();
    if (orbitControls) orbitControls.update();
    if (renderer3D && scene3D && camera3D) renderer3D.render(scene3D, camera3D);
  }
  loop();
}

function stopRenderLoop() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

// ── Rebuild 3D track ──
function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => rebuild3D(), 250);
}

function rebuild3D() {
  if (!scene3D || !trackGroup3D || !gizmoGroup || !camera3D || !orbitControls) return;

  // Clear track meshes
  while (trackGroup3D.children.length > 0) {
    const child = trackGroup3D.children[0];
    trackGroup3D.remove(child);
    child.traverse((c: THREE.Object3D) => {
      if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry?.dispose();
      if ((c as THREE.Mesh).material) {
        const mat = (c as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else if (mat && typeof (mat as THREE.Material).dispose === 'function') (mat as THREE.Material).dispose();
      }
    });
  }

  // Clear old gizmos
  while (gizmoGroup.children.length > 0) gizmoGroup.remove(gizmoGroup.children[0]);

  // Rebuild gizmos (always, even < 4 points)
  rebuildGizmos();

  if (controlPoints.length < 4) { lastTrackData = null; return; }

  try {
    const trackData = buildTrackFromControlPoints(controlPoints);
    lastTrackData = trackData;

    trackGroup3D.add(trackData.roadMesh);
    trackGroup3D.add(trackData.barrierLeft);
    trackGroup3D.add(trackData.barrierRight);
    trackGroup3D.add(trackData.shoulderMesh);
    trackGroup3D.add(trackData.kerbGroup);
    trackGroup3D.add(trackData.sceneryGroup);

    // Auto-fit camera
    const box = new THREE.Box3().setFromObject(trackGroup3D);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.z);

    orbitControls.target.copy(center);
    camera3D.position.set(center.x + maxDim * 0.3, maxDim * 0.5, center.z + maxDim * 0.5);
    camera3D.lookAt(center);
    orbitControls.update();

    // Store spline for fly-through
    flyThroughSpline = trackData.spline;
  } catch {
    lastTrackData = null;
  }
}

function rebuildGizmos() {
  if (!gizmoGroup) return;
  while (gizmoGroup.children.length > 0) gizmoGroup.remove(gizmoGroup.children[0]);

  const sphereGeo = new THREE.SphereGeometry(2.5, 12, 8);
  for (let i = 0; i < controlPoints.length; i++) {
    const p = controlPoints[i];
    const isFirst = i === 0;
    const gizmoY = p.y + 5; // Float above actual elevation

    // Elevation color coding for gizmo
    const elevT = Math.max(0, Math.min(1, (p.y - ELEV_MIN) / (ELEV_MAX - ELEV_MIN)));
    const gizmoColor = editorTool === 'elevation'
      ? new THREE.Color().setHSL(0.33 - elevT * 0.33, 0.8, 0.5) // green→red
      : new THREE.Color(isFirst ? 0xffcc00 : 0x4499ff);

    const mat = new THREE.MeshStandardMaterial({
      color: gizmoColor,
      emissive: gizmoColor.clone().multiplyScalar(0.3),
      emissiveIntensity: 0.4,
      roughness: 0.3,
      metalness: 0.5,
    });
    const sphere = new THREE.Mesh(sphereGeo, mat);
    sphere.position.set(p.x, gizmoY, p.z);
    sphere.userData.pointIndex = i;
    sphere.castShadow = true;
    gizmoGroup.add(sphere);

    // Elevation pillar (vertical line from ground to gizmo)
    if (Math.abs(p.y) > 0.1) {
      const pillarPoints = [new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(p.x, gizmoY, p.z)];
      const pillarGeo = new THREE.BufferGeometry().setFromPoints(pillarPoints);
      const pillarMat = new THREE.LineBasicMaterial({
        color: p.y > 0 ? 0x44ff88 : 0xff4444,
        opacity: 0.4, transparent: true,
      });
      const pillar = new THREE.Line(pillarGeo, pillarMat);
      gizmoGroup.add(pillar);
    }

    // Number/height label sprite
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = isFirst ? '#ffcc00' : '#44aaff';
    ctx.font = 'bold 28px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = editorTool === 'elevation' ? `${p.y.toFixed(1)}m` : (isFirst ? 'S' : `${i}`);
    ctx.fillText(label, 64, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(p.x, gizmoY + 7, p.z);
    sprite.scale.set(8, 4, 1);
    gizmoGroup.add(sprite);
  }

  // Connection lines (following elevation)
  if (controlPoints.length >= 2) {
    const linePoints = controlPoints.map(p => new THREE.Vector3(p.x, p.y + 5, p.z));
    linePoints.push(linePoints[0].clone()); // close loop
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x4499ff, opacity: 0.3, transparent: true });
    const line = new THREE.Line(lineGeo, lineMat);
    gizmoGroup.add(line);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3D INTERACTION (point add/drag/delete in 3D)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function get3DMouse(e: MouseEvent): THREE.Vector2 {
  if (!renderer3D) return new THREE.Vector2();
  const rect = renderer3D.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
}

function on3DMouseDown(e: MouseEvent) {
  if (e.button !== 0 || !camera3D || !gizmoGroup) return;
  mouse = get3DMouse(e);
  raycaster.setFromCamera(mouse, camera3D);

  // Check gizmo hit
  const gizmos = gizmoGroup.children.filter(c => c.type === 'Mesh');
  const hits = raycaster.intersectObjects(gizmos, false);
  if (hits.length > 0) {
    const idx = hits[0].object.userData.pointIndex;
    if (typeof idx === 'number') {
      pushUndo();
      isDragging3D = true;
      drag3DIdx = idx;
      if (orbitControls) orbitControls.enabled = false;
      return;
    }
  }

  // Check ground hit for adding points (only in full-3D mode)
  if (viewMode === 'full-3d' && groundMesh) {
    const groundHits = raycaster.intersectObject(groundMesh, false);
    if (groundHits.length > 0) {
      const pt = groundHits[0].point;
      pushUndo();
      controlPoints.push({ x: pt.x, z: pt.z, y: 0 });
      scheduleRebuild();
      draw();
    }
  }
}

function on3DMouseMove(e: MouseEvent) {
  if (!isDragging3D || !camera3D) return;
  mouse = get3DMouse(e);
  raycaster.setFromCamera(mouse, camera3D);
  const intersection = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
    controlPoints[drag3DIdx].x = intersection.x;
    controlPoints[drag3DIdx].z = intersection.z;
    scheduleRebuild();
    draw();
  }
}

function on3DMouseUp() {
  if (isDragging3D) {
    isDragging3D = false;
    drag3DIdx = -1;
    if (orbitControls) orbitControls.enabled = true;
  }
}

function on3DContextMenu(e: MouseEvent) {
  e.preventDefault();
  if (!camera3D || !gizmoGroup) return;
  mouse = get3DMouse(e);
  raycaster.setFromCamera(mouse, camera3D);
  const gizmos = gizmoGroup.children.filter(c => c.type === 'Mesh');
  const hits = raycaster.intersectObjects(gizmos, false);
  if (hits.length > 0) {
    const idx = hits[0].object.userData.pointIndex;
    if (typeof idx === 'number') {
      pushUndo();
      controlPoints.splice(idx, 1);
      scheduleRebuild();
      draw();
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FLY-THROUGH CAMERA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function startFlyThrough() {
  if (!flyThroughSpline || controlPoints.length < 4) {
    showToast('Need a compiled track to fly through!');
    return;
  }
  flyThroughActive = true;
  flyThroughT = 0;
  if (orbitControls) orbitControls.enabled = false;
  showToast('🎥 Flying through... (click to stop)');

  // Click anywhere to stop
  const stopHandler = () => {
    stopFlyThrough();
    window.removeEventListener('click', stopHandler, true);
    window.removeEventListener('keydown', stopHandler, true);
  };
  setTimeout(() => {
    window.addEventListener('click', stopHandler, true);
    window.addEventListener('keydown', stopHandler, true);
  }, 200);
}

function stopFlyThrough() {
  flyThroughActive = false;
  if (orbitControls) orbitControls.enabled = true;
}

function updateFlyThrough() {
  if (!flyThroughActive || !flyThroughSpline || !camera3D) return;

  const speed = 0.002; // t per frame
  flyThroughT += speed;
  if (flyThroughT >= 1) {
    stopFlyThrough();
    showToast('Fly-through complete');
    return;
  }

  const pos = flyThroughSpline.getPointAt(flyThroughT);
  const lookT = Math.min(flyThroughT + 0.02, 0.999);
  const lookAt = flyThroughSpline.getPointAt(lookT);
  const tangent = flyThroughSpline.getTangentAt(flyThroughT).normalize();

  // Chase-cam offset: above and behind
  camera3D.position.set(
    pos.x - tangent.x * 20,
    pos.y + 15,
    pos.z - tangent.z * 20,
  );
  camera3D.lookAt(lookAt.x, lookAt.y + 3, lookAt.z);
}
