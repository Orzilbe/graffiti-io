// Last One Standing — Display screen (Stage 2)
// Handles all game phases and drives the visual UI.

const socket = io('/los', { transports: ['websocket', 'polling'] });

// ── State ─────────────────────────────────────────────────────────────────────
let players      = new Map(); // socketId → { username, color, alive }
let gameRunning  = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const arenaEl      = document.getElementById('arena');
const waitingEl    = document.getElementById('waiting');
const startBtnEl   = document.getElementById('start-btn');
const roundBadgeEl = document.getElementById('round-badge');
const leaderboardEl = document.getElementById('leaderboard');
const weekCountdownEl = document.getElementById('week-countdown');

const ph = {
  round:    document.getElementById('ph-round'),
  count:    document.getElementById('ph-count'),
  tap:      document.getElementById('ph-tap'),
  fake:     document.getElementById('ph-fake'),
  gameover: document.getElementById('ph-gameover'),
};
const phRoundText  = document.getElementById('ph-round-text');
const phRoundAlive = document.getElementById('ph-round-alive');
const phCountNum   = document.getElementById('ph-count-num');
const phTapText    = document.getElementById('ph-tap-text');
const phGoWinner   = document.getElementById('go-winner-name');
const phGoPlacements = document.getElementById('go-placements');
const confettiCanvas = document.getElementById('confetti-canvas');

// ── Phase management ──────────────────────────────────────────────────────────
function showOverlay(name) {
  Object.keys(ph).forEach(k => ph[k].classList.add('hidden'));
  if (name) ph[name].classList.remove('hidden');
}

// ── Socket registration ───────────────────────────────────────────────────────
socket.emit('los-display-join');

// ── Lobby events ──────────────────────────────────────────────────────────────
socket.on('los-lobby-update', (list) => {
  if (gameRunning) return;
  players = new Map(list.map(p => [p.socketId, { ...p, alive: true }]));
  renderArena();
  updateStartBtn(list.length);
});

// ── Game events ───────────────────────────────────────────────────────────────
socket.on('los-game-start', ({ players: list }) => {
  gameRunning = true;
  players = new Map(list.map(p => [p.socketId, { ...p, alive: true }]));
  startBtnEl.classList.add('hidden');
  waitingEl.style.display = 'none';
  roundBadgeEl.textContent = '';
  showOverlay(null);
  renderArena();
});

socket.on('los-round-start', ({ round, alive }) => {
  roundBadgeEl.textContent = `ROUND ${round}`;
  phRoundText.textContent  = `ROUND ${round}`;
  phRoundAlive.textContent = `${alive} player${alive !== 1 ? 's' : ''} remaining`;
  showOverlay('round');
});

socket.on('los-countdown', ({ value }) => {
  showOverlay('count');
  phCountNum.textContent = value;

  const colors = ['#FF2D78', '#00E5FF', '#76FF03', '#FF6D00'];
  phCountNum.style.color = colors[(value - 1) % colors.length];
  phCountNum.style.textShadow = `0 0 80px ${colors[(value - 1) % colors.length]}`;

  // re-trigger animation
  phCountNum.style.animation = 'none';
  phCountNum.offsetHeight; // reflow
  phCountNum.style.animation = 'countDrop .55s cubic-bezier(.22,1,.36,1)';
});

socket.on('los-tap-now', () => {
  const aliveColors = [...players.values()].filter(p => p.alive).map(p => p.color);
  const col = aliveColors[Math.floor(Math.random() * aliveColors.length)] || '#FF2D78';
  phTapText.style.color = col;
  showOverlay('tap');
});

socket.on('los-fake', () => {
  showOverlay('fake');
});

socket.on('los-valid-tap', ({ socketId, color }) => {
  // flash the player card green briefly
  const card = document.getElementById(`card-${socketId}`);
  if (card) {
    card.style.outline = `4px solid #76FF03`;
    card.style.boxShadow = `0 0 40px #76FF0388`;
    setTimeout(() => {
      card.style.outline = '';
      card.style.boxShadow = `0 0 30px ${color}44`;
    }, 600);
  }
});

socket.on('los-early-tap', ({ socketId, username, color, reason }) => {
  eliminateCard(socketId);
});

socket.on('los-late-tap', ({ socketId, username, color }) => {
  eliminateCard(socketId);
});

socket.on('los-round-result', ({ eliminated, survivors }) => {
  eliminated.forEach(e => eliminateCard(e.socketId));
  showOverlay(null);
});

socket.on('los-game-over', ({ winner, placements }) => {
  gameRunning = false;

  phGoWinner.textContent = winner?.username ?? '???';
  phGoWinner.style.color = winner?.color ?? '#FFD600';

  phGoPlacements.innerHTML = placements.map((p, i) => `
    <div class="go-place">
      <div class="go-rank">${rankLabel(i + 1)}</div>
      <div class="go-name" style="color:${p.color}">${escHtml(p.username)}</div>
      <div class="go-pts">${[1000,600,300,100][i] ?? 0} pts</div>
    </div>
  `).join('');

  showOverlay('gameover');
  launchConfetti(winner?.color ?? '#FFD600');

  // After 8s: hide winner overlay; server broadcasts lobby-update with retained players
  setTimeout(() => {
    roundBadgeEl.textContent = '';
    showOverlay(null);
    stopConfetti();
    // Reset all current players to alive for lobby display while waiting for server update
    players.forEach(p => { p.alive = true; });
    renderArena();
  }, 8_000);
});

