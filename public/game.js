// 60fps canvas renderer for /display

const socket  = io();
const canvas  = document.getElementById('game-canvas');
const ctx     = canvas.getContext('2d');
const lobbyEl = document.getElementById('lobby');
const goEl    = document.getElementById('gameover');
const timerEl = document.getElementById('timer');
const lbEl    = document.getElementById('leaderboard');
const sidebar = document.getElementById('sidebar');
const lbTitle = document.getElementById('sidebar-title');

const COLORS = ['#FF2D78', '#00E5FF', '#76FF03', '#FF6D00'];
const RGB    = COLORS.map(h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]);

// ── State ──────────────────────────────────────────────────────────────────
let gs        = { running:false, players:[], territory:[], trailGrid:[], gridW:100, gridH:60, timeLeft:0 };
let brickBg   = null;
let particles = [];      // death splatter
let drips     = [];      // territory edge drips (recomputed at 20fps)
const rowMap  = new Map(); // player id → leaderboard DOM element

const terrOff  = document.createElement('canvas');
const trailOff = document.createElement('canvas');
terrOff.width = trailOff.width = 100;
terrOff.height = trailOff.height = 60;

// ── QR codes — generated once on page load ────────────────────────────────
async function initQRCodes() {
  try {
    const urls = await fetch('/qrcodes').then(r => r.json());
    for (let i = 0; i < 4; i++) {
      new QRCode(document.getElementById(`qr-${i}`), {
        text: urls[i], width: 180, height: 180,
        colorDark: '#111', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H,
      });
    }
  } catch (e) { console.error('[QR] init failed:', e); }
}
initQRCodes();

// ── Socket events ──────────────────────────────────────────────────────────
socket.emit('display-join');

socket.on('game-state', s => {
  checkDeaths(gs, s);
  gs = s;
  computeDrips();
});

socket.on('player-joined', ({ slotId, name }) => {
  document.getElementById(`slot-${slotId}`).classList.add('connected');
  document.getElementById(`overlay-${slotId}`).classList.remove('hidden');
  document.getElementById(`name-${slotId}`).textContent = name;
});
socket.on('player-left', ({ slotId }) => {
  document.getElementById(`slot-${slotId}`).classList.remove('connected');
  document.getElementById(`overlay-${slotId}`).classList.add('hidden');
  document.getElementById(`name-${slotId}`).textContent = '';
});
socket.on('leaderboard-update', board => updateLeaderboard(board));

socket.on('game-start', () => {
  particles = []; drips = [];
  rowMap.clear(); lbEl.innerHTML = '';
  lobbyEl.style.display = 'none';
  timerEl.style.display = 'block';
  goEl.style.display    = 'none';
});

socket.on('game-end', ({ winner, scores }) => {
  timerEl.style.display = 'none';
  const wl = document.getElementById('winner-line');
  wl.textContent = winner ? `${winner.name} wins!` : 'Draw!';
  wl.style.color = winner?.color || '#fff';
  document.getElementById('final-scores').innerHTML = scores
    .map(p => `<div class="score-row"><span style="color:${p.color}">${p.name}</span><span>${p.pct}%</span></div>`)
    .join('');
  goEl.style.display = 'flex';

  // Notify Mix Master platform when embedded in an iframe
  if (window.parent !== window) {
    window.parent.postMessage({
      type:   'mix-master-game-end',
      winner: winner ? { name: winner.name } : null,
      scores: scores.map(p => ({ name: p.name, pct: parseFloat(p.pct) })),
    }, '*');
  }
});

document.getElementById('start-btn').addEventListener('click', () => socket.emit('game-start'));

socket.on('scores-saved', ({ count }) => {
  const toast = document.createElement('div');
  toast.textContent = `✓ ${count} score${count !== 1 ? 's' : ''} saved`;
  Object.assign(toast.style, {
    position: 'fixed', bottom: '28px', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(118,255,3,.18)', border: '2px solid #76FF03',
    color: '#76FF03', fontFamily: "'Boogaloo', sans-serif", fontSize: '1.15rem',
    padding: '10px 26px', borderRadius: '10px', zIndex: '99',
    backdropFilter: 'blur(6px)', opacity: '1', transition: 'opacity 0.6s',
  });
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; }, 2800);
  setTimeout(() => toast.remove(), 3400);
});

