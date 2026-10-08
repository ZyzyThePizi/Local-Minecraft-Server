# Minecraft szerver panel

Saját gépen (PC vagy laptop) futó Minecraft szerver, amit egy publikus weboldalról lehet kezelni:
**https://zyzythepizi.github.io/minecraft/**

- A **nyilvános oldal** mindenkinek mutatja, hogy fut-e a szerver, hány játékos van fent, és a csatlakozási címet.
- **Admin belépés** után: indítás, leállítás, konzol, `server.properties`, memória, és **modpack telepítés keresésből egy kattintással**
  (CurseForge, Modrinth vagy vanilla).

```
 böngésző ──► GitHub Pages (statikus UI)
    │
    └──HTTPS──► Tailscale Funnel ──► backend (127.0.0.1:8765, Node) ──► Minecraft szerver (java)
                                                                         ▲
 játékosok ──► playit.gg ────────────────────────────────────────────────┘ (25565)
```

## Hogyan működik

| Rész | Mit csinál |
|---|---|
| `web/` | React + Vite UI, a GitHub Actions telepíti Pages-re. Maga keresi meg, melyik gépen fut épp a backend (`API_URLS`). |
| `backend/` | Node 24+ (TypeScript, build nélkül). Indítja és felügyeli a szervert, telepíti a modpackeket, a loadert és a Javát. |
| Tailscale Funnel | Stabil, publikus HTTPS címet ad a backendnek, routerállítás és port forward nélkül. |
| playit.gg | A játékforgalom (TCP 25565). A Funnel ezt nem tudja vinni, mert csak TLS forgalmat irányít. |

**Modpack telepítés:** a backend letölti a csomagot. CurseForge-nál, ha van hivatalos szervercsomag, azt használja, különben a
modlistából építi fel, és kihagyja a csak kliens oldali modokat. Utána telepíti a loadert (Forge / NeoForge / Fabric / Quilt),
és letölti a Minecraft verzióhoz illő Java-t (Temurin 8 / 17 / 21 / 25). Minden telepítés **külön szerver** (`data/instances/…`),
így a régi világ megmarad, és a „Szerverek” fülön vissza lehet rá váltani.

## Beállítás egy új gépen

1. **Node.js 24+** és **Tailscale** kell (a Javát a backend magától letölti).
2. Klónozás és első indítás:
   ```powershell
   git clone https://github.com/ZyzyThePizi/minecraft.git
   cd minecraft
   .\start-backend.bat
   ```
   Az első indításkor létrejön a `backend/.env`, benne egy **generált admin jelszóval** (a konzol is kiírja).
3. **CurseForge kulcs** (opcionális, a Modrinth nélküle is megy): <https://console.curseforge.com/> → *API Keys*, majd a
   `backend/.env` fájlba: `CURSEFORGE_API_KEY='…'` (aposztrófok között), és indítsd újra a backendet.
4. **Publikus HTTPS cím** a backendnek:
   ```powershell
   tailscale funnel --bg --https=10000 http://127.0.0.1:8765
   tailscale funnel status   # itt látszik a cím, pl. https://gep.tailXXXX.ts.net:10000
   ```
5. A címet add hozzá a repó `API_URLS` változójához (vesszővel elválasztva, ha több gép van), és futtasd újra a deployt:
   ```powershell
   gh variable set API_URLS --repo ZyzyThePizi/minecraft --body "https://gep1...:10000,https://gep2...:10000"
   gh workflow run pages.yml --repo ZyzyThePizi/minecraft
   ```
   Új gépet build nélkül is ki lehet próbálni: az oldal alján a **Backend cím** gombbal.
6. **Játékcím:** indítsd el a playit.gg-t, és hozz létre egy *Minecraft Java* tunnelt a `127.0.0.1:25565`-re. A kapott címet
   írd be a panelen: *Beállítások → Csatlakozási cím*.

> **Saját gépeken (tailneten belül):** a MagicDNS a `*.ts.net` címet a belső `100.x` IP-re oldja fel, ezért az Edge/Chrome
> egyszer engedélyt kér a „helyi hálózati eszközök” eléréséhez. Ezt engedélyezd. Kívülről (barátok) a publikus Funnel címen megy,
> nincs kérdés.

### Automatikus indítás Windows bejelentkezéskor

`Win+R` → `shell:startup` → ide tegyél egy parancsikont a `start-backend.bat`-ra. A panelen a *Beállítások → Automatikus indítás*
kapcsolóval a Minecraft szerver is elindul a backenddel. A Tailscale Funnel `--bg` beállítása újraindítás után is megmarad.

## Biztonság

- A backend csak `127.0.0.1`-en figyel, kívülről kizárólag a Funnel HTTPS címén érhető el.
- Minden módosító végponthoz admin token kell (7 napig érvényes, HMAC-cel aláírva). A jelszó cseréje mindenkit kiléptet.
- Belépési limit: IP-nként 5, összesen 30 hibás próbálkozás 15 percenként.
- CORS: csak az `ALLOWED_ORIGINS`-ban felsorolt oldalak hívhatják az API-t.
- A modpackek fájlútvonalait és zipjeit ellenőrzöm: symlinket és a szervermappán kívülre mutató útvonalat nem csomagolok ki.
- A `backend/.env` és a `data/` mappa nincs a gitben.

## Fejlesztés

```powershell
npm install
npm run dev:backend   # http://127.0.0.1:8765
npm run dev:web       # http://localhost:5173/minecraft/  (helyben a 127.0.0.1:8765 backendet keresi)
npm run typecheck
```

### API röviden

| Végpont | Auth | Leírás |
|---|---|---|
| `GET /api/health`, `GET /api/status` | – | elérhetőség, nyilvános állapot |
| `POST /api/auth/login` | – | `{ password }` → `{ token, expiresAt }` |
| `GET /api/admin/overview` | ✓ | szerver, aktív példány, beállítások |
| `POST /api/admin/server/start · stop · restart · command` | ✓ | vezérlés, konzolparancs |
| `GET /api/admin/server/logs?since=N` | ✓ | konzol napló |
| `GET/PUT /api/admin/properties` | ✓ | `server.properties` |
| `PUT /api/admin/settings` | ✓ | EULA, automatikus indítás, játékcím |
| `GET /api/admin/instances`, `POST …/:id/activate`, `PATCH/DELETE …/:id` | ✓ | szerverek kezelése |
| `GET /api/admin/packs/search · versions`, `POST /api/admin/packs/install` | ✓ | modpack keresés és telepítés |
| `GET /api/admin/jobs/:id` | ✓ | telepítés állapota |
