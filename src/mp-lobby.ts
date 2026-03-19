/* ── IRL Race — Multiplayer Lobby UI ── */

let lobbyEl: HTMLElement | null = null;
let lobbyIsHost = false;
let lobbyOnKick: ((id: string) => void) | null = null;

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
    onChat?: (text: string) => void;
    onLapsChange?: (laps: number) => void;
    onSeedChange?: (seed: string) => void;
    onKick?: (id: string) => void;
  }
) {
  destroyLobby();
  lobbyIsHost = opts.isHost;
  lobbyOnKick = opts.onKick ?? null;

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
      <div class="lobby-config">
        <label class="lobby-cfg-row">
          <span>Laps</span>
          <select id="lobby-laps">
            <option value="1">1</option>
            <option value="3" selected>3</option>
            <option value="5">5</option>
            <option value="10">10</option>
          </select>
        </label>
        <label class="lobby-cfg-row">
          <span>Seed</span>
          <input type="text" id="lobby-seed" class="lobby-input" placeholder="Random" maxlength="5"
                 style="width:80px;font-size:14px;padding:4px 8px;letter-spacing:2px;" />
        </label>
      </div>
      <div class="lobby-chat" id="lobby-chat">
        <div class="chat-messages" id="chat-messages"></div>
        <input class="chat-input" id="chat-input" placeholder="Type a message..." maxlength="50" />
      </div>
      <button class="select-btn" id="lobby-start-btn" disabled style="opacity:0.4;">WAITING FOR PLAYERS</button>
      <button class="menu-btn" id="lobby-back-btn" style="width:200px;">CANCEL</button>
    `;
  } else {
    // Guest: player list + ready button
    lobbyEl.innerHTML = `
      <div class="lobby-title">CONNECTED</div>
      <div class="room-code">${escapeHtml(opts.roomCode)}</div>
      <div class="player-list" id="lobby-players"></div>
      <div class="lobby-chat" id="lobby-chat">
        <div class="chat-messages" id="chat-messages"></div>
        <input class="chat-input" id="chat-input" placeholder="Type a message..." maxlength="50" />
      </div>
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

  // Chat input
  const chatInput = lobbyEl.querySelector('#chat-input') as HTMLInputElement | null;
  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text.length > 0) {
        opts.onChat?.(text);
        chatInput.value = '';
      }
    }
  });

  // Host config: laps and seed
  const lapsSelect = lobbyEl.querySelector('#lobby-laps') as HTMLSelectElement | null;
  lapsSelect?.addEventListener('change', () => {
    opts.onLapsChange?.(parseInt(lapsSelect.value));
  });

  const seedInput = lobbyEl.querySelector('#lobby-seed') as HTMLInputElement | null;
  seedInput?.addEventListener('input', () => {
    opts.onSeedChange?.(seedInput.value.trim());
  });
}

export function updatePlayerList(players: { id: string; name: string; ready?: boolean }[]) {
  const listEl = document.getElementById('lobby-players');
  if (!listEl) return;

  listEl.innerHTML = players.map(p => {
    const kickBtn = lobbyIsHost ? `<button class="lobby-kick-btn" data-kick-id="${p.id}" title="Kick">&times;</button>` : '';
    return `
    <div class="player-row">
      <span class="name">${escapeHtml(p.name)}</span>
      <span class="status" style="color:${p.ready ? 'var(--col-green)' : 'var(--col-text-dim)'};">${p.ready ? 'Ready' : 'Waiting'}</span>
      ${kickBtn}
    </div>
  `;
  }).join('');

  // Wire kick buttons
  if (lobbyIsHost && lobbyOnKick) {
    listEl.querySelectorAll('.lobby-kick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.kickId;
        if (id) lobbyOnKick?.(id);
      });
    });
  }

  // Enable/disable start button based on all players ready
  const startBtn = document.getElementById('lobby-start-btn') as HTMLButtonElement | null;
  if (startBtn && players.length > 0) {
    const allReady = players.every(p => p.ready);
    startBtn.disabled = !allReady;
    startBtn.style.opacity = allReady ? '1' : '0.4';
    startBtn.textContent = allReady ? 'START RACE' : `WAITING (${players.filter(p => p.ready).length}/${players.length})`;
  }
}

export function appendChatMessage(name: string, text: string) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const msg = document.createElement('div');
  msg.className = 'chat-msg';
  msg.innerHTML = `<span class="chat-name">${escapeHtml(name)}</span> ${escapeHtml(text)}`;
  container.appendChild(msg);

  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;

  // Limit to 50 messages
  while (container.children.length > 50) {
    container.removeChild(container.firstChild!);
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
