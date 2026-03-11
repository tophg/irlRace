/* ── Hood Racer — Multiplayer Lobby UI ── */

let lobbyEl: HTMLElement | null = null;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function showLobby(
  overlay: HTMLElement,
  opts: {
    isHost: boolean;
    roomCode: string;
    onHost: () => void;
    onJoin: (code: string) => void;
    onStart: () => void;
    onBack: () => void;
    onReady?: () => void;
    onNameChange?: (name: string) => void;
  }
) {
  destroyLobby();

  lobbyEl = document.createElement('div');
  lobbyEl.className = 'lobby-ui';
  lobbyEl.id = 'lobby-ui';

  if (!opts.roomCode) {
    // Initial state: choose host or join
    lobbyEl.innerHTML = `
      <div class="lobby-title">MULTIPLAYER</div>
      <div style="text-align:center; margin-bottom:12px;">
        <input class="lobby-input" id="lobby-name-input" placeholder="YOUR NAME" maxlength="12"
               value="${escapeHtml(localStorage.getItem('hr-player-name') || '')}" style="text-transform:uppercase;" />
      </div>
      <div class="menu-buttons">
        <button class="menu-btn" id="lobby-host-btn">HOST GAME</button>
        <button class="menu-btn" id="lobby-join-btn-show">JOIN GAME</button>
        <button class="menu-btn" id="lobby-back-btn">BACK</button>
      </div>
      <div id="join-section" style="display:none; text-align:center;">
        <input class="lobby-input" id="lobby-code-input" placeholder="CODE" maxlength="4" />
        <div id="join-error" style="color:var(--col-red);font-size:13px;min-height:20px;margin:8px 0;"></div>
        <button class="select-btn" id="lobby-join-go">CONNECT</button>
      </div>
    `;
  } else if (opts.isHost) {
    // Host: room code + player list + start button
    lobbyEl.innerHTML = `
      <div class="lobby-title">HOSTING</div>
      <div class="room-code">${escapeHtml(opts.roomCode)}</div>
      <div style="color:var(--col-text-dim);font-size:14px;">Share this code with friends</div>
      <div class="player-list" id="lobby-players"></div>
      <button class="select-btn" id="lobby-start-btn" disabled style="opacity:0.4;">WAITING FOR PLAYERS</button>
      <button class="menu-btn" id="lobby-back-btn" style="width:200px;">CANCEL</button>
    `;
  } else {
    // Guest: player list + ready button
    lobbyEl.innerHTML = `
      <div class="lobby-title">CONNECTED</div>
      <div class="room-code">${escapeHtml(opts.roomCode)}</div>
      <div class="player-list" id="lobby-players"></div>
      <button class="select-btn" id="lobby-ready-btn">READY</button>
      <button class="menu-btn" id="lobby-back-btn" style="width:200px;">LEAVE</button>
    `;
  }

  overlay.appendChild(lobbyEl);

  const persistName = () => {
    const nameInput = lobbyEl!.querySelector('#lobby-name-input') as HTMLInputElement | null;
    if (nameInput) {
      const name = nameInput.value.trim().toUpperCase() || `RACER_${Math.floor(Math.random() * 9999)}`;
      localStorage.setItem('hr-player-name', name);
      opts.onNameChange?.(name);
    }
  };

  // Wire buttons
  const hostBtn = lobbyEl.querySelector('#lobby-host-btn') as HTMLButtonElement | null;
  hostBtn?.addEventListener('click', () => {
    persistName();
    hostBtn.disabled = true;
    hostBtn.textContent = 'CREATING...';
    opts.onHost();
  });

  const joinShowBtn = lobbyEl.querySelector('#lobby-join-btn-show') as HTMLElement | null;
  const joinSection = lobbyEl.querySelector('#join-section') as HTMLElement | null;
  joinShowBtn?.addEventListener('click', () => {
    if (joinSection) joinSection.style.display = 'block';
    joinShowBtn.style.display = 'none';
  });

  const joinGoBtn = lobbyEl.querySelector('#lobby-join-go') as HTMLButtonElement | null;
  joinGoBtn?.addEventListener('click', () => {
    persistName();
    const input = lobbyEl!.querySelector('#lobby-code-input') as HTMLInputElement;
    const errorEl = lobbyEl!.querySelector('#join-error') as HTMLElement;
    const code = input.value.trim().toUpperCase();
    if (code.length !== 4) {
      if (errorEl) errorEl.textContent = 'Enter a 4-character room code';
      return;
    }
    if (errorEl) errorEl.textContent = '';
    joinGoBtn.disabled = true;
    joinGoBtn.textContent = 'CONNECTING...';
    opts.onJoin(code);
  });

  const readyBtn = lobbyEl.querySelector('#lobby-ready-btn') as HTMLButtonElement | null;
  readyBtn?.addEventListener('click', () => {
    readyBtn.classList.toggle('ready-active');
    const isReady = readyBtn.classList.contains('ready-active');
    readyBtn.textContent = isReady ? 'READY!' : 'READY';
    readyBtn.style.background = isReady ? 'var(--col-green)' : '';
    opts.onReady?.();
  });

  const startBtn = lobbyEl.querySelector('#lobby-start-btn') as HTMLButtonElement | null;
  startBtn?.addEventListener('click', () => {
    if (!startBtn.disabled) opts.onStart();
  });

  const backBtn = lobbyEl.querySelector('#lobby-back-btn');
  backBtn?.addEventListener('click', () => opts.onBack());
}

export function updatePlayerList(players: { id: string; name: string; ready?: boolean }[]) {
  const listEl = document.getElementById('lobby-players');
  if (!listEl) return;

  listEl.innerHTML = players.map(p => `
    <div class="player-row">
      <span class="name">${escapeHtml(p.name)}</span>
      <span class="status" style="color:${p.ready ? 'var(--col-green)' : 'var(--col-text-dim)'};">${p.ready ? 'Ready' : 'Waiting'}</span>
    </div>
  `).join('');

  // Enable/disable start button based on all players ready
  const startBtn = document.getElementById('lobby-start-btn') as HTMLButtonElement | null;
  if (startBtn && players.length > 0) {
    const allReady = players.every(p => p.ready);
    startBtn.disabled = !allReady;
    startBtn.style.opacity = allReady ? '1' : '0.4';
    startBtn.textContent = allReady ? 'START RACE' : `WAITING (${players.filter(p => p.ready).length}/${players.length})`;
  }
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
