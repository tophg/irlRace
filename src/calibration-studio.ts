import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { CarDef } from './types';
import { CarLightDef, saveCalibrationOverride } from './car-lights';
import { getGarageScene, getGarageCamera } from './garage';

// ── Globals for Studio State ──
// (Populated dynamically when the UI is built, logic will be implemented here)
let studioOverlay: HTMLElement | null = null;
let currentCar: THREE.Group | null = null;
let currentCarDef: CarDef | null = null;
let transformControls: TransformControls | null = null;
let activeMarker: string | null = null; // 'headlightL', 'headlightR', 'taillightL', 'taillightR'

// Store the coordinates and sizes being edited
const calData: Partial<CarLightDef> = {};
const markers: Record<string, THREE.Mesh> = {};

// We use 3D glowing planes (PlaneGeometry) aligned backward (-Z) instead of just spheres, 
// so the developer can see the exact bounding box of the headlights.
const markerGeo = new THREE.PlaneGeometry(1, 1);
markerGeo.rotateY(Math.PI); // Face forward relative to the car (-Z in ThreeJS)
markerGeo.translate(0, 0, -0.01); // Push slightly out to prevent Z-fighting

const hlMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthTest: false });
const tlMat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthTest: false });

/** Core init called from garage.ts */
export function initCalibrationStudio(renderer: THREE.WebGLRenderer, container: HTMLElement) {
  if (!new URLSearchParams(window.location.search).has('calibrate')) return;

  const scene = getGarageScene();
  const camera = getGarageCamera();

  // 1. Build the HTML UI panel (sliders, buttons)
  buildStudioUI(container);

  // 2. Setup TransformControls (Gizmo)
  transformControls = new TransformControls(camera as any, renderer.domElement);
  
  // Throttle changes so we don't spam the UI updates
  transformControls.addEventListener('change', () => {
    renderer.render(scene, camera);
    syncUIFromActiveMarker();
  });

  // When grabbing the gizmo, disable orbit controls
  transformControls.addEventListener('dragging-changed', (event) => {
    // A quick hack since garage.ts handles its own damping orbit:
    // We just stop the event propagation if we are dragging the transform gizmo.
    if (event.value) {
      document.body.classList.add('gizmo-active'); 
    } else {
      document.body.classList.remove('gizmo-active');
      applySymmetryIfEnabled();
    }
  });

  scene.add(transformControls.getHelper());

  // Hook up window clicks to select markers
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  window.addEventListener('click', (e) => {
    // Ignore clicks if they originated from our UI, the transform controls, or other garage UI
    if ((e.target as HTMLElement).closest('#calibration-studio, .garage-ui')) return;
    
    // Check if dragging the gizmo
    if (document.body.classList.contains('gizmo-active')) return;

    if (!currentCar) return;

    // Calculate mouse position
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Prioritize clicking existing markers directly
    const markerMeshes = Object.values(markers);
    if (markerMeshes.length > 0) {
      const hits = raycaster.intersectObjects(markerMeshes, false);
      if (hits.length > 0) {
        // Select the marker
        const hitMarker = hits[0].object as THREE.Mesh;
        const type = Object.keys(markers).find(k => markers[k] === hitMarker);
        if (type) {
          selectMarker(type);
          return;
        }
      }
    }

    // Otherwise, raycast against the car model to PLACE a new point
    const carHits = raycaster.intersectObject(currentCar, true);
    if (carHits.length > 0) {
      const hit = carHits[0];
      const localPt = hit.point.clone();
      currentCar.worldToLocal(localPt);
      
      if (activeMarker) {
        // Move active marker to clicked spot
        const marker = markers[activeMarker];
        if (marker) {
          marker.position.copy(localPt);
          syncDataFromMarker(activeMarker);
          syncUIFromActiveMarker();
          applySymmetryIfEnabled();
        }
      }
    }
  });
}

