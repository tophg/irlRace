/* ── Hood Racer — Multiplayer Lobby UI ── */

let lobbyEl: HTMLElement | null = null;
let onHostCallback: (() => void) | null = null;
let onJoinCallback: ((code: string) => void) | null = null;
let onStartCallback: (() => void) | null = null;

export function showLobby(
  overlay: HTMLElement,
  opts: {
    isHost: boolean;
    roomCode: string;
    onHost: () => void;
    onJoin: (code: string) => void;
    onStart: () => void;
    onBack: () => void;
    onNameChange?: (name: string) => void;
  }
) {
  destroyLobby();
  onHostCallback = opts.onHost;
  onJoinCallback = opts.onJoin;
  onStartCallback = opts.onStart;

  lobbyEl = document.createElement('div');
  lobbyEl.className = 'lobby-ui';
  lobbyEl.id = 'lobby-ui';

  if (!opts.roomCode) {
    // Initial state: choose host or join
  lobbyEl.innerHTML = `
      <div class="lobby-title">MULTIPLAYER</div>
      <div style="text-align:center; margin-bottom:12px;">
        <input class="lobby-input" id="lobby-name-input" placeholder="YOUR NAME" maxlength="12"
               value="${localStorage.getItem('hr-player-name') || ''}" style="text-transform:uppercase;" />
      </div>
      <div class="menu-buttons">
        <button class="menu-btn" id="lobby-host-btn">HOST GAME</button>
        <button class="menu-btn" id="lobby-join-btn-show">JOIN GAME</button>
        <button class="menu-btn" id="lobby-back-btn">BACK</button>
      </div>
      <div id="join-section" style="display:none; text-align:center;">
        <input class="lobby-input" id="lobby-code-input" placeholder="CODE" maxlength="4" />
        <br><br>
        <button class="select-btn" id="lobby-join-go">CONNECT</button>
      </div>
    `;
  } else if (opts.isHost) {
    // Host: show room code + player list + start button
    lobbyEl.innerHTML = `
      <div class="lobby-title">HOSTING</div>
      <div class="room-code">${opts.roomCode}</div>
      <div style="color:var(--col-text-dim);font-size:14px;">Share this code with friends</div>
      <div class="player-list" id="lobby-players"></div>
      <button class="select-btn" id="lobby-start-btn">START RACE</button>
      <button class="menu-btn" id="lobby-back-btn" style="width:200px;">CANCEL</button>
    `;
  } else {
    // Guest: waiting state
    lobbyEl.innerHTML = `
      <div class="lobby-title">CONNECTED</div>
      <div class="room-code">${opts.roomCode}</div>
      <div style="color:var(--col-green);font-size:16px;">Waiting for host to start...</div>
      <button class="menu-btn" id="lobby-back-btn" style="width:200px;">LEAVE</button>
    `;
  }

  overlay.appendChild(lobbyEl);

  // Helper: read and persist name from input
  const persistName = () => {
    const nameInput = lobbyEl!.querySelector('#lobby-name-input') as HTMLInputElement | null;
    if (nameInput) {
      const name = nameInput.value.trim().toUpperCase() || `RACER_${Math.floor(Math.random() * 9999)}`;
      localStorage.setItem('hr-player-name', name);
      opts.onNameChange?.(name);
    }
  };

  // Wire up buttons
  const hostBtn = lobbyEl.querySelector('#lobby-host-btn');
  hostBtn?.addEventListener('click', () => { persistName(); opts.onHost(); });

  const joinShowBtn = lobbyEl.querySelector('#lobby-join-btn-show') as HTMLElement | null;
  const joinSection = lobbyEl.querySelector('#join-section') as HTMLElement | null;
  joinShowBtn?.addEventListener('click', () => {
    if (joinSection) joinSection.style.display = 'block';
    joinShowBtn.style.display = 'none';
  });

  const joinGoBtn = lobbyEl.querySelector('#lobby-join-go');
  joinGoBtn?.addEventListener('click', () => {
    persistName();
    const input = lobbyEl!.querySelector('#lobby-code-input') as HTMLInputElement;
    const code = input.value.trim().toUpperCase();
    if (code.length === 4) opts.onJoin(code);
  });

  const startBtn = lobbyEl.querySelector('#lobby-start-btn');
  startBtn?.addEventListener('click', () => opts.onStart());

  const backBtn = lobbyEl.querySelector('#lobby-back-btn');
  backBtn?.addEventListener('click', () => opts.onBack());
}

export function updatePlayerList(players: { id: string; name: string }[]) {
  const listEl = document.getElementById('lobby-players');
  if (!listEl) return;

  listEl.innerHTML = players.map(p => `
    <div class="player-row">
      <span class="name">${p.name}</span>
      <span class="status">Ready</span>
    </div>
  `).join('');
}

export function destroyLobby() {
  if (lobbyEl) {
    lobbyEl.remove();
    lobbyEl = null;
  }
}

export function showToast(overlay: HTMLElement, message: string) {
  let container = overlay.querySelector('.toast-container') as HTMLElement;
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    overlay.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}
