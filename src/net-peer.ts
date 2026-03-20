/* ── IRL Race — P2P Networking (PeerJS + Binary Protocol) ── */

import Peer, { DataConnection } from 'peerjs';
import { PacketType, EventType } from './types';

const BROADCAST_HZ = 20;
const INTERP_DELAY = 80; // ms behind real-time
const MAX_PLAYERS = 6;
const _encoder = new TextEncoder();
const _decoder = new TextDecoder();

export interface StateSnapshot {
  x: number;
  z: number;
  heading: number;
  speed: number;
  time: number;
  // Damage HP per zone (transmitted in state packets)
  dmgFront?: number;
  dmgRear?: number;
  dmgLeft?: number;
  dmgRight?: number;
}

export interface RemotePlayer {
  id: string;
  conn: DataConnection;
  buffer: StateSnapshot[];
  name: string;
  carId: string;
  rtt: number;
  ready: boolean;
}

type StateCallback = (fromId: string, snap: StateSnapshot) => void;
type EventCallback = (fromId: string, type: EventType, data: any) => void;
type InputCallback = (fromId: string, frame: number, inputBits: number, steerI16: number) => void;

export class NetPeer {
  private peer: Peer | null = null;
  private connections = new Map<string, RemotePlayer>();
  private isHost = false;
  private roomId = '';
  private localId = '';

  onState: StateCallback = () => {};
  onEvent: EventCallback = () => {};
  onInput: InputCallback = () => {};
  onPlayerJoin: (id: string, name: string) => void = () => {};
  onPlayerLeave: (id: string, name?: string) => void = () => {};
  onReconnecting: (id: string, name: string) => void = () => {};
  onReconnected: (id: string, name: string) => void = () => {};

  private broadcastInterval: number | null = null;
  private pingInterval: number | null = null;
  private heartbeatInterval: number | null = null;
  private lastSeen = new Map<string, number>();
  // 19-byte state packet: 15B position/heading/speed + 4B damage HP
  private statePacketBuffer = new ArrayBuffer(19);
  private stateView = new DataView(this.statePacketBuffer);
  private pendingReconnect = new Map<string, { name: string; timer: number; retries: number }>();
  private reconnectInterval: number | null = null;

  /** Create a room (host). Returns the room code. */
  async createRoom(): Promise<string> {
    this.isHost = true;

    // Try up to 3 room codes in case of collision
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      this.roomId = generateRoomCode();
      const peerId = `irlrace-${this.roomId}`;
      try {
        await this.initPeer(peerId);
        break;
      } catch (err) {
        lastError = err as Error;
        // Clean up failed peer before retrying
        this.peer?.destroy();
        this.peer = null;
      }
    }

    if (!this.peer) throw lastError ?? new Error('Failed to create room');

    this.peer!.on('connection', (conn) => {
      // Enforce max player cap
      if (this.connections.size >= MAX_PLAYERS - 1) {
        conn.on('open', () => conn.close());
        return;
      }

      conn.on('open', () => {
        // Force raw binary mode on host side to match guest's serialization: 'raw'
        (conn as any).serialization = 'raw';

        const remote: RemotePlayer = {
          id: conn.peer,
          conn,
          buffer: [],
          name: conn.metadata?.name || 'Racer',
          carId: conn.metadata?.carId || '',
          rtt: 0,
          ready: false,
        };
        this.connections.set(conn.peer, remote);
        this.lastSeen.set(conn.peer, performance.now());
        this.onPlayerJoin(conn.peer, remote.name);

        conn.on('data', (data) => this.handleData(conn.peer, data));
        conn.on('close', () => this.handleGracefulDisconnect(conn.peer));
      });
    });

