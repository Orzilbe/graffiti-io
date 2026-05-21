const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_, res) => res.redirect('/display'));
app.get('/display', (_, res) => res.sendFile(path.join(__dirname, 'public/display.html')));
app.get('/controller/:id', (_, res) => res.sendFile(path.join(__dirname, 'public/controller.html')));
app.get('/controller',     (_, res) => res.sendFile(path.join(__dirname, 'public/controller.html')));

// QR codes — point to platform /hub when configured, else fall back to controller slots
app.get('/qrcodes', (req, res) => {
  if (PLATFORM_URL) {
    const hubUrl = `${PLATFORM_URL}/hub`;
    res.json({ 0: hubUrl, 1: hubUrl, 2: hubUrl, 3: hubUrl });
  } else {
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({ 0: `${base}/controller/0`, 1: `${base}/controller/1`,
               2: `${base}/controller/2`, 3: `${base}/controller/3` });
  }
});

// ── Constants ────────────────────────────────────────────────────────────────
const PORT            = process.env.PORT            || 3000;
const PLATFORM_URL    = process.env.PLATFORM_URL    || null;
const GAME_API_SECRET = process.env.GAME_API_SECRET || null;

const GW       = 100;
const GH       = 60;
const TICK_MS  = 50;
const GAME_MS  = 3 * 60 * 1000;
const RESP_T   = 60;
const COLORS   = ['#FF2D78', '#00E5FF', '#76FF03', '#FF6D00'];
const SPAWNS   = [
  { x: 15, y: 15, dir: 'right' }, { x: 84, y: 15, dir: 'left'  },
  { x: 15, y: 44, dir: 'right' }, { x: 84, y: 44, dir: 'left'  },
];
const OPP  = { up:'down', down:'up', left:'right', right:'left' };
const DVEC = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };

// ── Mutable game state ───────────────────────────────────────────────────────
const displays    = new Set();
const controllers = new Map();   // slotId → socketId

let territory  = [];
let trailGrid  = [];
let players    = [null, null, null, null];
let gameRunning = false;
let startTime   = 0;
let tick        = 0;
let loopId      = null;

// ── Grid helpers ─────────────────────────────────────────────────────────────
const newGrid = ()      => new Array(GW * GH).fill(-1);
const ci      = (x, y) => y * GW + x;
const inB     = (x, y) => x >= 0 && x < GW && y >= 0 && y < GH;

// ── Player helpers ────────────────────────────────────────────────────────────
function makePlayer(id, name, platformToken = null) {
  const s = SPAWNS[id];
  return { id, name, color: COLORS[id], x: s.x, y: s.y,
           dir: s.dir, pendingDir: s.dir, trail: [],
           alive: true, respawnTimer: 0, terrCount: 0, platformToken };
}

function giveSpawnZone(p) {
  const s = SPAWNS[p.id];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (inB(s.x + dx, s.y + dy)) territory[ci(s.x + dx, s.y + dy)] = p.id;
}

function spawnPlayer(p) {
  const s = SPAWNS[p.id];
  Object.assign(p, { x: s.x, y: s.y, dir: s.dir, pendingDir: s.dir,
                     trail: [], alive: true, respawnTimer: 0 });
  for (let i = 0; i < trailGrid.length; i++)
    if (trailGrid[i] === p.id) trailGrid[i] = -1;
  giveSpawnZone(p);
  calcTerritory();
}

function calcTerritory() {
  const counts = [0, 0, 0, 0];
  for (const v of territory) if (v >= 0) counts[v]++;
  for (const p of players) if (p) p.terrCount = counts[p.id];
}

function killPlayer(p) {
  if (!p.alive) return;
  p.alive = false;
  p.respawnTimer = RESP_T;
  for (let i = 0; i < trailGrid.length; i++)
    if (trailGrid[i] === p.id) trailGrid[i] = -1;
  p.trail = [];
  const sid = controllers.get(p.id);
  if (sid) io.to(sid).emit('player-died', { respawnIn: Math.ceil(RESP_T * TICK_MS / 1000) });
}