/** Called by garage.ts whenever a new car finishes dropping in. */
export function onStudioCarLoaded(carGroup: THREE.Group, def: CarDef) {
  if (!studioOverlay) return; // not calibrating
  
  currentCar = carGroup;
  currentCarDef = def;
  
  // Clear old markers
  Object.values(markers).forEach(m => m.removeFromParent());
  for (const key in markers) delete markers[key];
  for (const key in calData) delete (calData as any)[key];
  
  if (transformControls) transformControls.detach();
  activeMarker = null;

  // Render "Ghost" auto-detected lights
  renderAutoGhosts();

  // Create markers based on existing CAR_LIGHT_MAP data if available
  resetToSavedData();
}

// ── Internal Helpers ──

function buildStudioUI(container: HTMLElement) {
  studioOverlay = document.createElement('div');
  studioOverlay.id = 'calibration-studio';
  studioOverlay.style.cssText = `
    position: absolute; top: 10px; right: 10px; width: 320px;
    background: rgba(10,10,15,0.9); border: 1px solid #334; border-radius: 8px;
    padding: 16px; color: #fff; font-family: sans-serif; z-index: 100;
    backdrop-filter: blur(8px); display: flex; flex-direction: column; gap: 12px;
  `;

  studioOverlay.innerHTML = `
    <div style="font-weight:bold;font-size:14px;border-bottom:1px solid #334;padding-bottom:8px">Visual Calibration Studio</div>
    
    <div style="display:flex;gap:4px">
      <button class="cal-tab active" data-mark="headlightL">HL Left</button>
      <button class="cal-tab" data-mark="headlightR">HL Right</button>
      <button class="cal-tab" data-mark="taillightL">TL Left</button>
      <button class="cal-tab" data-mark="taillightR">TL Right</button>
    </div>

    <!-- Sliders Container -->
    <div id="cal-sliders" style="display:flex;flex-direction:column;gap:8px;font-size:11px;opacity:0.5;pointer-events:none">
      <label>X: <input type="range" id="cal-x" min="-1.5" max="1.5" step="0.001" value="0"> <span id="v-x">0</span></label>
      <label>Y: <input type="range" id="cal-y" min="0" max="1.5" step="0.001" value="0"> <span id="v-y">0</span></label>
      <label>Z: <input type="range" id="cal-z" min="-2.5" max="2.5" step="0.001" value="0"> <span id="v-z">0</span></label>
      <hr style="border:0;border-top:1px solid #334;margin:4px 0">
      <label>Width: <input type="range" id="cal-w" min="0.05" max="0.6" step="0.01" value="0.2"> <span id="v-w">0.2</span></label>
      <label>Height: <input type="range" id="cal-h" min="0.02" max="0.3" step="0.01" value="0.1"> <span id="v-h">0.1</span></label>
    </div>

    <label style="font-size:11px;display:flex;align-items:center;gap:6px">
      <input type="checkbox" id="cal-sym" checked> Mirror X-Axis (Symmetry)
    </label>

    <div style="display:flex;gap:8px;margin-top:4px">
      <button id="cal-save" style="flex:2;background:#0aa858;color:white;border:none;padding:6px;border-radius:4px;cursor:pointer;font-weight:bold">Save to LocalStorage</button>
    </div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button id="cal-copy" style="flex:1;background:#0d6efd;color:white;border:none;padding:6px;border-radius:4px;cursor:pointer;font-weight:bold">Copy JSON</button>
      <button id="cal-reset" style="flex:1;background:#333;color:white;border:none;padding:6px;border-radius:4px;cursor:pointer">Reset</button>
    </div>
  `;

  // Add basic CSS for the buttons
  const style = document.createElement('style');
  style.textContent = `
    .cal-tab { flex:1; padding: 4px; font-size: 10px; background: #223; color: #889; border: 1px solid #334; border-radius: 4px; cursor: pointer; }
    .cal-tab.active { background: #446; color: #fff; border-color: #668; font-weight: bold; }
    #calibration-studio input[type=range] { width: 100%; margin-top:2px; }
    #calibration-studio label { display:flex; align-items:center; gap:8px }
    #calibration-studio label span { width: 35px; text-align:right; font-family:monospace; color:#aaa; }
  `;
  document.head.appendChild(style);
  container.appendChild(studioOverlay);

  // Bind Tab Clicks
  const tabs = studioOverlay.querySelectorAll('.cal-tab');
  tabs.forEach(t => t.addEventListener('click', (e) => {
    const mark = (e.target as HTMLElement).dataset.mark;
    if (mark) selectMarker(mark);
  }));

  // Bind Sliders
  const inputs = ['x', 'y', 'z', 'w', 'h'];
  inputs.forEach(id => {
    const el = document.getElementById(`cal-${id}`) as HTMLInputElement;
    el.addEventListener('input', () => {
      document.getElementById(`v-${id}`)!.textContent = parseFloat(el.value).toFixed(3);
      applyUIToMarker();
    });
  });

  // Buttons
  document.getElementById('cal-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(calData, null, 2));
    const btn = document.getElementById('cal-copy')!;
    btn.textContent = 'COPIED!';
    setTimeout(() => btn.textContent = 'Copy JSON', 1500);
  });
  
  document.getElementById('cal-save')?.addEventListener('click', () => {
    if (!currentCarDef) return;
    saveCalibrationOverride(currentCarDef.id, calData as CarLightDef);
    const btn = document.getElementById('cal-save')!;
    const oldTxt = btn.textContent;
    btn.textContent = 'SAVED!';
    setTimeout(() => { if (btn) btn.textContent = oldTxt; }, 1500);
  });

  document.getElementById('cal-reset')?.addEventListener('click', resetToSavedData);
}

