// Tap Frenzy — display / big-screen logic
// Connects to /tap-frenzy Socket.io namespace

const socket      = io('/tap-frenzy');
const PLATFORM_URL = window.TF_PLATFORM_URL || '';
const COLORS      = ['#FF2D78', '#00E5FF', '#76FF03', '#FF6D00'];
const MEDALS      = ['🥇', '🥈', '🥉', '4️⃣'];

// ── State ─────────────────────────────────────────────────────
let players    = [];   // [{ userId, username, color, taps }]
let gameActive = false;

// ── DOM refs ──────────────────────────────────────────────────
const timerEl   = document.getElementById('timer');
const lobbyEl   = document.getElementById('lobby');
const waitMsg   = document.getElementById('waiting-msg');
const needMore  = document.getElementById('need-more');
const startBtn  = document.getElementById('start-btn');
const gridEl    = document.getElementById('players-grid');
const goEl      = document.getElementById('gameover');
const goTable   = document.getElementById('go-table');
const lbRows    = document.getElementById('leaderboard-rows');
const lbEmpty   = document.getElementById('lb-empty');
const sideTitle = document.getElementById('sidebar-title');

// ── Leaderboard ───────────────────────────────────────────────
async function fetchLeaderboard() {
  try {
    const res = await fetch(`${PLATFORM_URL}/api/leaderboard/display`);
    if (!res.ok) return;
    const { board } = await res.json();
    if (!board || !board.length) { lbEmpty.textContent = 'No scores yet'; return; }
    lbEmpty.remove();
    lbRows.innerHTML = board.slice(0, 12).map((row, i) => {
      const color = row.avatar_config?.color || COLORS[i % 4];
      return `<div class="lb-row">
        <span class="lb-rank" style="color:${color}">${i + 1}</span>
        <span class="lb-name">${row.username}</span>
        <span class="lb-score">${row.total_score}</span>
      </div>`;
    }).join('');
    if (board[0]?.avatar_config?.color) {
      const c = board[0].avatar_config.color;
      sideTitle.style.color      = c;
      sideTitle.style.textShadow = `0 0 16px ${c}88`;
    }
  } catch { /* CORS / network — silently ignore */ }
}
fetchLeaderboard();
setInterval(fetchLeaderboard, 30_000);

// ── Socket ────────────────────────────────────────────────────
socket.emit('tf-display-join');

socket.on('tf-lobby-update', ({ players: ps }) => {
  players = ps.map(p => ({ ...p, taps: p.taps || 0 }));
  renderLobby();
  renderCards();
});

socket.on('tf-game-start', () => {
  gameActive = true;
  goEl.style.display = 'none';
  lobbyEl.style.display = 'none';
  timerEl.textContent = '30';
  timerEl.classList.remove('urgent');
  renderCards();
});

socket.on('tf-tap-update', ({ playerId, count }) => {
  const p = players.find(x => x.userId === playerId);
  if (p) p.taps = count;
  renderCards();
});

socket.on('tf-timer', ({ secondsLeft }) => {
  timerEl.textContent = secondsLeft;
  timerEl.classList.toggle('urgent', secondsLeft <= 5);
});

socket.on('tf-game-end', ({ scores }) => {
  gameActive = false;
  renderGameOver(scores);
  // Reset lobby for next round
  setTimeout(() => {
    players = [];
    goEl.style.display = 'none';
    lobbyEl.style.display = 'flex';
    timerEl.textContent = '30';
    timerEl.classList.remove('urgent');
    renderLobby();
    renderCards();
    fetchLeaderboard();
  }, 10_000);
});

startBtn.addEventListener('click', () => socket.emit('tf-start-game'));

// ── Render helpers ────────────────────────────────────────────
function renderLobby() {
  const n = players.length;
  if (n === 0) {
    waitMsg.textContent = 'WAITING FOR PLAYERS…';
    needMore.style.display = 'none';
    startBtn.style.display = 'none';
  } else if (n === 1) {
    waitMsg.textContent = `${players[0].username} is ready!`;
    needMore.textContent = 'Need at least 1 more player';
    needMore.style.display = 'block';
    startBtn.style.display = 'none';
  } else {
    waitMsg.textContent = `${n} player${n > 1 ? 's' : ''} ready!`;
    needMore.style.display = 'none';
    startBtn.style.display = 'block';
  }
}

function renderCards() {
  if (!players.length) { gridEl.innerHTML = ''; return; }
  const maxTaps = Math.max(1, ...players.map(p => p.taps));
  gridEl.innerHTML = players.map(p => {
    const pct = gameActive ? Math.round((p.taps / maxTaps) * 100) : 0;
    return `<div class="player-card" style="border-color:${p.color}; box-shadow:0 0 24px ${p.color}33">
      <div class="card-top">
        <span class="card-name" style="color:${p.color}">${escHtml(p.username)}</span>
        <span class="card-taps-label">taps</span>
      </div>
      <div class="card-taps" style="color:${p.color}">${p.taps}</div>
      <div class="progress-track">
        <div class="progress-fill" style="width:${pct}%; background:${p.color}; box-shadow:0 0 12px ${p.color}88"></div>
      </div>
    </div>`;
  }).join('');
}

function renderGameOver(scores) {
  goTable.innerHTML = scores.map((s, i) => `
    <div class="go-row">
      <span class="go-medal">${MEDALS[i] || String(i + 1)}</span>
      <span class="go-name" style="color:${s.color || '#fff'}">${escHtml(s.username)}</span>
      <span class="go-taps">${s.taps} taps</span>
      <span class="go-pts">+${s.points}</span>
    </div>`).join('');
  goEl.style.display = 'flex';
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
