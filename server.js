const express = require('express');
const http = require('http');
const {Server} = require('socket.io');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const ALLOWED_ORIGINS = ['https://mix-master-gray.vercel.app', 'http://localhost:3000', 'http://localhost:3001',];
const io = new Server(httpServer, {
    cors: {origin: ALLOWED_ORIGINS, methods: ['GET', 'POST']}, perMessageDeflate: false,
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({status: 'ok'});
});
app.get('/', (_, res) => res.redirect('/display'));
app.get('/display', (_, res) => res.sendFile(path.join(__dirname, 'public/display.html')));
app.get('/controller', (_, res) => res.sendFile(path.join(__dirname, 'public/controller.html')));
app.get('/controller/:id', (_, res) => res.sendFile(path.join(__dirname, 'public/controller.html')));

// QR codes for the standalone /display lobby (4 controller URLs)
app.get('/qrcodes', (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    res.json([0, 1, 2, 3].map(i => `${base}/controller/${i}`));
});

// ── Constants ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const PLATFORM_URL = process.env.PLATFORM_URL || null;
const GAME_API_SECRET = process.env.GAME_API_SECRET || null;

const GW = 100;
const GH = 60;
const TICK_MS = 50;
const GAME_MS = 3 * 60 * 1000;
const RESP_T = 60;
const COLORS = ['#FF2D78', '#00E5FF', '#76FF03', '#FF6D00'];
const SPAWNS = [{x: 15, y: 15, dir: 'right'}, {x: 84, y: 15, dir: 'left'}, {x: 15, y: 44, dir: 'right'}, {
    x: 84,
    y: 44,
    dir: 'left'
},];
const OPP = {up: 'down', down: 'up', left: 'right', right: 'left'};
const DVEC = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]};

// ── Color helpers ─────────────────────────────────────────────────────────────
function hexToHSL(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255,
        b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            case b:
                h = (r - g) / d + 4;
                break;
        }
        h /= 6;
    }
    return {h: h * 360, s: s * 100, l: l * 100};
}

function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [0, 8, 4].map(n => Math.round(f(n) * 255).toString(16).padStart(2, '0')).join('');
}

function shiftHue(hex, deg) {
    const {h, s, l} = hexToHSL(hex);
    return hslToHex((h + deg) % 360, s, l);
}

function pickColor(wantedColor, slotId) {
    const usedColors = new Set([...lobbyPlayers.values()].map(p => p.color));
    let color = wantedColor || COLORS[slotId];
    if (usedColors.has(color)) color = shiftHue(color, 40);
    return color;
}

// ── Mutable game state ───────────────────────────────────────────────────────
const displays = new Set();
const controllers = new Map();    // slotId → socketId
const lobbyPlayers = new Map();    // socketId → { slotId, userId, username, avatarUrl, avatarConfig, color }
const waitingQueue = [];           // [{ socketId, userId, username, avatarUrl, avatarConfig }]

let territory = [];
let trailGrid = [];
let players = [null, null, null, null];
let gameRunning = false;
let startTime = 0;
let tick = 0;
let loopId = null;
let prevTerritory = [];
let prevTrail = [];
let lbTick = 0;
let embedReadyReceived = false;

let gamePhase = 'lobby';   // 'lobby' | 'countdown' | 'playing' | 'ended'
let countdownId = null;      // setInterval handle for the 3-2-1 ticker
let countdownTo = null;      // setTimeout handle for the 800ms GO → start delay
let endResetTo = null;      // setTimeout handle for the 8s post-game lobby reset

// ── Grid helpers ─────────────────────────────────────────────────────────────
const newGrid = () => new Array(GW * GH).fill(-1);
const ci = (x, y) => y * GW + x;
const inB = (x, y) => x >= 0 && x < GW && y >= 0 && y < GH;

