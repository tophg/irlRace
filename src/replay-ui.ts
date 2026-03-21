/* ── IRL Race — Replay UI & Playback Controller ──
 *
 * Extracted from main.ts. Manages replay HUD, scrub bar,
 * camera mode buttons, keyboard shortcuts, and free camera orbit.
 */

import * as THREE from 'three/webgpu';
import { ReplayPlayer } from './replay';
import { cleanupDestruction, triggerVehicleDestruction } from './vehicle-destruction';
import { spawnGPUExplosion, spawnGPUGlassShards } from './gpu-particles';
import { spawnDebris } from './vfx';
import { showHUD } from './hud';

// ── Dependencies injected from main.ts ──

export interface ReplayContext {
  /** Shared game state object */
  G: {
    replayRecorder: any;
    replayPlayer: ReplayPlayer | null;
    trackData: any;
    playerVehicle: any;
    aiRacers: { id: string; vehicle: any }[];
    vehicleCamera: any;
  };
  camera: THREE.PerspectiveCamera;
  renderer: { domElement: HTMLCanvasElement };
  uiOverlay: HTMLElement;
  getScene: () => THREE.Scene;
  onShowResults: () => void;
}

let _ctx: ReplayContext | null = null;
let _replayKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let _replayHudUpdater: (() => void) | null = null;

// Document-level handler refs for cleanup (prevent listener leaks)
let _docMouseMove: ((e: MouseEvent) => void) | null = null;
let _docMouseUp: (() => void) | null = null;
let _canvasMouseDown: ((e: MouseEvent) => void) | null = null;
let _canvasWheel: ((e: WheelEvent) => void) | null = null;

type CameraMode = 'chase' | 'orbit' | 'trackside' | 'helicopter' | 'free' | 'auto';

/**
 * Start replay playback with full HUD, scrub bar, and camera controls.
 */