function selectMarker(type: string) {
  activeMarker = type;
  
  // Update UI Tabs
  document.querySelectorAll('.cal-tab').forEach(t => {
    if ((t as HTMLElement).dataset.mark === type) t.classList.add('active');
    else t.classList.remove('active');
  });

  // Enable Sliders
  const sliders = document.getElementById('cal-sliders');
  if (sliders) {
    sliders.style.opacity = '1';
    sliders.style.pointerEvents = 'auto';
  }

  // Create mesh if it doesn't exist
  if (!markers[type] && currentCar) {
    const isHL = type.startsWith('headlight');
    const m = new THREE.Mesh(markerGeo, isHL ? hlMat : tlMat);
    m.scale.set(0.2, 0.1, 1);
    
    // Default position slightly in front/back of car
    m.position.set(type.endsWith('R') ? 0.5 : -0.5, 0.5, isHL ? -1.5 : 1.5);
    
    currentCar.add(m);
    markers[type] = m;
    
    // Initialize data
    (calData as any)[type] = [m.position.x, m.position.y, m.position.z];
    (calData as any)[isHL ? 'headlightSize' : 'taillightSize'] = [0.2, 0.1];
  }

  // Attach Gizmo
  if (transformControls && markers[type]) {
    transformControls.attach(markers[type]);
  }

  syncUIFromActiveMarker();
}

function syncUIFromActiveMarker() {
  if (!activeMarker || !markers[activeMarker]) return;
  const m = markers[activeMarker];
  const isHL = activeMarker.startsWith('headlight');
  const sizeKey = isHL ? 'headlightSize' : 'taillightSize';
  
  // Read actual mesh state
  const pos = m.position;
  const size = [m.scale.x, m.scale.y];

  // Update Data Model
  (calData as any)[activeMarker] = [parseFloat(pos.x.toFixed(3)), parseFloat(pos.y.toFixed(3)), parseFloat(pos.z.toFixed(3))];
  if (!(calData as any)[sizeKey]) (calData as any)[sizeKey] = [...size];

  // Update DOM sliders
  const setSlider = (id: string, val: number) => {
    const el = document.getElementById(`cal-${id}`) as HTMLInputElement;
    const span = document.getElementById(`v-${id}`);
    if (el && span) { el.value = String(val); span.textContent = val.toFixed(3); }
  };

  setSlider('x', pos.x);
  setSlider('y', pos.y);
  setSlider('z', pos.z);
  
  const curSize = (calData as any)[sizeKey];
  setSlider('w', curSize[0]);
  setSlider('h', curSize[1]);
}