// ── Player helpers ────────────────────────────────────────────────────────────
function makePlayer(id, name, userId = null, color = null) {
    const s = SPAWNS[id];
    return {
        id,
        name,
        color: color || COLORS[id],
        x: s.x,
        y: s.y,
        dir: s.dir,
        pendingDir: s.dir,
        trail: [],
        alive: true,
        respawnTimer: 0,
        terrCount: 0,
        userId
    };
}

function giveSpawnZone(p) {
    const s = SPAWNS[p.id];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inB(s.x + dx, s.y + dy)) territory[ci(s.x + dx, s.y + dy)] = p.id;
}

function spawnPlayer(p) {
    const s = SPAWNS[p.id];
    Object.assign(p, {
        x: s.x, y: s.y, dir: s.dir, pendingDir: s.dir, trail: [], alive: true, respawnTimer: 0
    });
    for (let i = 0; i < trailGrid.length; i++) if (trailGrid[i] === p.id) trailGrid[i] = -1;
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
    for (let i = 0; i < trailGrid.length; i++) if (trailGrid[i] === p.id) trailGrid[i] = -1;
    p.trail = [];
    const sid = controllers.get(p.id);
    if (sid) io.to(sid).emit('player-died', {respawnIn: Math.ceil(RESP_T * TICK_MS / 1000)});
}

// ── Territory capture (flood-fill) ────────────────────────────────────────────
function captureTerritory(p) {
    for (const {x, y} of p.trail) {
        territory[ci(x, y)] = p.id;
        trailGrid[ci(x, y)] = -1;
    }
    p.trail = [];
    const vis = new Uint8Array(GW * GH);
    const q = [];
    const seed = (x, y) => {
        const i = ci(x, y);
        if (!vis[i] && territory[i] !== p.id) {
            vis[i] = 1;
            q.push(i);
        }
    };
    for (let x = 0; x < GW; x++) {
        seed(x, 0);
        seed(x, GH - 1);
    }
    for (let y = 1; y < GH - 1; y++) {
        seed(0, y);
        seed(GW - 1, y);
    }
    while (q.length) {
        const i = q.pop();
        const x = i % GW, y = ~~(i / GW);
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (inB(nx, ny)) {
            const ni = ci(nx, ny);
            if (!vis[ni] && territory[ni] !== p.id) {
                vis[ni] = 1;
                q.push(ni);
            }
        }
    }
    for (let i = 0; i < territory.length; i++) if (!vis[i] && territory[i] !== p.id) {
        territory[i] = p.id;
        trailGrid[i] = -1;
    }
    calcTerritory();
}

// ── Game tick ─────────────────────────────────────────────────────────────────
function gameTick() {
    tick++;
    const timeLeft = Math.max(0, GAME_MS - (Date.now() - startTime));

    for (const p of players) {
        if (!p) continue;
        if (!p.alive) {
            if (--p.respawnTimer <= 0) spawnPlayer(p);
            continue;
        }
        if (p.pendingDir !== OPP[p.dir]) p.dir = p.pendingDir;
        const [dx, dy] = DVEC[p.dir];
        const nx = p.x + dx, ny = p.y + dy;
        if (!inB(nx, ny)) {
            killPlayer(p);
            continue;
        }
        if (trailGrid[ci(nx, ny)] !== -1) {
            killPlayer(p);
            continue;
        }
        p.x = nx;
        p.y = ny;
        const owner = territory[ci(nx, ny)];
        if (owner === p.id) {
            if (p.trail.length > 0) captureTerritory(p);
        } else {
            trailGrid[ci(nx, ny)] = p.id;
            p.trail.push({x: nx, y: ny});
        }
    }

    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
        const pa = players[a], pb = players[b];
        if (pa?.alive && pb?.alive && pa.x === pb.x && pa.y === pb.y) {
            killPlayer(pa);
            killPlayer(pb);
        }
    }

    const total = GW * GH;
    const terrDelta = [], trailDelta = [];
    for (let i = 0, len = GW * GH; i < len; i++) {
        if (territory[i] !== prevTerritory[i]) terrDelta.push(i, territory[i]);
        if (trailGrid[i] !== prevTrail[i]) trailDelta.push(i, trailGrid[i]);
    }
    prevTerritory = territory.slice();
    prevTrail = trailGrid.slice();

    io.to([...displays]).emit('game-state', {
        tick, timeLeft, running: gameRunning, players: players.map(p => p ? {
            id: p.id,
            name: p.name,
            color: p.color,
            x: p.x,
            y: p.y,
            dir: p.dir,
            trail: p.trail,
            alive: p.alive,
            respawnTimer: p.respawnTimer,
            pct: ((p.terrCount / total) * 100).toFixed(1),
        } : null), terrDelta, trailDelta,
    });

    if (++lbTick % 4 === 0) {
        const board = players.filter(Boolean)
            .sort((a, b) => b.terrCount - a.terrCount)
            .map((p, r) => ({
                rank: r + 1, id: p.id, name: p.name, color: p.color, pct: ((p.terrCount / total) * 100).toFixed(1)
            }));
        io.emit('leaderboard-update', board);
    }

    if (timeLeft === 0) endGame();
}