// ── Territory capture ─────────────────────────────────────────────────────────
function captureTerritory(p) {
  for (const { x, y } of p.trail) { territory[ci(x,y)] = p.id; trailGrid[ci(x,y)] = -1; }
  p.trail = [];
  const vis = new Uint8Array(GW * GH);
  const q   = [];
  const seed = (x, y) => {
    const i = ci(x, y);
    if (!vis[i] && territory[i] !== p.id) { vis[i] = 1; q.push(i); }
  };
  for (let x = 0; x < GW; x++)     { seed(x, 0); seed(x, GH - 1); }
  for (let y = 1; y < GH - 1; y++) { seed(0, y); seed(GW - 1, y); }
  while (q.length) {
    const i = q.pop();
    const x = i % GW, y = ~~(i / GW);
    for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]])
      if (inB(nx, ny)) { const ni = ci(nx,ny); if (!vis[ni] && territory[ni] !== p.id) { vis[ni]=1; q.push(ni); } }
  }
  for (let i = 0; i < territory.length; i++)
    if (!vis[i] && territory[i] !== p.id) { territory[i] = p.id; trailGrid[i] = -1; }
  calcTerritory();
}

// ── Game tick ─────────────────────────────────────────────────────────────────
function gameTick() {
  tick++;
  const timeLeft = Math.max(0, GAME_MS - (Date.now() - startTime));

  for (const p of players) {
    if (!p) continue;
    if (!p.alive) { if (--p.respawnTimer <= 0) spawnPlayer(p); continue; }
    if (p.pendingDir !== OPP[p.dir]) p.dir = p.pendingDir;
    const [dx, dy] = DVEC[p.dir];
    const nx = p.x + dx, ny = p.y + dy;
    if (!inB(nx, ny))               { killPlayer(p); continue; }
    if (trailGrid[ci(nx,ny)] !== -1) { killPlayer(p); continue; }
    p.x = nx; p.y = ny;
    const owner = territory[ci(nx, ny)];
    if (owner === p.id) {
      if (p.trail.length > 0) captureTerritory(p);
    } else {
      trailGrid[ci(nx, ny)] = p.id;
      p.trail.push({ x: nx, y: ny });
    }
  }

  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    const pa = players[a], pb = players[b];
    if (pa?.alive && pb?.alive && pa.x === pb.x && pa.y === pb.y)
      { killPlayer(pa); killPlayer(pb); }
  }

  const total = GW * GH;
  io.to([...displays]).emit('game-state', {
    tick, timeLeft, running: gameRunning, gridW: GW, gridH: GH,
    players: players.map(p => p ? {
      id: p.id, name: p.name, color: p.color,
      x: p.x, y: p.y, dir: p.dir, trail: p.trail,
      alive: p.alive, respawnTimer: p.respawnTimer,
      pct: ((p.terrCount / total) * 100).toFixed(1),
    } : null),
    territory: territory.slice(),
    trailGrid: trailGrid.slice(),
  });

  const board = players.filter(Boolean)
    .sort((a, b) => b.terrCount - a.terrCount)
    .map((p, r) => ({ rank: r+1, id: p.id, name: p.name, color: p.color,
                      pct: ((p.terrCount / total) * 100).toFixed(1) }));
  io.emit('leaderboard-update', board);

  if (timeLeft === 0) endGame();
}

function startGame() {
  territory = newGrid(); trailGrid = newGrid(); tick = 0;
  gameRunning = true; startTime = Date.now();
  players = [0,1,2,3].map(i => {
    const sid  = controllers.get(i);
    if (!sid) return null;
    const sock  = io.sockets.sockets.get(sid);
    const name  = sock?.data?.name          || `P${i+1}`;
    const token = sock?.data?.platformToken || null;
    return makePlayer(i, name, token);
  });
  players.forEach(p => { if (p) giveSpawnZone(p); });
  calcTerritory();
  if (loopId) clearInterval(loopId);
  loopId = setInterval(gameTick, TICK_MS);
  io.emit('game-start');
  console.log('[game] started with', players.filter(Boolean).length, 'players');
}

async function endGame() {
  gameRunning = false;
  clearInterval(loopId); loopId = null;
  const total  = GW * GH;
  const sorted = players.filter(Boolean).sort((a,b) => b.terrCount - a.terrCount);
  const winner = sorted[0];
  io.emit('game-end', {
    winner: winner ? { id: winner.id, name: winner.name, color: winner.color } : null,
    scores: sorted.map(p => ({ id:p.id, name:p.name, color:p.color,
                               pct: ((p.terrCount/total)*100).toFixed(1) })),
  });
  console.log('[game] ended. Winner:', winner?.name);

  if (PLATFORM_URL && GAME_API_SECRET) {
    postScoresToPlatform(players.filter(Boolean), total);
  }
}