function applyUIToMarker() {
  if (!activeMarker || !markers[activeMarker]) return;
  const m = markers[activeMarker];
  
  const getVal = (id: string) => parseFloat((document.getElementById(`cal-${id}`) as HTMLInputElement).value);
  
  m.position.set(getVal('x'), getVal('y'), getVal('z'));
  m.scale.set(getVal('w'), getVal('h'), 1);

  // Sync data
  const isHL = activeMarker.startsWith('headlight');
  (calData as any)[activeMarker] = [m.position.x, m.position.y, m.position.z];
  (calData as any)[isHL ? 'headlightSize' : 'taillightSize'] = [m.scale.x, m.scale.y];

  // Force bounds update for raycasting
  m.updateMatrixWorld(true);

  applySymmetryIfEnabled();
}

function syncDataFromMarker(type: string) {
    if(!markers[type]) return;
    const m = markers[type];
    (calData as any)[type] = [
        parseFloat(m.position.x.toFixed(3)),
        parseFloat(m.position.y.toFixed(3)),
        parseFloat(m.position.z.toFixed(3))
    ];
}

function applySymmetryIfEnabled() {
  const symCheckbox = document.getElementById('cal-sym') as HTMLInputElement;
  if (!symCheckbox || !symCheckbox.checked || !activeMarker) return;

  const isLeft = activeMarker.endsWith('L');
  const opposite = isLeft ? activeMarker.replace('L', 'R') : activeMarker.replace('R', 'L');
  const isHL = activeMarker.startsWith('headlight');
  const sizeKey = isHL ? 'headlightSize' : 'taillightSize';

  // If the opposite marker exists, mirror X and copy Y/Z/Size
  if (markers[activeMarker] && markers[opposite]) {
    const m = markers[activeMarker];
    const oppM = markers[opposite];
    
    // Mirror X coordinate
    oppM.position.x = -m.position.x;
    oppM.position.y = m.position.y;
    oppM.position.z = m.position.z;
    oppM.scale.copy(m.scale);
    
    // Update data model for opposite
    (calData as any)[opposite] = [
      parseFloat(oppM.position.x.toFixed(3)),
      parseFloat(oppM.position.y.toFixed(3)),
      parseFloat(oppM.position.z.toFixed(3))
    ];
  }
}

function resetToSavedData() {
  if (!currentCarDef) return;
  
  // Try loading from actual car-lights.ts map
  import('./car-lights').then(({ CAR_LIGHT_MAP }) => {
    const saved = CAR_LIGHT_MAP[currentCarDef!.id];
    if (saved) {
      Object.assign(calData, saved);
      
      // Rebuild markers based on saved data
      ['headlightL', 'headlightR', 'taillightL', 'taillightR'].forEach(type => {
        const d = (calData as any)[type];
        if (d && currentCar) {
          if (!markers[type]) {
            const isHL = type.startsWith('headlight');
            const m = new THREE.Mesh(markerGeo, isHL ? hlMat : tlMat);
            currentCar.add(m);
            markers[type] = m;
          }
          markers[type].position.set(d[0], d[1], d[2]);
          
          const size = (calData as any)[type.startsWith('headlight') ? 'headlightSize' : 'taillightSize'];
          if (size) markers[type].scale.set(size[0], size[1], 1);
        }
      });
      
      if (activeMarker) selectMarker(activeMarker);
    }
  });
}

function renderAutoGhosts() {
  if (!currentCar || !currentCar.userData.autoLights) return;
  
  const ghostMat = new THREE.MeshBasicMaterial({ 
    color: 0xffaaff, wireframe: true, transparent: true, opacity: 0.3 
  });

  const auto = currentCar.userData.autoLights as Partial<CarLightDef>;
  
  const addGhost = (pos: number[], size: number[]) => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.Mesh(geo, ghostMat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.scale.set(size[0], size[1], 1);
    currentCar!.add(m);
  };

  if (auto.headlightL && auto.headlightSize) addGhost(auto.headlightL, auto.headlightSize);
  if (auto.headlightR && auto.headlightSize) addGhost(auto.headlightR, auto.headlightSize);
  if (auto.taillightL && auto.taillightSize) addGhost(auto.taillightL, auto.taillightSize);
  if (auto.taillightR && auto.taillightSize) addGhost(auto.taillightR, auto.taillightSize);
}