function clearAllTimers() {
    if (loopId) {
        clearInterval(loopId);
        loopId = null;
    }
    if (countdownId) {
        clearInterval(countdownId);
        countdownId = null;
    }
    if (countdownTo) {
        clearTimeout(countdownTo);
        countdownTo = null;
    }
    if (endResetTo) {
        clearTimeout(endResetTo);
        endResetTo = null;
    }
}

function startGame() {
    if (gamePhase === 'countdown' || gamePhase === 'playing') {
        console.log('[game] startGame ignored — phase already', gamePhase);
        return;
    }

    clearAllTimers();
    gamePhase = 'countdown';
    embedReadyReceived = false;

    territory = newGrid();
    trailGrid = newGrid();
    tick = 0;
    startTime = Date.now();
    players = [0, 1, 2, 3].map(i => {
        const sid = controllers.get(i);
        if (!sid) return null;
        const sock = io.sockets.sockets.get(sid);
        const name = sock?.data?.name || `P${i + 1}`;
        const userId = sock?.data?.userId || null;
        const color = sock?.data?.color || COLORS[i];
        return makePlayer(i, name, userId, color);
    });
    players.forEach(p => { if (p) giveSpawnZone(p); });
    calcTerritory();
    prevTerritory = territory.slice();
    prevTrail = trailGrid.slice();
    lbTick = 0;

    io.emit('game-countdown', { count: 3 });

    const embeddedModeActive = [...displays].length > 0 && PLATFORM_URL;

    if (!embeddedModeActive) {
        runCountdownSequence();
    } else {
        countdownTo = setTimeout(() => {
            if (gamePhase === 'countdown' && !embedReadyReceived) {
                console.log('[game] Iframe ready timeout hit, forcing countdown sequence');
                runCountdownSequence();
            }
        }, 1500);
    }
}

function runCountdownSequence() {
    if (countdownId) clearInterval(countdownId);

    let count = 3;
    io.emit('game-countdown', { count });

    countdownId = setInterval(() => {
        count--;
        io.emit('game-countdown', { count });
        if (count <= 0) {
            clearInterval(countdownId);
            countdownId = null;
            countdownTo = setTimeout(() => {
                countdownTo = null;
                gameRunning = true;
                gamePhase = 'playing';
                startTime = Date.now();
                if (loopId) clearInterval(loopId);
                loopId = setInterval(gameTick, TICK_MS);
                io.emit('game-start');
                console.log('[game] started with', players.filter(Boolean).length, 'players');
            }, 800);
        }
    }, 1000);
}

