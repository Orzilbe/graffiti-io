# Mix Master 🎨

> A real-time multiplayer territory game with a graffiti aesthetic. Up to 4 players compete to spray-paint the most wall space before the clock runs out.

---

## 1. Project Overview

**Mix Master** is a browser-based multiplayer game inspired by Paper.io. Each player controls a spray-paint can on a shared brick-wall canvas. As you move, you leave a paint trail behind you. Close a loop back to your territory and you capture everything inside it — stealing wall space from your opponents.

**Key features:**
- Up to 4 players, each with a vivid graffiti color (pink, cyan, green, orange)
- Spray-can characters with top-down movement
- Territory capture with paint-drip edge effects
- Death splatter animation when a player is eliminated
- Animated leaderboard that slides when ranks change
- Split-screen setup: one display on a TV/monitor, each player controls from their phone

> 📸 **Screenshot:** *(add a screenshot of the game here)*

---

## 2. Requirements

- **Node.js** v18 or higher ([download here](https://nodejs.org))
- A modern browser (Chrome, Firefox, Safari, Edge)
- A local network so phones can reach your computer — or use ngrok/Railway for remote play (see Section 4)

### Installation

```bash
# 1. Clone or download the project, then enter the folder
cd graffiti-io

# 2. Install dependencies
npm install

# 3. Start the server
node server.js
```

You should see:
```
Mix Master  →  http://localhost:3000
  Display     →  http://localhost:3000/display
  Controller  →  http://localhost:3000/controller/0  (slots 0–3)
```

---

## 3. How to Play

### Setup

1. **Main screen (TV or monitor):** Open `http://localhost:3000/display` in a browser. You'll see the lobby with 4 player slots.

2. **Each player's phone:** Open one of these URLs in their mobile browser:
   - Player 1 → `http://localhost:3000/controller/0`
   - Player 2 → `http://localhost:3000/controller/1`
   - Player 3 → `http://localhost:3000/controller/2`
   - Player 4 → `http://localhost:3000/controller/3`

   > 💡 If players are on the same Wi-Fi, replace `localhost` with your computer's local IP address (e.g. `http://192.168.1.42:3000/controller/0`). You can find your IP by running `ipconfig` (Windows) or `ifconfig` (Mac/Linux).

3. **Start the game:** Once players have joined, the host clicks **START GAME** on the display screen.

### Controls

On the mobile controller, use the **D-pad buttons** or **swipe gestures** to change direction. Your spray can keeps moving — you're always painting.

### Rules

| Rule | Details |
|---|---|
| **Leave your territory** | Moving off your colored zone starts a trail |
| **Close the loop** | Return to your own territory to capture everything inside |
| **Avoid trails** | Running into any player's trail (including your own) gets you eliminated |
| **Respawn** | You come back after 3 seconds — your territory stays |
| **Win condition** | Most territory when the 3-minute timer ends wins |

The leaderboard on the right shows live rankings. The #1 player gets a crown 👑 and their color glows across the whole sidebar.

---

## 4. Deploying Online

> Use one of these options so players can join from anywhere — not just your local network.

### Option A — Railway *(easiest, free)*

Railway gives you a public HTTPS URL in minutes.

1. Push your project to a GitHub repository
2. Go to [railway.app](https://railway.app) and sign in with GitHub
3. Click **New Project → Deploy from GitHub repo** and select your repo
4. In the project settings, set the **Start Command** to: `node server.js`
5. Railway will build and deploy automatically — copy the public URL it gives you
6. Share that URL with players, replacing `localhost:3000` with your Railway domain

> ✅ Recommended for a party or event — stable, always-on, free for small projects.

---

### Option B — Render *(free tier)*

1. Push your project to a GitHub repository
2. Go to [render.com](https://render.com) → **New → Web Service**
3. Connect your GitHub repo
4. Set **Build Command** to: `npm install`
5. Set **Start Command** to: `node server.js`
6. Click **Deploy** and wait for the build to finish
7. Render gives you a `.onrender.com` URL — share it with players

> ⚠️ **Note:** Render's free tier spins the server down after 15 minutes of inactivity. The first connection after sleep can take 30–60 seconds. For a live game session, wake it up by visiting the URL yourself first.

---

### Option C — ngrok *(fastest for local play with friends)*

ngrok creates a temporary public tunnel to your local server. No deployment needed.

1. Install ngrok globally:
   ```bash
   npm install -g ngrok
   ```
2. Start your server in one terminal:
   ```bash
   node server.js
   ```
3. In a **second terminal**, start the tunnel:
   ```bash
   ngrok http 3000
   ```
4. ngrok will show a URL like `https://abc123.ngrok-free.app` — share that with players

   Controller URLs become:
   - `https://abc123.ngrok-free.app/controller/0`
   - `https://abc123.ngrok-free.app/controller/1`
   - etc.

> ✅ Great for a one-off game night — no GitHub or accounts needed. The URL changes each time you restart ngrok (free tier).

---

## 5. Environment Variables

You can set these before starting the server if needed:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | The port the server listens on |

**Example — run on a different port:**
```bash
PORT=8080 node server.js
```

On Windows (PowerShell):
```powershell
$env:PORT = "8080"; node server.js
```

---

## 6. File Structure

```
graffiti-io/
│
├── server.js              # Express + Socket.io server
│                          # Handles all game logic: movement, collision,
│                          # territory capture (flood fill), respawn, timer
│
├── package.json           # Project metadata and dependencies
│
└── public/                # All browser-side files (served statically)
    │
    ├── display.html       # The main game screen (open on TV/monitor)
    │                      # Shows canvas, leaderboard sidebar, lobby, game-over
    │
    ├── game.js            # Canvas rendering for the display screen
    │                      # 60fps render loop: brick wall, territory, trails,
    │                      # spray-can sprites, drip effects, death splatter
    │
    ├── controller.html    # Mobile controller page (open on each phone)
    │                      # D-pad layout, player HUD, death/lobby overlays
    │
    ├── controller.js      # Mobile input logic
    │                      # Button press, swipe gestures, socket events,
    │                      # respawn countdown, game-over screen
    │
    ├── style.css          # Shared base styles and Google Fonts import
    │
    └── mixMaster.png      # Game logo (used on lobby + controller HUD)
```

### Key dependencies

| Package | Version | Purpose |
|---|---|---|
| `express` | ^4.19 | Serves static files and page routes |
| `socket.io` | ^4.7 | Real-time WebSocket communication between all clients |

---

*Built with Node.js, Socket.io, and the Canvas 2D API. No frameworks — just vanilla HTML, CSS, and JavaScript.*