// ── Arena ─────────────────────────────────────────────────────────────────────
function renderArena() {
  arenaEl.innerHTML = '';

  if (players.size === 0) {
    waitingEl.style.display = 'flex';
    return;
  }

  waitingEl.style.display = 'none';

  for (const [id, p] of players) {
    const card = document.createElement('div');
    card.id = `card-${id}`;
    card.className = `player-card ${p.alive ? 'alive' : 'eliminated'}`;
    card.style.cssText = `background:${p.color}18;border:2px solid ${p.color};box-shadow:0 0 30px ${p.color}44`;
    card.innerHTML = `
      <div class="spray-icon">🎨</div>
      <div class="player-name" style="color:${p.color};text-shadow:0 0 16px ${p.color}88">${escHtml(p.username)}</div>
      <div class="status-badge" style="color:${p.color};border:1px solid ${p.color}44">${p.alive ? 'ALIVE ✅' : '💀 OUT'}</div>
    `;
    arenaEl.appendChild(card);
  }
}

function eliminateCard(socketId) {
  const p = players.get(socketId);
  if (p) p.alive = false;

  const card = document.getElementById(`card-${socketId}`);
  if (!card) return;

  // boom effect
  const boom = document.createElement('div');
  boom.className = 'boom';
  boom.textContent = '💥';
  card.querySelector('.spray-icon').appendChild(boom);

  card.classList.remove('alive');
  card.classList.add('eliminated');

  const badge = card.querySelector('.status-badge');
  if (badge) badge.textContent = '💀 OUT';
}

// ── Start button ──────────────────────────────────────────────────────────────
function updateStartBtn(count) {
  if (count >= 2 && !gameRunning) {
    startBtnEl.classList.remove('hidden');
  } else {
    startBtnEl.classList.add('hidden');
  }
}

startBtnEl.addEventListener('click', () => {
  socket.emit('los-start-game');
});

// ── Leaderboard ───────────────────────────────────────────────────────────────
async function fetchLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard/display', { cache: 'no-store' });
    if (!res.ok) return;
    const { board } = await res.json();
    renderLeaderboard(board ?? []);
  } catch { /* silently skip */ }
}

function renderLeaderboard(rows) {
  if (!rows.length) return;
  leaderboardEl.innerHTML = rows.slice(0, 10).map((r, i) => `
    <div class="lb-row">
      <span class="lb-rank">${i === 0 ? '👑' : `#${i + 1}`}</span>
      <span class="lb-name">${escHtml(r.username)}</span>
      <span class="lb-score" style="color:${r.avatar_config?.color ?? '#fff'}">${r.total_score}</span>
    </div>
  `).join('');
}

// ── Week countdown ────────────────────────────────────────────────────────────
function updateWeekCountdown() {
  const now  = new Date();
  const dow  = now.getUTCDay();
  const days = ((8 - dow) % 7) || 7;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  const diff = next - now;
  if (diff <= 0) { weekCountdownEl.textContent = '0d 0h 0m'; return; }
  const m = Math.floor(diff / 60_000);
  weekCountdownEl.textContent = `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h ${m % 60}m`;
}

// ── Confetti ──────────────────────────────────────────────────────────────────
let confettiParticles = [];
let confettiRaf = null;

function launchConfetti(winnerColor) {
  const canvas = confettiCanvas;
  const ctx = canvas.getContext('2d');
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;

  const palette = [winnerColor, '#FFD600', '#ffffff', '#FF2D78', '#00E5FF'];
  confettiParticles = Array.from({ length: 120 }, () => ({
    x:  Math.random() * canvas.width,
    y:  Math.random() * canvas.height * -1,
    r:  4 + Math.random() * 6,
    d:  2 + Math.random() * 3,
    color: palette[Math.floor(Math.random() * palette.length)],
    tilt: Math.random() * 10 - 5,
    tiltSpeed: 0.05 + Math.random() * 0.1,
    tiltAngle: 0,
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    confettiParticles.forEach(p => {
      p.tiltAngle += p.tiltSpeed;
      p.y += p.d;
      p.tilt = Math.sin(p.tiltAngle) * 12;
      if (p.y > canvas.height) { p.y = -10; p.x = Math.random() * canvas.width; }
      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 4, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 4);
      ctx.stroke();
    });
    confettiRaf = requestAnimationFrame(draw);
  }
  draw();
}

function stopConfetti() {
  if (confettiRaf) { cancelAnimationFrame(confettiRaf); confettiRaf = null; }
  const ctx = confettiCanvas.getContext('2d');
  ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  confettiParticles = [];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function rankLabel(n) {
  if (n === 1) return '🥇';
  if (n === 2) return '🥈';
  if (n === 3) return '🥉';
  return `#${n}`;
}

// ── Init ──────────────────────────────────────────────────────────────────────
renderArena();
fetchLeaderboard();
setInterval(fetchLeaderboard, 30_000);
updateWeekCountdown();
setInterval(updateWeekCountdown, 60_000);
