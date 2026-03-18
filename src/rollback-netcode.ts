/* ── Hood Racer — Rollback Netcode ──
 *
 * Input-based rollback synchronization for multiplayer racing.
 *
 * Instead of broadcasting positions every 50ms, each peer broadcasts
 * its inputs every physics frame. The local simulation predicts remote
 * vehicles using their last-known inputs. When a delayed input arrives
 * that contradicts the prediction, the system:
 *   1. Rolls back to the confirmed state snapshot
 *   2. Replays all frames with corrected inputs
 *   3. Fast-forwards to the present
 *
 * ─── Key Design Choices ───
 * • Ring buffers (128 frames) for inputs and snapshots
 * • Last-input prediction (assume remote repeats their last input)
 * • Max rollback window: 8 frames (~133ms at 60Hz)
 * • Existing state broadcast kept as reconciliation fallback
 */

import type { InputState } from './types';
import { PHYSICS_HZ } from './game-context';

// ── Constants ──
const BUFFER_SIZE = 128;
const MAX_ROLLBACK_FRAMES = 8;

// ── Packed Input ──
// 5 bits: up(0), down(1), left(2), right(3), boost(4)
// + 16-bit signed steerAnalog (-10000..10000)

export function packInput(input: InputState): { bits: number; steerI16: number } {
  let bits = 0;
  if (input.up) bits |= 1;
  if (input.down) bits |= 2;
  if (input.left) bits |= 4;
  if (input.right) bits |= 8;
  if (input.boost) bits |= 16;
  const steerI16 = Math.round(Math.max(-1, Math.min(1, input.steerAnalog)) * 10000);
  return { bits, steerI16 };
}

export function unpackInput(bits: number, steerI16: number): InputState {
  return {
    up: (bits & 1) !== 0,
    down: (bits & 2) !== 0,
    left: (bits & 4) !== 0,
    right: (bits & 8) !== 0,
    boost: (bits & 16) !== 0,
    steerAnalog: steerI16 / 10000,
  };
}

// ── Vehicle Snapshot ──
export interface VehicleSnapshot {
  px: number; py: number; pz: number;
  velX: number; velZ: number;
  heading: number;
  angularVel: number;
  speed: number;
  steer: number;
  nitro: number;
  driftAngle: number;
}

// ── Frame State ──
interface FrameRecord {
  frame: number;
  localInput: InputState;
  remoteInputs: Map<string, InputState>;   // peerId → input
  snapshot: VehicleSnapshot | null;        // local vehicle state BEFORE this frame's update
  confirmed: boolean;                     // all remote inputs received for this frame
}

// ── Rollback Manager ──
export class RollbackManager {
  private buffer: (FrameRecord | null)[] = new Array(BUFFER_SIZE).fill(null);
  private currentFrame = 0;
  private _rollbacksThisSecond = 0;
  private _rollbackResetTimer = 0;

  // Last known input per remote peer (for prediction)
  private lastConfirmedInput = new Map<string, InputState>();

  // Track which peers are in the session
  private remotePeerIds = new Set<string>();

  // Callback: called when rollback + resimulation is needed
  onRollback: ((fromFrame: number, toFrame: number) => void) | null = null;

  get frame(): number { return this.currentFrame; }
  get rollbacksPerSecond(): number { return this._rollbacksThisSecond; }

  reset() {
    this.buffer.fill(null);
    this.currentFrame = 0;
    this.lastConfirmedInput.clear();
    this.remotePeerIds.clear();
    this._rollbacksThisSecond = 0;
    this._rollbackResetTimer = 0;
  }

  addRemotePeer(id: string) {
    this.remotePeerIds.add(id);
  }

  removeRemotePeer(id: string) {
    this.remotePeerIds.delete(id);
    this.lastConfirmedInput.delete(id);
  }

