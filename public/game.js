// 60fps canvas renderer for /display

const socket = io();
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const lobbyEl = document.getElementById('lobby');
const goEl = document.getElementById('gameover');
const timerEl = document.getElementById('timer');
const lbEl = document.getElementById('leaderboard');
const sidebar = document.getElementById('sidebar');
const lbTitle = document.getElementById('sidebar-title');
const cdOverlay = document.getElementById('countdown-overlay');
const cdNumber = document.getElementById('countdown-number');

// Sidebar Early Match Termination elements
const adminActionsEl = document.getElementById('admin-actions');
const forceEndBtn = document.getElementById('platform-force-end-btn');

const isEmbed = new URLSearchParams(location.search).get('embed') === '1';
if (isEmbed) {
    lobbyEl.style.display = 'none';
    goEl.style.display = 'none';
}

const COLORS = ['#FF2D78', '#00E5FF', '#76FF03', '#FF6D00'];
const RGB = COLORS.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[ch]));
}

let gs = {running: false, players: [], territory: [], trailGrid: [], gridW: 100, gridH: 60, timeLeft: 0};
let brickBg = null;
let particles = [];
let drips = [];
const rowMap = new Map();

const terrOff = document.createElement('canvas');
const trailOff = document.createElement('canvas');
terrOff.width = trailOff.width = 100;
terrOff.height = trailOff.height = 60;

function launchResultFireworks() {
    const layer = document.getElementById('fireworks-layer');
    if (!layer) return;

    const bursts = [
        { left: '16%', top: '18%', color: '#FF2D78', delay: 0 },
        { left: '82%', top: '20%', color: '#00E5FF', delay: 260 },
        { left: '26%', top: '72%', color: '#76FF03', delay: 520 },
        { left: '74%', top: '70%', color: '#FF6D00', delay: 780 },
        { left: '50%', top: '13%', color: '#FFD600', delay: 1040 },
    ];

    layer.innerHTML = bursts.map((burst, bi) => {
        const sparks = Array.from({ length: 16 }, (_, i) => {
            const angle = (360 / 16) * i;
            const distance = 58 + ((i + bi) % 5) * 11;
            return `<span class="firework-spark" style="--a:${angle}deg;--d:${distance}px;--c:${burst.color};animation-delay:${burst.delay}ms"></span>`;
        }).join('');
        return `<div class="firework" style="left:${burst.left};top:${burst.top};--c:${burst.color};animation-delay:${burst.delay}ms">${sparks}</div>`;
    }).join('');
}

async function initQRCodes() {
    try {
        const r = await fetch('/qrcodes');
        if (!r.ok) return;
        const urls = await r.json();
        for (let i = 0; i < 4; i++) {
            const el = document.getElementById(`qr-${i}`);
            if (!el) continue;
            new QRCode(el, {
                text: urls[i],
                width: 180,
                height: 180,
                colorDark: '#111',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H,
            });
        }
    } catch (_) {
    }
}

if (!isEmbed) initQRCodes();

// ── Socket events ──────────────────────────────────────────────────────────
socket.emit('display-join');

// Emit readiness signal once layout engine baseline runs
if (isEmbed) {
    setTimeout(() => {
        socket.emit('display-ready');
    }, 100);
}

socket.on('game-state-full', s => {
    gs = {
        running: s.running,
        gridW: s.gridW,
        gridH: s.gridH,
        timeLeft: s.timeLeft,
        players: s.players,
        territory: s.territory,
        trailGrid: s.trailGrid
    };
});

socket.on('game-state', s => {
    checkDeaths(gs, s);
    const td = s.terrDelta;
    for (let i = 0, len = td.length; i < len; i += 2) gs.territory[td[i]] = td[i + 1];
    const trd = s.trailDelta;
    for (let i = 0, len = trd.length; i < len; i += 2) gs.trailGrid[trd[i]] = trd[i + 1];
    gs.running = s.running;
    gs.timeLeft = s.timeLeft;
    gs.players = s.players;
});

