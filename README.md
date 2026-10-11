# Local Minecraft Server

Minecraft servers that run on your own PCs and laptops, all managed from one public web page, the hub:
**https://zyzythepizi.github.io/Local-Minecraft-Server/**

- **Every machine is an island.** Anyone can start a backend on their own machine. The hub lists the machines your
  browser knows, as islands of one archipelago. There are no user accounts: each backend has its own password.
- **Several servers per machine**, running side by side within the machine's RAM budget, each with its own world, game
  port and playit.gg tunnel. One-click modpack install from search (CurseForge, Modrinth or vanilla), a console,
  `server.properties` and a restart button for each server.
- **Commands as buttons:** the everyday ones up front (OP, game mode, whitelist, time, weather, difficulty), and a
  searchable catalogue of a few hundred more (per player, moderation, messages, world, game rules, scoreboards,
  performance), each with a description and the exact command it sends. Only what the server's Minecraft version and
  loader understand is listed.
- **A fresh start in one click:** wipe every player's data, the world, or everything at once (see below).
- **Sharing without handing out the password:** invite links (with an expiry and a use limit, revocable at any time), a
  list of the devices that are signed in, and an audit log of who did what.
- The page floats above a **live Minecraft archipelago rendered in Three.js** that mirrors what runs where.

The hub is in English, with a switch to Hungarian in the top bar (the choice stays in the browser). The backend's own
console window prints Hungarian.

```
 browser (hub, GitHub Pages) ──HTTPS──► Tailscale Funnel ──► backend A (127.0.0.1:8765) ──► Minecraft servers (java)
        │   keyring in IndexedDB                                                                ▲
        └──────────────HTTPS──────────► Tailscale Funnel ──► backend B (another PC)             │
                                                                                                │
 players ──► playit.gg (one tunnel per server) ─────────────────────────────────────────────────┘
```

## The archipelago

