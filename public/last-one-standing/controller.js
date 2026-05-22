// Last One Standing — Controller (mobile) Stage 2
// Connects to the /los Socket.io namespace.

const socket = io('/los', { transports: ['websocket', 'polling'] });

// ── State ─────────────────────────────────────────────────────────────────────
let myColor    = '#FF2D78';
let myUsername = '';
let gamePhase  = 'lobby'; // lobby | countdown | pre-window | window | fake | result

// ── DOM refs ──────────────────────────────────────────────────────────────────
const screens = {
  join:       document.getElementById('screen-join'),
  lobby:      document.getElementById('screen-lobby'),
  game:       document.getElementById('screen-game'),
  eliminated: document.getElementById('screen-eliminated'),
  winner:     document.getElementById('screen-winner'),
  full:       document.getElementById('screen-full'),
};

const usernameInput  = document.getElementById('username-input');
const joinBtn        = document.getElementById('join-btn');
const youreInText    = document.getElementById('you-re-in-text');
const playersList    = document.getElementById('players-list');
const placementText  = document.getElementById('placement-text');
const winnerText     = document.getElementById('winner-text');
const tapBtn         = document.getElementById('tap-btn');
const tapHint        = document.getElementById('tap-hint');
const tapStatus      = document.getElementById('tap-status');

// ── Screen management ─────────────────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  if (screens[name]) screens[name].classList.remove('hidden');
}

// ── Join ──────────────────────────────────────────────────────────────────────
function doJoin() {
  const name = usernameInput.value.trim();
  if (!name) { usernameInput.focus(); return; }
  myUsername = name;

  const color = window.__playerColor || '#FF2D78';

  socket.emit('los-player-join', {
    userId:       window.__userId       || null,
    username:     myUsername,
    color,
    avatarConfig: window.__avatarConfig || null,
  });
}

joinBtn.addEventListener('click', doJoin);
usernameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });

// ── Server responses: lobby ───────────────────────────────────────────────────
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

// ── Game events ───────────────────────────────────────────────────────────────
socket.on('los-game-start', () => {
  gamePhase = 'countdown';
  setTapState('wait', 'Get ready…');
  showScreen('game');
});

socket.on('los-round-start', ({ round }) => {
  gamePhase = 'countdown';
  setTapState('wait', `Round ${round} — get ready!`);
});

socket.on('los-countdown', ({ value }) => {
  gamePhase = 'countdown';
  setTapState('wait', `${value}…`);
});

socket.on('los-tap-now', () => {
  gamePhase = 'window';
  setTapState('go', 'TAP NOW!');
});

socket.on('los-fake', () => {
  gamePhase = 'fake';
  setTapState('fake', "DON'T TAP!");
});

socket.on('los-round-result', ({ eliminated }) => {
  gamePhase = 'result';
  const iEliminated = eliminated.some(e => e.username === myUsername);
  if (!iEliminated) {
    setTapState('wait', 'You survived! ✅');
  }
});

socket.on('los-early-tap', ({ username }) => {
  if (username === myUsername) showEliminated('Tapped too early!');
});

socket.on('los-late-tap', ({ username }) => {
  if (username === myUsername) showEliminated("Didn't tap in time!");
});

socket.on('los-game-over', ({ winner, placements }) => {
  if (winner.username === myUsername) {
    winnerText.textContent = '🏆 YOU WIN!';
    winnerText.style.color = myColor;
    showScreen('winner');
  } else {
    const place = placements.findIndex(p => p.username === myUsername) + 1;
    placementText.textContent = place > 0 ? `You finished #${place}` : '';
    // if not already eliminated screen, show it
    if (!screens.eliminated.classList.contains('hidden') === false) return;
  }
  // reset to lobby after 10s
  setTimeout(() => {
    gamePhase = 'lobby';
    showScreen('lobby');
    setTapState('wait', '');
  }, 10_000);
});

// ── Tap button ────────────────────────────────────────────────────────────────
tapBtn.addEventListener('click', () => {
  socket.emit('los-tap');
});

tapBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  socket.emit('los-tap');
}, { passive: false });

// ── Helpers ───────────────────────────────────────────────────────────────────
function setTapState(state, hint) {
  tapHint.textContent = hint;
  tapBtn.className = 'tap-btn';
  tapStatus.textContent = '';

  if (state === 'go') {
    tapBtn.classList.add('tap-go');
    tapBtn.disabled = false;
  } else if (state === 'fake') {
    tapBtn.classList.add('tap-fake');
    tapBtn.disabled = false;
  } else {
    tapBtn.classList.add('tap-wait');
    tapBtn.disabled = true;
  }
}

function showEliminated(reason) {
  placementText.textContent = reason;
  showScreen('eliminated');
  setTimeout(() => showScreen('lobby'), 10_000);
}

function renderPlayerList(list) {
  playersList.innerHTML = list.map(p => `
    <div class="player-row" style="border-color:${p.color}44">
      <div class="player-dot" style="background:${p.color};box-shadow:0 0 8px ${p.color}"></div>
      <div class="player-row-name">${escHtml(p.username)}${p.username === myUsername ? ' (you)' : ''}</div>
    </div>
  `).join('');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
