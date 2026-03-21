/* ── IRL Race — Typed Event Bus ──
 *
 * Zero-dependency pub/sub for decoupling game systems.
 * Producers (physics, race engine) emit events.
 * Consumers (audio, VFX, HUD, network) subscribe.
 *
 * Usage:
 *   import { bus } from './event-bus';
 *   bus.on('checkpoint', (e) => playCheckpointSFX());     // consumer
 *   bus.emit('checkpoint', { racerId: 'local', index: 3 }); // producer
 */

// ── Event type definitions ──

export interface GameEvents {
  /** Player or AI crossed a checkpoint gate */
  checkpoint: { racerId: string; index: number; lap: number };

  /** Player or AI completed a lap */
  lap: { racerId: string; lapIndex: number; lapTime: number; isBest: boolean };

  /** Race finished for a racer */
  finish: { racerId: string; finishTime: number };

  /** Car-to-car collision occurred */
  collision: {
    aId: string;
    bId: string;
    impactForce: number;
    contactX: number;
    contactY: number;
    contactZ: number;
  };

  /** Vehicle is drifting */
  drift: { racerId: string; angle: number; x: number; y: number; z: number };

  /** Vehicle position/rank changed */
  position_change: { racerId: string; oldRank: number; newRank: number; gained: boolean };

  /** Race state transition */
  state_change: { from: number; to: number };

  /** Damage sustained */
  damage: { racerId: string; zone: string; hp: number; x: number; y: number; z: number };

  /** Nitro state change */
  nitro: { racerId: string; amount: number; active: boolean };

  /** Speed update (for engine audio) */
  speed: { racerId: string; speed: number; rpm: number };

  /** Mid-race reward awarded */
  mid_race_reward: { type: string; nitro: number; credits: number; xp: number; combo: number; jackpot: boolean };
}

// ── Generic typed event bus ──

type Listener<T> = (data: T) => void;

class EventBus<T extends Record<string, any>> {
  private listeners = new Map<keyof T, Set<Listener<any>>>();
  private onceListeners = new Map<keyof T, Set<Listener<any>>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof T>(event: K, fn: Listener<T[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  /** Subscribe to an event, auto-unsubscribe after first call. */
  once<K extends keyof T>(event: K, fn: Listener<T[K]>): () => void {
    let set = this.onceListeners.get(event);
    if (!set) { set = new Set(); this.onceListeners.set(event, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  /** Emit an event with typed payload. */
  emit<K extends keyof T>(event: K, data: T[K]): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const fn of listeners) fn(data);
    }

    const onceListeners = this.onceListeners.get(event);
    if (onceListeners) {
      for (const fn of onceListeners) fn(data);
      onceListeners.clear();
    }
  }

  /** Remove all listeners for an event, or all events if no key given. */
  off<K extends keyof T>(event?: K): void {
    if (event) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
    }
  }

  /** Number of active listeners across all events (for debugging). */
  get listenerCount(): number {
    let count = 0;
    for (const set of this.listeners.values()) count += set.size;
    for (const set of this.onceListeners.values()) count += set.size;
    return count;
  }
}

/** Global game event bus — import this everywhere. */
export const bus = new EventBus<GameEvents>();