  /** Record local input and vehicle snapshot for the current frame. */
  recordLocalFrame(input: InputState, snapshot: VehicleSnapshot) {
    const idx = this.currentFrame % BUFFER_SIZE;
    let record = this.buffer[idx];

    if (!record || record.frame !== this.currentFrame) {
      record = {
        frame: this.currentFrame,
        localInput: { ...input },
        remoteInputs: new Map(),
        snapshot,
        confirmed: this.remotePeerIds.size === 0,
      };
      this.buffer[idx] = record;
    } else {
      record.localInput = { ...input };
      record.snapshot = snapshot;
    }
  }

  /** Advance the frame counter. Call after physics step. */
  advanceFrame() {
    this.currentFrame++;

    // Rollback counter decay (once per second)
    this._rollbackResetTimer++;
    if (this._rollbackResetTimer >= PHYSICS_HZ) {
      this._rollbacksThisSecond = 0;
      this._rollbackResetTimer = 0;
    }
  }

  /** Receive a remote input for a specific frame. Returns true if rollback is needed. */
  receiveRemoteInput(peerId: string, frame: number, input: InputState): boolean {
    // Update last-known input for prediction
    this.lastConfirmedInput.set(peerId, { ...input });

    const idx = frame % BUFFER_SIZE;
    let record = this.buffer[idx];

    // Frame is too old — already evicted from buffer
    if (!record || record.frame !== frame) {
      // If it's a future frame, pre-allocate
      if (frame >= this.currentFrame) {
        record = {
          frame,
          localInput: { up: false, down: false, left: false, right: false, boost: false, steerAnalog: 0 },
          remoteInputs: new Map(),
          snapshot: null,
          confirmed: false,
        };
        this.buffer[idx] = record;
      } else {
        return false; // Too old, ignore
      }
    }

    record.remoteInputs.set(peerId, { ...input });

    // Check if all remote inputs are confirmed
    let allConfirmed = true;
    for (const pid of this.remotePeerIds) {
      if (!record.remoteInputs.has(pid)) {
        allConfirmed = false;
        break;
      }
    }
    record.confirmed = allConfirmed;

    // Rollback needed if this input is for a past frame
    if (frame < this.currentFrame) {
      const framesBack = this.currentFrame - frame;
      if (framesBack <= MAX_ROLLBACK_FRAMES) {
        this._rollbacksThisSecond++;
        return true;
      }
    }

    return false;
  }

  /** Get the predicted input for a remote peer at a given frame. */
  getRemoteInput(peerId: string, frame: number): InputState {
    const idx = frame % BUFFER_SIZE;
    const record = this.buffer[idx];

    if (record && record.frame === frame) {
      const confirmed = record.remoteInputs.get(peerId);
      if (confirmed) return confirmed;
    }

    // Predict: use last confirmed input
    return this.lastConfirmedInput.get(peerId) ?? {
      up: false, down: false, left: false, right: false,
      boost: false, steerAnalog: 0,
    };
  }

  /** Get the local input recorded at a given frame (for resimulation). */
  getLocalInput(frame: number): InputState {
    const idx = frame % BUFFER_SIZE;
    const record = this.buffer[idx];
    if (record && record.frame === frame) {
      return record.localInput;
    }
    return { up: false, down: false, left: false, right: false, boost: false, steerAnalog: 0 };
  }

  /** Get the vehicle snapshot saved at a given frame (for rollback restore). */
  getSnapshot(frame: number): VehicleSnapshot | null {
    const idx = frame % BUFFER_SIZE;
    const record = this.buffer[idx];
    if (record && record.frame === frame) {
      return record.snapshot;
    }
    return null;
  }

  /**
   * Build the list of frames to resimulate after receiving a late input.
   * Returns [startFrame, endFrame) range, or null if no rollback needed.
   */
  getRollbackRange(lateFrame: number): { start: number; end: number } | null {
    if (lateFrame >= this.currentFrame) return null;

    const framesBack = this.currentFrame - lateFrame;
    if (framesBack > MAX_ROLLBACK_FRAMES) return null;

    // Verify we have a snapshot to restore
    if (!this.getSnapshot(lateFrame)) return null;

    return { start: lateFrame, end: this.currentFrame };
  }
}

// ── Singleton ──
export const rollbackManager = new RollbackManager();