| On the map | Meaning |
|---|---|
| an island | one machine (its terrain is generated from the machine's id, so it always looks the same) |
| a small beacon on the island | one installed server: lime beam = running, flickering = starting, short red haze = crashed, dark = stopped |
| the big beacon on the control station | the server selected in the panel |
| Steve figures walking around | players online on that machine |
| an island sunk under low clouds | the machine is switched off |
| the pale reef with "+ New island" | add a machine |

The sky follows the focused machine: day while its selected server runs, dawn while it starts, a stormy night after a
crash. Click an island (or a row in the list) to fly there. Inside an island each admin tab has a station and the camera
flies to it: **Control** → beacon, **Modpacks** → chest, **Servers** → Nether portal, **Settings** → crafting table,
**Machine** → the whole island. Every texture is generated at runtime.
The 3D world is a separate chunk loaded after the first paint, and with `prefers-reduced-motion` it renders a still frame.

## How it works

| Part | What it does |
|---|---|
| `web/` | The hub: React + Vite + Tailwind, the Three.js archipelago under `web/src/world/`, the keyring and API client under `web/src/hub/`. GitHub Actions deploys it to Pages. |
| `backend/` | Node 24+ (TypeScript, no build step). Runs the Minecraft servers, installs modpacks, the mod loader and Java, and publishes itself with Tailscale Funnel. |
| Tailscale Funnel | A stable public HTTPS address for each backend, with no router setup. The backend sets it up on start. |
| playit.gg | Carries the game traffic (TCP). Funnel cannot, because it only routes TLS traffic. |

**Modpack install:** on CurseForge the backend uses the author's server pack when there is one; otherwise it builds the
server from the mod list and skips client-only mods. Any skipped mod that a server-side mod lists as a required dependency
(`mods.toml` / `fabric.mod.json`) is put back, because CurseForge's "Client" tag is sometimes wrong. If the server still
crashes, the console prints the gist of the crash report. Then it installs the loader (Forge / NeoForge / Fabric / Quilt)
and the Java version the release needs (Temurin 8 / 17 / 21 / 25). Every install is a separate server with its own game
port, so several can run at once.

## Identity and sign-in (no user accounts)

- **Machine key.** On the first start the backend makes an Ed25519 key pair (`data/node.key`, sealed with Windows DPAPI
  in machine scope, so a copy of `data/` on another PC cannot open it). The machine id is the key's fingerprint, shown
  as e.g. `3HPB-GX98-B0YS-2RPQ`.
- **Pinning.** When you add a machine, the hub shows its fingerprint and the machine signs a fresh nonce to prove it holds
  the key. The hub remembers the key; if a different key ever answers on that address, the hub stops and warns, like SSH.
- **Sign-in.** The `.env` password or an invite link opens a session: a 15-minute access token bound to that machine and
  a 14-day refresh token that rotates on every use. A refresh token used twice (a stolen copy) ends the session.
  Everyone who gets in has full access to that machine.
- **Keyring.** The hub keeps the machines and sessions in this browser's IndexedDB; refresh tokens are encrypted with a
  non-extractable key. *Keyring* moves them to another device in a passphrase-encrypted file.

## Setting up a machine

1. You need **Node.js 24+** and **Tailscale** (the backend downloads Java by itself).
2. Clone and start:
   ```powershell
   git clone https://github.com/ZyzyThePizi/Local-Minecraft-Server.git
   cd Local-Minecraft-Server
   .\start-backend.bat
   ```
   The first start creates `backend/.env` with a **generated admin password** (also printed to the console). The console
   prints the machine's public address and a link that adds it to the hub. The window stays open while the backend runs.
3. **`backend/.env` holds only two secrets:** `ADMIN_PASSWORD` and the optional `CURSEFORGE_API_KEY='…'` (inside single
   quotes; <https://console.curseforge.com/> → *API Keys*; Modrinth works without it). Changes take effect on save.
   Everything else (machine name, RAM budget, public status, addresses, allowed pages) is set in the panel under
   **Machine** and saved to `data/settings.json`. Settings an older version kept in `.env` are moved there on the first start.
4. **Public address.** With Tailscale installed and logged in, the backend publishes itself with Funnel on port 10000.
   A second backend on the same PC (started from another folder) gets its own sub-path and the next free local port.
   With another tunnel (e.g. Cloudflare) enter its address under *Machine → Public address*.
5. **Game traffic.** `start-backend.bat` installs playit.gg if it is missing (the official signed installer, signature
   checked against Developed Methods LLC) and starts it if it is not running. On playit.gg create one *Minecraft Java*
   tunnel per server, to the local port the panel shows under *Settings*, and enter the tunnel address in the same
   place.
6. **Featured machines** (optional): machines listed in the repository variable `API_URLS` are shown to every visitor.
   ```powershell
   gh variable set API_URLS --repo ZyzyThePizi/Local-Minecraft-Server --body "https://pc1...:10000"
   ```

> **On your own machines (inside the tailnet):** MagicDNS resolves `*.ts.net` to the internal `100.x` IP, so Edge/Chrome
> asks once for permission to access devices on the local network. Allow it.

### Sharing a machine

On **Machine → Sharing** create an invite: who it is for, when it expires (1 hour to 30 days) and how
many devices may use it. Send the link privately. The friend opens it, checks the fingerprint and joins with one click;
the machine then shows up in their hub next to their own. Revoking the invite also signs out every device that used it.
Handing out the `.env` password works as well, but it cannot be taken back without changing it.

### Joining a server

Players need the **same modpack version** the server runs (for CurseForge packs, install it in the CurseForge app and pick
the exact version shown in the hub), then *Multiplayer → Add Server* with the server's address from the hub.

### Start on Windows sign-in

`Win+R` → `shell:startup` → put a shortcut to `start-backend.bat` there. Servers with *Auto start* switched on start
together with the backend.

### Starting over

On the **Servers** tab every stopped server has three *Fresh start* buttons. Each one first shows what it deletes and
what it keeps, and nothing can be undone afterwards:

| Button | Deletes | Keeps |
|---|---|---|
| **Player data** | every player's inventory, position, XP, statistics and advancements, per-player mod data (quests, teams, claimed chunks) and the list of known players | the world and everything built in it |
| **World** | the whole world in every dimension, including the character data stored inside it; the next start generates a new one from the seed in the settings | the list of known players and the backups of backup mods |
| **Everything** | the world, all player data, the list of known players, and the `simplebackups` and `backups` folders | |

Mods, configs, `server.properties`, the datapacks and server configs inside the world folder, the operators, the
whitelist and the bans are never touched. One player can be reset on the **Control** tab (the eraser in the player list).

## Security

- The backend listens on `127.0.0.1` only; from outside it is reachable through its Funnel HTTPS address.
- Every endpoint that changes something needs a valid session (see above). Changing the password from the panel requires
  the current one, writes the new one to `.env` and signs every device out.
- Installing a modpack runs code on the machine, which is why only signed-in people can do it and why invites expire.
- The audit log (`data/audit.log`) records sign-ins (including failed ones), commands, installs and setting changes,
  with the device name and how they got in.
- CORS: only the pages listed under *Machine → allowed pages* can call the API from a browser.
- The hub is published with a Content Security Policy (scripts only from the site), and everything machines send is
  rendered as text, because the hub holds sign-ins to several machines in one origin.
- Modpack paths and zips are validated: symlinks and paths that point outside the server folder are never extracted.
- `backend/.env` and `data/` are not in git.

### Network (every backend reports)

Every backend is part of the network and reports to its registry. **This cannot be switched off in the panel**, so read
this before you run a backend:

- **When:** every five minutes, and within a few seconds of a visible change (a server starts or stops, a player joins or
  leaves, a server is added or removed, the machine is renamed).
- **What the network owner sees:** the machine's id, public key, name and version, and for each server its name,
  Minecraft version, loader, state and player count.
- **What is never sent:** passwords, sign-in tokens, the machine's or the servers' addresses, player names, console
  output, files. The registry cannot reach your machine or change anything on it; it only stores what backends send.
- **What comes back:** the network's announcements and the minimum recommended backend version.

The beat is signed with the machine key. The panel shows the same summary and the connection state under
*Machine → Network*, and the backend prints it at startup. The code is in
[`backend/src/registry.ts`](backend/src/registry.ts). The registry and the owner's admin panel live in a separate
private repository.

For development, `LMS_REGISTRY_URL` points a scratch backend at a local registry; set it to an empty value to keep a
test backend from reporting to the real one.

## Development

```powershell
npm install
npm run dev:backend   # http://127.0.0.1:8765
npm run dev:web       # http://localhost:5173/Local-Minecraft-Server/  (shows 127.0.0.1:8765 as a featured machine)
                      # ...?demo  → running beacons and players on every island (dev mode only)
npm run typecheck
```

### API at a glance (`/api/v1`)

Texts the panel shows (errors, the panel's own console lines, install progress, the audit log) come back in the
language of the `Accept-Language` header: `hu` for Hungarian, English otherwise.

| Endpoint | Auth | Description |
|---|---|---|
| `GET /hello?nonce=…` | – | machine id, public key, signature of the nonce, name, version |
| `GET /status` | – | public list of servers and join addresses (when the owner allows it) |
| `POST /session` | – | `{ password }` or `{ invite }` + `device` → tokens |
| `POST /session/refresh`, `DELETE /session` | –, ✓ | rotate the refresh token, sign out |
| `GET /node`, `PATCH /node`, `POST /node/password` | ✓ | machine overview and settings, password change |
| `GET /sessions`, `DELETE /sessions/:id`, `POST /sessions/revoke-all` | ✓ | signed-in devices |
| `GET /invites`, `POST /invites`, `DELETE /invites/:id` | ✓ | invite links |
| `GET /audit` | ✓ | audit log |
| `GET /servers`, `PATCH · DELETE /servers/:id` | ✓ | installed servers |
| `POST /servers/:id/start · stop · restart · command`, `GET …/logs` | ✓ | control and console |
| `GET …/players`, `POST …/players/:uuid/reset`, `GET · PUT …/properties` | ✓ | players, `server.properties` |
| `POST …/wipe` | ✓ | `{ scope: "players" \| "world" \| "all" }`: a fresh start for a stopped server |
| `GET /packs/search · versions`, `POST /packs/install`, `GET /jobs/:id` | ✓ | modpack search, install and progress |