// ── Leaderboard — FLIP rank-slide animation ────────────────────────────────
function updateLeaderboard(board) {
  // Ensure a persistent DOM row exists per player
  for (const p of board) {
    if (rowMap.has(p.id)) continue;
    const el = document.createElement('div');
    el.className = 'lb-row'; el.dataset.id = p.id;
    el.innerHTML =
      `<span class="lb-rank"></span>` +
      `<span class="lb-swatch" style="background:${p.color}"></span>` +
      `<span class="lb-name">${p.name}</span>` +
      `<span class="lb-pct"></span>`;
    lbEl.appendChild(el);
    rowMap.set(p.id, el);
  }

  // FLIP step 1 — snapshot current Y positions
  const first = {};
  for (const [id, el] of rowMap) first[id] = el.getBoundingClientRect().top;

  // FLIP step 2 — update content + reorder (appendChild moves existing nodes)
  for (const p of board) {
    const el = rowMap.get(p.id);
    el.querySelector('.lb-rank').textContent = p.rank === 1 ? '\u{1F451}' : p.rank;
    el.querySelector('.lb-rank').style.color = p.color;
    el.querySelector('.lb-pct').textContent  = `${p.pct}%`;
    el.querySelector('.lb-pct').style.color  = p.color;
    el.classList.toggle('gold', p.rank === 1);
    lbEl.appendChild(el);
  }

  // FLIP step 3 — invert, force reflow, play
  for (const [id, el] of rowMap) {
    const delta = first[id] - el.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) continue;
    el.style.transition = 'none';
    el.style.transform  = `translateY(${delta}px)`;
    el.getBoundingClientRect();                        // flush layout
    el.style.transition = 'transform 400ms ease-in-out';
    el.style.transform  = '';
  }

  // Sidebar border + title glow follow leader color
  if (board[0]) {
    sidebar.style.borderLeftColor = board[0].color;
    lbTitle.style.color      = board[0].color;
    lbTitle.style.textShadow = `0 0 14px ${board[0].color}`;
  }
}

// ── Death detection ────────────────────────────────────────────────────────
function checkDeaths(prev, curr) {
  if (!prev.players.length) return;
  for (const p of curr.players) {
    if (!p) continue;
    const was = prev.players[p.id];
    if (was?.alive && !p.alive) spawnSplatter(was.x, was.y, p.color);
  }
}

function spawnSplatter(gx, gy, color) {
  const cw = canvas.width / gs.gridW, ch = canvas.height / gs.gridH;
  const ox = (gx + .5) * cw, oy = (gy + .5) * ch;
  for (let i = 0; i < 26; i++) {
    const ang = Math.random() * Math.PI * 2;
    // Mix of fast-small and slow-big drops for a natural splatter
    const heavy = Math.random() < 0.3;
    const spd   = heavy ? 1.5 + Math.random() * 5 : 4 + Math.random() * 11;
    particles.push({
      x: ox, y: oy,
      vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 1.5,
      r: heavy ? 5 + Math.random() * 7 : 2 + Math.random() * 5,
      color, life: 1,
      decay: (heavy ? 0.016 : 0.026) + Math.random() * 0.012,
    });
  }
}

function renderParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x  += p.vx;  p.y  += p.vy;
    p.vy += 0.35;                   // gravity
    p.vx *= 0.91;  p.vy *= 0.91;   // air drag
    p.life -= p.decay;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, p.life * 1.4);
    ctx.fillStyle   = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.r * p.life), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ── Paint drips (bottom edge of territory blocks) ─────────────────────────
function computeDrips() {
  drips = [];
  const { territory, gridW: gw, gridH: gh } = gs;
  if (!territory.length) return;
  for (let y = 0; y < gh - 1; y++)
    for (let x = 0; x < gw; x++) {
      const o = territory[y * gw + x];
      if (o >= 0 && territory[(y + 1) * gw + x] !== o)
        drips.push({ x, y: y + 1, o, h: 5 + ((x * 137 + y * 31) % 9) });
    }
}

