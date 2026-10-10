import {
  ACESFilmicToneMapping,
  Box3,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import { createShared, disposeShared, Island, SIGNAL, type IslandInfo, type Shared, type WorldServerState } from './island';
import { disposeMobResources, makeNameTag } from './mobs';
import { clamp, damp, dampAngle, mulberry32 } from './random';
import { cloneMood, createCelestials, createClouds, createParticles, createSkyDome, dampMood, dotTexture, MOODS, type MoodName } from './sky';
import { WATER, type StationId } from './terrain';
import { buildAtlas, buildPortalTexture, buildWaterTexture } from './textures';

export type { StationId } from './terrain';
export type { IslandInfo, WorldServerState } from './island';

export interface WorldState {
  islands: IslandInfo[];
  /** The island the page shows (machine view), or null for the archipelago overview. */
  focus: string | null;
  /** The admin tab's station on the focused island. */
  station: StationId | null;
  /** Show the empty "add an island" slot in the overview. */
  addSlot: boolean;
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

const MAX_ISLANDS = 9;
const ADD_KEY = 'add';

/** Island slots: the first in the middle, six around it, then an outer ring. */
function slotPosition(i: number) {
  if (i === 0) return { x: 0, z: 0 };
  if (i <= 6) {
    const a = ((i - 1) / 6) * Math.PI * 2 + Math.PI / 6;
    return { x: Math.sin(a) * 62, z: Math.cos(a) * 62 };
  }
  const a = ((i - 7) / 12) * Math.PI * 2;
  return { x: Math.sin(a) * 124, z: Math.cos(a) * 124 };
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** The archipelago behind the whole page: one island per machine in the hub. */
export class World {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(35, 1, 0.1, 1400);
  private mood = cloneMood(MOODS.night);
  private targetMood = MOODS.night;
  private state: WorldState = { islands: [], focus: null, station: null, addSlot: false };
  private islands = new Map<string, Island>();
  private shared: Shared;
  private disposables: { dispose(): void }[] = [];
  private raf = 0;
  private last = performance.now();
  private time = 0;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private coarse = matchMedia('(pointer: coarse)').matches;
  private mobile = Math.min(innerWidth, innerHeight) < 640;
  private canvas: HTMLCanvasElement;

  private hemi = new HemisphereLight();
  private sunLight = new DirectionalLight();
  private sky = createSkyDome();
  private celestial = createCelestials();
  private clouds = createClouds();
  private water!: Mesh<PlaneGeometry, MeshLambertMaterial>;
  private fireflies!: ReturnType<typeof createParticles>;
  private sparks!: ReturnType<typeof createParticles>;
  private addSlot = new Group();
  private addTag = makeNameTag('+ Új sziget');
  private addLevel = 0;
  private raycaster = new Raycaster();

  private cam = { az: 0.75, el: 0.5, dist: 60, tx: 0, ty: 5, tz: 0, offset: 0, offY: 0 };
  private baseAz = 0.75;
  private pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  private focus = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: !this.mobile, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = !this.mobile;
    this.renderer.shadowMap.type = PCFShadowMap;

    const atlas = buildAtlas();
    const portalTex = buildPortalTexture();
    portalTex.repeat.set(2, 3);
    this.shared = createShared(atlas, portalTex);
    this.disposables.push(atlas, portalTex);

    this.buildScene();
    this.resize();
    addEventListener('resize', this.resize);
    addEventListener('pointermove', this.onPointer, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.raf = requestAnimationFrame(this.frame);
  }

  private buildScene() {
    const { scene } = this;
    scene.fog = new Fog(0x000000, 60, 170);
    scene.add(this.sky.mesh, this.celestial.group, this.celestial.stars, this.clouds.mesh, this.hemi, this.sunLight, this.sunLight.target);
    this.disposables.push(this.sky.material, this.sky.mesh.geometry, this.clouds.material, this.clouds.mesh.geometry);

    // Ocean and the sea floor between the islands
    const waterTex = buildWaterTexture();
    waterTex.repeat.set(1000, 1000);
    const water = new Mesh(new PlaneGeometry(2000, 2000), new MeshLambertMaterial({ map: waterTex, color: '#ffffff', transparent: true, opacity: 0.82, depthWrite: false }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER - 0.12;
    water.receiveShadow = true;
    this.water = water;
    const floor = new Mesh(new PlaneGeometry(2000, 2000), new MeshLambertMaterial({ color: '#d6c99c' }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 1.99;
    floor.receiveShadow = true;
    scene.add(floor, water);
    this.disposables.push(waterTex, water.geometry, water.material, floor.geometry, floor.material as Material);

    const s = this.sunLight;
    s.castShadow = !this.mobile;
    s.shadow.mapSize.set(2048, 2048);
    Object.assign(s.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 180 });
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.03;

    // The empty slot for the next island: a shallow, pale reef with a label.
    const reefMat = new MeshBasicMaterial({ color: '#e8f0d0', transparent: true, opacity: 0, depthWrite: false });
    const rnd = mulberry32(11);
    for (let i = 0; i < 14; i++) {
      const m = new Mesh(this.shared.cubeGeo, reefMat);
      m.scale.set(3 + rnd() * 6, 0.3, 3 + rnd() * 6);
      m.position.set((rnd() - 0.5) * 22, WATER - 0.05, (rnd() - 0.5) * 22);
      this.addSlot.add(m);
    }
    this.addTag.scale.multiplyScalar(7);
    this.addTag.position.y = 12;
    this.addSlot.add(this.addTag);
    this.addSlot.visible = false;
    this.addSlot.userData.mat = reefMat;
    scene.add(this.addSlot);
    this.disposables.push(reefMat);

    const dots = dotTexture();
    this.disposables.push(dots);
    this.fireflies = createParticles(160, SIGNAL, 0.22, dots);
    this.sparks = createParticles(70, SIGNAL, 0.3, dots);
    scene.add(this.fireflies.points, this.sparks.points);
  }

  // ---------- state ----------

  setState(next: WorldState) {
    this.state = next;
    const shown = next.islands.slice(0, MAX_ISLANDS);
    const keys = new Set(shown.map((i) => i.key));
    for (const [key, island] of this.islands) {
      if (keys.has(key)) continue;
      this.scene.remove(island.group);
      island.dispose();
      this.islands.delete(key);
    }
    shown.forEach((info, i) => {
      let island = this.islands.get(info.key);
      if (!island) {
        island = new Island(info, this.shared, this.mobile);
        this.islands.set(info.key, island);
        this.scene.add(island.group);
      } else island.setInfo(info);
      island.slot = i;
      const p = slotPosition(i);
      island.group.position.x = p.x;
      island.group.position.z = p.z;
    });
    const addPos = slotPosition(shown.length);
    this.addSlot.position.set(addPos.x, 0, addPos.z);

    const focused = next.focus ? this.islands.get(next.focus) : null;
    let mood: WorldServerState;
    if (focused) mood = focused.info.online ? focused.info.selectedState : 'offline';
    else {
      const states = shown.filter((i) => i.online).flatMap((i) => i.servers.map((s) => s.state));
      mood = states.includes('running') ? 'running' : states.includes('starting') ? 'starting' : shown.some((i) => i.online) ? 'stopped' : 'offline';
    }
    this.targetMood = MOODS[MOOD_FOR[mood]];
    if (this.reducedMotion) this.renderStill();
  }

  /** The island (machine id) or the empty slot under a screen point, for clicks in the overview. */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const ray = this.raycaster.ray;
    const box = new Box3();
    let best: { key: string; d: number } | null = null;
    const test = (key: string, x: number, z: number, top: number) => {
      box.min.set(x - 22, 0, z - 22);
      box.max.set(x + 22, top, z + 22);
      const hit = ray.intersectBox(box, new Vector3());
      if (hit) {
        const d = hit.distanceTo(ray.origin);
        if (!best || d < best.d) best = { key, d };
      }
    };
    for (const island of this.islands.values()) test(island.key, island.group.position.x, island.group.position.z, 22);
    if (this.addSlot.visible) test(ADD_KEY, this.addSlot.position.x, this.addSlot.position.z, 8);
    return (best as { key: string } | null)?.key ?? null;
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

  private renderStill() {
    for (let i = 0; i < 40; i++) this.tick(0.25, true);
    this.renderer.render(this.scene, this.camera);
  }

  private tick(dt: number, still = false) {
    this.time += dt;
    const { mood, state } = this;
    dampMood(mood, this.targetMood, 0.9, dt);
    const night = 1 - mood.daylight;

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

    const elev = 0.35 + mood.daylight * 0.55;
    const dir = new Vector3(Math.sin(0.9) * Math.cos(elev), Math.sin(elev), Math.cos(0.9) * Math.cos(elev));
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

    // The shadow camera follows what the camera looks at.
    this.sunLight.target.position.set(this.cam.tx, 0, this.cam.tz);
    this.sunLight.position.set(this.cam.tx, 0, this.cam.tz).addScaledVector(dir, 90);
    this.shared.cloudMat.opacity = 0;

    const focused = state.focus ? (this.islands.get(state.focus) ?? null) : null;
    const overview = 1 - this.focus;
    for (const island of this.islands.values()) {
      // Up close only the focused island moves; in the overview all of them do.
      const animate = !still && (!focused || island === focused);
      island.update(still ? 0.25 : dt, this.time, night, animate);
      island.setTagOpacity(focused ? (island === focused ? 0 : 0.5) : overview * 0.95);
      this.shared.cloudMat.opacity = Math.max(this.shared.cloudMat.opacity, island.offlineLevel * 0.85);
    }

    this.addLevel = damp(this.addLevel, state.addSlot && !focused ? 1 : 0, 3, dt);
    (this.addSlot.userData.mat as MeshBasicMaterial).opacity = this.addLevel * 0.2;
    this.addTag.material.opacity = this.addLevel * 0.9;
    this.addSlot.visible = this.addLevel > 0.02;

    this.updateParticles(night, focused ?? this.islands.values().next().value ?? null);
    this.updateCamera(dt, still);
  }

  private updateParticles(night: number, island: Island | null) {
    const t = this.time;
    const ff = this.fireflies;
    ff.material.opacity = this.mood.fireflies * 0.9;
    ff.points.visible = Boolean(island) && this.mood.fireflies > 0.02;
    if (ff.points.visible && island) {
      ff.points.position.copy(island.group.position);
      const arr = ff.positions.array as Float32Array;
      const seeds = island.fireflySeeds;
      for (let i = 0; i < 160; i++) {
        const x = seeds[i * 4]!;
        const y = seeds[i * 4 + 1]!;
        const z = seeds[i * 4 + 2]!;
        const s = seeds[i * 4 + 3]!;
        arr[i * 3] = x + Math.sin(t * 0.4 + s) * 1.2;
        arr[i * 3 + 1] = y + Math.sin(t * 0.9 + s * 2) * 0.4;
        arr[i * 3 + 2] = z + Math.cos(t * 0.35 + s) * 1.2;
      }
      ff.positions.needsUpdate = true;
    }

    // Install sparks rise from the chest of whichever island is installing (the focused one first).
    const installing = island && island.installLevel > 0.02 ? island : [...this.islands.values()].find((i) => i.installLevel > 0.02);
    const sp = this.sparks;
    sp.material.opacity = (installing?.installLevel ?? 0) * (0.6 + night * 0.4);
    sp.points.visible = Boolean(installing);
    if (installing) {
      const { x: cx, y: cy, z: cz } = installing.stationWorld('packs');
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
    const { camera, cam, state } = this;
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    const wide = w >= 1024;
    const focused = state.focus ? (this.islands.get(state.focus) ?? null) : null;

    // 1 = flown to an island, 0 = archipelago overview.
    this.focus = still ? (focused ? 1 : 0) : damp(this.focus, focused ? 1 : 0, 2.2, dt);

    // How far the admin console has scrolled into view (0 = hero, 1 = admin).
    const admin = document.getElementById('admin');
    let adminGoal = 0;
    if (admin && state.station && focused) {
      const top = admin.getBoundingClientRect().top;
      adminGoal = clamp(1 - top / (h * 0.85), 0, 1);
    }
    const a = adminGoal * adminGoal * (3 - 2 * adminGoal);

    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const usable = wide ? 0.58 : 0.96;
    const fit = (width: number, depth: number) => clamp(Math.max(width / 2 / Math.tan((hfov * usable) / 2), depth / 2 / Math.tan(vfov / 2)) * 1.05, 40, 520);
    if (!still && !this.reducedMotion && a < 0.5) this.baseAz += dt * 0.03;

    // Overview: every island (and the empty slot) fitted to the free part of the screen.
    let minX = -24;
    let maxX = 24;
    let minZ = -24;
    let maxZ = 24;
    const points = [...this.islands.values()].map((i) => i.group.position);
    if (this.addSlot.visible) points.push(this.addSlot.position);
    for (const p of points) {
      minX = Math.min(minX, p.x - 24);
      maxX = Math.max(maxX, p.x + 24);
      minZ = Math.min(minZ, p.z - 24);
      maxZ = Math.max(maxZ, p.z + 24);
    }
    const span = Math.max(maxX - minX, maxZ - minZ);
    const overviewGoal = { tx: (minX + maxX) / 2, tz: (minZ + maxZ) / 2, dist: fit(span * 0.95, span * 0.62), ty: wide ? 3.5 : 6 };

    const islandGoal = focused ? { tx: focused.group.position.x, tz: focused.group.position.z, dist: fit(46, 30), ty: wide ? 3.5 : 6 } : overviewGoal;
    const f = this.focus;
    const goal = {
      az: this.baseAz,
      el: (wide ? 0.4 : 0.5) + (1 - f) * 0.12,
      dist: overviewGoal.dist + (islandGoal.dist - overviewGoal.dist) * f,
      tx: overviewGoal.tx + (islandGoal.tx - overviewGoal.tx) * f,
      ty: overviewGoal.ty,
      tz: overviewGoal.tz + (islandGoal.tz - overviewGoal.tz) * f,
      offset: wide ? -0.2 : 0,
      offY: 0,
    };

    if (focused && a > 0) {
      const station = focused.stationWorld(state.station);
      const sway = Math.sin(this.time * 0.25) * 0.12;
      if (station.angle !== null) {
        const stationAz = station.angle + 0.4 + sway;
        let dAz = ((stationAz - goal.az + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (dAz < -Math.PI) dAz += Math.PI * 2;
        goal.az += dAz * a;
        goal.el += (0.34 - goal.el) * a;
        goal.dist += ((wide ? 16.5 : 20) - goal.dist) * a;
        goal.ty += (station.y + 0.4 - goal.ty) * a;
      } else {
        // "Machine" tab: the whole island from a little higher.
        goal.el += (0.55 - goal.el) * a;
        goal.dist += ((wide ? 48 : 58) - goal.dist) * a;
      }
      goal.tx += (station.x - goal.tx) * a;
      goal.tz += (station.z - goal.tz) * a;
      goal.offset += ((wide ? -0.12 : 0) - goal.offset) * a;
      goal.offY += 0.24 * a;
    }

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
    for (const island of this.islands.values()) island.dispose();
    this.addTag.material.map?.dispose();
    this.addTag.material.dispose();
    for (const d of this.disposables) d.dispose();
    disposeShared(this.shared);
    disposeMobResources();
    this.renderer.dispose();
  }
}
