// Tap Frenzy — phone controller logic
// Connects to /tap-frenzy Socket.io namespace
// Reads player info from URL query params:
//   ?userId=xxx&username=yyy&color=%23FF2D78

const MEDALS      = ['🥇', '🥈', '🥉', '4️⃣'];
const POINT_LABELS = [1000, 600, 300, 100];

// ── Read URL params ───────────────────────────────────────────
const params   = new URLSearchParams(location.search);
const userId   = params.get('userId')   || `guest_${Math.random().toString(36).slice(2, 8)}`;
const username = params.get('username') || 'Player';
const color    = params.get('color')    || '#FF2D78';

// Apply player color throughout the page
document.documentElement.style.setProperty('--color', color);
document.getElementById('username').textContent = username;

// ── DOM refs ──────────────────────────────────────────────────
const tapBtn         = document.getElementById('tap-btn');
const tapCountEl     = document.getElementById('tap-count');
const timerEl        = document.getElementById('timer-display');
const overlayConnect = document.getElementById('overlay-connecting');
const overlayWaiting = document.getElementById('overlay-waiting');
const overlayGameover= document.getElementById('overlay-gameover');
const goPlacement    = document.getElementById('go-placement');
const goTapsEl       = document.getElementById('go-taps');
const goPointsEl     = document.getElementById('go-points');

// ── State ─────────────────────────────────────────────────────
let tapCount  = 0;
let gameActive = false;

// ── Socket ────────────────────────────────────────────────────
const socket = io('/tap-frenzy');

socket.on('connect', () => {
  socket.emit('tf-player-join', { userId, username, color });
});

socket.on('tf-join-ack', () => {
  overlayConnect.style.display = 'none';
  overlayWaiting.style.display = 'flex';
});

socket.on('tf-game-start', () => {
  gameActive = true;
  tapCount   = 0;
  tapCountEl.textContent = '0';
  timerEl.textContent    = '30';
  timerEl.classList.remove('urgent');
  overlayWaiting.style.display  = 'none';
  overlayGameover.style.display = 'none';
});

socket.on('tf-timer', ({ secondsLeft }) => {
  timerEl.textContent = secondsLeft;
  timerEl.classList.toggle('urgent', secondsLeft <= 5);
});

socket.on('tf-game-end', ({ scores }) => {
  gameActive = false;
  const idx  = scores.findIndex(s => s.userId === userId);
  const me   = scores[idx];

  goPlacement.textContent = idx >= 0 ? MEDALS[idx] || `#${idx + 1}` : '🎮';
  goPlacement.style.color = color;
  goTapsEl.textContent    = me ? `${me.taps} taps` : '';
  goPointsEl.textContent  = me ? `+${me.points} pts` : '';

  overlayGameover.style.display = 'flex';
  overlayWaiting.style.display  = 'none';
});

// Rejoin after a round resets
socket.on('tf-lobby-reset', () => {
  gameActive = false;
  tapCount   = 0;
  tapCountEl.textContent = '0';
  timerEl.textContent    = '30';
  timerEl.classList.remove('urgent');
  overlayGameover.style.display = 'none';
  // Re-announce to the server
  socket.emit('tf-player-join', { userId, username, color });
});

// ── Tap handler ───────────────────────────────────────────────
function handleTap() {
  if (!gameActive) return;
  tapCount++;
  tapCountEl.textContent = tapCount;

  // Pulse animation on count
  tapCountEl.classList.remove('pop');
  void tapCountEl.offsetWidth; // reflow
  tapCountEl.classList.add('pop');
  setTimeout(() => tapCountEl.classList.remove('pop'), 100);

  // Button press animation
  tapBtn.classList.add('tap-anim');
  setTimeout(() => tapBtn.classList.remove('tap-anim'), 100);

  socket.emit('tf-tap');
}

// Both touch and click so it works on desktop too
tapBtn.addEventListener('touchstart', e => { e.preventDefault(); handleTap(); }, { passive: false });
tapBtn.addEventListener('click', handleTap);