socket.on('player-joined', ({slotId, name}) => {
    const slot = document.getElementById(`slot-${slotId}`);
    const overlay = document.getElementById(`overlay-${slotId}`);
    const nameEl = document.getElementById(`name-${slotId}`);
    if (slot) slot.classList.add('connected');
    if (overlay) overlay.classList.remove('hidden');
    if (nameEl) nameEl.textContent = name;
});

socket.on('player-left', ({slotId}) => {
    const slot = document.getElementById(`slot-${slotId}`);
    const overlay = document.getElementById(`overlay-${slotId}`);
    const nameEl = document.getElementById(`name-${slotId}`);
    if (slot) slot.classList.remove('connected');
    if (overlay) overlay.classList.add('hidden');
    if (nameEl) nameEl.textContent = '';
});

socket.on('leaderboard-update', board => updateLeaderboard(board));

const CD_COLORS = {3: '#FF2D78', 2: '#00E5FF', 1: '#76FF03', 0: '#FFD600'};
socket.on('game-countdown', ({count}) => {
    resizeCanvas();

    if (!isEmbed) {
        lobbyEl.style.display = 'none';
        goEl.style.display = 'none';
    }
    cdOverlay.style.display = 'flex';

    const label = count === 0 ? 'GO!' : String(count);
    const color = CD_COLORS[count] ?? '#fff';

    cdNumber.style.transition = 'none';
    cdNumber.style.transform = 'scale(1.4)';
    cdNumber.style.color = color;
    cdNumber.style.textShadow = `0 0 100px ${color}, 0 0 40px ${color}`;
    cdNumber.textContent = label;

    cdNumber.getBoundingClientRect();
    cdNumber.style.transition = 'transform 0.7s ease-out';
    cdNumber.style.transform = 'scale(1)';
});

socket.on('game-start', () => {
    particles = [];
    drips = [];
    rowMap.clear();
    lbEl.innerHTML = '';
    cdOverlay.style.display = 'none';
    if (!isEmbed) lobbyEl.style.display = 'none';
    timerEl.style.display = 'block';
    if (!isEmbed) goEl.style.display = 'none';

    // Disclose early termination button panel inside the active iframe container
    if (adminActionsEl) adminActionsEl.style.display = 'block';
});

socket.on('game-end', ({winner, scores}) => {
    timerEl.style.display = 'none';

    // Conceal early termination layout to make room for final scoring assets
    if (adminActionsEl) adminActionsEl.style.display = 'none';

    if (isEmbed) return;

    const wl = document.getElementById('winner-line');
    wl.style.color = winner?.color || '#fff';
    wl.innerHTML = winner
        ? `<span class="winner-label">Winner</span><span class="winner-name">${escapeHtml(winner.name)}</span><span class="winner-sub">wins!</span>`
        : `<span class="winner-name">Draw!</span>`;
    launchResultFireworks();
    document.getElementById('final-scores').innerHTML = scores
        .map(p => `<div class="score-row"><span style="color:${p.color}">${escapeHtml(p.name)}</span><span>${p.pct}%</span></div>`)
        .join('');
    goEl.style.display = 'flex';
});

socket.on('lobby-reset', () => {
    cdOverlay.style.display = 'none';
    timerEl.style.display = 'none';
    if (adminActionsEl) adminActionsEl.style.display = 'none';

    if (!isEmbed) {
        goEl.style.display = 'none';
        lobbyEl.style.display = 'flex';
    }
    rowMap.clear();
    lbEl.innerHTML = '';
    particles = [];
    drips = [];
    const fw = document.getElementById('fireworks-layer');
    if (fw) fw.innerHTML = '';
});

document.getElementById('start-btn')?.addEventListener('click', () => socket.emit('game-start'));
document.getElementById('play-again-btn')?.addEventListener('click', () => socket.emit('play-again'));

