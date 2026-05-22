// Last One Standing — Display screen logic
// Connects to the /los Socket.io namespace.
// Stage 1: lobby display + weekly leaderboard sidebar.

const PLATFORM_ORIGIN = window.location.origin.includes('localhost')
  ? 'http://localhost:3000'
  : window.location.origin.replace(':3001', ':3000'); // adjust if needed

const socket = io('/los', { transports: ['websocket', 'polling'] });

// ── State ─────────────────────────────────────────────────────────────────────
let players = [];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const arenaEl      = document.getElementById('arena');
const waitingEl    = document.getElementById('waiting');
const playerCountEl = document.getElementById('player-count');
const leaderboardEl = document.getElementById('leaderboard');
const countdownEl  = document.getElementById('countdown');

// ── Socket events ─────────────────────────────────────────────────────────────
socket.emit('los-display-join');

socket.on('los-lobby-update', (list) => {
  players = list;
  renderArena();
});

// ── Arena render ──────────────────────────────────────────────────────────────
function renderArena() {
  arenaEl.innerHTML = '';

  if (players.length === 0) {
    waitingEl.style.display = 'flex';
    playerCountEl.textContent = '';
    return;
  }

  waitingEl.style.display = 'none';
  playerCountEl.textContent = `${players.length} / 4 players`;

  for (const p of players) {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.style.cssText = `
      background: ${p.color}18;
      border: 2px solid ${p.color};
      box-shadow: 0 0 30px ${p.color}44;
    `;
    card.innerHTML = `
      <div class="spray-icon">🎨</div>
      <div class="player-name" style="color:${p.color};text-shadow:0 0 16px ${p.color}88">${escHtml(p.username)}</div>
      <div class="status-badge" style="color:${p.color};border:1px solid ${p.color}44">READY ✅</div>
    `;
    arenaEl.appendChild(card);
  }
}

// ── Leaderboard polling ───────────────────────────────────────────────────────
async function fetchLeaderboard() {
  try {
    const res  = await fetch('/api/leaderboard/display', { cache: 'no-store' });
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
function updateCountdown() {
  const now  = new Date();
  const dow  = now.getUTCDay();
  const days = ((8 - dow) % 7) || 7;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  const diff = next - now;
  if (diff <= 0) { countdownEl.textContent = '0d 0h 0m'; return; }
  const m = Math.floor(diff / 60_000);
  countdownEl.textContent = `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h ${m % 60}m`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
renderArena();
fetchLeaderboard();
setInterval(fetchLeaderboard, 30_000);
updateCountdown();
setInterval(updateCountdown, 60_000);
