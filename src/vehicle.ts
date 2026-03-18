/* ── Hood Racer — Arcade Vehicle Physics (v3 — Pacejka + Bicycle Model) ── */

import * as THREE from 'three';
import { CarDef, InputState, VehicleState, DamageState, createDamageState } from './types';
import { CAR_LIGHT_MAP, CarLightDef } from './car-lights';
import { getSettings } from './settings';
import { getClosestSplinePoint } from './track';
import { fractureMesh, MeshFragment } from './mesh-fracture';
import type { SplineBVH } from './bvh';
import type { WeatherPhysics } from './weather';

// Reusable temps to avoid GC
const _carForward = new THREE.Vector3();
const _carRight = new THREE.Vector3();
const _temp = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _rayOrigin = new THREE.Vector3();
const _rayDown = new THREE.Vector3(0, -1, 0);

// Wheel attachment geometry (local frame)
const WHEEL_SIDE_X = 0.85;
const WHEEL_FRONT_Z = -1.3;
const WHEEL_REAR_Z = 1.3;
const WHEELBASE = 2.6;    // |frontZ - rearZ|
const TRACK_WIDTH = 1.7;  // sideX * 2
const AXLE_FRONT = 1.3;   // CG to front axle
const AXLE_REAR = 1.3;    // CG to rear axle

/** Simplified Pacejka Magic Formula (E=0): D·sin(C·atan(B·x)) */
function pacejka(slip: number, B: number, C: number, D: number): number {
  const Bx = B * slip;
  return D * Math.sin(C * Math.atan(Bx));
}

export class Vehicle {
  readonly group: THREE.Group;
  readonly def: CarDef;

  // Physics state — heading-based, but velocity is a 2D vector (XZ plane)
  heading = 0;
  speed = 0;           // scalar projection of velocity on carForward (for HUD / API)
  steer = 0;           // -1..1 current steering amount
  throttle = 0;
  brake = 0;
  driftAngle = 0;      // visual drift, for VFX / audio
  nitro = 100;         // 0–100 nitro meter (limited supply — starts full)
  private _nitroActive = false; // actual nitro burn state (requires nitro > 0)

  // ── Engine Heat System ──
  private _engineHeat = 0;           // 0–100, overheat at 100
  private _engineDead = false;       // true = engine blown, coasting to halt
  private _engineDeadTimer = 0;      // countdown to engine restart (seconds)
  private _engineJustExploded = false; // single-frame flag for VFX trigger

  /** Whether nitro is currently being burned (read-only) */
  get nitroActive(): boolean { return this._nitroActive; }
  /** Current engine heat 0-100. */
  get engineHeat(): number { return this._engineHeat; }
  /** Whether the engine is dead from overheat. */
  get engineDead(): boolean { return this._engineDead; }
  /** Single-frame flag: true on the frame the engine explodes. */
  get engineJustExploded(): boolean { return this._engineJustExploded; }
  /** Clear the single-frame explosion flag (call after VFX code has consumed it). */
  clearExplosionFlag() { this._engineJustExploded = false; }

  /** Barrier impact info — polled by main loop for sparks/shake. Cleared each frame. */
  lastBarrierImpact: { force: number; posX: number; posY: number; posZ: number; normalX: number; normalZ: number } | null = null;

  // Internal velocity vector on XZ plane
  private _velX = 0;
  private _velZ = 0;
  private _velY = 0;       // vertical velocity (m/s) — used for airborne parabolic flight
  private angularVel = 0;  // heading rate of change (rad/s)

  // ── Airborne state ──
  private _airborne = false;
  private _airTime = 0;          // seconds spent in air
  private _prevRoadY = 0;        // previous frame's road surface Y (for velY derivation)
  private _justLanded = false;   // single-frame flag for landing VFX
  private _landingImpact = 0;    // 0-1 severity of last landing
  private _airPitch = 0;         // accumulated nose-dip pitch while airborne

  /** Whether the vehicle is currently airborne (in air after a ramp/jump). */
  get airborne(): boolean { return this._airborne; }
  /** Time in seconds the vehicle has been airborne. */
  get airTime(): number { return this._airTime; }
  /** Single-frame flag: true on the frame the vehicle lands. */
  get justLanded(): boolean { return this._justLanded; }
  /** Landing impact severity 0-1 (proportional to downward velocity at impact). */
  get landingImpact(): number { return this._landingImpact; }
  /** Clear the single-frame landing flag (call after VFX code has consumed it). */
  clearLandingFlag() { this._justLanded = false; }

  /** Expose velocity for car-to-car collision damping */
  get velX() { return this._velX; }
  set velX(v: number) { this._velX = v; }
  get velZ() { return this._velZ; }
  set velZ(v: number) { this._velZ = v; }

  // Smooth steer interpolation
  private steerTarget = 0;

  // Visuals
  private _bodyGroup: THREE.Group;
  private model: THREE.Group | null = null;
  private wheelFL: THREE.Mesh | null = null;
  private wheelFR: THREE.Mesh | null = null;
  private wheelRL: THREE.Mesh | null = null;
  private wheelRR: THREE.Mesh | null = null;
  private wheelSpin = 0;
  private _destroyed = false;

  // Read-only accessors for destruction system
  get bodyGroupRef(): THREE.Group { return this._bodyGroup; }
  get wheelRefs(): (THREE.Mesh | null)[] {
    return [this.wheelFL, this.wheelFR, this.wheelRL, this.wheelRR];
  }
  get destroyed(): boolean { return this._destroyed; }
  set destroyed(v: boolean) { this._destroyed = v; }

  // Read-only accessors for replay recorder
  get currentWheelSpin(): number { return this.wheelSpin; }
  get bodyPitchX(): number { return this._bodyGroup.rotation.x; }
  get bodyRollZ(): number { return this._bodyGroup.rotation.z; }

  /** Reset all dynamic rotations for replay playback.
   *  Clears: group pitch/roll, bodyGroup pitch/roll/drift-yaw.
   *  Forces procedural wheel containers + all children invisible
   *  (they exist for physics only — GLB model wheels in bodyGroup
   *  handle visuals).
   */
  resetForReplay() {
    // Group: clear road pitch/roll, keep rotation order
    this.group.rotation.set(0, 0, 0, 'YXZ');
    // Body group: clear cosmetic pitch, roll, drift yaw
    this._bodyGroup.rotation.set(0, 0, 0);
    // Procedural wheel containers: force invisible recursively.
    // These containers (torus/hub/spoke) exist for physics positioning only.
    // The visible wheels are part of the GLB model inside _bodyGroup.
    this.wheelSpin = 0;
    for (const w of [this.wheelFL, this.wheelFR, this.wheelRL, this.wheelRR]) {
      if (!w) continue;
      w.visible = false;
      w.traverse((child: THREE.Object3D) => { child.visible = false; });
      // Reset dynamic state (rotation, scale, position) for physics correctness
      w.rotation.set(0, 0, 0);
      w.scale.set(1, 1, 1);
      w.position.y = 0.33; // match GLB model wheel hub height
      const wg = w.children[0];
      if (wg) wg.rotation.set(0, 0, 0);
    }
  }

  /** Apply a replay frame's visual state to the vehicle.
   *  Only drives body pitch/roll/drift — procedural wheel containers
   *  are invisible, so wheel manipulation has no visual effect.
   *  The GLB model's wheel meshes move with _bodyGroup automatically.
   */
  applyReplayFrame(frame: {
    steer: number; wheelSpin: number; driftAngle: number;
    bodyPitchX: number; bodyRollZ: number;
  }) {
    // Body group: pitch + roll + drift yaw
    this._bodyGroup.rotation.x = frame.bodyPitchX;
    this._bodyGroup.rotation.z = frame.bodyRollZ;
    this._bodyGroup.rotation.y = frame.driftAngle * 0.03;
  }

