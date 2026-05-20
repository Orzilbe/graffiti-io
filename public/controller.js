// Mobile controller for /controller/:id

const socket  = io();
const slotId  = parseInt(location.pathname.split('/').pop(), 10);
const COLORS  = ['#FF2D78', '#00E5FF', '#76FF03', '#FF6D00'];
const myColor = COLORS[slotId] ?? '#FF2D78';

// Apply player color throughout
document.documentElement.style.setProperty('--pc', myColor);

// ── DOM refs ───────────────────────────────────────────────────────────────
const hudName   = document.getElementById('hud-name');
const hudRank   = document.getElementById('hud-rank');
const hudPct    = document.getElementById('hud-pct');
const lobbyEl   = document.getElementById('lobby-screen');
const goEl      = document.getElementById('go-screen');
const deathEl   = document.getElementById('death-screen');
const endEl     = document.getElementById('end-screen');
const cntEl     = document.getElementById('countdown');
const endWinner = document.getElementById('end-winner');

let gameActive = false;
let alive      = false;
let respawnIv  = null;

// ── Socket ─────────────────────────────────────────────────────────────────
socket.on('connect', () => {
  socket.emit('player-join', { slotId, name: `P${slotId + 1}` });
});

socket.on('join-ack', ({ name, color }) => {
  hudName.textContent = name;
  hudName.style.color = color;
  document.getElementById('lobby-player-name').textContent = name;
});

socket.on('game-start', () => {
  gameActive = true;
  alive      = true;
  clearInterval(respawnIv);

  lobbyEl.classList.remove('show');
  deathEl.classList.remove('show');
  endEl.classList.remove('show');

  // Flash "GO!" for 1.1s
  goEl.classList.add('show');
  setTimeout(() => goEl.classList.remove('show'), 1100);
});

socket.on('leaderboard-update', board => {
  const me = board.find(p => p.id === slotId);
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

  endWinner.textContent  = winner ? `${winner.name} wins!` : 'Draw!';
  endWinner.style.color  = winner?.color ?? '#fff';
  endEl.classList.add('show');
});

// ── Input ──────────────────────────────────────────────────────────────────
function sendDir(dir) {
  if (!gameActive || !alive) return;
  socket.emit('player-input', { direction: dir });
}

// D-pad button press / release
document.querySelectorAll('.dpad-btn[data-dir]').forEach(btn => {
  const dir = btn.dataset.dir;

  btn.addEventListener('pointerdown', e => {
    e.preventDefault();           // block long-press context menu on mobile
    btn.classList.add('active');
    sendDir(dir);
  });

  const release = () => btn.classList.remove('active');
  btn.addEventListener('pointerup',     release);
  btn.addEventListener('pointerleave',  release);
  btn.addEventListener('pointercancel', release);
});

// Swipe anywhere on the D-pad area
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
  swipeOrigin = null;   // one direction per swipe gesture
}, { passive: true });

document.getElementById('dpad').addEventListener('touchend',
  () => { swipeOrigin = null; }, { passive: true });