async function postScoresToPlatform(activePlayers, total) {
  const withTokens = activePlayers.filter(p => p.platformToken);
  if (!withTokens.length) return;

  const results = await Promise.allSettled(
    withTokens.map(p =>
      fetch(`${PLATFORM_URL}/api/game/score`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-secret': GAME_API_SECRET },
        body: JSON.stringify({
          token:         p.platformToken,
          territory_pct: (p.terrCount / total) * 100,
        }),
      }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
    )
  );

  const saved = results.filter(r => r.status === 'fulfilled').length;
  console.log(`[platform] scores posted: ${saved}/${withTokens.length}`);
  if (saved > 0) io.to([...displays]).emit('scores-saved', { count: saved });
}

// ── Socket events ─────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('[+]', socket.id);

  socket.on('display-join', () => {
    displays.add(socket.id);
    socket.emit('game-state', { running:false, players:[], territory:[], trailGrid:[], gridW:GW, gridH:GH, tick:0 });
  });

  // ── Legacy join (direct controller URL, no platform token) ────────────────
  socket.on('player-join', ({ slotId, name }) => {
    if (slotId < 0 || slotId > 3) return;
    controllers.set(slotId, socket.id);
    socket.data = { slotId, name, platformToken: null };
    console.log(`[join] slot=${slotId} name=${name}`);
    io.to([...displays]).emit('player-joined', { slotId, name, color: COLORS[slotId] });
    socket.emit('join-ack', { slotId, name, color: COLORS[slotId] });
  });

  // ── Platform token auth ───────────────────────────────────────────────────
  socket.on('player-auth', async ({ token }) => {
    if (!PLATFORM_URL || !GAME_API_SECRET) {
      socket.emit('auth-failed', { reason: 'Platform integration not configured' });
      return;
    }
    try {
      const res = await fetch(
        `${PLATFORM_URL}/api/game/player-info?token=${encodeURIComponent(token)}`,
        { headers: { 'x-api-secret': GAME_API_SECRET } }
      );
      if (!res.ok) {
        socket.emit('auth-failed', { reason: 'Token expired — go back and tap JOIN again' });
        return;
      }
      const { username, avatar_url, color } = await res.json();
      const slotId = COLORS.indexOf(color);
      if (slotId === -1) {
        socket.emit('auth-failed', { reason: 'Game is full (all 4 slots taken)' });
        return;
      }
      // Disconnect any stale socket in this slot
      const prevSid = controllers.get(slotId);
      if (prevSid && prevSid !== socket.id) {
        io.sockets.sockets.get(prevSid)?.disconnect(true);
      }
      controllers.set(slotId, socket.id);
      socket.data = { slotId, name: username, platformToken: token, avatarUrl: avatar_url };
      console.log(`[auth] slot=${slotId} name=${username}`);
      io.to([...displays]).emit('player-joined', { slotId, name: username, color, avatarUrl: avatar_url });
      socket.emit('auth-ok', { slotId, name: username, color, avatarUrl: avatar_url });
    } catch (err) {
      console.error('[auth]', err);
      socket.emit('auth-failed', { reason: 'Server error — try again' });
    }
  });

  socket.on('player-input', ({ direction }) => {
    const slotId = socket.data?.slotId;
    if (slotId === undefined) return;
    const p = players[slotId];
    if (p?.alive) p.pendingDir = direction;
  });

  socket.on('game-start', () => { if (!gameRunning) startGame(); });

  socket.on('disconnect', () => {
    console.log('[-]', socket.id);
    displays.delete(socket.id);
    for (const [sid, wsid] of controllers)
      if (wsid === socket.id) {
        controllers.delete(sid);
        io.to([...displays]).emit('player-left', { slotId: sid });
        break;
      }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Mix Master  →  http://localhost:${PORT}`);
  console.log(`  Display     →  http://localhost:${PORT}/display`);
  console.log(`  Controller  →  http://localhost:${PORT}/controller/0  (slots 0–3)`);
  if (PLATFORM_URL) console.log(`  Platform    →  ${PLATFORM_URL}`);
});