async function endGame() {
    if (gamePhase === 'ended' || gamePhase === 'lobby') {
        console.log('[game] endGame ignored — phase already', gamePhase);
        return;
    }

    clearAllTimers();
    gameRunning = false;
    gamePhase = 'ended';

    const total = GW * GH;
    const sorted = players.filter(Boolean).sort((a, b) => b.terrCount - a.terrCount);
    const winner = sorted[0];
    io.emit('game-end', {
        winner: winner ? {id: winner.id, name: winner.name, color: winner.color} : null, scores: sorted.map(p => ({
            id: p.id, name: p.name, color: p.color, pct: ((p.terrCount / total) * 100).toFixed(1)
        })),
    });
    const activePlayers = players.filter(Boolean);
    console.log('[game] ended. Winner:', winner?.name, '| players:', activePlayers.map(p => `${p.name}(userId=${p.userId})`).join(', '));

    if (!PLATFORM_URL || !GAME_API_SECRET) {
        console.log('[platform] PLATFORM_URL or GAME_API_SECRET not set — scores not saved');
    } else {
        await postScoresToPlatform(activePlayers, total);
    }

    endResetTo = setTimeout(() => {
        endResetTo = null;
        autoResetToLobby();
    }, 8000);
}

function autoResetToLobby() {
    controllers.clear();
    lobbyPlayers.clear();
    players = [null, null, null, null];
    territory = newGrid();
    trailGrid = newGrid();
    gamePhase = 'lobby';
    io.emit('lobby-update', []);
    io.emit('lobby-reset');
    promoteFromQueue();
    console.log('[lobby] auto-reset to lobby (8s timeout)');
}

function playAgainReset() {
    if (endResetTo) {
        clearTimeout(endResetTo);
        endResetTo = null;
    }
    clearAllTimers();

    gamePhase = 'lobby';
    gameRunning = false;
    territory = newGrid();
    trailGrid = newGrid();
    players = [null, null, null, null];
    prevTerritory = [];
    prevTrail = [];

    for (const [slotId, socketId] of [...controllers]) {
        const sock = io.sockets.sockets.get(socketId);
        if (!sock || !sock.connected) {
            controllers.delete(slotId);
            continue;
        }
        io.to([...displays]).emit('player-joined', {
            slotId,
            name: sock.data?.name ?? `P${slotId + 1}`,
            color: sock.data?.color ?? COLORS[slotId],
            avatarUrl: sock.data?.avatarUrl ?? null,
            avatarConfig: sock.data?.avatarConfig ?? null,
        });
    }
    io.emit('lobby-reset');
    io.emit('lobby-update', [...lobbyPlayers.values()]);
    console.log('[lobby] play-again reset, controllers:', controllers.size);
}