socket.on('scores-saved', ({count}) => {
    const toast = document.createElement('div');
    toast.textContent = `✓ ${count} score${count !== 1 ? 's' : ''} saved`;
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '28px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(118,255,3,.18)',
        border: '2px solid #76FF03',
        color: '#76FF03',
        fontFamily: "'Boogaloo', sans-serif",
        fontSize: '1.15rem',
        padding: '10px 26px',
        borderRadius: '10px',
        zIndex: '99',
        backdropFilter: 'blur(6px)',
        opacity: '1',
        transition: 'opacity 0.6s',
    });
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
    }, 2800);
    setTimeout(() => toast.remove(), 3400);
});

if (!isEmbed) {
    const btn = document.createElement('button');
    btn.textContent = '⏹ End Game';
    Object.assign(btn.style, {
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: '999',
        background: 'rgba(255,45,120,.15)',
        border: '2px solid rgba(255,45,120,.5)',
        color: '#fff',
        fontFamily: "'Boogaloo', sans-serif",
        fontSize: '1rem',
        padding: '8px 16px',
        borderRadius: '10px',
        cursor: 'pointer',
        backdropFilter: 'blur(6px)',
        transition: 'background .15s',
    });
    btn.onmouseenter = () => btn.style.background = 'rgba(255,45,120,.55)';
    btn.onmouseleave = () => btn.style.background = 'rgba(255,45,120,.15)';
    btn.onclick = () => {
        if (confirm('Force end the current game?')) socket.emit('force-end-game');
    };
    document.body.appendChild(btn);
}

function updateLeaderboard(board) {
    for (const p of board) {
        if (rowMap.has(p.id)) continue;
        const el = document.createElement('div');
        el.className = 'lb-row';
        el.dataset.id = p.id;
        el.innerHTML = `<span class="lb-rank"></span>` + `<span class="lb-swatch" style="background:${p.color}"></span>` + `<span class="lb-name">${escapeHtml(p.name)}</span>` + `<span class="lb-pct"></span>`;
        lbEl.appendChild(el);
        rowMap.set(p.id, el);
    }

    const first = {};
    for (const [id, el] of rowMap) first[id] = el.getBoundingClientRect().top;

    for (const p of board) {
        const el = rowMap.get(p.id);
        el.querySelector('.lb-rank').textContent = p.rank === 1 ? '\u{1F451}' : p.rank;
        el.querySelector('.lb-rank').style.color = p.color;
        el.querySelector('.lb-pct').textContent = `${p.pct}%`;
        el.querySelector('.lb-pct').style.color = p.color;
        el.classList.toggle('gold', p.rank === 1);
        lbEl.appendChild(el);
    }

    for (const [id, el] of rowMap) {
        const delta = first[id] - el.getBoundingClientRect().top;
        if (Math.abs(delta) < 1) continue;
        el.style.transition = 'none';
        el.style.transform = `translateY(${delta}px)`;
        el.getBoundingClientRect();
        el.style.transition = 'transform 400ms ease-in-out';
        el.style.transform = '';
    }

    if (board[0] && sidebar && lbTitle) {
        sidebar.style.borderLeftColor = board[0].color;
        lbTitle.style.color = board[0].color;
        lbTitle.style.textShadow = `0 0 14px ${board[0].color}`;
    }
}

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
        const heavy = Math.random() < 0.3;
        const spd = heavy ? 1.5 + Math.random() * 5 : 4 + Math.random() * 11;
        particles.push({
            x: ox,
            y: oy,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd - 1.5,
            r: heavy ? 5 + Math.random() * 7 : 2 + Math.random() * 5,
            color,
            life: 1,
            decay: (heavy ? 0.016 : 0.026) + Math.random() * 0.012,
        });
    }
}

function renderParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35;
        p.vx *= 0.91;
        p.vy *= 0.91;
        p.life -= p.decay;
        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }
        ctx.globalAlpha = Math.min(1, p.life * 1.4);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.r * p.life), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function buildBrick(w, h) {
    const off = Object.assign(document.createElement('canvas'), {width: w, height: h});
    const c = off.getContext('2d');
    const BW = 64, BH = 26;
    c.fillStyle = '#111';
    c.fillRect(0, 0, w, h);
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

function renderGrid() {
    const {territory, trailGrid, gridW: gw, gridH: gh} = gs;
    if (!territory.length) return;
    if (terrOff.width !== gw) {
        terrOff.width = trailOff.width = gw;
    }
    if (terrOff.height !== gh) {
        terrOff.height = trailOff.height = gh;
    }

    const tc = terrOff.getContext('2d');
    const rc = trailOff.getContext('2d');
    tc.imageSmoothingEnabled = false;
    rc.imageSmoothingEnabled = false;

    const tImg = tc.createImageData(gw, gh);
    const rImg = rc.createImageData(gw, gh);

    for (let i = 0, n = gw * gh; i < n; i++) {
        const to = territory[i], ro = trailGrid[i];
        if (to >= 0) {
            const [r, g, b] = RGB[to];
            tImg.data[i * 4] = r;
            tImg.data[i * 4 + 1] = g;
            tImg.data[i * 4 + 2] = b;
            tImg.data[i * 4 + 3] = 148;
        }
        if (ro >= 0) {
            const [r, g, b] = RGB[ro];
            rImg.data[i * 4] = r;
            rImg.data[i * 4 + 1] = g;
            rImg.data[i * 4 + 2] = b;
            rImg.data[i * 4 + 3] = 255;
        }
    }

    tc.putImageData(tImg, 0, 0);
    rc.putImageData(rImg, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrOff, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(trailOff, 0, 0, canvas.width, canvas.height);
}

function renderPlayers() {
    const {players, gridW: gw, gridH: gh} = gs;
    if (!players.length) return;
    const cw = canvas.width / gw, ch = canvas.height / gh;

    for (const p of players) {
        if (!p || !p.alive) continue;
        const cx = (p.x + .5) * cw, cy = (p.y + .5) * ch;
        const r = Math.min(cw, ch) * .68;
        const ang = {right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2}[p.dir] ?? 0;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang);

        ctx.shadowColor = p.color;
        ctx.shadowBlur = r * 1.2;

        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * .52, r * .74, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;

        ctx.fillStyle = '#ddd';
        ctx.beginPath();
        ctx.ellipse(0, -r * .58, r * .24, r * .19, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = p.color + 'bb';
        ctx.beginPath();
        ctx.ellipse(0, -r * .88, r * .09, r * .18, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,.22)';
        ctx.beginPath();
        ctx.ellipse(-r * .16, -r * .1, r * .13, r * .3, -.3, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

const fmtTime = ms => {
    const s = Math.ceil(ms / 1000);
    return `${~~(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function render() {
    if (brickBg) ctx.drawImage(brickBg, 0, 0); else {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    renderGrid();
    renderPlayers();
    renderParticles();
    if (gs.running) timerEl.textContent = fmtTime(gs.timeLeft);
    requestAnimationFrame(render);
}

function resizeCanvas() {
    if (!canvas.parentElement) return;
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    brickBg = buildBrick(canvas.width, canvas.height);
}

// Wire up termination click emitter interactions
if (forceEndBtn) {
    forceEndBtn.onmouseenter = () => forceEndBtn.style.background = 'rgba(255,45,120,0.45)';
    forceEndBtn.onmouseleave = () => forceEndBtn.style.background = 'rgba(255,45,120,0.12)';
    forceEndBtn.onclick = () => {
        if (confirm('Force end the current match early?')) {
            socket.emit('force-end-game');
        }
    };
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
requestAnimationFrame(render);