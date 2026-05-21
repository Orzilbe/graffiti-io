// Mobile controller — token-based (platform) and legacy (direct URL) flows

const socket = io();
const COLORS = ['#FF2D78', '#00E5FF', '#76FF03', '#FF6D00'];

// ── Auth mode detection ────────────────────────────────────────────────────
const params   = new URLSearchParams(location.search);
const token    = params.get('token');
const pathId   = parseInt(location.pathname.split('/').pop(), 10);
const isLegacy = !token && !isNaN(pathId) && pathId >= 0 && pathId <= 3;

let currentSlotId = isLegacy ? pathId : null;
let myColor       = isLegacy ? (COLORS[pathId] ?? '#FF2D78') : '#FF2D78';

document.documentElement.style.setProperty('--pc', myColor);

// ── DOM refs ───────────────────────────────────────────────────────────────
const hudName   = document.getElementById('hud-name');
const hudRank   = document.getElementById('hud-rank');
const hudPct    = document.getElementById('hud-pct');
const lobbyEl   = document.getElementById('lobby-screen');
const lobbySub  = document.getElementById('lobby-sub');
const lobbyName = document.getElementById('lobby-player-name');
const goEl      = document.getElementById('go-screen');
const deathEl   = document.getElementById('death-screen');
const endEl     = document.getElementById('end-screen');
const errorEl   = document.getElementById('error-screen');
const cntEl     = document.getElementById('countdown');
const endWinner = document.getElementById('end-winner');

let gameActive = false;
let alive      = false;
let respawnIv  = null;

// ── Socket ─────────────────────────────────────────────────────────────────
socket.on('connect', () => {
  if (token) {
    lobbySub.textContent = 'Authenticating…';
    socket.emit('player-auth', { token });
  } else if (isLegacy) {
    socket.emit('player-join', { slotId: currentSlotId, name: `P${currentSlotId + 1}` });
  }
});

// ── Platform auth responses ────────────────────────────────────────────────
socket.on('auth-ok', ({ slotId, name, color }) => {
  currentSlotId = slotId;
  myColor       = color;
  document.documentElement.style.setProperty('--pc', color);
  lobbyName.textContent  = name;
  hudName.textContent    = name;
  hudName.style.color    = color;
  lobbySub.textContent   = 'Waiting for host…';
});

socket.on('auth-failed', ({ reason }) => {
  document.getElementById('error-msg').textContent = reason;
  lobbyEl.classList.remove('show');
  errorEl.classList.add('show');
});

// ── Legacy join ack ────────────────────────────────────────────────────────
socket.on('join-ack', ({ name, color }) => {
  hudName.textContent    = name;
  hudName.style.color    = color;
  lobbyName.textContent  = name;
});

// ── Game events ────────────────────────────────────────────────────────────
socket.on('game-start', () => {
  gameActive = true;
  alive      = true;
  clearInterval(respawnIv);

  lobbyEl.classList.remove('show');
  deathEl.classList.remove('show');
  endEl.classList.remove('show');

  goEl.classList.add('show');
  setTimeout(() => goEl.classList.remove('show'), 1100);
});

socket.on('leaderboard-update', board => {
  if (currentSlotId === null) return;
  const me = board.find(p => p.id === currentSlotId);
  if (!me) return;
  hudRank.textContent = `#${me.rank}`;
  hudPct.textContent  = `${me.pct}%`;
});

socket.on('player-died', ({ respawnIn }) => {
  alive = false;
  clearInterval(respawnIv);

  let t = respawnIn;
  cntEl.textContent = t;
  deathEl.classList.add('show');

  respawnIv = setInterval(() => {
    t -= 1;
    cntEl.textContent = Math.max(0, t);
    if (t <= 0) {
      clearInterval(respawnIv);
      deathEl.classList.remove('show');
      alive = true;
    }
  }, 1000);
});

socket.on('game-end', ({ winner }) => {
  gameActive = false;
  alive      = false;
  clearInterval(respawnIv);
  deathEl.classList.remove('show');
  goEl.classList.remove('show');

  endWinner.textContent = winner ? `${winner.name} wins!` : 'Draw!';
  endWinner.style.color = winner?.color ?? '#fff';
  endEl.classList.add('show');
});

// ── Input ──────────────────────────────────────────────────────────────────
function sendDir(dir) {
  if (!gameActive || !alive) return;
  socket.emit('player-input', { direction: dir });
}

document.querySelectorAll('.dpad-btn[data-dir]').forEach(btn => {
  const dir = btn.dataset.dir;

  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    btn.classList.add('active');
    sendDir(dir);
  });

  const release = () => btn.classList.remove('active');
  btn.addEventListener('pointerup',     release);
  btn.addEventListener('pointerleave',  release);
  btn.addEventListener('pointercancel', release);
});

const SWIPE_MIN = 30;
let swipeOrigin = null;

document.getElementById('dpad').addEventListener('touchstart', e => {
  const t = e.touches[0];
  swipeOrigin = { x: t.clientX, y: t.clientY };
}, { passive: true });

document.getElementById('dpad').addEventListener('touchmove', e => {
  if (!swipeOrigin) return;
  const dx = e.touches[0].clientX - swipeOrigin.x;
  const dy = e.touches[0].clientY - swipeOrigin.y;
  if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
  const dir = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? 'right' : 'left')
    : (dy > 0 ? 'down'  : 'up');
  sendDir(dir);
  swipeOrigin = null;
}, { passive: true });

document.getElementById('dpad').addEventListener('touchend',
  () => { swipeOrigin = null; }, { passive: true });