async function postScoresToPlatform(activePlayers, total) {
    const withIds = activePlayers.filter(p => p.userId);
    console.log(`[platform] posting scores: ${withIds.length}/${activePlayers.length} players have userId`);
    if (!withIds.length) {
        console.log('[platform] no players with userId — check that lobby-join sends userId');
        return;
    }

    const results = await Promise.allSettled(withIds.map(async p => {
        const territory_pct = (p.terrCount / total) * 100;
        console.log(`[platform] → POST score userId=${p.userId} pct=${territory_pct.toFixed(1)}%`);
        const res = await fetch(`${PLATFORM_URL}/api/game/score`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'x-api-secret': GAME_API_SECRET},
            body: JSON.stringify({userId: p.userId, territory_pct}),
        });
        const text = await res.text();
        console.log(`[platform] ← response ${res.status}: ${text}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    }));

    const saved = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected');
    console.log(`[platform] scores saved: ${saved}/${withIds.length}`);
    failed.forEach((r, i) => console.log(`[platform] failed[${i}]:`, r.reason));
    if (saved > 0) io.to([...displays]).emit('scores-saved', {count: saved});
}

function broadcastQueuePositions() {
    waitingQueue.forEach((p, i) => {
        const sock = io.sockets.sockets.get(p.socketId);
        if (sock) sock.emit('queue-position', {position: i + 1, totalWaiting: waitingQueue.length});
    });
}

function promoteFromQueue() {
    while (waitingQueue.length > 0) {
        const usedSlots = new Set(controllers.keys());
        const slotId = [0, 1, 2, 3].find(i => !usedSlots.has(i));
        if (slotId === undefined) break;

        const pd = waitingQueue.shift();
        broadcastQueuePositions();

        const sock = io.sockets.sockets.get(pd.socketId);
        if (!sock || !sock.connected) continue;

        const color = pickColor(pd.wantedColor, slotId);
        console.log(`[queue] promoted ${pd.username} → slot=${slotId} wantedColor=${pd.wantedColor} → assigned=${color}`);
        controllers.set(slotId, sock.id);
        sock.data = {
            slotId, name: pd.username, userId: pd.userId, avatarUrl: pd.avatarUrl, avatarConfig: pd.avatarConfig, color
        };
        lobbyPlayers.set(sock.id, {
            slotId,
            userId: pd.userId,
            username: pd.username,
            avatarUrl: pd.avatarUrl,
            avatarConfig: pd.avatarConfig,
            color
        });

        sock.emit('promoted-to-player', {slotId, color});
        io.emit('lobby-update', [...lobbyPlayers.values()]);
        io.to([...displays]).emit('player-joined', {
            slotId, name: pd.username, color, avatarUrl: pd.avatarUrl, avatarConfig: pd.avatarConfig
        });
        console.log(`[queue] promoted ${pd.username} → slot ${slotId}`);
    }
}

io.on('connection', socket => {
    console.log('[+]', socket.id);

    socket.on('display-ready', () => {
        if (gamePhase === 'countdown' && !embedReadyReceived) {
            console.log(`[game] Iframe layout confirmed by connection ${socket.id}. Kicking off countdown sequence.`);
            embedReadyReceived = true;
            if (countdownTo) clearTimeout(countdownTo);
            runCountdownSequence();
        }
    });

    socket.on('display-join', () => {
        displays.add(socket.id);
        const total = GW * GH;
        socket.emit('lobby-update', [...lobbyPlayers.values()]);
        if (gameRunning) socket.emit('game-start');
        socket.emit('game-state-full', {
            tick,
            running: gameRunning,
            gridW: GW,
            gridH: GH,
            timeLeft: gameRunning ? Math.max(0, GAME_MS - (Date.now() - startTime)) : 0,
            players: players.map(p => p ? {
                id: p.id,
                name: p.name,
                color: p.color,
                x: p.x,
                y: p.y,
                dir: p.dir,
                trail: p.trail,
                alive: p.alive,
                respawnTimer: p.respawnTimer,
                pct: ((p.terrCount / total) * 100).toFixed(1),
            } : null),
            territory: territory.slice(),
            trailGrid: trailGrid.slice(),
        });
    });

    socket.on('lobby-join', ({userId, username, avatarUrl, avatarConfig, color: clientColor}) => {
        const cfg = avatarConfig ?? null;
        const wantedColor = clientColor || cfg?.color;

        if (gameRunning) {
            if (!waitingQueue.find(p => p.socketId === socket.id)) {
                waitingQueue.push({socketId: socket.id, userId, username, avatarUrl, avatarConfig: cfg, wantedColor});
                socket.data = {name: username, userId, avatarUrl, avatarConfig: cfg, inQueue: true};
            }
            socket.emit('game-in-progress');
            const pos = waitingQueue.findIndex(p => p.socketId === socket.id) + 1;
            socket.emit('queue-position', {position: pos, totalWaiting: waitingQueue.length});
            return;
        }

        const usedSlots = new Set(controllers.keys());
        const slotId = [0, 1, 2, 3].find(i => !usedSlots.has(i));

        if (slotId === undefined) {
            if (!waitingQueue.find(p => p.socketId === socket.id)) {
                waitingQueue.push({socketId: socket.id, userId, username, avatarUrl, avatarConfig: cfg, wantedColor});
                socket.data = {name: username, userId, avatarUrl, avatarConfig: cfg, inQueue: true};
            }
            const pos = waitingQueue.findIndex(p => p.socketId === socket.id) + 1;
            socket.emit('queue-position', {position: pos, totalWaiting: waitingQueue.length});
            broadcastQueuePositions();
            return;
        }

        const color = pickColor(wantedColor, slotId);
        console.log(`[lobby] slot=${slotId} user=${username} clientColor=${clientColor} avatarColor=${cfg?.color} → assigned=${color}`);
        controllers.set(slotId, socket.id);
        socket.data = {slotId, name: username, userId, avatarUrl, avatarConfig: cfg, color};
        lobbyPlayers.set(socket.id, {slotId, userId, username, avatarUrl, avatarConfig: cfg, color});

        socket.emit('lobby-join-ack', {slotId, color, username, avatarUrl, avatarConfig: cfg});
        io.emit('lobby-update', [...lobbyPlayers.values()]);
        io.to([...displays]).emit('player-joined', {slotId, name: username, color, avatarUrl, avatarConfig: cfg});
    });

    socket.on('player-join', ({slotId, name}) => {
        if (slotId < 0 || slotId > 3) return;
        controllers.set(slotId, socket.id);
        socket.data = {slotId, name, userId: null};
        console.log(`[join-legacy] slot=${slotId} name=${name}`);
        io.to([...displays]).emit('player-joined', {slotId, name, color: COLORS[slotId]});
        socket.emit('join-ack', {slotId, name, color: COLORS[slotId]});
    });

    socket.on('player-input', ({direction}) => {
        const slotId = socket.data?.slotId;
        if (slotId === undefined) return;
        const p = players[slotId];
        if (p?.alive) p.pendingDir = direction;
    });

    socket.on('game-start', () => {
        if (gamePhase !== 'lobby') {
            console.log('[game] game-start ignored — phase is', gamePhase);
            return;
        }
        startGame();
    });

    socket.on('force-end-game', () => {
        console.log('[admin] force-end-game handling triggered from connection', socket.id);
        if (gamePhase === 'countdown' || gamePhase === 'playing' || gamePhase === 'ended') {
            endGame();
            autoResetToLobby();
        }
    });

    socket.on('play-again', () => {
        if (gamePhase !== 'ended') {
            console.log('[lobby] play-again ignored — phase is', gamePhase);
            return;
        }
        console.log('[lobby] play-again requested by', socket.id);
        playAgainReset();
    });

    socket.on('disconnect', () => {
        console.log('[-]', socket.id);
        displays.delete(socket.id);
        lobbyPlayers.delete(socket.id);

        const qi = waitingQueue.findIndex(p => p.socketId === socket.id);
        if (qi >= 0) {
            waitingQueue.splice(qi, 1);
            broadcastQueuePositions();
        }

        let wasActive = false;
        for (const [slotId, wsid] of controllers) {
            if (wsid === socket.id) {
                controllers.delete(slotId);
                io.to([...displays]).emit('player-left', {slotId: sid = slotId});
                wasActive = true;
                break;
            }
        }

        // AUTO-TERMINATION CHECK: If the game loop is active, check if all active mobile controls left
        if ((gamePhase === 'playing' || gamePhase === 'countdown') && controllers.size === 0) {
            console.log('[game] All active controllers disconnected mid-match. Auto-terminating match pipeline.');
            endGame();
            autoResetToLobby();
            return;
        }

        if (wasActive && gamePhase === 'lobby') promoteFromQueue();
        if (gamePhase === 'lobby') io.emit('lobby-update', [...lobbyPlayers.values()]);
    });
});

httpServer.listen(PORT, () => {
    console.log(`Mix Master  →  http://localhost:${PORT}`);
    console.log(`  Display     →  http://localhost:${PORT}/display`);
    if (PLATFORM_URL) console.log(`  Platform    →  ${PLATFORM_URL}`);
});