/* ── Hood Racer — P2P Networking (PeerJS + Binary Protocol) ── */

import Peer, { DataConnection } from 'peerjs';
import { PacketType, EventType } from './types';

const BROADCAST_HZ = 20; // 50ms interval
const INTERP_DELAY = 80; // ms behind real-time

export interface StateSnapshot {
  x: number;
  z: number;
  heading: number;
  speed: number;
  time: number;
}

export interface RemotePlayer {
  id: string;
  conn: DataConnection;
  buffer: StateSnapshot[];
  name: string;
  carId: string;
}

type StateCallback = (fromId: string, snap: StateSnapshot) => void;
type EventCallback = (fromId: string, type: EventType, data: any) => void;

export class NetPeer {
  private peer: Peer | null = null;
  private connections = new Map<string, RemotePlayer>();
  private isHost = false;
  private roomId = '';
  private localId = '';

  onState: StateCallback = () => {};
  onEvent: EventCallback = () => {};
  onPlayerJoin: (id: string, name: string) => void = () => {};
  onPlayerLeave: (id: string) => void = () => {};

  private broadcastInterval: number | null = null;
  private statePacketBuffer = new ArrayBuffer(13);
  private stateView = new DataView(this.statePacketBuffer);

  /** Create a room (host). Returns the room code. */
  async createRoom(): Promise<string> {
    this.isHost = true;
    this.roomId = generateRoomCode();
    const peerId = `hoodracer-${this.roomId}`;

    await this.initPeer(peerId);

    this.peer!.on('connection', (conn) => {
      conn.on('open', () => {
        const remote: RemotePlayer = {
          id: conn.peer,
          conn,
          buffer: [],
          name: conn.metadata?.name || 'Racer',
          carId: conn.metadata?.carId || '',
        };
        this.connections.set(conn.peer, remote);
        this.onPlayerJoin(conn.peer, remote.name);

        conn.on('data', (data) => this.handleData(conn.peer, data));
        conn.on('close', () => this.handleDisconnect(conn.peer));
      });
    });

    return this.roomId;
  }

  /** Join a room (guest). */
  async joinRoom(roomCode: string, name: string, carId: string): Promise<void> {
    this.isHost = false;
    this.roomId = roomCode;
    const guestId = `hoodracer-guest-${Date.now().toString(36)}`;

    await this.initPeer(guestId);

    const hostPeerId = `hoodracer-${roomCode}`;
    const conn = this.peer!.connect(hostPeerId, {
      reliable: true,
      serialization: 'binary',
      metadata: { name, carId },
    });

    return new Promise((resolve, reject) => {
      conn.on('open', () => {
        const remote: RemotePlayer = {
          id: conn.peer,
          conn,
          buffer: [],
          name: 'Host',
          carId: '',
        };
        this.connections.set(conn.peer, remote);
        this.onPlayerJoin(conn.peer, 'Host');

        conn.on('data', (data) => this.handleData(conn.peer, data));
        conn.on('close', () => this.handleDisconnect(conn.peer));

        resolve();
      });

      conn.on('error', (err) => reject(err));
      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });
  }

