import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import { disposeMobResources, Mob, type MobKind } from './mobs';
import { clamp, damp, dampAngle, mulberry32 } from './random';
import { cloneMood, createCelestials, createClouds, createParticles, createSkyDome, dampMood, dotTexture, MOODS, type MoodName } from './sky';
import { BLOCK, buildGeometry, Terrain, WATER, type StationId } from './terrain';
import { buildAtlas, buildPortalTexture, buildWaterTexture, pixelTexture, shadeRGB } from './textures';

export type { StationId } from './terrain';

export type WorldServerState = 'loading' | 'offline' | 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

export interface WorldState {
  server: WorldServerState;
  playerCount: number;
  playerNames: string[];
  station: StationId | null;
  installing: boolean;
}

const MOOD_FOR: Record<WorldServerState, MoodName> = {
  loading: 'night',
  offline: 'night',
  stopped: 'night',
  starting: 'dawn',
  stopping: 'dawn',
  running: 'day',
  crashed: 'crashed',
};

const SIGNAL = '#c8f43a';
const MAX_PLAYERS_SHOWN = 12;

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export class World {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(35, 1, 0.1, 900);
  private terrain = new Terrain();
  private mood = cloneMood(MOODS.night);
  private targetMood = MOODS.night;
  private state: WorldState = { server: 'loading', playerCount: 0, playerNames: [], station: null, installing: false };
  private mobs: Mob[] = [];
  private nightMobs: Mob[] = [];
  private players: Mob[] = [];
  private disposables: { dispose(): void }[] = [];
  private raf = 0;
  private last = performance.now();
  private time = 0;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private coarse = matchMedia('(pointer: coarse)').matches;
  private mobile = Math.min(innerWidth, innerHeight) < 640;

  // lights & scene parts
  private hemi = new HemisphereLight();
  private sunLight = new DirectionalLight();
  private sky = createSkyDome();
  private celestial = createCelestials();
  private clouds = createClouds();
  private water!: Mesh<PlaneGeometry, MeshLambertMaterial>;
  private beam!: Group;
  private beamMats: MeshBasicMaterial[] = [];
  private beamLevel = 0;
  private portalMat!: MeshBasicMaterial;
  private chestLid!: Group;
  private installLevel = 0;
  private fireflies!: ReturnType<typeof createParticles>;
  private sparks!: ReturnType<typeof createParticles>;
  private fireflySeeds: Float32Array;

  // camera
  private cam = { az: 0.75, el: 0.5, dist: 60, tx: 0, ty: 5, tz: 0, offset: 0, offY: 0 };
  private baseAz = 0.75;
  private pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  private focus = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: !this.mobile, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = !this.mobile;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.fireflySeeds = new Float32Array(160 * 4);

    this.buildScene();
    this.resize();
    addEventListener('resize', this.resize);
    addEventListener('pointermove', this.onPointer, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------- setup ----------

  private buildScene() {
    const { scene, terrain } = this;
    scene.fog = new Fog(0x000000, 60, 170);
    scene.add(this.sky.mesh, this.celestial.group, this.celestial.stars, this.clouds.mesh, this.hemi, this.sunLight, this.sunLight.target);
    this.disposables.push(this.sky.material, this.sky.mesh.geometry, this.clouds.material, this.clouds.mesh.geometry);

    const atlas = buildAtlas();
    const solidMat = new MeshLambertMaterial({ map: atlas, vertexColors: true });
    const solid = new Mesh(buildGeometry(terrain, (b) => b !== BLOCK.beacon), solidMat);
    solid.castShadow = solid.receiveShadow = true;
    const glowMat = new MeshBasicMaterial({ map: atlas });
    const glow = new Mesh(buildGeometry(terrain, (b) => b === BLOCK.beacon), glowMat);
    scene.add(solid, glow);
    this.disposables.push(atlas, solidMat, solid.geometry, glowMat, glow.geometry);

    // Ocean and the sea floor beyond the island
    const waterTex = buildWaterTexture();
    waterTex.repeat.set(140, 140);
    const water = new Mesh(new PlaneGeometry(280, 280), new MeshLambertMaterial({ map: waterTex, color: '#ffffff', transparent: true, opacity: 0.82, depthWrite: false }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER - 0.12;
    water.receiveShadow = true;
    this.water = water;
    // Sand floor at the same height and tone as the island's underwater sand, so the map edge disappears.
    const floor = new Mesh(new PlaneGeometry(280, 280), new MeshLambertMaterial({ color: '#d6c99c' }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 1.99;
    floor.receiveShadow = true;
    scene.add(floor, water);
    this.disposables.push(waterTex, water.geometry, water.material, floor.geometry, floor.material as Material);

    // Sun / moon light with shadows over the island
    const s = this.sunLight;
    s.castShadow = !this.mobile;
    s.shadow.mapSize.set(2048, 2048);
    Object.assign(s.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 160 });
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.03;

    this.buildFlowers();
    this.buildStations();
    this.buildMobs();

    const dots = dotTexture();
    this.disposables.push(dots);
    this.fireflies = createParticles(160, SIGNAL, 0.22, dots);
    this.sparks = createParticles(70, SIGNAL, 0.3, dots);
    scene.add(this.fireflies.points, this.sparks.points);
    const rnd = mulberry32(3);
    for (let i = 0; i < 160; i++) {
      const x = (rnd() - 0.5) * 38;
      const z = (rnd() - 0.5) * 38;
      const g = terrain.groundAt(x, z) ?? WATER + 1;
      this.fireflySeeds.set([x, g + 0.6 + rnd() * 2.2, z, rnd() * 100], i * 4);
    }
  }

  private buildFlowers() {
    const { flowers } = this.terrain;
    const stemGeo = new BoxGeometry(0.07, 0.38, 0.07);
    const bloomGeo = new BoxGeometry(0.2, 0.2, 0.2);
    const stemMat = new MeshLambertMaterial({ color: '#3f7a2a' });
    const bloomMat = new MeshLambertMaterial({ color: '#ffffff' });
    const stems = new InstancedMesh(stemGeo, stemMat, flowers.length);
    const blooms = new InstancedMesh(bloomGeo, bloomMat, flowers.length);
    const dummy = new Object3D();
    flowers.forEach((f, i) => {
      dummy.position.set(f.x, f.y + 0.19, f.z);
      dummy.updateMatrix();
      stems.setMatrixAt(i, dummy.matrix);
      dummy.position.y = f.y + 0.42;
      dummy.rotation.y = i;
      dummy.updateMatrix();
      blooms.setMatrixAt(i, dummy.matrix);
      dummy.rotation.y = 0;
      blooms.setColorAt(i, new Color(f.color));
    });
    this.scene.add(stems, blooms);
    this.disposables.push(stemGeo, bloomGeo, stemMat, bloomMat);
  }

  private buildStations() {
    const { control, packs, instances } = this.terrain.stations;

    // Beacon beam (lit while the server runs)
    this.beam = new Group();
    this.beam.position.set(control.x, control.y + 0.5, control.z);
    for (const [w, opacity] of [[0.32, 0.9], [0.7, 0.22], [1.3, 0.07]] as const) {
      const mat = new MeshBasicMaterial({ color: SIGNAL, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false });
      mat.userData.base = opacity;
      const m = new Mesh(new BoxGeometry(w, 120, w), mat);
      m.position.y = 60;
      this.beam.add(m);
      this.beamMats.push(mat);
      this.disposables.push(mat, m.geometry);
    }
    this.scene.add(this.beam);

    // Nether portal surface
    const portalTex = buildPortalTexture();
    portalTex.repeat.set(2, 3);
    this.portalMat = new MeshBasicMaterial({ map: portalTex, transparent: true, opacity: 0.82, side: DoubleSide, depthWrite: false });
    const portal = new Mesh(new PlaneGeometry(2, 3), this.portalMat);
    portal.rotation.y = Math.PI / 2;
    portal.position.set(instances.x, instances.y, instances.z - 0.5);
    this.scene.add(portal);
    this.disposables.push(portalTex, this.portalMat, portal.geometry);

    // Chest (its lid opens during a modpack install)
    const wood = [125, 86, 40] as const;
    const chestTex = pixelTexture(14, 14, (set, rnd) => {
      for (let y = 0; y < 14; y++) {
        for (let x = 0; x < 14; x++) {
          const frame = x === 0 || y === 0 || x === 13 || y === 13;
          set(x, y, shadeRGB(frame ? [74, 50, 22] : wood, 1 + (rnd() - 0.5) * 0.14));
        }
      }
    });
    const chestMat = new MeshLambertMaterial({ map: chestTex });
    const chest = new Group();
    chest.position.set(packs.x, packs.y - 0.6, packs.z);
    chest.rotation.y = packs.angle;
    const base = new Mesh(new BoxGeometry(0.875, 0.62, 0.875), chestMat);
    base.position.y = 0.31;
    this.chestLid = new Group();
    this.chestLid.position.set(0, 0.62, -0.4375);
    const lid = new Mesh(new BoxGeometry(0.875, 0.25, 0.875), chestMat);
    lid.position.set(0, 0.125, 0.4375);
    const latch = new Mesh(new BoxGeometry(0.12, 0.25, 0.06), new MeshLambertMaterial({ color: '#c9c9c9' }));
    latch.position.set(0, 0.05, 0.9);
    this.chestLid.add(lid, latch);
    chest.add(base, this.chestLid);
    for (const m of [base, lid]) m.castShadow = m.receiveShadow = true;
    this.scene.add(chest);
    this.disposables.push(chestTex, chestMat, base.geometry, lid.geometry, latch.geometry, latch.material as Material);
  }

  private buildMobs() {
    const counts: [MobKind, number][] = this.mobile
      ? [['pig', 2], ['cow', 2], ['sheep', 2], ['chicken', 3]]
      : [['pig', 3], ['cow', 3], ['sheep', 4], ['chicken', 5]];
    let seed = 100;
    for (const [kind, n] of counts) {
      for (let i = 0; i < n; i++) this.addMob(new Mob(kind, this.terrain, seed++), this.mobs);
    }
    for (const kind of ['zombie', 'zombie', 'creeper', 'creeper'] as MobKind[]) {
      const mob = new Mob(kind, this.terrain, seed++);
      mob.presence = 0;
      this.addMob(mob, this.nightMobs);
    }
    for (let i = 0; i < MAX_PLAYERS_SHOWN; i++) {
      const mob = new Mob('player', this.terrain, 500 + i);
      mob.presence = 0;
      this.addMob(mob, this.players);
    }
  }

  private addMob(mob: Mob, list: Mob[]) {
    list.push(mob);
    this.scene.add(mob.root);
  }

  // ---------- state ----------

  setState(next: WorldState) {
    this.state = next;
    this.targetMood = MOODS[MOOD_FOR[next.server]];
    const shown = Math.min(next.playerCount, MAX_PLAYERS_SHOWN);
    this.players.forEach((p, i) => {
      p.presence = i < shown ? 1 : 0;
      p.setName(i < shown ? (next.playerNames[i] ?? null) : null);
    });
    if (this.reducedMotion) this.renderStill();
  }

  // ---------- loop ----------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (this.reducedMotion) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.tick(dt);
    this.renderer.render(this.scene, this.camera);
  };

  /** Reduced motion: settle every transition at once and draw a single frame. */
  private renderStill() {
    for (let i = 0; i < 40; i++) this.tick(0.25, true);
    this.renderer.render(this.scene, this.camera);
  }

  private tick(dt: number, still = false) {
    this.time += dt;
    const { mood, state, terrain } = this;
    dampMood(mood, this.targetMood, 0.9, dt);
    const night = 1 - mood.daylight;

    // lighting
    this.renderer.toneMappingExposure = mood.exposure;
    this.hemi.color.copy(mood.hemiSky);
    this.hemi.groundColor.copy(mood.hemiGround);
    this.hemi.intensity = mood.hemiIntensity;
    this.sunLight.color.copy(mood.sun);
    this.sunLight.intensity = mood.sunIntensity;
    (this.scene.fog as Fog).color.copy(mood.skyHorizon);
    this.sky.material.uniforms.top!.value.copy(mood.skyTop);
    this.sky.material.uniforms.horizon!.value.copy(mood.skyHorizon);
    this.sky.material.uniforms.bottom!.value.copy(mood.skyBottom);
    this.water.material.color.copy(mood.water);
    this.water.material.map!.offset.x += dt * 0.025;

    // sun by day, moon by night (the directional light follows whichever is up)
    const elev = 0.35 + mood.daylight * 0.55;
    const dir = new Vector3(Math.sin(0.9) * Math.cos(elev), Math.sin(elev), Math.cos(0.9) * Math.cos(elev));
    this.sunLight.position.copy(dir).multiplyScalar(80);
    this.sunLight.target.position.set(0, 0, 0);
    const camPos = this.camera.position;
    const { sun, sunGlow, moon, starMat } = this.celestial;
    for (const [mesh, visible] of [[sun, mood.daylight], [sunGlow, mood.daylight], [moon, night]] as const) {
      mesh.position.copy(camPos).addScaledVector(dir, 300);
      mesh.lookAt(camPos);
      (mesh.material as MeshBasicMaterial).opacity = (mesh === sunGlow ? 0.2 : 1) * visible;
      mesh.visible = visible > 0.02;
    }
    starMat.opacity = mood.stars;
    this.celestial.stars.visible = mood.stars > 0.02;
    this.celestial.stars.position.copy(camPos);
    this.sky.mesh.position.copy(camPos);
    this.clouds.material.opacity = 0.85 - night * 0.55;
    this.clouds.material.color.setRGB(1 - night * 0.7, 1 - night * 0.68, 1 - night * 0.6);
    if (!still) this.clouds.update(dt);

    // beacon: on while running, flickers while starting
    const beamGoal = state.server === 'running' ? 1 : state.server === 'starting' ? 0.35 + Math.abs(Math.sin(this.time * 6)) * 0.3 : 0;
    this.beamLevel = damp(this.beamLevel, beamGoal, 3, dt);
    const pulse = 0.85 + Math.sin(this.time * 2.2) * 0.15;
    for (const m of this.beamMats) m.opacity = (m.userData.base as number) * this.beamLevel * pulse;
    this.beam.visible = this.beamLevel > 0.01;

    this.portalMat.map!.offset.y -= dt * 0.18;
    this.portalMat.map!.offset.x = Math.sin(this.time * 0.6) * 0.1;

    this.installLevel = damp(this.installLevel, state.installing ? 1 : 0, 3, dt);
    this.chestLid.rotation.x = -this.installLevel * (1.1 + Math.sin(this.time * 3) * 0.08);

    this.updateParticles(night);

    // mobs
    for (const m of this.nightMobs) m.presence = night > 0.6 ? 1 : 0;
    if (!still) for (const m of [...this.mobs, ...this.nightMobs, ...this.players]) m.update(dt, this.time, terrain);
    else for (const m of [...this.mobs, ...this.nightMobs, ...this.players]) m.update(0, this.time, terrain);

    this.updateCamera(dt, still);
  }

  private updateParticles(night: number) {
    const t = this.time;
    const ff = this.fireflies;
    ff.material.opacity = this.mood.fireflies * 0.9;
    ff.points.visible = this.mood.fireflies > 0.02;
    if (ff.points.visible) {
      const arr = ff.positions.array as Float32Array;
      for (let i = 0; i < 160; i++) {
        const [x, y, z, s] = this.fireflySeeds.subarray(i * 4, i * 4 + 4) as unknown as number[];
        arr[i * 3] = x! + Math.sin(t * 0.4 + s!) * 1.2;
        arr[i * 3 + 1] = y! + Math.sin(t * 0.9 + s! * 2) * 0.4;
        arr[i * 3 + 2] = z! + Math.cos(t * 0.35 + s!) * 1.2;
      }
      ff.positions.needsUpdate = true;
    }

    const sp = this.sparks;
    sp.material.opacity = this.installLevel * (0.6 + night * 0.4);
    sp.points.visible = this.installLevel > 0.02;
    if (sp.points.visible) {
      const { x: cx, y: cy, z: cz } = this.terrain.stations.packs;
      const arr = sp.positions.array as Float32Array;
      for (let i = 0; i < 70; i++) {
        const life = (t * 0.35 + i / 70) % 1;
        const a = i * 2.39996 + t * 1.5;
        const r = 0.25 + life * 0.9;
        arr[i * 3] = cx + Math.cos(a) * r;
        arr[i * 3 + 1] = cy + life * 5;
        arr[i * 3 + 2] = cz + Math.sin(a) * r;
      }
      sp.positions.needsUpdate = true;
    }
  }

  private updateCamera(dt: number, still: boolean) {
    const { camera, cam, terrain, state } = this;
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    const wide = w >= 1024;

    // How far the admin console has scrolled into view (0 = hero, 1 = admin).
    const admin = document.getElementById('admin');
    let focusGoal = 0;
    if (admin && state.station) {
      const top = admin.getBoundingClientRect().top;
      focusGoal = clamp(1 - top / (h * 0.85), 0, 1);
    }
    this.focus = still ? focusGoal : damp(this.focus, focusGoal, 6, dt);
    const f = this.focus * this.focus * (3 - 2 * this.focus);

    // overview: the whole island, fitted to the free part of the screen
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const usable = wide ? 0.58 : 0.96;
    const fitW = 46;
    const distW = fitW / 2 / Math.tan((hfov * usable) / 2);
    const distH = 30 / 2 / Math.tan(vfov / 2);
    const overviewDist = clamp(Math.max(distW, distH) * 1.05, 40, 140);
    if (!still && !this.reducedMotion && f < 0.5) this.baseAz += dt * 0.03;

    const st = state.station ? terrain.stations[state.station] : null;
    const goal = {
      az: this.baseAz,
      el: wide ? 0.4 : 0.5,
      dist: overviewDist,
      tx: 0,
      ty: wide ? 3.5 : 6,
      tz: 0,
      offset: wide ? -0.2 : 0,
      offY: 0,
    };
    if (st && f > 0) {
      const sway = Math.sin(this.time * 0.25) * 0.12;
      const stationAz = st.angle + 0.4 + sway;
      let dAz = ((stationAz - goal.az + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (dAz < -Math.PI) dAz += Math.PI * 2;
      goal.az += dAz * f;
      goal.el += (0.34 - goal.el) * f;
      goal.dist += ((wide ? 16.5 : 20) - goal.dist) * f;
      goal.tx += (st.x - goal.tx) * f;
      goal.ty += (st.y + 0.4 - goal.ty) * f;
      goal.tz += (st.z - goal.tz) * f;
      // Frame the station inside the transparent "window" at the top of the admin section.
      goal.offset += ((wide ? -0.12 : 0) - goal.offset) * f;
      goal.offY += 0.24 * f;
    }

    // pointer parallax (fine pointers only)
    if (!this.coarse && !this.reducedMotion) {
      this.pointer.sx = damp(this.pointer.sx, this.pointer.x, 3, dt);
      this.pointer.sy = damp(this.pointer.sy, this.pointer.y, 3, dt);
      goal.az += this.pointer.sx * 0.1;
      goal.el += this.pointer.sy * 0.05;
    }

    const lambda = still ? 50 : 2.6;
    cam.az = dampAngle(cam.az, goal.az, lambda, dt);
    for (const k of ['el', 'dist', 'tx', 'ty', 'tz', 'offset', 'offY'] as const) cam[k] = damp(cam[k], goal[k], lambda, dt);

    const cosEl = Math.cos(cam.el);
    camera.position.set(cam.tx + Math.sin(cam.az) * cosEl * cam.dist, cam.ty + Math.sin(cam.el) * cam.dist, cam.tz + Math.cos(cam.az) * cosEl * cam.dist);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    camera.setViewOffset(w, h, cam.offset * w, cam.offY * h, w, h);

    const fog = this.scene.fog as Fog;
    fog.near = cam.dist * 0.95;
    fog.far = cam.dist * 2.1 + 30;
  }

  // ---------- events ----------

  private resize = () => {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.mobile ? 1.25 : 1.75));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.reducedMotion) this.renderStill();
  };

  private onPointer = (e: PointerEvent) => {
    this.pointer.x = (e.clientX / innerWidth) * 2 - 1;
    this.pointer.y = (e.clientY / innerHeight) * 2 - 1;
  };

  private onVisibility = () => {
    cancelAnimationFrame(this.raf);
    if (!document.hidden) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    removeEventListener('pointermove', this.onPointer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const m of [...this.mobs, ...this.nightMobs, ...this.players]) m.setName(null);
    for (const d of this.disposables) d.dispose();
    disposeMobResources();
    this.renderer.dispose();
  }
}
