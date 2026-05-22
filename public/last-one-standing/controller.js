// Last One Standing — Controller (mobile) logic
// Connects to the /los Socket.io namespace.
// Stage 1: join flow + lobby display.

const socket = io('/los', { transports: ['websocket', 'polling'] });

// ── State ─────────────────────────────────────────────────────────────────────
let myColor    = '#FF2D78';
let myUsername = '';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const screens = {
  join:       document.getElementById('screen-join'),
  lobby:      document.getElementById('screen-lobby'),
  eliminated: document.getElementById('screen-eliminated'),
  full:       document.getElementById('screen-full'),
};

const usernameInput  = document.getElementById('username-input');
const joinBtn        = document.getElementById('join-btn');
const youreInText    = document.getElementById('you-re-in-text');
const playersList    = document.getElementById('players-list');
const placementText  = document.getElementById('placement-text');

// ── Screen management ─────────────────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ── Join ──────────────────────────────────────────────────────────────────────
function doJoin() {
  const name = usernameInput.value.trim();
  if (!name) { usernameInput.focus(); return; }
  myUsername = name;

  // Pull avatar color from platform session if available (set by /join page)
  const color = window.__playerColor || '#FF2D78';

  socket.emit('los-player-join', {
    userId:      window.__userId      || null,
    username:    myUsername,
    color,
    avatarConfig: window.__avatarConfig || null,
  });
}

joinBtn.addEventListener('click', doJoin);
usernameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });

// ── Server responses ──────────────────────────────────────────────────────────
socket.on('los-join-ack', ({ color }) => {
  myColor = color;
  document.documentElement.style.setProperty('--player', color);
  youreInText.style.color = color;
  youreInText.style.textShadow = `0 0 30px ${color}`;
  showScreen('lobby');
});

socket.on('los-lobby-full', () => {
  showScreen('full');
});

socket.on('los-lobby-update', (list) => {
  renderPlayerList(list);
});

// ── Player list in lobby ──────────────────────────────────────────────────────
function renderPlayerList(list) {
  playersList.innerHTML = list.map(p => `
    <div class="player-row" style="border-color:${p.color}44">
      <div class="player-dot" style="background:${p.color};box-shadow:0 0 8px ${p.color}"></div>
      <div class="player-row-name">${escHtml(p.username)}${p.username === myUsername ? ' (you)' : ''}</div>
    </div>
  `).join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