  private initPeer(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.peer = new Peer(id, { debug: 0 });
      this.peer.on('open', (openId) => {
        this.localId = openId;
        resolve();
      });
      this.peer.on('error', (err) => reject(err));
    });
  }

  /** Start broadcasting state at 20Hz. */
  startBroadcasting(getState: () => { x: number; z: number; heading: number; speed: number }) {
    if (this.broadcastInterval) return;

    this.broadcastInterval = window.setInterval(() => {
      const state = getState();
      this.broadcastState(state);
    }, 1000 / BROADCAST_HZ);
  }

  stopBroadcasting() {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
  }

  /** Send compact 13-byte state packet. */
  private broadcastState(state: { x: number; z: number; heading: number; speed: number }) {
    const view = this.stateView;
    view.setUint8(0, PacketType.STATE);
    view.setFloat32(1, state.x, true);
    view.setFloat32(5, state.z, true);
    view.setInt16(9, Math.round(state.heading * 1000), true);
    view.setUint16(11, Math.round(Math.abs(state.speed) * 1000), true);

    for (const remote of this.connections.values()) {
      try {
        remote.conn.send(this.statePacketBuffer);
      } catch { /* swallow send errors */ }
    }

    // Host relay: re-broadcast to other guests
    if (this.isHost && this.connections.size > 1) {
      this.relayState(this.localId, state);
    }
  }

  /** Host: relay a guest's state to all other guests. */
  private relayState(fromId: string, state: { x: number; z: number; heading: number; speed: number }) {
    const idBytes = new TextEncoder().encode(fromId);
    const buf = new ArrayBuffer(1 + 1 + idBytes.length + 12);
    const view = new DataView(buf);
    view.setUint8(0, PacketType.STATE_RELAY);
    view.setUint8(1, idBytes.length);
    new Uint8Array(buf, 2, idBytes.length).set(idBytes);

    const offset = 2 + idBytes.length;
    view.setFloat32(offset, state.x, true);
    view.setFloat32(offset + 4, state.z, true);
    view.setInt16(offset + 8, Math.round(state.heading * 1000), true);
    view.setUint16(offset + 10, Math.round(Math.abs(state.speed) * 1000), true);

    for (const [id, remote] of this.connections) {
      if (id !== fromId) {
        try { remote.conn.send(buf); } catch {}
      }
    }
  }

  /** Send a game event. */
  broadcastEvent(type: EventType, data: any = {}) {
    const json = JSON.stringify({ type, ...data });
    const jsonBytes = new TextEncoder().encode(json);
    const buf = new ArrayBuffer(2 + jsonBytes.length);
    new DataView(buf).setUint8(0, PacketType.EVENT);
    new DataView(buf).setUint8(1, type);
    new Uint8Array(buf, 2).set(jsonBytes);

    for (const remote of this.connections.values()) {
      try { remote.conn.send(buf); } catch {}
    }
  }

  private handleData(fromId: string, data: unknown) {
    if (!(data instanceof ArrayBuffer)) return;
    const view = new DataView(data);
    const packetType = view.getUint8(0);

    switch (packetType) {
      case PacketType.STATE: {
        const snap: StateSnapshot = {
          x: view.getFloat32(1, true),
          z: view.getFloat32(5, true),
          heading: view.getInt16(9, true) / 1000,
          speed: view.getUint16(11, true) / 1000,
          time: performance.now(),
        };
        this.onState(fromId, snap);

        // Host relay
        if (this.isHost) {
          this.relayState(fromId, snap);
        }
        break;
      }

      case PacketType.EVENT: {
        const eventType = view.getUint8(1) as EventType;
        const jsonBytes = new Uint8Array(data, 2);
        const json = new TextDecoder().decode(jsonBytes);
        try {
          const eventData = JSON.parse(json);
          this.onEvent(fromId, eventType, eventData);

          // Host relay events to all other guests
          if (this.isHost) {
            for (const [id, remote] of this.connections) {
              if (id !== fromId) {
                try { remote.conn.send(data); } catch {}
              }
            }
          }
        } catch {}
        break;
      }

      case PacketType.STATE_RELAY: {
        const idLen = view.getUint8(1);
        const idBytes = new Uint8Array(data, 2, idLen);
        const actualFromId = new TextDecoder().decode(idBytes);

        const offset = 2 + idLen;
        const snap: StateSnapshot = {
          x: view.getFloat32(offset, true),
          z: view.getFloat32(offset + 4, true),
          heading: view.getInt16(offset + 8, true) / 1000,
          speed: view.getUint16(offset + 10, true) / 1000,
          time: performance.now(),
        };
        this.onState(actualFromId, snap);
        break;
      }
    }
  }

  private handleDisconnect(peerId: string) {
    this.connections.delete(peerId);
    this.onPlayerLeave(peerId);
  }

  /** Get interpolated state for a remote player. */
  getInterpolatedState(id: string): StateSnapshot | null {
    const remote = this.connections.get(id);
    if (!remote || remote.buffer.length < 2) {
      return remote?.buffer[remote.buffer.length - 1] ?? null;
    }

    const renderTime = performance.now() - INTERP_DELAY;
    const buf = remote.buffer;

    // Find surrounding snapshots
    let s0: StateSnapshot | null = null;
    let s1: StateSnapshot | null = null;
    for (let i = buf.length - 1; i >= 1; i--) {
      if (buf[i - 1].time <= renderTime && buf[i].time >= renderTime) {
        s0 = buf[i - 1];
        s1 = buf[i];
        break;
      }
    }

    if (!s0 || !s1) return buf[buf.length - 1];

    const t = (renderTime - s0.time) / (s1.time - s0.time);
    return {
      x: s0.x + (s1.x - s0.x) * t,
      z: s0.z + (s1.z - s0.z) * t,
      heading: lerpAngle(s0.heading, s1.heading, t),
      speed: s0.speed + (s1.speed - s0.speed) * t,
      time: renderTime,
    };
  }

  /** Add a state snapshot to a remote player's buffer. */
  addToBuffer(id: string, snap: StateSnapshot) {
    let remote = this.connections.get(id);
    if (!remote) {
      // Create stub for late-joining players
      remote = { id, conn: null as any, buffer: [], name: 'Racer', carId: '' };
      this.connections.set(id, remote);
    }
    remote.buffer.push(snap);
    // Cap buffer at 10 snapshots
    if (remote.buffer.length > 10) {
      remote.buffer.splice(0, remote.buffer.length - 10);
    }
  }

  getConnectedIds(): string[] {
    return Array.from(this.connections.keys());
  }

  getRemotePlayers(): RemotePlayer[] {
    return Array.from(this.connections.values());
  }

  getRoomId() { return this.roomId; }
  getLocalId() { return this.localId; }
  getIsHost() { return this.isHost; }
  getConnectionCount() { return this.connections.size; }

  destroy() {
    this.stopBroadcasting();
    for (const remote of this.connections.values()) {
      remote.conn?.close();
    }
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