    return this.roomId;
  }

  /** Join a room (guest). */
  async joinRoom(roomCode: string, name: string, carId: string): Promise<void> {
    this.isHost = false;
    this.roomId = roomCode;
    const guestId = `irlrace-guest-${Date.now().toString(36)}`;

    await this.initPeer(guestId);

    const hostPeerId = `irlrace-${roomCode}`;
    const conn = this.peer!.connect(hostPeerId, {
      reliable: true,
      serialization: 'raw',
      metadata: { name, carId },
    });

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('Connection timeout')), 10000);

      conn.on('open', () => {
        clearTimeout(timeoutId);
        const remote: RemotePlayer = {
          id: conn.peer,
          conn,
          buffer: [],
          name: 'Host',
          carId: '',
          rtt: 0,
          ready: false,
        };
        this.connections.set(conn.peer, remote);
        this.onPlayerJoin(conn.peer, 'Host');

        conn.on('data', (data) => this.handleData(conn.peer, data));
        conn.on('close', () => this.handleGracefulDisconnect(conn.peer));

        resolve();
      });

      conn.on('error', (err) => { clearTimeout(timeoutId); reject(err); });
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
  startBroadcasting(getState: () => {
    x: number; z: number; heading: number; speed: number;
    dmgFront?: number; dmgRear?: number; dmgLeft?: number; dmgRight?: number;
  }) {
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

  /** Send 19-byte state packet: position + heading + speed + damage. */
  private broadcastState(state: {
    x: number; z: number; heading: number; speed: number;
    dmgFront?: number; dmgRear?: number; dmgLeft?: number; dmgRight?: number;
  }) {
    const view = this.stateView;
    view.setUint8(0, PacketType.STATE);
    view.setFloat32(1, state.x, true);
    view.setFloat32(5, state.z, true);
    const normHeading = ((state.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    view.setUint16(9, Math.round(normHeading * 10000), true);
    view.setFloat32(11, state.speed, true);
    view.setUint8(15, Math.round(state.dmgFront ?? 100));
    view.setUint8(16, Math.round(state.dmgRear ?? 100));
    view.setUint8(17, Math.round(state.dmgLeft ?? 100));
    view.setUint8(18, Math.round(state.dmgRight ?? 100));

    for (const remote of this.connections.values()) {
      if (!remote.conn) continue; // buffer-only placeholder (Bug #2 fix)
      try { remote.conn.send(this.statePacketBuffer); } catch {}
    }

    // FIX: Do NOT relay host's own state — guests already received it directly
  }

  /** Send 8-byte input packet: [type(u8), frame(u32), bits(u8), steerI16(i16)] */
  broadcastInput(frameNumber: number, inputBits: number, steerI16: number) {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint8(0, PacketType.INPUT);
    view.setUint32(1, frameNumber, true);
    view.setUint8(5, inputBits);
    view.setInt16(6, steerI16, true);

    for (const remote of this.connections.values()) {
      try { remote.conn.send(buf); } catch {}
    }
  }

  /** Host: relay an input packet embedding the original sender ID. */
  private relayInput(fromId: string, frameNumber: number, inputBits: number, steerI16: number) {
    const idBytes = _encoder.encode(fromId);
    const buf = new ArrayBuffer(1 + 1 + idBytes.length + 7);
    const view = new DataView(buf);
    view.setUint8(0, PacketType.INPUT_RELAY);
    view.setUint8(1, idBytes.length);
    new Uint8Array(buf, 2, idBytes.length).set(idBytes);
    const offset = 2 + idBytes.length;
    view.setUint32(offset, frameNumber, true);
    view.setUint8(offset + 4, inputBits);
    view.setInt16(offset + 5, steerI16, true);

    for (const [id, remote] of this.connections) {
      if (id !== fromId) {
        try { remote.conn.send(buf); } catch {}
      }
    }
  }

  /** Host: relay a guest's state to all other guests. */
  private relayState(fromId: string, state: {
    x: number; z: number; heading: number; speed: number;
    dmgFront?: number; dmgRear?: number; dmgLeft?: number; dmgRight?: number;
  }) {
    const idBytes = _encoder.encode(fromId);
    const buf = new ArrayBuffer(1 + 1 + idBytes.length + 18);
    const view = new DataView(buf);
    view.setUint8(0, PacketType.STATE_RELAY);
    view.setUint8(1, idBytes.length);
    new Uint8Array(buf, 2, idBytes.length).set(idBytes);

    const offset = 2 + idBytes.length;
    view.setFloat32(offset, state.x, true);
    view.setFloat32(offset + 4, state.z, true);
    const normHeading = ((state.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    view.setUint16(offset + 8, Math.round(normHeading * 10000), true);
    view.setFloat32(offset + 10, state.speed, true);
    view.setUint8(offset + 14, Math.round(state.dmgFront ?? 100));
    view.setUint8(offset + 15, Math.round(state.dmgRear ?? 100));
    view.setUint8(offset + 16, Math.round(state.dmgLeft ?? 100));
    view.setUint8(offset + 17, Math.round(state.dmgRight ?? 100));

    for (const [id, remote] of this.connections) {
      if (id !== fromId) {
        try { remote.conn.send(buf); } catch {}
      }
    }
  }

  /** Send a game event. */
  broadcastEvent(type: EventType, data: any = {}) {
    const json = JSON.stringify({ type, ...data });
    const jsonBytes = _encoder.encode(json);
    const buf = new ArrayBuffer(2 + jsonBytes.length);
    new DataView(buf).setUint8(0, PacketType.EVENT);
    new DataView(buf).setUint8(1, type);
    new Uint8Array(buf, 2).set(jsonBytes);

    for (const remote of this.connections.values()) {
      try { remote.conn.send(buf); } catch {}
    }
  }

  /** Host: relay an event embedding the original sender ID. */
  private relayEvent(fromId: string, eventType: number, jsonBytes: Uint8Array) {
    const idBytes = _encoder.encode(fromId);
    const buf = new ArrayBuffer(1 + 1 + idBytes.length + 1 + jsonBytes.length);
    const view = new DataView(buf);
    view.setUint8(0, PacketType.EVENT_RELAY);
    view.setUint8(1, idBytes.length);
    new Uint8Array(buf, 2, idBytes.length).set(idBytes);
    view.setUint8(2 + idBytes.length, eventType);
    new Uint8Array(buf, 3 + idBytes.length).set(jsonBytes);

    for (const [id, remote] of this.connections) {
      if (id !== fromId) {
        try { remote.conn.send(buf); } catch {}
      }
    }
  }

  private handleData(fromId: string, rawData: unknown) {
    // Normalize: browsers/PeerJS may deliver ArrayBuffer, Uint8Array, or Blob
    if (rawData instanceof Blob) {
      rawData.arrayBuffer().then(ab => this.processPacket(fromId, ab));
      return;
    }
    let data: ArrayBuffer;
    if (rawData instanceof ArrayBuffer) {
      data = rawData;
    } else if (rawData instanceof Uint8Array) {
      data = rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength) as ArrayBuffer;
    } else if (ArrayBuffer.isView(rawData)) {
      const v = rawData as ArrayBufferView;
      data = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
    } else {
      return;
    }
    this.processPacket(fromId, data);
  }

  private processPacket(fromId: string, data: ArrayBuffer) {
    this.lastSeen.set(fromId, performance.now());
    const view = new DataView(data);
    const packetType = view.getUint8(0);

    switch (packetType) {
      case PacketType.STATE: {
        const snap: StateSnapshot = {
          x: view.getFloat32(1, true),
          z: view.getFloat32(5, true),
          heading: view.getUint16(9, true) / 10000,
          speed: view.getFloat32(11, true),
          time: performance.now(),
          dmgFront: data.byteLength >= 19 ? view.getUint8(15) : undefined,
          dmgRear:  data.byteLength >= 19 ? view.getUint8(16) : undefined,
          dmgLeft:  data.byteLength >= 19 ? view.getUint8(17) : undefined,
          dmgRight: data.byteLength >= 19 ? view.getUint8(18) : undefined,
        };
        this.onState(fromId, snap);

        if (this.isHost) {
          this.relayState(fromId, snap);
        }
        break;
      }

      case PacketType.EVENT: {
        const eventType = view.getUint8(1) as EventType;
        const jsonBytes = new Uint8Array(data, 2);
        const json = _decoder.decode(jsonBytes);
        try {
          const eventData = JSON.parse(json);
          this.onEvent(fromId, eventType, eventData);

          // FIX: relay with embedded sender ID instead of raw forward
          if (this.isHost) {
            this.relayEvent(fromId, eventType, jsonBytes);
          }
        } catch {}
        break;
      }

      case PacketType.EVENT_RELAY: {
        const idLen = view.getUint8(1);
        const idBytes = new Uint8Array(data, 2, idLen);
        const actualFromId = _decoder.decode(idBytes);
        const eventType = view.getUint8(2 + idLen) as EventType;
        const jsonBytes = new Uint8Array(data, 3 + idLen);
        const json = _decoder.decode(jsonBytes);
        try {
          const eventData = JSON.parse(json);
          this.onEvent(actualFromId, eventType, eventData);
        } catch {}
        break;
      }

      case PacketType.STATE_RELAY: {
        const idLen = view.getUint8(1);
        const idBytes = new Uint8Array(data, 2, idLen);
        const actualFromId = _decoder.decode(idBytes);

        const offset = 2 + idLen;
        const snap: StateSnapshot = {
          x: view.getFloat32(offset, true),
          z: view.getFloat32(offset + 4, true),
          heading: view.getUint16(offset + 8, true) / 10000,
          speed: view.getFloat32(offset + 10, true),
          time: performance.now(),
          dmgFront: data.byteLength >= offset + 18 ? view.getUint8(offset + 14) : undefined,
          dmgRear:  data.byteLength >= offset + 18 ? view.getUint8(offset + 15) : undefined,
          dmgLeft:  data.byteLength >= offset + 18 ? view.getUint8(offset + 16) : undefined,
          dmgRight: data.byteLength >= offset + 18 ? view.getUint8(offset + 17) : undefined,
        };
        this.onState(actualFromId, snap);
        break;
      }

      case PacketType.INPUT: {
        const inputFrame = view.getUint32(1, true);
        const inputBits = view.getUint8(5);
        const steerI16 = view.getInt16(6, true);
        this.onInput(fromId, inputFrame, inputBits, steerI16);

        // Host relays input to other guests
        if (this.isHost) {
          this.relayInput(fromId, inputFrame, inputBits, steerI16);
        }
        break;
      }

      case PacketType.INPUT_RELAY: {
        const idLen = view.getUint8(1);
        const idBytes = new Uint8Array(data, 2, idLen);
        const actualFromId = _decoder.decode(idBytes);
        const offset = 2 + idLen;
        const inputFrame = view.getUint32(offset, true);
        const inputBits = view.getUint8(offset + 4);
        const steerI16 = view.getInt16(offset + 5, true);
        this.onInput(actualFromId, inputFrame, inputBits, steerI16);
        break;
      }

      case PacketType.PING: {
        const pongBuf = new ArrayBuffer(9);
        const pongView = new DataView(pongBuf);
        pongView.setUint8(0, PacketType.PONG);
        pongView.setFloat64(1, view.getFloat64(1, true), true);
        const remote = this.connections.get(fromId);
        if (remote) try { remote.conn.send(pongBuf); } catch {}
        break;
      }

      case PacketType.PONG: {
        const sentTime = view.getFloat64(1, true);
        const rtt = Math.round(performance.now() - sentTime);
        // FIX: store RTT per-peer instead of single scalar
        const remote = this.connections.get(fromId);
        if (remote) remote.rtt = rtt;
        break;
      }
    }
  }

  private handleGracefulDisconnect(peerId: string) {
    const remote = this.connections.get(peerId);
    if (!remote) return;
    const name = remote.name;

    // Don't immediately disconnect — give a grace period for reconnection
    this.onReconnecting(peerId, name);
    this.pendingReconnect.set(peerId, { name, timer: 5000, retries: 0 });

    // Start the reconnection interval if not already running
    if (!this.reconnectInterval) {
      this.reconnectInterval = window.setInterval(() => {
        for (const [id, info] of this.pendingReconnect) {
          info.timer -= 500;
          if (info.timer <= 0) {
            // Grace period expired — finalize disconnect
            this.pendingReconnect.delete(id);
            this.finalizeDisconnect(id, info.name);
          }
        }
        if (this.pendingReconnect.size === 0 && this.reconnectInterval) {
          clearInterval(this.reconnectInterval);
          this.reconnectInterval = null;
        }
      }, 500);
    }
  }

  /** Called when a peer rejoins (e.g. host receives a new connection with same metadata). */
  handleReconnection(peerId: string) {
    const pending = this.pendingReconnect.get(peerId);
    if (pending) {
      this.pendingReconnect.delete(peerId);
      this.onReconnected(peerId, pending.name);
    }
  }

  private finalizeDisconnect(peerId: string, name?: string) {
    this.connections.delete(peerId);
    this.onPlayerLeave(peerId, name);
  }

  private handleDisconnect(peerId: string) {
    const name = this.connections.get(peerId)?.name;
    this.connections.delete(peerId);
    this.pendingReconnect.delete(peerId);
    this.onPlayerLeave(peerId, name);
  }

  /** Get interpolated state for a remote player. */
  getInterpolatedState(id: string): StateSnapshot | null {
    const remote = this.connections.get(id);
    if (!remote || remote.buffer.length < 2) {
      return remote?.buffer[remote.buffer.length - 1] ?? null;
    }

    const renderTime = performance.now() - INTERP_DELAY;
    const buf = remote.buffer;

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

    const dt = s1.time - s0.time;
    const t = dt > 0 ? (renderTime - s0.time) / dt : 0;
    return {
      x: s0.x + (s1.x - s0.x) * t,
      z: s0.z + (s1.z - s0.z) * t,
      heading: lerpAngle(s0.heading, s1.heading, t),
      speed: s0.speed + (s1.speed - s0.speed) * t,
      time: renderTime,
      dmgFront: s1.dmgFront,
      dmgRear: s1.dmgRear,
      dmgLeft: s1.dmgLeft,
      dmgRight: s1.dmgRight,
    };
  }

  /** Add a state snapshot to a remote player's buffer. */
  addToBuffer(id: string, snap: StateSnapshot) {
    let remote = this.connections.get(id);
    if (!remote) {
      remote = { id, conn: null as any, buffer: [], name: 'Racer', carId: '', rtt: 0, ready: false };
      this.connections.set(id, remote);
    }
    remote.buffer.push(snap);
    // Ring-buffer style trim: when buffer gets too large, discard old entries in bulk
    if (remote.buffer.length > 20) {
      remote.buffer = remote.buffer.slice(-10);
    }
  }

  /** Mark a remote player as ready. */
  setPlayerReady(id: string, ready: boolean) {
    const remote = this.connections.get(id);
    if (remote) remote.ready = ready;
  }

  /** Check if all connected players are ready. */
  allPlayersReady(): boolean {
    if (this.connections.size === 0) return false;
    for (const remote of this.connections.values()) {
      if (!remote.ready) return false;
    }
    return true;
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

  /** Clear all per-player snapshot buffers (call between races). */
  clearBuffers() {
    for (const remote of this.connections.values()) {
      remote.buffer.length = 0;
    }
  }

  /** Get average RTT across all peers. */
  getRtt(): number {
    const peers = this.getRemotePlayers();
    if (peers.length === 0) return 0;
    let sum = 0;
    for (const p of peers) sum += p.rtt;
    return Math.round(sum / peers.length);
  }

  /** Get RTT for a specific peer. */
  getPeerRtt(id: string): number {
    return this.connections.get(id)?.rtt ?? 0;
  }

  /** Kick a player (host only). Sends KICK event, then closes connection. */
  kickPlayer(id: string) {
    const remote = this.connections.get(id);
    if (!remote) return;
    // Build and send kick event packet
    const json = JSON.stringify({ type: EventType.KICK });
    const jsonBytes = _encoder.encode(json);
    const buf = new ArrayBuffer(2 + jsonBytes.length);
    new DataView(buf).setUint8(0, PacketType.EVENT);
    new DataView(buf).setUint8(1, EventType.KICK);
    new Uint8Array(buf, 2).set(jsonBytes);
    try { remote.conn.send(buf); } catch {}
    setTimeout(() => {
      remote.conn?.close();
      this.connections.delete(id);
      this.pendingReconnect.delete(id);
      this.onPlayerLeave(id, remote.name);
    }, 100);
  }

  destroy() {
    this.stopBroadcasting();
    this.stopPinging();
    this.stopHeartbeat();
    if (this.reconnectInterval) { clearInterval(this.reconnectInterval); this.reconnectInterval = null; }
    this.pendingReconnect.clear();
    for (const remote of this.connections.values()) {
      remote.conn?.close();
    }
    this.connections.clear();
    this.lastSeen.clear();
    this.peer?.destroy();
    this.peer = null;
  }

  startPinging() {
    if (this.pingInterval) return;
    this.pingInterval = window.setInterval(() => {
      const buf = new ArrayBuffer(9);
      const view = new DataView(buf);
      view.setUint8(0, PacketType.PING);
      view.setFloat64(1, performance.now(), true);
      for (const remote of this.connections.values()) {
        try { remote.conn.send(buf); } catch {}
      }
    }, 3000);
  }

  stopPinging() {
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
  }

  /** Start checking for stale connections every 5s. */
  startHeartbeat() {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = window.setInterval(() => {
      const now = performance.now();
      const STALE_MS = 15000;
      for (const [id, ts] of this.lastSeen) {
        if (now - ts > STALE_MS && this.connections.has(id)) {
          this.handleDisconnect(id);
        }
      }
    }, 5000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
  }
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
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