  // Pre-computed fracture fragments (created at load time, used at explosion time)
  private _cachedFragments: MeshFragment[] = [];
  get cachedFragments(): MeshFragment[] { return this._cachedFragments; }

  // Road-mesh raycast state
  private roadMesh: THREE.Mesh | null = null;
  private _extraRayTargets: THREE.Object3D[] = []; // ramp meshes etc.
  private raycaster = new THREE.Raycaster();
  private _roadPitch = 0;
  private _roadRoll = 0;
  private groundOffset = 0; // distance from model origin to wheel contact point (positive = origin above ground)

  // Damage
  damage: DamageState = createDamageState();
  detachedZones = new Set<string>();

  // ── Fixed-timestep interpolation ──
  // _prev: snapshot BEFORE all physics steps. _curr: snapshot AFTER all physics steps.
  // lerpToRender modifies Three.js visuals to _prev + alpha * (_curr - _prev).
  // restoreFromRender puts _curr back so the next frame's physics is correct.
  private _prev = { px: 0, py: 0, pz: 0, heading: 0, roadPitch: 0, roadRoll: 0, bodyPX: 0, bodyRZ: 0, bodyYY: 0 };
  private _curr = { px: 0, py: 0, pz: 0, heading: 0, roadPitch: 0, roadRoll: 0, bodyPX: 0, bodyRZ: 0, bodyYY: 0 };
  private _snapValid = false;

  /** Save current state as "previous". Call ONCE before the first physics sub-step. */
  saveSnapshot() {
    const p = this.group.position;
    this._prev.px = p.x; this._prev.py = p.y; this._prev.pz = p.z;
    this._prev.heading = this.heading;
    this._prev.roadPitch = this._roadPitch;
    this._prev.roadRoll = this._roadRoll;
    this._prev.bodyPX = this._bodyGroup.rotation.x;
    this._prev.bodyRZ = this._bodyGroup.rotation.z;
    this._prev.bodyYY = this._bodyGroup.rotation.y;
    this._snapValid = true;
  }

  /**
   * Interpolate Three.js visual state between _prev and current physics state.
   * Saves the actual physics state into _curr first so restoreFromRender can put it back.
   * alpha ∈ [0,1]:  0 → show prev,  1 → show current.
   */
  lerpToRender(alpha: number) {
    if (!this._snapValid) return;
    const p = this.group.position;

    // Save current (physics-authoritative) state
    this._curr.px = p.x; this._curr.py = p.y; this._curr.pz = p.z;
    this._curr.heading = this.heading;
    this._curr.roadPitch = this._roadPitch;
    this._curr.roadRoll = this._roadRoll;
    this._curr.bodyPX = this._bodyGroup.rotation.x;
    this._curr.bodyRZ = this._bodyGroup.rotation.z;
    this._curr.bodyYY = this._bodyGroup.rotation.y;

    const prev = this._prev;
    const curr = this._curr;

    // Interpolate position
    p.x = prev.px + (curr.px - prev.px) * alpha;
    p.y = prev.py + (curr.py - prev.py) * alpha;
    p.z = prev.pz + (curr.pz - prev.pz) * alpha;

    // Interpolate heading (with angle wrapping)
    let dh = curr.heading - prev.heading;
    if (dh > Math.PI) dh -= Math.PI * 2;
    if (dh < -Math.PI) dh += Math.PI * 2;
    this.group.rotation.y = prev.heading + dh * alpha;

    // Interpolate road surface alignment
    this.group.rotation.x = prev.roadPitch + (curr.roadPitch - prev.roadPitch) * alpha;
    this.group.rotation.z = prev.roadRoll + (curr.roadRoll - prev.roadRoll) * alpha;

    // Interpolate body cosmetic rotations
    this._bodyGroup.rotation.x = prev.bodyPX + (curr.bodyPX - prev.bodyPX) * alpha;
    this._bodyGroup.rotation.z = prev.bodyRZ + (curr.bodyRZ - prev.bodyRZ) * alpha;
    this._bodyGroup.rotation.y = prev.bodyYY + (curr.bodyYY - prev.bodyYY) * alpha;
  }

  /** Restore physics-authoritative state after rendering, so next physics step is correct. */
  restoreFromRender() {
    if (!this._snapValid) return;
    const c = this._curr;
    const p = this.group.position;
    p.x = c.px; p.y = c.py; p.z = c.pz;
    this.group.rotation.y = c.heading;
    this.group.rotation.x = c.roadPitch;
    this.group.rotation.z = c.roadRoll;
    this._bodyGroup.rotation.x = c.bodyPX;
    this._bodyGroup.rotation.z = c.bodyRZ;
    this._bodyGroup.rotation.y = c.bodyYY;
  }


  // Debug telemetry (populated each frame for debug overlay)
  telemetry = {
    alphaFront: 0, alphaRear: 0,
    frontLatF: 0, rearLatF: 0,
    frontGrip: 0.5, rearGrip: 0.5,
    yawTorque: 0, kinBlend: 0,
    slipAngle: 0, longForce: 0,
  };

  constructor(def: CarDef) {
    this.def = def;
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this._bodyGroup = new THREE.Group();
    this.group.add(this._bodyGroup);
  }

