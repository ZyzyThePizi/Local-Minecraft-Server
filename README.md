# Local Minecraft Server

A Minecraft server that runs on your own PC or laptop and is managed from a public web page:
**https://zyzythepizi.github.io/Local-Minecraft-Server/**

- The **public page** shows everyone whether the server is up, how many players are online, and the address to join.
- After **admin login**: start, stop, console, `server.properties`, memory, and **one-click modpack install from search**
  (CurseForge, Modrinth or vanilla).
- The whole page floats above a **live Minecraft island rendered in Three.js**, and the world mirrors the server state.

The panel UI is in Hungarian; the labels below are given with their English meaning.

### The live world

| Server state | On the island |
|---|---|
| running | daytime, the beacon's lime beam reaches the sky, online players walk around as Steve (with name tags in the admin view) |
| starting / stopping | dawn or dusk, the beacon flickers |
| stopped / the PC is off | night: stars, fireflies, zombies and creepers |
| crashed | a reddish, stormy night |
| installing a modpack | the chest opens and sparks rise from it |

Each admin tab belongs to a station on the island and the camera flies there: **Vezérlés** (control) → beacon,
**Modpack** → chest, **Beállítások** (settings) → crafting table, **Szerverek** (servers) → Nether portal. Pigs, cows,
sheep and chickens wander the terrain. Every texture is generated at runtime (no images to download). The 3D world is a
separate chunk loaded after the first paint, and with `prefers-reduced-motion` it renders a single still frame. The design
system matches the portfolio: one lime accent, hairlines, corner brackets, Space Grotesk and JetBrains Mono.

```
 browser ──► GitHub Pages (static UI)
    │
    └──HTTPS──► Tailscale Funnel ──► backend (127.0.0.1:8765, Node) ──► Minecraft server (java)
                                                                          ▲
 players ──► playit.gg ───────────────────────────────────────────────────┘ (25565)
```

## How it works

| Part | What it does |
|---|---|
| `web/` | React + Vite + Tailwind UI, with the Three.js world (terrain, mobs, sky) under `web/src/world/`. GitHub Actions deploys it to Pages, and the page finds out by itself which machine is currently running the backend (`API_URLS`). |
| `backend/` | Node 24+ (TypeScript, no build step). Starts and supervises the server, installs modpacks, the mod loader and Java. |
| Tailscale Funnel | Gives the backend a stable public HTTPS address, with no router setup or port forwarding. |
| playit.gg | Carries the game traffic (TCP 25565). Funnel cannot, because it only routes TLS traffic. |