export function startReplayPlayback(ctx: ReplayContext) {
  _ctx = ctx;
  const { G } = ctx;

  if (!G.replayRecorder || !G.trackData || !G.playerVehicle) return;

  // Clean up any destruction effects
  cleanupDestruction();

  // Restore car body visibility
  G.playerVehicle.bodyGroupRef.visible = true;
  G.playerVehicle.destroyed = false;

  // Reset body pitch/roll + wheel state
  G.playerVehicle.resetForReplay();
  for (const ai of G.aiRacers) ai.vehicle.resetForReplay();

  // Build mesh map for replay (player + AI vehicles)
  const meshes = new Map<string, THREE.Group>();
  meshes.set('local', G.playerVehicle.group);
  for (const ai of G.aiRacers) meshes.set(ai.id, ai.vehicle.group);

  // Build vehicle lookup for frame updates
  const vehicleMap = new Map<string, { applyReplayFrame: (f: any) => void }>();
  vehicleMap.set('local', G.playerVehicle);
  for (const ai of G.aiRacers) vehicleMap.set(ai.id, ai.vehicle);

  // Per-frame visual state callback
  const onFrameUpdate = (vehicleId: string, frame: any) => {
    const v = vehicleMap.get(vehicleId);
    if (v) v.applyReplayFrame(frame);
  };

  // Full explosion callback for replay
  const _replayExpPos = new THREE.Vector3();
  const onExplosion = (pos: THREE.Vector3, vehicleId: string, speed: number, heading: number) => {
    const isLocal = vehicleId === 'local';
    const vehicle = isLocal ? G.playerVehicle : G.aiRacers.find(a => a.id === vehicleId)?.vehicle;

    const velX = Math.sin(heading) * speed * 0.06;
    const velZ = Math.cos(heading) * speed * 0.06;

    _replayExpPos.copy(pos);
    _replayExpPos.y += 1.0;
    _replayExpPos.x += Math.sin(heading) * 2.2;
    _replayExpPos.z += Math.cos(heading) * 2.2;
    spawnGPUExplosion(_replayExpPos, 40);

    const ep = _replayExpPos.clone();
    const vx = velX, vz = velZ;
    requestAnimationFrame(() => {
      spawnGPUGlassShards(ep);
      spawnDebris(ep, 35, vx, vz);
    });

    if (vehicle) {
      triggerVehicleDestruction(
        vehicle.bodyGroupRef,
        vehicle.group,
        ctx.getScene(),
        velX, velZ,
        vehicle.wheelRefs,
        vehicle.cachedFragments,
      );
    }
  };

  // Loop cleanup
  const onLoop = () => {
    cleanupDestruction();
    G.playerVehicle!.bodyGroupRef.visible = true;
    G.playerVehicle!.destroyed = false;
    G.playerVehicle!.resetForReplay();
    for (const ai of G.aiRacers) {
      ai.vehicle.bodyGroupRef.visible = true;
      ai.vehicle.destroyed = false;
      ai.vehicle.resetForReplay();
    }
  };

  G.replayPlayer = new ReplayPlayer(G.replayRecorder, ctx.camera, meshes, onExplosion, onFrameUpdate, onLoop);
  G.replayPlayer.start();
  showHUD(false);

  // ── Enhanced Replay HUD ──
  const replayHud = document.createElement('div');
  replayHud.id = 'replay-hud';
  replayHud.style.cssText = `
    position:fixed; bottom:0; left:0; right:0; z-index:100;
    background:linear-gradient(transparent, rgba(0,0,0,0.85));
    padding:16px 24px 20px; display:flex; flex-direction:column; gap:10px;
    font-family:var(--font-display); transition:opacity 0.3s;
  `;
  replayHud.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="font-size:14px;color:var(--col-cyan);letter-spacing:3px;">● REPLAY</div>
      <div id="replay-time" style="font-size:13px;color:rgba(255,255,255,0.6);font-family:monospace;">0:00 / 0:00</div>
      <div style="flex:1;"></div>
      <div id="replay-focus" style="font-size:12px;color:rgba(255,255,255,0.5);cursor:pointer;" title="Click or Tab to cycle">👁 PLAYER</div>
    </div>
    <div id="replay-scrub" style="width:100%;height:8px;background:rgba(255,255,255,0.12);border-radius:4px;cursor:pointer;position:relative;">
      <div id="replay-bar" style="height:100%;background:var(--col-cyan);border-radius:4px;width:0%;pointer-events:none;"></div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;justify-content:center;flex-wrap:wrap;">
      <button class="replay-ctrl" id="rp-skip-back" title="← Skip -3s">⏪</button>
      <button class="replay-ctrl" id="rp-play-pause" title="Space: Play/Pause">▶</button>
      <button class="replay-ctrl" id="rp-skip-fwd" title="→ Skip +3s">⏩</button>
      <button class="replay-ctrl" id="rp-speed" title="[ ] Speed" style="min-width:48px;">1x</button>
      <div style="width:1px;height:20px;background:rgba(255,255,255,0.15);margin:0 6px;"></div>
      <button class="replay-ctrl replay-cam" data-cam="chase" title="1: Chase">🏎</button>
      <button class="replay-ctrl replay-cam" data-cam="orbit" title="2: Orbit">🔄</button>
      <button class="replay-ctrl replay-cam" data-cam="trackside" title="3: Trackside">📷</button>
      <button class="replay-ctrl replay-cam" data-cam="helicopter" title="4: Helicopter">🚁</button>
      <button class="replay-ctrl replay-cam" data-cam="free" title="5: Free Cam (drag)">🎥</button>
      <button class="replay-ctrl replay-cam active" data-cam="auto" title="0: Auto Cycle">AUTO</button>
      <div style="width:1px;height:20px;background:rgba(255,255,255,0.15);margin:0 6px;"></div>
      <button class="replay-ctrl" id="rp-exit" title="Esc: Exit">EXIT</button>
    </div>
  `;

  // Inject replay button styles
  const style = document.createElement('style');
  style.id = 'replay-styles';
  style.textContent = `
    .replay-ctrl {
      border:1px solid rgba(255,255,255,0.25); background:rgba(255,255,255,0.06);
      color:#fff; font-size:14px; padding:6px 12px; border-radius:6px;
      cursor:pointer; font-family:var(--font-display); transition:all 0.15s;
    }
    .replay-ctrl:hover { background:rgba(255,255,255,0.15); border-color:var(--col-cyan); }
    .replay-ctrl.active { background:var(--col-cyan); color:#000; border-color:var(--col-cyan); }
  `;
  document.head.appendChild(style);
  ctx.uiOverlay.appendChild(replayHud);

  // ── HUD update helpers ──
  const updateHUD = () => {
    if (!G.replayPlayer) return;
    const bar = document.getElementById('replay-bar');
    if (bar) bar.style.width = `${Math.round(G.replayPlayer.getProgress() * 100)}%`;

    const timeEl = document.getElementById('replay-time');
    if (timeEl) {
      const cur = G.replayPlayer.getPlaybackTime() / 1000;
      const dur = G.replayPlayer.getDuration() / 1000;
      const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      timeEl.textContent = `${fmt(cur)} / ${fmt(dur)}`;
    }

    const pauseBtn = document.getElementById('rp-play-pause');
    if (pauseBtn) pauseBtn.textContent = G.replayPlayer.paused ? '▶' : '❚❚';

    const speedBtn = document.getElementById('rp-speed');
    if (speedBtn) speedBtn.textContent = `${G.replayPlayer.speed}x`;

    const focusEl = document.getElementById('replay-focus');
    if (focusEl) {
      const id = G.replayPlayer.focusTarget;
      focusEl.textContent = `👁 ${id === 'local' ? 'PLAYER' : id.substring(0, 8).toUpperCase()}`;
    }
  };

  // ── Scrub bar click/drag + touch ──
  const scrubBar = document.getElementById('replay-scrub')!;
  let scrubbing = false;
  const handleScrub = (e: MouseEvent) => {
    const rect = scrubBar.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    G.replayPlayer?.seekTo(progress);
    updateHUD();
  };
  const handleTouchScrub = (e: TouchEvent) => {
    const rect = scrubBar.getBoundingClientRect();
    const touch = e.touches[0] || e.changedTouches[0];
    if (!touch) return;
    const progress = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    G.replayPlayer?.seekTo(progress);
    updateHUD();
  };
  scrubBar.addEventListener('mousedown', (e) => { scrubbing = true; handleScrub(e); });
  const onDocMouseMove = (e: MouseEvent) => { if (scrubbing) handleScrub(e); if (freeDragging && G.replayPlayer?.cameraMode === 'free') G.replayPlayer.rotateFreeCam(-e.movementX * 0.005, -e.movementY * 0.005); };
  const onDocMouseUp = () => { scrubbing = false; freeDragging = false; };
  document.addEventListener('mousemove', onDocMouseMove);
  document.addEventListener('mouseup', onDocMouseUp);
  _docMouseMove = onDocMouseMove;
  _docMouseUp = onDocMouseUp;
  scrubBar.addEventListener('touchstart', (e) => { e.preventDefault(); scrubbing = true; handleTouchScrub(e); }, { passive: false });
  scrubBar.addEventListener('touchmove', (e) => { if (scrubbing) { e.preventDefault(); handleTouchScrub(e); } }, { passive: false });
  scrubBar.addEventListener('touchend', () => { scrubbing = false; });
  scrubBar.addEventListener('touchcancel', () => { scrubbing = false; });

  // ── Button handlers ──
  document.getElementById('rp-play-pause')!.addEventListener('click', () => {
    G.replayPlayer?.togglePause(); updateHUD();
  });
  document.getElementById('rp-skip-back')!.addEventListener('click', () => {
    G.replayPlayer?.seekRelative(-3000); updateHUD();
  });
  document.getElementById('rp-skip-fwd')!.addEventListener('click', () => {
    G.replayPlayer?.seekRelative(3000); updateHUD();
  });
  document.getElementById('rp-speed')!.addEventListener('click', () => {
    G.replayPlayer?.cycleSpeedUp(); updateHUD();
  });
  document.getElementById('rp-exit')!.addEventListener('click', () => {
    stopReplayPlayback();
  });
  document.getElementById('replay-focus')!.addEventListener('click', () => {
    G.replayPlayer?.cycleFocusTarget(); updateHUD();
  });

  // Camera mode buttons
  for (const btn of document.querySelectorAll('.replay-cam')) {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.cam as CameraMode;
      G.replayPlayer?.setCameraMode(mode);
      document.querySelectorAll('.replay-cam').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  }

  // ── Free camera mouse orbit ──
  let freeDragging = false;
  const canvasEl = ctx.renderer.domElement;
  const onCanvasMouseDown = (e: MouseEvent) => {
    if (G.replayPlayer?.cameraMode === 'free' && e.button === 0) freeDragging = true;
  };
  canvasEl.addEventListener('mousedown', onCanvasMouseDown);
  _canvasMouseDown = onCanvasMouseDown;
  // mousemove + mouseup are already combined into the document-level handlers above
  const onCanvasWheel = (e: WheelEvent) => {
    if (G.replayPlayer?.cameraMode === 'free') {
      G.replayPlayer.zoomFreeCam(e.deltaY * 0.05);
      e.preventDefault();
    }
  };
  canvasEl.addEventListener('wheel', onCanvasWheel, { passive: false });
  _canvasWheel = onCanvasWheel;

  // ── Keyboard shortcuts ──
  const replayKeyHandler = (e: KeyboardEvent) => {
    if (!G.replayPlayer) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        G.replayPlayer.togglePause(); updateHUD(); break;
      case 'ArrowLeft':
        G.replayPlayer.seekRelative(-3000); updateHUD(); break;
      case 'ArrowRight':
        G.replayPlayer.seekRelative(3000); updateHUD(); break;
      case '[':
        G.replayPlayer.cycleSpeedDown(); updateHUD(); break;
      case ']':
        G.replayPlayer.cycleSpeedUp(); updateHUD(); break;
      case 'Tab':
        e.preventDefault();
        G.replayPlayer.cycleFocusTarget(); updateHUD(); break;
      case 'Escape':
        stopReplayPlayback(); break;
      case '1': case '2': case '3': case '4': case '5': case '0': {
        const modes: Record<string, string> = {
          '1': 'chase', '2': 'orbit', '3': 'trackside',
          '4': 'helicopter', '5': 'free', '0': 'auto',
        };
        const mode = modes[e.key]!;
        G.replayPlayer.setCameraMode(mode as CameraMode);
        document.querySelectorAll('.replay-cam').forEach(b => {
          b.classList.toggle('active', (b as HTMLElement).dataset.cam === mode);
        });
        break;
      }
    }
  };
  document.addEventListener('keydown', replayKeyHandler);
  // Store handler ref for cleanup
  _replayKeyHandler = replayKeyHandler;
  _replayHudUpdater = updateHUD;
}

/**
 * Stop replay playback, remove HUD, and return to results.
 */
export function stopReplayPlayback() {
  if (!_ctx) return;
  const { G } = _ctx;

  if (G.replayPlayer) {
    G.replayPlayer.stop();
    G.replayPlayer = null;
  }
  const hud = document.getElementById('replay-hud');
  if (hud) {
    if (_replayKeyHandler) document.removeEventListener('keydown', _replayKeyHandler);
    _replayKeyHandler = null;
    hud.remove();
  }
  // Clean up document-level listeners (prevent listener leak on each replay watch)
  if (_docMouseMove) { document.removeEventListener('mousemove', _docMouseMove); _docMouseMove = null; }
  if (_docMouseUp) { document.removeEventListener('mouseup', _docMouseUp); _docMouseUp = null; }
  // Clean up canvas-level listeners
  if (_ctx.renderer?.domElement) {
    if (_canvasMouseDown) { _ctx.renderer.domElement.removeEventListener('mousedown', _canvasMouseDown); _canvasMouseDown = null; }
    if (_canvasWheel) { _ctx.renderer.domElement.removeEventListener('wheel', _canvasWheel); _canvasWheel = null; }
  }
  _replayHudUpdater = null;
  const style = document.getElementById('replay-styles');
  if (style) style.remove();
  _ctx.onShowResults();
}

/**
 * Get the HUD update function (for external frame-loop calls).
 */
function getReplayHUDUpdater(): (() => void) | null {
  return _replayHudUpdater;
}