function renderDrips() {
  if (!drips.length) return;
  const cw = canvas.width / gs.gridW, ch = canvas.height / gs.gridH;
  const groups = [[], [], [], []];
  for (const d of drips) groups[d.o].push(d);
  for (let o = 0; o < 4; o++) {
    if (!groups[o].length) continue;
    ctx.fillStyle = COLORS[o] + 'cc';
    ctx.beginPath();
    for (const d of groups[o])
      ctx.ellipse((d.x + .5) * cw, d.y * ch + d.h * .45, cw * .13, d.h * .6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Brick wall (built once per resize) ────────────────────────────────────
function buildBrick(w, h) {
  const off = Object.assign(document.createElement('canvas'), { width:w, height:h });
  const c = off.getContext('2d');
  const BW = 64, BH = 26;
  c.fillStyle = '#111'; c.fillRect(0, 0, w, h);
  for (let row = 0; row * BH < h + BH; row++) {
    const ox = (row % 2) * (BW / 2);
    for (let col = -1; col * BW < w + BW; col++) {
      const shade = 8 + Math.abs(Math.sin(col * 7.3 + row * 13.1) * 4 | 0);
      c.fillStyle = `hsl(0,0%,${shade}%)`;
      c.fillRect(col * BW + ox + 2, row * BH + 2, BW - 4, BH - 4);
    }
  }
  return off;
}

// ── Grid pixel renderer ────────────────────────────────────────────────────
function renderGrid() {
  const { territory, trailGrid, gridW: gw, gridH: gh } = gs;
  if (!territory.length) return;
  if (terrOff.width !== gw)  { terrOff.width  = trailOff.width  = gw; }
  if (terrOff.height !== gh) { terrOff.height = trailOff.height = gh; }
  const tc = terrOff.getContext('2d'),  tImg = tc.createImageData(gw, gh);
  const rc = trailOff.getContext('2d'), rImg = rc.createImageData(gw, gh);
  for (let i = 0, n = gw * gh; i < n; i++) {
    const to = territory[i], ro = trailGrid[i];
    if (to >= 0) { const [r,g,b]=RGB[to]; tImg.data[i*4]=r;tImg.data[i*4+1]=g;tImg.data[i*4+2]=b;tImg.data[i*4+3]=148; }
    if (ro >= 0) { const [r,g,b]=RGB[ro]; rImg.data[i*4]=r;rImg.data[i*4+1]=g;rImg.data[i*4+2]=b;rImg.data[i*4+3]=215; }
  }
  tc.putImageData(tImg, 0, 0); rc.putImageData(rImg, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terrOff,  0, 0, canvas.width, canvas.height);
  ctx.drawImage(trailOff, 0, 0, canvas.width, canvas.height);
}

// ── Spray-can sprite ────────────────────────────────────────────────────────
function renderPlayers() {
  const { players, gridW: gw, gridH: gh } = gs;
  if (!players.length) return;
  const cw = canvas.width / gw, ch = canvas.height / gh;
  for (const p of players) {
    if (!p || !p.alive) continue;
    const cx = (p.x + .5) * cw, cy = (p.y + .5) * ch;
    const r  = Math.min(cw, ch) * .68;
    const ang = { right:0, down:Math.PI/2, left:Math.PI, up:-Math.PI/2 }[p.dir] ?? 0;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(0,0,r*.52,r*.74,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ddd';
    ctx.beginPath(); ctx.ellipse(0,-r*.58,r*.24,r*.19,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = p.color+'bb';
    ctx.beginPath(); ctx.ellipse(0,-r*.88,r*.09,r*.18,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.beginPath(); ctx.ellipse(-r*.16,-r*.1,r*.13,r*.3,-.3,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

// ── Timer ──────────────────────────────────────────────────────────────────
const fmtTime = ms => { const s = Math.ceil(ms/1000); return `${~~(s/60)}:${String(s%60).padStart(2,'0')}`; };

// ── Render loop (60 fps) ───────────────────────────────────────────────────
function render() {
  if (brickBg) ctx.drawImage(brickBg, 0, 0);
  else { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  renderGrid();
  renderDrips();
  renderPlayers();
  renderParticles();
  if (gs.running) timerEl.textContent = fmtTime(gs.timeLeft);
  requestAnimationFrame(render);
}

// ── Resize ─────────────────────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
  brickBg = buildBrick(canvas.width, canvas.height);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
requestAnimationFrame(render);