**Modpack install:** the backend downloads the pack. On CurseForge it uses the author's server pack when there is one;
otherwise it builds the server from the mod list and skips client-only mods. The skipped mods are set aside, and any of
them that a server-side mod lists as a required dependency in its own `mods.toml` / `fabric.mod.json` is put back
(CurseForge's "Client" tag is sometimes wrong, and a missing dependency stops the server at boot). If the server still
crashes, the console prints the gist of the crash report. Then it installs the loader (Forge / NeoForge / Fabric / Quilt)
and downloads the Java version the Minecraft release needs (Temurin 8 / 17 / 21 / 25). Every install is a **separate
server** (`data/instances/…`), so the old world is kept and you can switch back to it on the **Szerverek** tab.

## Setting up a new machine

1. You need **Node.js 24+** and **Tailscale** (the backend downloads Java by itself).
2. Clone and start:
   ```powershell
   git clone https://github.com/ZyzyThePizi/Local-Minecraft-Server.git
   cd Local-Minecraft-Server
   .\start-backend.bat
   ```
   The first start creates `backend/.env` with a **generated admin password** (also printed to the console).
   The window stays open while the backend runs; closing it stops the backend and the Minecraft server.
   You can change the password in `backend/.env` at any time. It takes effect as soon as you save, no restart needed.
3. **CurseForge key** (optional, Modrinth works without it): <https://console.curseforge.com/> → *API Keys*, then put it in
   `backend/.env` as `CURSEFORGE_API_KEY='…'` (inside single quotes). It takes effect as soon as you save.
   Some keys can reach every endpoint except search (403). In that case search runs on the public `api.curse.tools`
   mirror, while pack details and downloads still go through the official API with your own key. You can also paste a
   CurseForge link or project ID into the search box.
4. **Public HTTPS address** for the backend (`start-backend.bat` runs this for you when Tailscale is installed):
   ```powershell
   tailscale funnel --bg --https=10000 http://127.0.0.1:8765
   tailscale funnel status   # shows the address, e.g. https://machine.tailXXXX.ts.net:10000
   ```
5. Add the address to the repo's `API_URLS` variable (comma separated if there are several machines) and redeploy:
   ```powershell
   gh variable set API_URLS --repo ZyzyThePizi/Local-Minecraft-Server --body "https://pc1...:10000,https://pc2...:10000"
   gh workflow run pages.yml --repo ZyzyThePizi/Local-Minecraft-Server
   ```
   You can try a new machine without a rebuild with the **Backend cím** (backend address) button at the bottom of the page.
6. **Game address:** `start-backend.bat` handles playit.gg too:
   - if playit is not installed, it downloads the official signed installer from the playit GitHub releases, checks that
     the signature is valid and belongs to Developed Methods LLC (playit.gg), and installs it (Windows asks for UAC
     approval). A new window then runs `playit setup`: open the link it prints to link the agent to your account;
   - if playit is installed but not running, it starts it in a separate, minimized window.

   On playit.gg create a *Minecraft Java* tunnel to `127.0.0.1:25565`, then enter the address you get on the panel under
   *Beállítások → Csatlakozási cím* (settings → join address).

> **On your own machines (inside the tailnet):** MagicDNS resolves the `*.ts.net` address to the internal `100.x` IP, so
> Edge/Chrome asks once for permission to access devices on the local network. Allow it. From outside (friends) the page
> uses the public Funnel address and there is no prompt.

### Joining the server

Players need the **same modpack version** the server runs (for CurseForge packs, install it in the CurseForge app and pick
the exact version shown on the page), then *Multiplayer → Add Server* with the address from the page. On the machine that
runs the server, `localhost` works too.

### Start on Windows sign-in

`Win+R` → `shell:startup` → put a shortcut to `start-backend.bat` there. With the *Beállítások → Automatikus indítás*
(auto start) switch on the panel, the Minecraft server starts together with the backend. Tailscale Funnel's `--bg`
setting survives reboots.

## Security

- The backend only listens on `127.0.0.1`; from outside it is reachable only through the Funnel HTTPS address.
- Every endpoint that changes something requires an admin token (valid for 7 days, HMAC-signed). Changing the password
  signs everyone out.
- Login limits: 5 failed attempts per IP and 30 in total per 15 minutes.
- CORS: only the origins listed in `ALLOWED_ORIGINS` can call the API.
- Modpack file paths and zips are validated: symlinks and paths that point outside the server folder are never extracted.
- `backend/.env` and the `data/` folder are not in git.

## Development

```powershell
npm install
npm run dev:backend   # http://127.0.0.1:8765
npm run dev:web       # http://localhost:5173/Local-Minecraft-Server/  (looks for the backend on 127.0.0.1:8765 locally)
                      # ...?demo  → sample players on the island (dev mode only)
npm run typecheck
```

### API at a glance

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/health`, `GET /api/status` | – | reachability, public status |
| `POST /api/auth/login` | – | `{ password }` → `{ token, expiresAt }` |
| `GET /api/admin/overview` | ✓ | server, active instance, settings |
| `POST /api/admin/server/start · stop · restart · command` | ✓ | control, console command |
| `GET /api/admin/server/logs?since=N` | ✓ | console log |
| `GET/PUT /api/admin/properties` | ✓ | `server.properties` |
| `PUT /api/admin/settings` | ✓ | EULA, auto start, join address |
| `GET /api/admin/instances`, `POST …/:id/activate`, `PATCH/DELETE …/:id` | ✓ | manage servers |
| `GET /api/admin/packs/search · versions`, `POST /api/admin/packs/install` | ✓ | modpack search and install |
| `GET /api/admin/jobs/:id` | ✓ | install progress |