  /** Attach a loaded GLB model to this vehicle.
   *  Pass renderer + camera to pre-warm WebGL shaders for explosion fragments
   *  (prevents 1-2s shader compilation stall at detonation time).
   */
  setModel(
    model: THREE.Group,
    renderer?: { compile: (scene: THREE.Scene, camera: THREE.Camera) => void },
    camera?: THREE.Camera,
    scene?: THREE.Scene,
  ) {
    this.model = model;
    this._bodyGroup.add(model);

    // Per-model height offset — the loader positions cars at ground level,
    // so groundOffset is just the optional per-model tuning value.
    this.groundOffset = this.def.heightOffset ?? 0;

    this.buildWheels();
    this.buildLights();

    // Pre-fracture the mesh NOW (at load time) so explosion is instant
    const meshes: THREE.Mesh[] = [];
    this._bodyGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry && child.visible) {
        meshes.push(child);
      }
    });
    for (const srcMesh of meshes) {
      this._cachedFragments.push(...fractureMesh(srcMesh, 2, 1, 1));
    }
    // Cap fragments to avoid excessive scene.add() calls at explosion time
    if (this._cachedFragments.length > 12) {
      this._cachedFragments.length = 12;
    }

    // Pre-warm WebGPU pipelines for fragment materials in the REAL scene.
    // Compiling in a throwaway scene creates pipelines that don't match the
    // real render state (lights, env, fog, tone mapping) — causing pipeline
    // recompilation (5-30ms stall) on the explosion frame.
    // By compiling in the actual scene, pipelines match exactly.
    if (renderer && camera && scene && this._cachedFragments.length > 0) {
      const tempMeshes: THREE.Mesh[] = [];
      for (const frag of this._cachedFragments) {
        const m = new THREE.Mesh(frag.mesh.geometry, frag.mesh.material);
        m.visible = true;
        m.position.set(0, -100, 0); // off-screen so invisible to player
        m.frustumCulled = false; // ensure it's compiled even though off-screen
        scene.add(m);
        tempMeshes.push(m);
      }
      renderer.compile(scene, camera);
      // Remove temp meshes (compiled pipelines persist in renderer cache)
      for (const m of tempMeshes) scene.remove(m);
    }
  }

  /** Recolor the car body with a new hue (0–360). Preserves metalness/roughness. */
  setPaintColor(hue: number) {
    if (!this.model) return;
    const color = new THREE.Color().setHSL(hue / 360, 0.90, 0.15);
    this.model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      
      for (const mat of mats as any[]) {
        if (!mat) continue;
        // Skip glass / transparent
        if (mat.transparent && mat.opacity < 0.5) continue;
        // Skip lights (strong emissive color)
        if (mat.emissiveIntensity > 0.5 && mat.emissive && mat.emissive.getHex() > 0) continue;
        // Named exclusions
        const name = (mat.name || child.name || '').toLowerCase();
        if (/glass|window|windshield|tire|tyre|wheel|rubber|rim|chrome|logo|badge|grille|exhaust|mirror|light|lens|indicator/.test(name)) continue;
        if (!mat.color) continue;
        // Very dark + highly metallic = trim, not body
        const hsl = { h: 0, s: 0, l: 0 };
        mat.color.getHSL(hsl);
        if (hsl.l < 0.05 && (mat.metalness ?? 0) > 0.85) continue;
        // Apply paint
        mat.color.copy(color);
        if (mat.needsUpdate !== undefined) mat.needsUpdate = true;
        mat.version++; // Force WebGPU uniform re-upload
      }
    });
  }

  /** Set the road mesh used for per-wheel raycasting. Additional targets (ramp meshes) are also raycasted. */
  setRoadMesh(mesh: THREE.Mesh, extraTargets?: THREE.Object3D[]) {
    this.roadMesh = mesh;
    this._extraRayTargets = extraTargets ?? [];
  }

  /** Cast a single ray downward from a wheel's world position and return the highest hit Y, or null. */
  private castWheelRay(sinH: number, cosH: number, localX: number, localZ: number): number | null {
    if (!this.roadMesh) return null;
    const wx = this.group.position.x + cosH * localX + sinH * localZ;
    const wz = this.group.position.z - sinH * localX + cosH * localZ;
    _rayOrigin.set(wx, this.group.position.y + 15, wz);
    this.raycaster.set(_rayOrigin, _rayDown);
    this.raycaster.far = 30;

    // Raycast road mesh
    const hits = this.raycaster.intersectObject(this.roadMesh, false);
    let bestY: number | null = hits.length > 0 ? hits[0].point.y : null;

    // Raycast extra targets (ramps) — take highest hit Y
    for (const target of this._extraRayTargets) {
      const extraHits = this.raycaster.intersectObject(target, true);
      if (extraHits.length > 0) {
        const y = extraHits[0].point.y;
        if (bestY === null || y > bestY) bestY = y;
      }
    }
    return bestY;
  }

  private buildWheels() {
    const wheelGeo = new THREE.TorusGeometry(0.35, 0.12, 8, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.3 });
    const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.08, 6);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x888899, metalness: 0.8, roughness: 0.2 });

    const createWheel = (): THREE.Mesh => {
      const wheelGroup = new THREE.Group();

      // Tire: default torus ring is flat in XZ. Rotate to stand upright (ring in YZ plane)
      // so the axle runs along X and the wheel spins correctly with rotation.x
      const tire = new THREE.Mesh(wheelGeo, wheelMat);
      tire.rotation.z = Math.PI / 2;
      wheelGroup.add(tire);

      // Hub: default cylinder axis is Y. Rotate so axle runs along X
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.rotation.z = Math.PI / 2;
      wheelGroup.add(hub);

      // Spokes: fan out in the YZ wheel plane (rotate around X axis)
      for (let i = 0; i < 5; i++) {
        const spokeGeo = new THREE.BoxGeometry(0.04, 0.3, 0.04);
        const spoke = new THREE.Mesh(spokeGeo, hubMat);
        spoke.rotation.x = (i / 5) * Math.PI;
        wheelGroup.add(spoke);
      }

      const container = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
      container.visible = false;
      container.add(wheelGroup);
      return container;
    };

    this.wheelFL = createWheel();
    this.wheelFR = createWheel();
    this.wheelRL = createWheel();
    this.wheelRR = createWheel();

    // wheelY = 0.33 matches approximate GLB model wheel hub center height
    // (containers are invisible — used only for suspension raycasting)
    const wheelY = 0.33, frontZ = -1.3, rearZ = 1.3, sideX = 0.85;
    this.wheelFL.position.set(-sideX, wheelY, frontZ);
    this.wheelFR.position.set(sideX, wheelY, frontZ);
    this.wheelRL.position.set(-sideX, wheelY, rearZ);
    this.wheelRR.position.set(sideX, wheelY, rearZ);
    this.group.add(this.wheelFL, this.wheelFR, this.wheelRL, this.wheelRR);
  }

  // ── Car lights ──
  private taillightMatL: THREE.MeshStandardMaterial | null = null;
  private taillightMatR: THREE.MeshStandardMaterial | null = null;
  private buildLights() {
    const ld = CAR_LIGHT_MAP[this.def.file]; // manual overrides
    const auto = this.model?.userData?.autoLights as Partial<CarLightDef> | undefined;

    let hlLPos: [number, number, number], hlRPos: [number, number, number];
    let tlLPos: [number, number, number], tlRPos: [number, number, number];
    let hlSize: [number, number], tlSize: [number, number];
    let spotI: number, spotD: number, beamLen: number, beamRad: number;

    // Headlight position logic
    if (auto?.headlightL && auto?.headlightR) {
      hlLPos = auto.headlightL;
      hlRPos = auto.headlightR;
      hlSize = auto.headlightSize || [0.22, 0.14];
    } else if (ld?.headlightL) {
      hlLPos = ld.headlightL;
      hlRPos = ld.headlightR;
      hlSize = ld.headlightSize || [0.22, 0.14];
    } else {
      // Bounding box fallback
      const box = new THREE.Box3();
      if (this.model) box.setFromObject(this.model);
      else box.min.set(-0.9, 0, -2.2), box.max.set(0.9, 1.4, 2.2);
      const frontZ = box.max.z;
      const lightY = box.min.y + (box.max.y - box.min.y) * 0.35;
      const halfW = (box.max.x - box.min.x) * 0.35;
      hlLPos = [-halfW, lightY, frontZ];
      hlRPos = [ halfW, lightY, frontZ];
      hlSize = [0.22, 0.14];
    }

    // Taillight position logic
    if (auto?.taillightL && auto?.taillightR) {
      tlLPos = auto.taillightL;
      tlRPos = auto.taillightR;
      tlSize = auto.taillightSize || [0.28, 0.10];
    } else if (ld?.taillightL) {
      tlLPos = ld.taillightL;
      tlRPos = ld.taillightR;
      tlSize = ld.taillightSize || [0.28, 0.10];
    } else {
      const box = new THREE.Box3();
      if (this.model) box.setFromObject(this.model);
      else box.min.set(-0.9, 0, -2.2), box.max.set(0.9, 1.4, 2.2);
      const rearZ = box.min.z;
      const lightY = box.min.y + (box.max.y - box.min.y) * 0.35;
      const halfW = (box.max.x - box.min.x) * 0.35;
      tlLPos = [-halfW, lightY, rearZ];
      tlRPos = [ halfW, lightY, rearZ];
      tlSize = [0.28, 0.10];
    }

    // Beam parameters (use manual overrides if present, else defaults)
    spotI = ld?.spotIntensity || 2.0;
    spotD = ld?.spotDistance || 20;
    beamLen = ld?.beamLength || 15;
    beamRad = ld?.beamRadius || 3.5;

    // ── Headlight decals (flat planes flush on front face, facing +Z) ──
    const hlGeo = new THREE.PlaneGeometry(hlSize[0], hlSize[1]);
    const hlMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffeedd,
      emissiveIntensity: 3.0,
      roughness: 0.05,
      metalness: 0.0,
    });

    const hlL = new THREE.Mesh(hlGeo, hlMat);
    hlL.position.set(hlLPos[0], hlLPos[1], hlLPos[2] + 0.01); // tiny offset to prevent z-fighting
    this._bodyGroup.add(hlL);

    const hlR = new THREE.Mesh(hlGeo, hlMat.clone());
    hlR.position.set(hlRPos[0], hlRPos[1], hlRPos[2] + 0.01);
    this._bodyGroup.add(hlR);

    // SpotLights for road illumination
    const hlSpotL = new THREE.SpotLight(0xffeedd, spotI, spotD, Math.PI / 5, 0.8, 2);
    hlSpotL.position.set(hlLPos[0], hlLPos[1], hlLPos[2]);
    const targetL = new THREE.Object3D();
    targetL.position.set(hlLPos[0] * 0.5, hlLPos[1] - 1, hlLPos[2] + 12);
    this._bodyGroup.add(targetL);
    hlSpotL.target = targetL;
    this._bodyGroup.add(hlSpotL);

    const hlSpotR = new THREE.SpotLight(0xffeedd, spotI, spotD, Math.PI / 5, 0.8, 2);
    hlSpotR.position.set(hlRPos[0], hlRPos[1], hlRPos[2]);
    const targetR = new THREE.Object3D();
    targetR.position.set(hlRPos[0] * 0.5, hlRPos[1] - 1, hlRPos[2] + 12);
    this._bodyGroup.add(targetR);
    hlSpotR.target = targetR;
    this._bodyGroup.add(hlSpotR);

    // Volumetric beam cones
    const beamGeo = new THREE.ConeGeometry(beamRad, beamLen, 12, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffeedd,
      transparent: true,
      opacity: 0.025,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const beamL = new THREE.Mesh(beamGeo, beamMat);
    beamL.rotation.x = -Math.PI / 2 - 0.15;
    beamL.position.set(hlLPos[0], hlLPos[1] - 0.5, hlLPos[2] + beamLen / 2);
    this._bodyGroup.add(beamL);

    const beamR = new THREE.Mesh(beamGeo, beamMat.clone());
    beamR.rotation.x = -Math.PI / 2 - 0.15;
    beamR.position.set(hlRPos[0], hlRPos[1] - 0.5, hlRPos[2] + beamLen / 2);
    this._bodyGroup.add(beamR);

    // ── Taillight decals — DISABLED ──
    // const tlGeo = new THREE.PlaneGeometry(tlSize[0], tlSize[1]);
    // this.taillightMatL = new THREE.MeshStandardMaterial({ ... });
    // (brake lights temporarily removed)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHYSICS UPDATE — Friction Circle Model
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  update(dt: number, input: InputState, spline?: THREE.CatmullRomCurve3, bvh?: SplineBVH, weather?: WeatherPhysics) {
    dt = Math.min(dt, 0.05);
    const { def } = this;

    // ── Input mapping ──
    this.throttle = input.up ? 1 : 0;
    this.brake = input.down ? 1 : 0;
    this.steerTarget = input.steerAnalog !== 0
      ? input.steerAnalog
      : (input.left ? -1 : 0) + (input.right ? 1 : 0);
    // Reduced steering in air (no tire grip)
    const steerInfluence = this._airborne ? 0.15 : 1.0;
    this.steer += ((this.steerTarget * steerInfluence) - this.steer) * Math.min(1, def.steerSpeed * dt);

    // ── Compute car-local basis ──
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    _carForward.set(sinH, 0, cosH);
    _carRight.set(cosH, 0, -sinH);

    // ── Decompose velocity into car-local components ──
    const vForward = this._velX * sinH + this._velZ * cosH;
    const vLateral = this._velX * cosH - this._velZ * sinH;

    // ── Speed metrics ──
    const absSpeed = Math.abs(vForward);
    const speedRatio = Math.min(absSpeed / def.maxSpeed, 1);

    // ── Damage penalties (realistic mechanical degradation) ──
    const dmg = this.damage;
    const fHP = dmg.front.hp / 100;  // 1=pristine, 0=destroyed
    const rHP = dmg.rear.hp  / 100;
    const lHP = dmg.left.hp  / 100;
    const riHP = dmg.right.hp / 100;
    const avgHP = (fHP + rHP + lHP + riHP) / 4;
    // Engine/radiator damage (front) → acceleration + max speed
    const accelMult  = 0.7 + 0.3 * fHP;           // 70-100%
    const maxSpdMult = 0.6 + 0.4 * fHP;           // 60-100%
    // Asymmetric side damage → steering pull toward damaged side
    const steerBias  = (lHP - riHP) * 0.15;
    // Suspension damage (sides) → handling degradation
    const handlingMult = 0.5 + 0.5 * Math.min(lHP, riHP); // 50-100%
    // Rear damage → braking degradation
    const brakeMult  = 0.65 + 0.35 * rHP;          // 65-100%
    // Overall structural damage → global penalty
    const globalMult = 0.7 + 0.3 * avgHP;          // 70-100%

    // ── Longitudinal forces ──
    // Tyre forces (throttle/brake) — used for friction circle
    let tyreForce = 0;
    if (this.throttle > 0) tyreForce += def.acceleration * this.throttle * accelMult * globalMult;
    if (this.brake > 0)    tyreForce -= def.braking * this.brake * brakeMult * (weather?.brakingScale ?? 1);
    // Aero/rolling resistance added separately (not part of tyre budget)
    const weatherDrag = vForward * (weather?.rollingResistance ?? 0);
    const dragForce = vForward * Math.abs(vForward) * 0.002 + vForward * 0.8 + weatherDrag;
    const longForce = tyreForce - dragForce;

    // ── Per-axle slip angles (bicycle model) ──
    const vLatFront = vLateral + this.angularVel * AXLE_FRONT;
    const vLatRear  = vLateral - this.angularVel * AXLE_REAR;
    const vFwdClamped = Math.max(absSpeed, 1.5);

    const maxSteerAngle = 0.35 * getSettings().steerSensitivity * handlingMult * (weather?.steerResponseScale ?? 1);
    const steerAngle = (this.steer + steerBias) * maxSteerAngle / (1 + absSpeed * 0.025);
    const signFwd = vForward >= 0 ? 1 : -1;

    const alphaFront = Math.atan2(vLatFront, vFwdClamped) - steerAngle * signFwd;
    const alphaRear  = Math.atan2(vLatRear, vFwdClamped);

    // ── Weight transfer ──
    const totalGrip = Math.max(def.gripCoeff * 50, 1);
    // Only tyre forces count for friction circle, not drag
    const longUsage = Math.min(Math.abs(tyreForce) / totalGrip, 0.9);
    const weightShift = (tyreForce / totalGrip) * def.cgHeight;
    const frontGrip = Math.max(0.15, def.frontBias - weightShift);
    const rearGrip  = Math.max(0.15, (1 - def.frontBias) + weightShift);

    // Friction circle: lateral budget shrinks when longitudinal tyre force is saturated
    const latBudget = Math.sqrt(Math.max(0, 1 - longUsage * longUsage));

    // ── Pacejka lateral forces per axle ──
    const B = def.latFriction * 1.4 * (weather?.corneringStiffness ?? 1);
    const C = 1.4;
    let frontPeak = totalGrip * frontGrip * 2 * latBudget * globalMult * (weather?.gripScale ?? 1);
    let rearPeak  = totalGrip * rearGrip  * 2 * latBudget * globalMult * (weather?.gripScale ?? 1);

    // Aquaplaning: speed-dependent grip loss above threshold
    if (weather?.aquaplaneSpeed && absSpeed > weather.aquaplaneSpeed) {
      const aquaFactor = 1 - weather.aquaplaneGripLoss *
        Math.min(1, (absSpeed - weather.aquaplaneSpeed) / 20);
      frontPeak *= aquaFactor;
      rearPeak  *= aquaFactor;
    }

    const frontLatF = -pacejka(alphaFront, B, C, frontPeak);
    const rearLatF  = -pacejka(alphaRear,  B, C, rearPeak);

    // ── Yaw torque from tyre forces ──
    const yawTorque = frontLatF * AXLE_FRONT - rearLatF * AXLE_REAR;
    const yawInertia = def.mass * 0.004;

    // ── Integrate velocity ──
    const newVForward = vForward + longForce * dt;

    // ── Engine overheat: dead engine — no throttle, coast to halt ──
    // (engineJustExploded flag is cleared by main.ts after VFX code consumes it)
    if (this._engineDead) {
      this._engineDeadTimer -= dt;
      // Kill throttle/nitro while engine is dead
      this._nitroActive = false;
      // Apply heavy drag to coast to a stop
      const deadDrag = vForward * 3.0;
      // We'll use this below by zeroing tyreForce contribution
      if (this._engineDeadTimer <= 0) {
        // Engine restarts — heat partially cooled
        this._engineDead = false;
        this._engineDeadTimer = 0;
        this._engineHeat = 40; // still warm after restart
      }
    }

    // ── Nitro drain/recharge (must run before boostedMax) ──
    if (!this._engineDead && input.boost && this.nitro > 0) {
      this._nitroActive = true;
      this.nitro = Math.max(0, this.nitro - 20 * dt);  // slower drain = longer burn window
    } else {
      this._nitroActive = false;
    }
    // Drift recharge (slow trickle — NOS is a limited resource, not infinitely renewable)
    if (!this._nitroActive && Math.abs(this.driftAngle) > 0.15 && absSpeed > 5) {
      this.nitro = Math.min(100, this.nitro + Math.abs(this.driftAngle) * 4 * dt);
    }
    // Nitro is primarily a finite supply — drift recharge is a small bonus, not a refill

    // ── Engine Heat accumulation ──
    if (!this._engineDead) {
      // Heat sources (tuned for longer survival — engines should be hard to destroy)
      if (this._nitroActive) this._engineHeat += 25 * dt;       // nitro heat (reduced from 40)
      this._engineHeat += absSpeed * 0.2 * dt;                   // high-RPM heat (reduced from 0.3)
      // Cooling (scaled by front HP — damaged radiator = less cooling)
      const radiatorEff = fHP;                                   // 1.0 pristine → 0.0 destroyed
      this._engineHeat -= 12 * radiatorEff * dt;                 // passive radiator cooling (up from 8)
      this._engineHeat -= absSpeed * 0.18 * dt;                  // air cooling at speed (up from 0.12)
      this._engineHeat = Math.max(0, Math.min(100, this._engineHeat));

      // Overheat explosion!
      if (this._engineHeat >= 100) {
        this._engineDead = true;
        this._engineDeadTimer = 3.0; // 3 seconds of engine death
        this._engineJustExploded = true;
        this._nitroActive = false;
        // Engine explosion damages the front zone (radiator/engine)
        this.damage.front.hp = Math.max(0, this.damage.front.hp - 50);
        this.damage.front.deformAmount += 50;
      }
    } else {
      // While dead: slow passive cooling
      this._engineHeat = Math.max(0, this._engineHeat - 8 * dt);
    }

    const weatherMaxSpeed = def.maxSpeed * (weather?.topSpeedScale ?? 1);
    const boostedMax = this._nitroActive ? weatherMaxSpeed * 1.4 * maxSpdMult : weatherMaxSpeed * maxSpdMult;
    const clampedFwd = Math.max(-def.maxSpeed * 0.3, Math.min(newVForward, boostedMax));

    const totalLatAccel = frontLatF + rearLatF;
    const newVLateral = vLateral + totalLatAccel * dt;

    this._velX = clampedFwd * sinH + newVLateral * cosH;
    this._velZ = clampedFwd * cosH - newVLateral * sinH;

    // ── Telemetry ──
    this.telemetry.alphaFront = alphaFront;
    this.telemetry.alphaRear = alphaRear;
    this.telemetry.frontLatF = frontLatF;
    this.telemetry.rearLatF = rearLatF;
    this.telemetry.frontGrip = frontGrip;
    this.telemetry.rearGrip = rearGrip;
    this.telemetry.yawTorque = yawTorque;
    this.telemetry.slipAngle = Math.atan2(Math.abs(vLateral), Math.max(absSpeed, 1));
    this.telemetry.longForce = longForce;

    // ── Steering: blend kinematic (snappy arcade) + physics (natural limits) ──
    const kinBlend = 1 / (1 + absSpeed * 0.05);
    this.telemetry.kinBlend = kinBlend;
    const kinSteer = this.steer * def.handling * dt / (1 + absSpeed * 0.035);
    if (absSpeed > 0.5) {
      this.angularVel += kinSteer * signFwd * kinBlend;
      this.angularVel += (yawTorque / yawInertia) * dt * (1 - kinBlend * 0.5);
    }

    // ── Auto-countersteer (reduced — tyre forces now provide natural correction) ──
    const slideAngle = Math.atan2(Math.abs(vLateral), Math.max(absSpeed, 0.5));
    const driftHeld = this._nitroActive ? 0.1 : 0.5;
    this.angularVel *= 1 - Math.min(1, 3.0 * driftHeld * slideAngle * dt);

    // Angular damping (frame-rate independent, weather-affected)
    this.angularVel *= Math.exp(-(weather?.yawDamping ?? 2.5) * dt);

    // Apply angular velocity to heading
    this.heading += this.angularVel * dt;
    // Keep heading in [0, 2π) to prevent accumulation overflow in network encoding
    this.heading = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    // ── Drift angle (for VFX / audio / visuals) ──
    this.driftAngle = Math.atan2(-vLateral, Math.max(absSpeed, 1)) * def.driftFactor * 5 * (weather?.driftScale ?? 1);

    // ── Crosswind lateral push ──
    if (weather?.crosswindForce && absSpeed > 3) {
      // Use deterministic per-frame time from physics accumulator
      const windTime = performance.now() * 0.001; // smooth, monotonic
      const variance = 1 + Math.sin(windTime) * (weather.crosswindVariance ?? 0);
      const windForce = weather.crosswindForce * absSpeed * absSpeed * 0.0001 * variance;
      this._velX += windForce * cosH * dt;
      this._velZ -= windForce * sinH * dt;
    }

    // ── Scalar speed (for HUD, network, audio) ──
    this.speed = this._velX * sinH + this._velZ * cosH;

    // Stop threshold
    if (absSpeed < 0.1 && this.throttle === 0) {
      this._velX = 0;
      this._velZ = 0;
      this.speed = 0;
      this.angularVel = 0;
    }

    // ── Position update ──
    this.group.position.x += this._velX * dt;
    this.group.position.z += this._velZ * dt;

    // ── Keep on road surface (per-wheel raycast with spline fallback) ──
    let nearestSpline: { t: number; point: THREE.Vector3; distance: number } | null = null;
    let usedRaycast = false;

    // ── Airborne physics constants ──
    const GRAVITY = 15;            // m/s² (~1.5g for arcade feel)
    const LAUNCH_VEL_THRESHOLD = 0.5; // min velY to trigger airborne
    const LAUNCH_GAP_THRESHOLD = 0.08; // min gap above road to trigger airborne
    const MAX_AIR_TIME = 5.0;      // safety: force-land after 5s
    const AIR_STEER_FACTOR = 0.15; // steering multiplier while airborne

    if (this.roadMesh) {
      const flY = this.castWheelRay(sinH, cosH, -WHEEL_SIDE_X, WHEEL_FRONT_Z);
      const frY = this.castWheelRay(sinH, cosH, WHEEL_SIDE_X, WHEEL_FRONT_Z);
      const rlY = this.castWheelRay(sinH, cosH, -WHEEL_SIDE_X, WHEEL_REAR_Z);
      const rrY = this.castWheelRay(sinH, cosH, WHEEL_SIDE_X, WHEEL_REAR_Z);

      const hitCount = (flY !== null ? 1 : 0) + (frY !== null ? 1 : 0) +
                       (rlY !== null ? 1 : 0) + (rrY !== null ? 1 : 0);

      if (hitCount >= 2) {
        usedRaycast = true;
        const validHits: number[] = [];
        if (flY !== null) validHits.push(flY);
        if (frY !== null) validHits.push(frY);
        if (rlY !== null) validHits.push(rlY);
        if (rrY !== null) validHits.push(rrY);

        const fl = flY ?? validHits[0];
        const fr = frY ?? validHits[0];
        const rl = rlY ?? validHits[validHits.length - 1];
        const rr = rrY ?? validHits[validHits.length - 1];

        const roadY = (fl + fr + rl + rr) / 4 + this.groundOffset;

        if (this._airborne) {
          // ── AIRBORNE: parabolic flight ──
          this._velY -= GRAVITY * dt;
          this.group.position.y += this._velY * dt;
          this._airTime += dt;

          // Slow nose-dip pitch (angular momentum in air)
          this._airPitch -= 0.4 * dt;

          // Landing detection: car has descended to or below road surface
          if (this.group.position.y <= roadY || this._airTime > MAX_AIR_TIME) {
            // LAND
            this._airborne = false;
            this.group.position.y = roadY;
            this._justLanded = true;
            this._landingImpact = Math.min(1.0, Math.abs(this._velY) / 15);
            this._velY = 0;
            this._airTime = 0;
            this._airPitch = 0;
          }
        } else {
          // ── GROUNDED: smooth Y tracking (both directions) ──
          const yLerp = 1 - Math.exp(-15 * dt);
          this.group.position.y += (roadY - this.group.position.y) * yLerp;

          // Derive vertical velocity from road slope × forward speed
          // (this is what gives launch velocity when leaving a ramp)
          const prevVelY = this._velY;
          if (this._prevRoadY !== 0) {
            this._velY = (roadY - this._prevRoadY) / dt;
          }
          this._prevRoadY = roadY;

          // Launch detection: car is above road AND has upward velocity
          const gap = this.group.position.y - roadY;
          if (gap > LAUNCH_GAP_THRESHOLD && this._velY > LAUNCH_VEL_THRESHOLD) {
            this._airborne = true;
            this._airTime = 0;
            this._airPitch = 0;
            this._velY *= 1.5; // arcade boost for dramatic jumps
          }
          // Ramp lip detection: road dropped away while we had upward climbing momentum
          else if (gap > LAUNCH_GAP_THRESHOLD && prevVelY > LAUNCH_VEL_THRESHOLD && this._velY < 0) {
            this._airborne = true;
            this._airTime = 0;
            this._airPitch = 0;
            this._velY = prevVelY * 1.5; // carry forward climbing momentum with arcade boost
          }
        }

        // ── Per-wheel visual suspension (only when grounded) ──
        if (!this._airborne) {
          const avgHit = (fl + fr + rl + rr) / 4;
          const suspLerp = 1 - Math.exp(-20 * dt);
          const baseWheelY = 0.33;
          const maxTravel = 0.15;

          if (this.wheelFL) {
            const delta = Math.max(-maxTravel, Math.min(maxTravel, fl - avgHit));
            this.wheelFL.position.y += (baseWheelY + delta - this.wheelFL.position.y) * suspLerp;
          }
          if (this.wheelFR) {
            const delta = Math.max(-maxTravel, Math.min(maxTravel, fr - avgHit));
            this.wheelFR.position.y += (baseWheelY + delta - this.wheelFR.position.y) * suspLerp;
          }
          if (this.wheelRL) {
            const delta = Math.max(-maxTravel, Math.min(maxTravel, rl - avgHit));
            this.wheelRL.position.y += (baseWheelY + delta - this.wheelRL.position.y) * suspLerp;
          }
          if (this.wheelRR) {
            const delta = Math.max(-maxTravel, Math.min(maxTravel, rr - avgHit));
            this.wheelRR.position.y += (baseWheelY + delta - this.wheelRR.position.y) * suspLerp;
          }

          // Road surface pitch (positive = nose up)
          const frontAvgY = (fl + fr) / 2;
          const rearAvgY = (rl + rr) / 2;
          const targetPitchRoad = Math.atan2(frontAvgY - rearAvgY, WHEELBASE);

          // Road surface roll (positive = tilted right)
          const leftAvgY = (fl + rl) / 2;
          const rightAvgY = (fr + rr) / 2;
          const targetRollRoad = Math.atan2(rightAvgY - leftAvgY, TRACK_WIDTH);

          // Smooth alignment (frame-rate independent)
          const alignFactor = 1 - Math.exp(-10 * dt);
          this._roadPitch += (targetPitchRoad - this._roadPitch) * alignFactor;
          this._roadRoll += (targetRollRoad - this._roadRoll) * alignFactor;
        }
      } else if (hitCount === 0 && !this._airborne && this._velY > LAUNCH_VEL_THRESHOLD) {
        // All rays missed AND we have upward velocity — launch!
        this._airborne = true;
        this._airTime = 0;
        this._airPitch = 0;
      }
    }

    // ── Airborne flight (no road contact — either off-road or all rays missed) ──
    if (this._airborne && !usedRaycast) {
      this._velY -= GRAVITY * dt;
      this.group.position.y += this._velY * dt;
      this._airTime += dt;
      this._airPitch -= 0.4 * dt;

      // Safety: force-land if airborne too long
      if (this._airTime > MAX_AIR_TIME) {
        this._airborne = false;
        this._velY = 0;
        this._airTime = 0;
        this._airPitch = 0;
      }
    }

    if (!usedRaycast && !this._airborne && spline) {
      nearestSpline = bvh
        ? getClosestSplinePoint(spline, this.group.position, bvh)
        : getClosestSplinePoint(spline, this.group.position, 200);

      // Smooth Y tracking for spline fallback
      const splineTargetY = nearestSpline.point.y + this.groundOffset;
      const splineYLerp = 1 - Math.exp(-30 * dt);
      this.group.position.y += (splineTargetY - this.group.position.y) * splineYLerp;

      // Decay road alignment toward neutral when off road mesh
      const decayFactor = 1 - Math.exp(-5 * dt);
      this._roadPitch *= (1 - decayFactor);
      this._roadRoll *= (1 - decayFactor);
    }

    // Emergency floor: safety net only (lowered from -0.5 to -5 to allow deep jumps)
    if (this.group.position.y < -5) {
      this.group.position.y = -5;
      this._velY = 0;
      this._airborne = false;
    }

    // Safety teleport: if car is way too far from track, snap back to nearest spline point
    if (spline && !nearestSpline) {
      nearestSpline = bvh
        ? getClosestSplinePoint(spline, this.group.position, bvh)
        : getClosestSplinePoint(spline, this.group.position, 200);
    }
    if (nearestSpline && nearestSpline.distance > 30) {
      // Car escaped the track — teleport back
      this.group.position.x = nearestSpline.point.x;
      this.group.position.z = nearestSpline.point.z;
      this.group.position.y = nearestSpline.point.y + this.groundOffset;
      this._velX *= 0.5;
      this._velZ *= 0.5;
      this.angularVel = 0;
    }

    // ── Multi-corner barrier collision (4-corner probes) ──
    this.lastBarrierImpact = null; // Clear each frame
    if (spline) {
      if (!nearestSpline) {
        nearestSpline = bvh
          ? getClosestSplinePoint(spline, this.group.position, bvh)
          : getClosestSplinePoint(spline, this.group.position, 200);
      }
      const roadHalfWidth = 6.5; // Tighter — accounts for barrier wall thickness

      // Vehicle corner offsets in local space
      const cornerOffsets = [
        { lx: -0.85, lz: -1.5, zone: 'front' as const },  // Front-Left
        { lx:  0.85, lz: -1.5, zone: 'front' as const },  // Front-Right
        { lx: -0.85, lz:  1.3, zone: 'rear'  as const },  // Rear-Left
        { lx:  0.85, lz:  1.3, zone: 'rear'  as const },  // Rear-Right
      ];

      let worstOvershoot = 0;
      let worstNormalX = 0;
      let worstNormalZ = 0;
      let worstCornerX = 0;
      let worstCornerZ = 0;
      let worstZone: 'front' | 'rear' = 'front';
      let worstSide: 'left' | 'right' = 'left';

      for (const corner of cornerOffsets) {
        // Transform local offset to world space using heading
        const worldX = this.group.position.x + cosH * corner.lx + sinH * corner.lz;
        const worldZ = this.group.position.z - sinH * corner.lx + cosH * corner.lz;

        // Find nearest spline point for this corner
        _temp.set(worldX, this.group.position.y, worldZ);
        const cornerNearest = bvh
          ? getClosestSplinePoint(spline, _temp, bvh)
          : getClosestSplinePoint(spline, _temp, 200);

        // XZ-only distance
        const dx = worldX - cornerNearest.point.x;
        const dz = worldZ - cornerNearest.point.z;
        const xzDist = Math.sqrt(dx * dx + dz * dz);

        if (xzDist > roadHalfWidth) {
          const overshoot = xzDist - roadHalfWidth;
          if (overshoot > worstOvershoot) {
            worstOvershoot = overshoot;
            const invLen = 1 / xzDist;
            worstNormalX = -dx * invLen; // inward
            worstNormalZ = -dz * invLen;
            worstCornerX = worldX;
            worstCornerZ = worldZ;
            worstZone = corner.zone;
            worstSide = corner.lx < 0 ? 'left' : 'right';
          }
        }
      }

      if (worstOvershoot > 0) {
        // How fast the car is approaching the barrier
        const approachSpeed = -(this._velX * worstNormalX + this._velZ * worstNormalZ);

        // Hard clamp: snap car back to road edge (push entire car)
        this.group.position.x += worstNormalX * (worstOvershoot + 0.05);
        this.group.position.z += worstNormalZ * (worstOvershoot + 0.05);

        if (approachSpeed > 0) {
          // Reflect velocity off barrier normal with restitution
          const restitution = 0.3;
          const impulse = approachSpeed * (1 + restitution);
          this._velX += worstNormalX * impulse;
          this._velZ += worstNormalZ * impulse;

          // Friction along the barrier wall (scraping)
          const tangentX = -worstNormalZ;
          const tangentZ = worstNormalX;
          const tangentSpeed = this._velX * tangentX + this._velZ * tangentZ;
          const frictionLoss = Math.min(Math.abs(tangentSpeed) * 0.15, Math.abs(approachSpeed) * 0.5);
          this._velX -= tangentX * frictionLoss * Math.sign(tangentSpeed);
          this._velZ -= tangentZ * frictionLoss * Math.sign(tangentSpeed);

          // Angular velocity kick — corner-specific spin direction
          const cornerLeverage = worstZone === 'front' ? 1 : -1;
          const sideLeverage = worstSide === 'left' ? -1 : 1;
          this.angularVel += cornerLeverage * sideLeverage * approachSpeed * 0.015;
        } else {
          // Sliding along barrier — gentle friction
          this._velX *= 0.95;
          this._velZ *= 0.95;
        }

        // Signal impact to main loop (for sparks, camera shake, damage)
        const impactForce = Math.abs(approachSpeed) * (def.mass / 1000);
        if (impactForce > 2) {
          this.lastBarrierImpact = {
            force: impactForce,
            posX: worstCornerX,
            posY: this.group.position.y + 0.5,
            posZ: worstCornerZ,
            normalX: worstNormalX, normalZ: worstNormalZ,
          };
        }
      }
    }

    // ── Visual rotation (heading + road surface alignment + airborne pitch) ──
    this.group.rotation.y = this.heading;
    this.group.rotation.x = this._roadPitch + this._airPitch;
    this.group.rotation.z = this._roadRoll;

    // Cosmetic body pitch & roll (throttle squat, brake dive, drift lean)
    const targetPitch = -this.throttle * speedRatio * 0.04 + this.brake * speedRatio * 0.06;
    const targetRoll = this.driftAngle * def.suspStiffness * 3;
    const bodyLerp = 1 - Math.exp(-8 * dt);
    this._bodyGroup.rotation.x += (targetPitch - this._bodyGroup.rotation.x) * bodyLerp;
    this._bodyGroup.rotation.z += (targetRoll - this._bodyGroup.rotation.z) * bodyLerp;

    // Drift visual yaw offset
    this._bodyGroup.rotation.y = this.driftAngle * 0.03;


    // ── Wheel spin tracking (for replay recording only — containers are invisible) ──
    this.wheelSpin = (this.wheelSpin + this.speed * dt * 3) % (Math.PI * 2);

    // ── Brake light intensity — DISABLED ──
    // if (this.taillightMatL && this.taillightMatR) {
    //   const brakeGlow = this.brake > 0 ? 5.0 : 1.5;
    //   this.taillightMatL.emissiveIntensity = brakeGlow;
    //   this.taillightMatR.emissiveIntensity = brakeGlow;
    // }
  }

  /** Add nitro from external source (slipstream, near-miss). */
  addNitro(amount: number) {
    this.nitro = Math.min(100, this.nitro + amount);
  }

  /** Whether nitro boost is currently firing. */
  get isNitroActive(): boolean { return this._nitroActive; }

  // flattenTire removed — procedural wheel containers are invisible,
  // so scaling them has no visual effect.

  serializeState(): {
    px: number; py: number; pz: number;
    velX: number; velZ: number;
    heading: number; angularVel: number;
    speed: number; steer: number;
    nitro: number; driftAngle: number;
  } {
    return {
      px: this.group.position.x,
      py: this.group.position.y,
      pz: this.group.position.z,
      velX: this._velX,
      velZ: this._velZ,
      heading: this.heading,
      angularVel: this.angularVel,
      speed: this.speed,
      steer: this.steer,
      nitro: this.nitro,
      driftAngle: this.driftAngle,
    };
  }

  /** Restore vehicle physics state from a rollback snapshot. */
  deserializeState(snap: {
    px: number; py: number; pz: number;
    velX: number; velZ: number;
    heading: number; angularVel: number;
    speed: number; steer: number;
    nitro: number; driftAngle: number;
  }) {
    this.group.position.set(snap.px, snap.py, snap.pz);
    this._velX = snap.velX;
    this._velZ = snap.velZ;
    this.heading = snap.heading;
    this.angularVel = snap.angularVel;
    this.speed = snap.speed;
    this.steer = snap.steer;
    this.nitro = snap.nitro;
    this.driftAngle = snap.driftAngle;
    this.group.rotation.y = snap.heading;
  }

  /** Get current state for network broadcasting. */
  getState(): VehicleState {
    return {
      position: this.group.position.clone(),
      heading: this.heading,
      speed: this.speed,
      steer: this.steer,
      throttle: this.throttle,
      brake: this.brake,
      driftAngle: this.driftAngle,
      engineHeat: this._engineHeat,
    };
  }

  /** Apply state from network. */
  applyState(state: VehicleState) {
    this.group.position.copy(state.position);
    this.heading = state.heading;
    this.speed = state.speed;
    this.steer = state.steer;
    this.driftAngle = state.driftAngle;
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    this._velX = state.speed * sinH;
    this._velZ = state.speed * cosH;
    this.group.rotation.y = this.heading;
  }

  /** Position the vehicle at a point on the spline, facing forward. */
  placeOnTrack(spline: THREE.CatmullRomCurve3, t: number, laneOffset = 0) {
    const pos = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();

    this.group.position.copy(pos);

    if (laneOffset !== 0) {
      _temp.crossVectors(tangent, _up).normalize();
      this.group.position.x += _temp.x * laneOffset;
      this.group.position.z += _temp.z * laneOffset;
    }

    // Snap to road mesh surface if available (avoids floating above road)
    if (this.roadMesh) {
      this.raycaster.set(
        _temp.set(this.group.position.x, this.group.position.y + 10, this.group.position.z),
        _rayDown,
      );
      this.raycaster.far = 25;
      const hits = this.raycaster.intersectObject(this.roadMesh, false);
      if (hits.length > 0) {
        this.group.position.y = hits[0].point.y + this.groundOffset;
      }
    }

    this.heading = Math.atan2(tangent.x, tangent.z);
    this.group.rotation.y = this.heading;
    this.group.rotation.x = 0;
    this.group.rotation.z = 0;
    this.speed = 0;
    this._velX = 0;
    this._velZ = 0;
    this.angularVel = 0;
    this.steer = 0;
    this.driftAngle = 0;
    this._roadPitch = 0;
    this._roadRoll = 0;
    this.nitro = 100;
    this._nitroActive = false;
    this._engineHeat = 0;
    this._engineDead = false;
    this._engineDeadTimer = 0;
    this._engineJustExploded = false;
    this.damage = createDamageState();
    this.detachedZones.clear();
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DAMAGE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Apply collision damage. Determines the hit zone from the impact direction
   * relative to the car's heading, reduces zone HP, and deforms the mesh.
   */
  applyDamage(impactDir: THREE.Vector3, impactForce: number) {
    if (impactForce < 8) return;

    const localDirX = impactDir.x * Math.cos(this.heading) - impactDir.z * Math.sin(this.heading);
    const localDirZ = impactDir.x * Math.sin(this.heading) + impactDir.z * Math.cos(this.heading);

    let zone: 'front' | 'rear' | 'left' | 'right';
    if (Math.abs(localDirZ) > Math.abs(localDirX)) {
      zone = localDirZ > 0 ? 'front' : 'rear';
    } else {
      zone = localDirX > 0 ? 'right' : 'left';
    }

    const dmgAmount = Math.min((impactForce - 8) * 1.2, 35);
    this.damage[zone].hp = Math.max(0, this.damage[zone].hp - dmgAmount);
    this.damage[zone].deformAmount += dmgAmount;

    this.deformMesh(impactDir, impactForce);
    this.applyMaterialDamage(zone);

    // Detach a part when zone reaches 0 HP
    if (this.damage[zone].hp <= 0 && !this.detachedZones.has(zone)) {
      this.detachedZones.add(zone);
    }
  }

  /** Progressively darken and roughen materials on the damaged zone. */
  private applyMaterialDamage(zone: 'front' | 'rear' | 'left' | 'right') {
    if (!this.model) return;
    const severity = 1 - this.damage[zone].hp / 100; // 0 = pristine, 1 = destroyed

    this.model.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat.color) return;

      // Only affect meshes whose center falls in the damaged zone
      const localZ = mesh.position.z;
      const localX = mesh.position.x;
      let inZone = false;
      if (zone === 'front' && localZ < -0.5) inZone = true;
      else if (zone === 'rear' && localZ > 0.5) inZone = true;
      else if (zone === 'left' && localX < -0.3) inZone = true;
      else if (zone === 'right' && localX > 0.3) inZone = true;

      if (!inZone) return;

      // Darken color toward grey based on absolute damage (not compounding)
      const darkFactor = Math.max(0.5, 1 - severity * 0.4);
      const hsl = { h: 0, s: 0, l: 0 };
      mat.color.getHSL(hsl);
      mat.color.setHSL(hsl.h, hsl.s * darkFactor, Math.max(hsl.l * darkFactor, 0.15));

      // Increase roughness (fresh paint → scraped metal)
      mat.roughness = Math.min(0.3 + severity * 0.6, 0.9);

      // Reduce metalness slightly (paint loss)
      mat.metalness = Math.max(0.1, (mat.metalness || 0.5) - severity * 0.2);
    });
  }

  /** Create a detached part mesh for a destroyed zone. Returns null if already detached. */
  createDetachedPart(zone: string): THREE.Mesh | null {
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    const pos = this.group.position;

    // Part dimensions and offsets per zone
    const parts: Record<string, { w: number; h: number; d: number; ox: number; oy: number; oz: number; color: number }> = {
      front: { w: 2.0, h: 0.08, d: 1.2, ox: 0, oy: 0.8, oz: -2.2, color: 0x888899 },
      rear:  { w: 1.8, h: 0.3, d: 0.4, ox: 0, oy: 0.5, oz: 2.0, color: 0x666677 },
      left:  { w: 0.08, h: 0.8, d: 1.6, ox: -1.0, oy: 0.6, oz: 0, color: 0x777788 },
      right: { w: 0.08, h: 0.8, d: 1.6, ox: 1.0, oy: 0.6, oz: 0, color: 0x777788 },
    };

    const p = parts[zone];
    if (!p) return null;

    const geo = new THREE.BoxGeometry(p.w, p.h, p.d);
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.6, metalness: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);

    // World position from car position + rotated local offset
    mesh.position.set(
      pos.x + cosH * p.ox + sinH * p.oz,
      pos.y + p.oy,
      pos.z - sinH * p.ox + cosH * p.oz,
    );
    mesh.rotation.y = this.heading + (Math.random() - 0.5) * 0.5;

    return mesh;
  }

  // Pooled temps for deformMesh (avoid per-collision allocations)
  private static _deformInvMat = new THREE.Matrix4();
  private static _deformLocalImpact = new THREE.Vector3();
  private static _deformLocalDir = new THREE.Vector3();
  private static _deformWorldImpact = new THREE.Vector3();

  /** Displace mesh vertices near the impact for visual crumple.
   * Permanent CPU-side deformation — vertices are moved and never restored.
   * Uses quadratic falloff with directional asymmetry and inward crush bias
   * for realistic crumple patterns.
   */
  private deformMesh(impactDir: THREE.Vector3, force: number) {
    if (!this.model) return;

    // Force-scaled radius: bigger hits affect a larger area
    const radius = Math.min(1.5 + force * 0.04, 3.5);
    const strength = force * 0.012;
    const maxDeformPerVertex = 1.2; // cap total displacement per vertex
    Vehicle._deformWorldImpact.copy(this.group.position).addScaledVector(impactDir, 2.5);

    // Determine dominant impact axis for directional asymmetry
    const absImpX = Math.abs(impactDir.x);
    const absImpZ = Math.abs(impactDir.z);
    const isFrontal = absImpZ > absImpX; // front/rear vs side hit

    this.model.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      const posAttr = mesh.geometry?.attributes?.position;
      if (!posAttr) return;

      const positions = posAttr.array as Float32Array;
      Vehicle._deformInvMat.copy(mesh.matrixWorld).invert();
      Vehicle._deformLocalImpact.copy(Vehicle._deformWorldImpact).applyMatrix4(Vehicle._deformInvMat);
      Vehicle._deformLocalDir.copy(impactDir).transformDirection(Vehicle._deformInvMat);
      const localImpact = Vehicle._deformLocalImpact;
      const localDir = Vehicle._deformLocalDir;

      let changed = false;
      const vertCount = positions.length / 3;
      for (let i = 0; i < vertCount; i++) {
        const idx = i * 3;
        const dx = positions[idx] - localImpact.x;
        const dy = positions[idx + 1] - localImpact.y;
        const dz = positions[idx + 2] - localImpact.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < radius) {
          const falloff = (1 - dist / radius) * (1 - dist / radius);
          const deform = Math.min(strength * falloff, maxDeformPerVertex);

          // Directional asymmetry: frontal hits compress Z more, side hits compress X more
          const xScale = isFrontal ? 0.25 : 0.6;
          const zScale = isFrontal ? 0.6 : 0.25;

          // Inward crush bias: vertices push toward car center (0,0,0 in local space)
          const crushX = -positions[idx] * deform * 0.15;
          const crushZ = -positions[idx + 2] * deform * 0.15;

          // Asymmetric noise for natural crumple
          const nx = (Math.random() - 0.5) * deform * 0.35;
          const ny = (Math.random() - 0.3) * deform * 0.2; // slightly downward bias
          const nz = (Math.random() - 0.5) * deform * 0.35;

          positions[idx]     += localDir.x * deform * xScale + crushX + nx;
          positions[idx + 1] += localDir.y * deform * 0.3 + ny;
          positions[idx + 2] += localDir.z * deform * zScale + crushZ + nz;
          changed = true;
        }
      }

      if (changed) {
        posAttr.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
    });
  }
}

