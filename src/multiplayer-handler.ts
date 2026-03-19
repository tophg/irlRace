/* ── Hood Racer — Multiplayer Handler ──
 *
 * Handles lobby management, network callback wiring,
 * and player list broadcasting. Extracted from main.ts.
 */

import * as THREE from 'three/webgpu';
import { GameState, EventType } from './types';
import { G } from './game-context';
import { NetPeer } from './net-peer';
import {
  showLobby, updatePlayerList, destroyLobby, showToast, appendChatMessage,
} from './mp-lobby';
import { showEmoteBubble } from './ui-screens';
import { rollbackManager, unpackInput } from './rollback-netcode';

/** Actions that require calling back into the main orchestrator */
export interface MultiplayerCallbacks {
  startRace: () => void;
  showTitleScreen: () => void;
  showResults: () => void;
  clearRaceObjects: () => void;
  destroyLeaderboard: () => void;
  destroySpectateHUD: () => void;
  resolvePlayerName: (id: string) => string;
}

let _cb: MultiplayerCallbacks;
let _uiOverlay: HTMLElement;
let _scene: THREE.Scene;

/** Bind references that are needed across all MP functions */
export function initMultiplayerHandler(
  uiOverlay: HTMLElement,
  scene: THREE.Scene,
  callbacks: MultiplayerCallbacks,
) {
  _uiOverlay = uiOverlay;
  _scene = scene;
  _cb = callbacks;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MULTIPLAYER LOBBY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function enterMultiplayerLobby() {
  G.gameState = GameState.LOBBY;

  // Show initial choose screen (no room code yet)
  showLobby(_uiOverlay, {
    isHost: false,
    roomCode: '',
    onNameChange: (name: string) => { G.localPlayerName = name; },
    onHost: async () => {
      G.netPeer = new NetPeer();

      // Wire callbacks BEFORE creating room (eager wiring pattern)
      wireNetworkCallbacks();

      const code = await G.netPeer.createRoom();

      destroyLobby();
      showLobby(_uiOverlay, {
        isHost: true,
        roomCode: code,
        onHost: () => {},
        onJoin: () => {},
        onChat: (text) => {
          G.netPeer?.broadcastEvent(EventType.CHAT, { text, name: G.localPlayerName });
          appendChatMessage(G.localPlayerName, text);
        },
        onLapsChange: (laps) => { G.totalLaps = laps; },
        onSeedChange: (seed) => {
          if (seed.length > 0) {
            const parsed = parseInt(seed, 10);
            G.trackSeed = Number.isNaN(parsed) ? null : parsed;
          } else {
            G.trackSeed = null;
          }
        },
        onKick: (id) => {
          G.netPeer?.kickPlayer(id);
        },
        onStart: () => {
          destroyLobby();
          G.raceReadyCount = 0;
          G.trackSeed = Math.floor(Math.random() * 99999);
          const players = [{ id: G.netPeer!.getLocalId(), name: G.localPlayerName, carId: G.selectedCar.id }];
          for (const rp of G.netPeer!.getRemotePlayers()) players.push({ id: rp.id, name: rp.name, carId: rp.carId });
          G.mpPlayersList = players;
          G.netPeer!.broadcastEvent(EventType.COUNTDOWN_START, { laps: G.totalLaps, seed: G.trackSeed, players });
          _cb.startRace();
        },
        onBack: () => { G.netPeer?.destroy(); G.netPeer = null; destroyLobby(); _cb.showTitleScreen(); },
      });

      // Send initial player list to connected guests
      broadcastPlayerList();
    },

    onJoin: async (code: string) => {
      G.netPeer = new NetPeer();
      wireNetworkCallbacks();

      try {
        showToast(_uiOverlay, 'Connecting...');
        await G.netPeer.joinRoom(code, G.localPlayerName, G.selectedCar.id);

        destroyLobby();
        showLobby(_uiOverlay, {
          isHost: false,
          roomCode: code,
          onHost: () => {},
          onJoin: () => {},
          onStart: () => {},
          onChat: (text) => {
            G.netPeer?.broadcastEvent(EventType.CHAT, { text, name: G.localPlayerName });
            appendChatMessage(G.localPlayerName, text);
          },
          onReady: () => {
            G.netPeer?.broadcastEvent(EventType.PLAYER_READY, { ready: true });
          },
          onBack: () => { G.netPeer?.destroy(); G.netPeer = null; destroyLobby(); _cb.showTitleScreen(); },
        });

        showToast(_uiOverlay, 'Connected to room');
      } catch (err) {
        showToast(_uiOverlay, `Could not connect: ${(err as Error).message}`);
        destroyLobby();
        enterMultiplayerLobby();
      }
    },

    onStart: () => {},
    onBack: () => { destroyLobby(); _cb.showTitleScreen(); },
  });
}

export function broadcastPlayerList() {
  if (!G.netPeer?.getIsHost()) return;
  const players = G.netPeer.getRemotePlayers().map(p => ({
    id: p.id, name: p.name, ready: p.ready,
  }));
  G.netPeer.broadcastEvent(EventType.PLAYER_LIST, { players });
}

export function wireNetworkCallbacks() {
  if (!G.netPeer) return;

  G.netPeer.onState = (fromId: string, snap: any) => {
    G.netPeer!.addToBuffer(fromId, snap);
  };

  // Wire rollback input reception
  G.netPeer.onInput = (fromId: string, frame: number, inputBits: number, steerI16: number) => {
    const input = unpackInput(inputBits, steerI16);
    rollbackManager.receiveRemoteInput(fromId, frame, input);
  };

  G.netPeer.onEvent = (fromId: string, type: number, data: any) => {
    switch (type) {
      case EventType.COUNTDOWN_START:
        destroyLobby();
        G.totalLaps = data.laps ?? 3;
        G.trackSeed = data.seed ?? Math.floor(Math.random() * 99999);
        G.mpPlayersList = data.players ?? [];
        if (data.players) {
          for (const p of data.players) {
            const rp = G.netPeer!.getRemotePlayers().find((r: any) => r.id === p.id);
            if (rp) rp.carId = p.carId;
          }
        }
        _cb.startRace();
        break;

      case EventType.CHECKPOINT_HIT:
        G.raceEngine?.updateRemoteProgress(fromId, data.lap, data.cp);
        break;

      case EventType.LAP_COMPLETE:
        G.raceEngine?.updateRemoteProgress(fromId, data.lap, 0);
        break;

      case EventType.REMATCH_REQUEST:
        G.raceReadyCount = 0;
        G.trackSeed = data.seed ?? Math.floor(Math.random() * 99999);
        G.totalLaps = data.laps ?? G.totalLaps;
        if (data.players) G.mpPlayersList = data.players;
        _cb.destroyLeaderboard();
        _uiOverlay.querySelector('.results-overlay')?.remove();
        _cb.startRace();
        break;

      case EventType.RACE_FINISH:
        if (G.raceEngine) {
          const racer = G.raceEngine.getProgress(fromId);
          if (racer && !racer.finished) {
            racer.finished = true;
            racer.finishTime = data.finishTime ?? 0;
            racer.lapIndex = G.totalLaps;
            racer.checkpointIndex = 0;
          }
        }
        break;

      case EventType.PLAYER_READY:
        G.netPeer!.setPlayerReady(fromId, data.ready ?? true);
        updatePlayerList(G.netPeer!.getRemotePlayers().map((p: any) => ({
          id: p.id, name: p.name, ready: p.ready,
        })));
        broadcastPlayerList();
        break;

      case EventType.PLAYER_LIST:
        if (data.players) {
          updatePlayerList(data.players);
        }
        break;

      case EventType.RACE_READY:
        if (!G.netPeer?.getIsHost()) break;
        G.raceReadyCount++;
        if (G.raceReadyCount >= (G.netPeer?.getConnectionCount() ?? 0) && G.raceGoResolve) {
          G.raceGoResolve();
        }
        break;

      case EventType.RACE_GO:
        if (G.raceGoResolve) G.raceGoResolve();
        break;

      case EventType.CAR_SELECT: {
        const rp = G.netPeer!.getRemotePlayers().find((r: any) => r.id === fromId);
        if (rp && data.carId) {
          rp.carId = data.carId;
        }
        break;
      }

      case EventType.REMATCH_ACCEPT:
        if (G.netPeer!.getIsHost() && G.gameState === GameState.RESULTS) {
          _uiOverlay.querySelector('.results-overlay')?.remove();
          if (G.postWinnerTimer) { clearTimeout(G.postWinnerTimer); G.postWinnerTimer = null; }
          G.raceReadyCount = 0;
          G.trackSeed = Math.floor(Math.random() * 99999);
          const rematchPlayers = [{ id: G.netPeer!.getLocalId(), name: G.localPlayerName, carId: G.selectedCar.id }];
          for (const rp of G.netPeer!.getRemotePlayers()) rematchPlayers.push({ id: rp.id, name: rp.name, carId: rp.carId });
          G.mpPlayersList = rematchPlayers;
          G.netPeer!.broadcastEvent(EventType.REMATCH_REQUEST, { seed: G.trackSeed, laps: G.totalLaps, players: rematchPlayers });
          _cb.destroyLeaderboard();
          _cb.startRace();
        }
        break;

      case EventType.CHAT: {
        const senderName = data.name || _cb.resolvePlayerName(fromId);
        appendChatMessage(senderName, data.text ?? '');
        break;
      }

      case EventType.KICK: {
        // Guest was kicked by host — return to title
        showToast(_uiOverlay, 'You were kicked from the lobby');
        G.netPeer?.destroy();
        G.netPeer = null;
        destroyLobby();
        _cb.clearRaceObjects();
        _cb.destroyLeaderboard();
        _cb.destroySpectateHUD();
        _cb.showTitleScreen();
        break;
      }

      case EventType.EMOTE: {
        const emoji = data.emoji ?? '👍';
        showEmoteBubble(emoji, Math.random() * window.innerWidth * 0.6 + window.innerWidth * 0.2);
        break;
      }
    }
  };

  G.netPeer.onPlayerJoin = (id: string, name: string) => {
    rollbackManager.addRemotePeer(id);
    showToast(_uiOverlay, `${name} joined`);
    updatePlayerList(G.netPeer!.getRemotePlayers().map((p: any) => ({ id: p.id, name: p.name, ready: p.ready })));
    broadcastPlayerList();
  };

  G.netPeer.onPlayerLeave = (id: string, disconnectedName?: string) => {
    rollbackManager.removeRemotePeer(id);
    const name = disconnectedName || 'Player';

    // Mark as DNF if race is in progress
    if (G.gameState === GameState.RACING || G.gameState === GameState.COUNTDOWN) {
      G.raceEngine?.markDnf(id);
      showToast(_uiOverlay, `${name} disconnected (DNF)`);

      // Auto-finish if all opponents are DNF (only in multiplayer with no AI)
      if (G.raceEngine && G.netPeer && G.aiRacers.length === 0) {
        const rankings = G.raceEngine.getRankings();
        const allOpponentsDnf = rankings
          .filter((r: any) => r.id !== 'local')
          .every((r: any) => r.dnf);
        if (allOpponentsDnf && G.gameState === GameState.RACING) {
          _cb.destroyLeaderboard();
          _cb.showResults();
        }
      }
    } else {
      showToast(_uiOverlay, `${name} disconnected`);
    }

    // Clean up remote mesh and tracking data (dispose GPU resources)
    const mesh = G.remoteMeshes.get(id);
    if (mesh) {
      _scene.remove(mesh);
      mesh.traverse((child: any) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          const mat = child.material;
          if (Array.isArray(mat)) mat.forEach((m: any) => m.dispose());
          else if (mat) mat.dispose();
        }
      });
      G.remoteMeshes.delete(id);
    }
    G.remotePrevPos.delete(id);

    const tag = G.remoteNameTags.get(id);
    if (tag) { _scene.remove(tag); G.remoteNameTags.delete(id); };
  };

  G.netPeer.onReconnecting = (id: string, name: string) => {
    showToast(_uiOverlay, `${name} reconnecting...`);
  };

  G.netPeer.onReconnected = (id: string, name: string) => {
    showToast(_uiOverlay, `${name} reconnected`);
  };
}
