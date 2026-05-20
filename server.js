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

// Returns controller URLs built from the actual request host (works on localhost + Render)
app.get('/qrcodes', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({ 0: `${base}/controller/0`, 1: `${base}/controller/1`,
             2: `${base}/controller/2`, 3: `${base}/controller/3` });
});

// ── Constants ────────────────────────────────────────────────────────────
const PORT     = process.env.PORT || 3000;
const GW       = 100;               // grid width  (cells)
const GH       = 60;                // grid height (cells)
const TICK_MS  = 50;                // 20 ticks/sec
const GAME_MS  = 3 * 60 * 1000;    // 3-minute match
const RESP_T   = 60;                // respawn delay (ticks)
const COLORS   = ['#FF2D78', '#00E5FF', '#76FF03', '#FF6D00'];
const SPAWNS   = [
  { x: 15, y: 15, dir: 'right' }, { x: 84, y: 15, dir: 'left'  },
  { x: 15, y: 44, dir: 'right' }, { x: 84, y: 44, dir: 'left'  },
];
const OPP  = { up:'down', down:'up', left:'right', right:'left' };
const DVEC = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };

// ── Mutable game state ───────────────────────────────────────────────────
const displays    = new Set();
const controllers = new Map();   // slotId → socketId

let territory  = [];             // GW*GH, value = -1 | slotId
let trailGrid  = [];             // GW*GH, value = -1 | slotId
let players    = [null,null,null,null];
let gameRunning = false;
let startTime   = 0;
let tick        = 0;
let loopId      = null;

// ── Grid helpers ─────────────────────────────────────────────────────────
const newGrid  = ()      => new Array(GW * GH).fill(-1);
const ci       = (x, y) => y * GW + x;
const inB      = (x, y) => x >= 0 && x < GW && y >= 0 && y < GH;

// ── Player helpers ────────────────────────────────────────────────────────
function makePlayer(id, name) {
  const s = SPAWNS[id];
  return { id, name, color: COLORS[id], x: s.x, y: s.y,
           dir: s.dir, pendingDir: s.dir, trail: [],
           alive: true, respawnTimer: 0, terrCount: 0 };
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

// ── Territory capture via flood-fill ─────────────────────────────────────
function captureTerritory(p) {
  // 1. Convert trail → territory
  for (const { x, y } of p.trail) { territory[ci(x,y)] = p.id; trailGrid[ci(x,y)] = -1; }
  p.trail = [];

  // 2. Flood fill from every border cell that is NOT p's territory
  const vis = new Uint8Array(GW * GH);
  const q   = [];
  const seed = (x, y) => {
    const i = ci(x, y);
    if (!vis[i] && territory[i] !== p.id) { vis[i] = 1; q.push(i); }
  };
  for (let x = 0; x < GW; x++)        { seed(x, 0); seed(x, GH - 1); }
  for (let y = 1; y < GH - 1; y++)    { seed(0, y); seed(GW - 1, y); }
  while (q.length) {
    const i  = q.pop();
    const x  = i % GW, y = ~~(i / GW);
    for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]])
      if (inB(nx, ny)) { const ni = ci(nx, ny); if (!vis[ni] && territory[ni] !== p.id) { vis[ni] = 1; q.push(ni); } }
  }

  // 3. Everything unreachable from border → capture
  for (let i = 0; i < territory.length; i++)
    if (!vis[i] && territory[i] !== p.id) { territory[i] = p.id; trailGrid[i] = -1; }

  calcTerritory();
}

// ── Game tick (20 tps) ───────────────────────────────────────────────────
function gameTick() {
  tick++;
  const timeLeft = Math.max(0, GAME_MS - (Date.now() - startTime));

  for (const p of players) {
    if (!p) continue;
    if (!p.alive) { if (--p.respawnTimer <= 0) spawnPlayer(p); continue; }

    // Apply direction (no 180° reversal)
    if (p.pendingDir !== OPP[p.dir]) p.dir = p.pendingDir;
    const [dx, dy] = DVEC[p.dir];
    const nx = p.x + dx, ny = p.y + dy;

    if (!inB(nx, ny))              { killPlayer(p); continue; }   // wall
    if (trailGrid[ci(nx,ny)] !== -1) { killPlayer(p); continue; } // trail hit

    p.x = nx; p.y = ny;
    const owner = territory[ci(nx, ny)];

    if (owner === p.id) {
      if (p.trail.length > 0) captureTerritory(p);  // closed the loop
    } else {
      trailGrid[ci(nx, ny)] = p.id;
      p.trail.push({ x: nx, y: ny });
    }
  }

  // Head-on collisions
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    const pa = players[a], pb = players[b];
    if (pa?.alive && pb?.alive && pa.x === pb.x && pa.y === pb.y)
      { killPlayer(pa); killPlayer(pb); }
  }

  // Broadcast state to displays
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

  // Leaderboard to everyone (controllers show rank/%)
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
    const sid = controllers.get(i);
    return sid ? makePlayer(i, io.sockets.sockets.get(sid)?.data?.name || `P${i+1}`) : null;
  });
  players.forEach(p => { if (p) { giveSpawnZone(p); } });
  calcTerritory();
  if (loopId) clearInterval(loopId);
  loopId = setInterval(gameTick, TICK_MS);
  io.emit('game-start');
  console.log('[game] started with', players.filter(Boolean).length, 'players');
}

function endGame() {
  gameRunning = false;
  clearInterval(loopId); loopId = null;
  const total   = GW * GH;
  const sorted  = players.filter(Boolean).sort((a,b) => b.terrCount - a.terrCount);
  const winner  = sorted[0];
  io.emit('game-end', {
    winner: winner ? { id: winner.id, name: winner.name, color: winner.color } : null,
    scores: sorted.map(p => ({ id:p.id, name:p.name, color:p.color,
                               pct: ((p.terrCount/total)*100).toFixed(1) })),
  });
  console.log('[game] ended. Winner:', winner?.name);
}

// ── Socket events ─────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('[+]', socket.id);

  socket.on('display-join', () => {
    displays.add(socket.id);
    socket.emit('game-state', { running:false, players:[], territory:[], trailGrid:[], gridW:GW, gridH:GH, tick:0 });
  });

  socket.on('player-join', ({ slotId, name }) => {
    if (slotId < 0 || slotId > 3) return;
    controllers.set(slotId, socket.id);
    socket.data = { slotId, name };
    console.log(`[join] slot=${slotId} name=${name}`);
    io.to([...displays]).emit('player-joined', { slotId, name, color: COLORS[slotId] });
    socket.emit('join-ack', { slotId, name, color: COLORS[slotId] });
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
});
