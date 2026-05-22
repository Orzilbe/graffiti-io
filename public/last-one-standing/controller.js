// Last One Standing — Controller (Stage 3 + Stage 4)
// Stage 3: full-screen tap UX with haptics and countdown on mobile.
// Stage 4: reads URL params from platform redirect (userId, username, color).

// ── URL param injection (from platform /join redirect) ────────────────────────
const _p = new URLSearchParams(window.location.search);
if (_p.get('userId'))   window.__userId      = _p.get('userId');
if (_p.get('username')) window.__username    = _p.get('username');
if (_p.get('color'))    window.__playerColor = _p.get('color');

const socket = io('/los', { transports: ['websocket', 'polling'] });

// ── State ─────────────────────────────────────────────────────────────────────
let myColor    = window.__playerColor || '#FF2D78';
let myUsername = window.__username    || '';
let gamePhase  = 'lobby';
let currentRound = 0;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const screens = {
  join:       document.getElementById('screen-join'),
  lobby:      document.getElementById('screen-lobby'),
  game:       document.getElementById('screen-game'),
  eliminated: document.getElementById('screen-eliminated'),
  winner:     document.getElementById('screen-winner'),
  full:       document.getElementById('screen-full'),
};
const usernameInput = document.getElementById('username-input');
const joinBtn       = document.getElementById('join-btn');
const youreInText   = document.getElementById('you-re-in-text');
const playersList   = document.getElementById('players-list');
const placementText = document.getElementById('placement-text');
const winnerText    = document.getElementById('winner-text');
const gameScreen    = document.getElementById('screen-game');
const roundLabel    = document.getElementById('round-label');
const gameBigText   = document.getElementById('game-big-text');
const gameSubText   = document.getElementById('game-sub-text');

// ── Screen management ─────────────────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  if (screens[name]) screens[name].classList.remove('hidden');
}

function setGameState(state, big, sub) {
  gameScreen.dataset.state = state;
  if (big !== undefined) gameBigText.textContent = big;
  if (sub !== undefined) gameSubText.textContent = sub;
  // re-trigger animations
  gameBigText.style.animation = 'none';
  gameBigText.offsetHeight;
  gameBigText.style.animation = '';
}

function haptic(ms = 50) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}

// ── Join ──────────────────────────────────────────────────────────────────────
function doJoin(name) {
  if (!name) { usernameInput?.focus(); return; }
  myUsername = name;
  const color = window.__playerColor || '#FF2D78';
  socket.emit('los-player-join', {
    userId:       window.__userId       || null,
    username:     myUsername,
    color,
    avatarConfig: window.__avatarConfig || null,
  });
}

// Auto-join if URL params provided by platform
if (myUsername && window.__userId) {
  // Wait for socket connection, then auto-join (skip join screen)
  socket.once('connect', () => doJoin(myUsername));
  showScreen('lobby'); // show lobby optimistically
} else {
  showScreen('join');
}

joinBtn?.addEventListener('click', () => doJoin(usernameInput.value.trim()));
usernameInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(usernameInput.value.trim()); });

// ── Server responses: lobby ───────────────────────────────────────────────────
socket.on('los-join-ack', ({ color }) => {
  myColor = color;
  document.documentElement.style.setProperty('--player', color);
  youreInText.style.color = color;
  youreInText.style.textShadow = `0 0 30px ${color}`;
  showScreen('lobby');
});

socket.on('los-lobby-full', () => showScreen('full'));

socket.on('los-lobby-update', (list) => renderPlayerList(list));

// ── Game events ───────────────────────────────────────────────────────────────
socket.on('los-game-start', () => {
  gamePhase = 'wait';
  currentRound = 0;
  roundLabel.textContent = '';
  setGameState('wait', '🎨', 'Get ready…');
  showScreen('game');
});

socket.on('los-round-start', ({ round }) => {
  gamePhase = 'wait';
  currentRound = round;
  roundLabel.textContent = `ROUND ${round}`;
  setGameState('wait', '🎨', 'Round starting…');
});

socket.on('los-countdown', ({ value }) => {
  gamePhase = 'countdown';
  const colors = ['#FF2D78', '#00E5FF', '#76FF03'];
  gameBigText.style.color = colors[(value - 1) % colors.length];
  gameBigText.style.textShadow = `0 0 60px ${colors[(value - 1) % colors.length]}`;
  setGameState('countdown', String(value), 'Get ready…');
  haptic(30);
});

socket.on('los-tap-now', () => {
  gamePhase = 'window';
  gameBigText.style.color = '';
  gameBigText.style.textShadow = '';
  setGameState('go', 'TAP!', 'Tap anywhere!');
  haptic([50, 30, 80]); // double-pulse haptic
});

socket.on('los-fake', () => {
  gamePhase = 'fake';
  gameBigText.style.color = '';
  gameBigText.style.textShadow = '';
  setGameState('fake', '⚠️ FAKE!', "DON'T TAP!");
  haptic([20, 10, 20, 10, 20]);
});

socket.on('los-round-result', ({ eliminated }) => {
  gamePhase = 'result';
  const wasEliminated = eliminated.some(e => e.username === myUsername);
  if (!wasEliminated) {
    setGameState('survived', '✅', 'SURVIVED!');
  }
  // reset to wait state after a beat
  setTimeout(() => {
    if (gamePhase === 'result') setGameState('wait', '🎨', '');
  }, 1200);
});

socket.on('los-early-tap', ({ username, reason }) => {
  if (username === myUsername) {
    const msg = reason === 'fake' ? 'Tapped on FAKE!' : 'Tapped too early!';
    showEliminated(msg);
  }
});

socket.on('los-late-tap', ({ username }) => {
  if (username === myUsername) showEliminated("Didn't tap in time!");
});

socket.on('los-game-over', ({ winner }) => {
  if (winner.username === myUsername) {
    winnerText.style.color = myColor;
    showScreen('winner');
    haptic([100, 50, 100, 50, 200]);
  }
  setTimeout(() => {
    gamePhase = 'lobby';
    showScreen('lobby');
    setGameState('wait', '🎨', '');
  }, 10_000);
});

// ── Full-screen tap handler (game screen) ─────────────────────────────────────
gameScreen.addEventListener('click', handleTap);
gameScreen.addEventListener('touchstart', e => { e.preventDefault(); handleTap(); }, { passive: false });

function handleTap() {
  if (gamePhase !== 'window' && gamePhase !== 'fake') return;
  socket.emit('los-tap');
  haptic(40);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showEliminated(reason) {
  placementText.textContent = reason;
  showScreen('eliminated');
  setTimeout(() => showScreen('lobby'), 10_000);
}

function renderPlayerList(list) {
  if (!playersList) return;
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
