import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  type Sprite,
  type Texture,
} from 'three';
import { makeNameTag, Mob, type MobKind } from './mobs';
import { damp, mulberry32 } from './random';
import { BLOCK, buildGeometry, MAX_BEACONS, Terrain, WATER } from './terrain';
import { pixelTexture, shadeRGB } from './textures';

export type WorldServerState = 'loading' | 'offline' | 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

/** What the hub knows about one machine, as the 3D world needs it. */
export interface IslandInfo {
  /** The machine id. */
  key: string;
  name: string;
  seed: number;
  online: boolean;
  /** One beacon per installed server (up to 8). */
  servers: { id: string; state: WorldServerState }[];
  /** The selected server: drives the big beacon on the control station. */
  selectedState: WorldServerState;
  playerCount: number;
  playerNames: string[];
  installing: boolean;
}

export const SIGNAL = '#c8f43a';
const DANGER = '#ff6b5a';
const MAX_PLAYERS_SHOWN = 8;

/** Textures and materials every island shares. */
export interface Shared {
  atlas: Texture;
  glowMat: MeshBasicMaterial;
  portalTex: Texture;
  chestMat: MeshLambertMaterial;
  latchMat: MeshLambertMaterial;
  stemGeo: BoxGeometry;
  bloomGeo: BoxGeometry;
  stemMat: MeshLambertMaterial;
  bloomMat: MeshLambertMaterial;
  cubeGeo: BoxGeometry;
  cloudMat: MeshLambertMaterial;
}

export function createShared(atlas: Texture, portalTex: Texture): Shared {
  const wood = [125, 86, 40] as const;
  const chestTex = pixelTexture(14, 14, (set, rnd) => {
    for (let y = 0; y < 14; y++) {
      for (let x = 0; x < 14; x++) {
        const frame = x === 0 || y === 0 || x === 13 || y === 13;
        set(x, y, shadeRGB(frame ? [74, 50, 22] : wood, 1 + (rnd() - 0.5) * 0.14));
      }
    }
  });
  return {
    atlas,
    glowMat: new MeshBasicMaterial({ map: atlas }),
    portalTex,
    chestMat: new MeshLambertMaterial({ map: chestTex }),
    latchMat: new MeshLambertMaterial({ color: '#c9c9c9' }),
    stemGeo: new BoxGeometry(0.07, 0.38, 0.07),
    bloomGeo: new BoxGeometry(0.2, 0.2, 0.2),
    stemMat: new MeshLambertMaterial({ color: '#3f7a2a' }),
    bloomMat: new MeshLambertMaterial({ color: '#ffffff' }),
    cubeGeo: new BoxGeometry(1, 1, 1),
    cloudMat: new MeshLambertMaterial({ color: '#dfe3ea', transparent: true, opacity: 0, depthWrite: false }),
  };
}

export function disposeShared(s: Shared) {
  for (const d of [s.glowMat, s.chestMat.map!, s.chestMat, s.latchMat, s.stemGeo, s.bloomGeo, s.stemMat, s.bloomMat, s.cubeGeo, s.cloudMat]) d.dispose();
}

interface Beam {
  group: Group;
  mats: MeshBasicMaterial[];
  level: number;
}

function makeBeam(width: number, height: number, color: string): Beam {
  const group = new Group();
  const mats: MeshBasicMaterial[] = [];
  for (const [w, opacity] of [[width, 0.9], [width * 2.2, 0.22], [width * 4, 0.07]] as const) {
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false });
    mat.userData.base = opacity;
    const m = new Mesh(new BoxGeometry(w, height, w), mat);
    m.position.y = height / 2;
    group.add(m);
    mats.push(mat);
  }
  group.visible = false;
  return { group, mats, level: 0 };
}

function beamGoal(state: WorldServerState, time: number) {
  if (state === 'running') return 1;
  if (state === 'starting') return 0.35 + Math.abs(Math.sin(time * 6)) * 0.3;
  if (state === 'stopping') return 0.25;
  if (state === 'crashed') return 0.45 + Math.sin(time * 9) * 0.15;
  return 0;
}

/**
 * One machine as a floating island: the voxel terrain from its seed, the four admin stations,
 * a beacon per installed server, animals and the players that are online.
 */
export class Island {
  readonly key: string;
  readonly group = new Group();
  readonly terrain: Terrain;
  info: IslandInfo;
  /** Slot in the archipelago; the world moves the group there. */
  slot = 0;
  /** Smoothed 0..1 values the world reads. */
  offlineLevel = 1;
  installLevel = 0;
  fireflySeeds = new Float32Array(160 * 4);

  private solidMat: MeshLambertMaterial;
  private disposables: { dispose(): void }[] = [];
  private controlBeam: Beam;
  private serverBeams: (Beam & { cube: Mesh; cubeMat: MeshBasicMaterial; color: string; state: WorldServerState })[] = [];
  private portalMat: MeshBasicMaterial;
  private chestLid = new Group();
  private mobs: Mob[] = [];
  private nightMobs: Mob[] = [];
  private players: Mob[] = [];
  private tag: Sprite | null = null;
  private cloud = new Group();
  private sinkY = 0;
  private grey = new Color('#6f747c');
  private white = new Color('#ffffff');

  constructor(info: IslandInfo, shared: Shared, mobile: boolean) {
    this.key = info.key;
    this.info = info;
    this.offlineLevel = info.online ? 0 : 1;
    this.sinkY = info.online ? 0 : -2.5;
    this.terrain = new Terrain(info.seed);
    const { terrain } = this;

    this.solidMat = new MeshLambertMaterial({ map: shared.atlas, vertexColors: true });
    const solid = new Mesh(buildGeometry(terrain, (b) => b !== BLOCK.beacon), this.solidMat);
    solid.castShadow = solid.receiveShadow = true;
    const glow = new Mesh(buildGeometry(terrain, (b) => b === BLOCK.beacon), shared.glowMat);
    this.group.add(solid, glow);
    this.disposables.push(this.solidMat, solid.geometry, glow.geometry);

    // Flowers
    const { flowers } = terrain;
    const stems = new InstancedMesh(shared.stemGeo, shared.stemMat, flowers.length);
    const blooms = new InstancedMesh(shared.bloomGeo, shared.bloomMat, flowers.length);
    const dummy = new Object3D();
    flowers.forEach((f, i) => {
      dummy.position.set(f.x, f.y + 0.19, f.z);
      dummy.rotation.y = 0;
      dummy.updateMatrix();
      stems.setMatrixAt(i, dummy.matrix);
      dummy.position.y = f.y + 0.42;
      dummy.rotation.y = i;
      dummy.updateMatrix();
      blooms.setMatrixAt(i, dummy.matrix);
      blooms.setColorAt(i, new Color(f.color));
    });
    this.group.add(stems, blooms);
    this.disposables.push(stems, blooms);

    const { control, packs, instances } = terrain.stations;

    // The big beacon on the control station: the selected server
    this.controlBeam = makeBeam(0.32, 120, SIGNAL);
    this.controlBeam.group.position.set(control.x, control.y + 0.5, control.z);
    this.group.add(this.controlBeam.group);

    // One small beacon per installed server
    for (const spot of terrain.beacons.slice(0, MAX_BEACONS)) {
      const beam = makeBeam(0.2, 60, SIGNAL);
      beam.group.position.set(spot.x, spot.y + 1, spot.z);
      const cubeMat = new MeshBasicMaterial({ color: '#2b3634' });
      const cube = new Mesh(shared.cubeGeo, cubeMat);
      cube.position.set(spot.x, spot.y + 0.5, spot.z);
      cube.visible = false;
      this.group.add(beam.group, cube);
      this.serverBeams.push({ ...beam, cube, cubeMat, color: SIGNAL, state: 'stopped' });
      this.disposables.push(cubeMat);
    }

    // Nether portal surface
    this.portalMat = new MeshBasicMaterial({ map: shared.portalTex, transparent: true, opacity: 0.82, side: DoubleSide, depthWrite: false });
    const portal = new Mesh(new PlaneGeometry(2, 3), this.portalMat);
    portal.rotation.y = Math.PI / 2;
    portal.position.set(instances.x, instances.y, instances.z - 0.5);
    this.group.add(portal);
    this.disposables.push(this.portalMat, portal.geometry);

    // Chest (its lid opens during a modpack install)
    const chest = new Group();
    chest.position.set(packs.x, packs.y - 0.6, packs.z);
    chest.rotation.y = packs.angle;
    const base = new Mesh(new BoxGeometry(0.875, 0.62, 0.875), shared.chestMat);
    base.position.y = 0.31;
    this.chestLid.position.set(0, 0.62, -0.4375);
    const lid = new Mesh(new BoxGeometry(0.875, 0.25, 0.875), shared.chestMat);
    lid.position.set(0, 0.125, 0.4375);
    const latch = new Mesh(new BoxGeometry(0.12, 0.25, 0.06), shared.latchMat);
    latch.position.set(0, 0.05, 0.9);
    this.chestLid.add(lid, latch);
    chest.add(base, this.chestLid);
    for (const m of [base, lid]) m.castShadow = m.receiveShadow = true;
    this.group.add(chest);
    this.disposables.push(base.geometry, lid.geometry, latch.geometry);

    // A low cloud bank that covers the island while its machine is switched off
    const rnd = mulberry32(info.seed + 7);
    for (let i = 0; i < 9; i++) {
      const c = new Mesh(shared.cubeGeo, shared.cloudMat);
      c.scale.set(8 + rnd() * 8, 1.6 + rnd() * 1.2, 6 + rnd() * 8);
      c.position.set((rnd() - 0.5) * 30, 15 + rnd() * 3, (rnd() - 0.5) * 30);
      this.cloud.add(c);
    }
    this.cloud.visible = false;
    this.group.add(this.cloud);

    // Animals, night mobs and players
    const counts: [MobKind, number][] = mobile ? [['pig', 1], ['cow', 1], ['sheep', 2], ['chicken', 2]] : [['pig', 2], ['cow', 2], ['sheep', 3], ['chicken', 3]];
    let seed = (info.seed % 10_000) * 50;
    for (const [kind, n] of counts) for (let i = 0; i < n; i++) this.addMob(new Mob(kind, terrain, seed++), this.mobs);
    for (const kind of ['zombie', 'creeper'] as MobKind[]) {
      const mob = new Mob(kind, terrain, seed++);
      mob.presence = 0;
      this.addMob(mob, this.nightMobs);
    }
    for (let i = 0; i < MAX_PLAYERS_SHOWN; i++) {
      const mob = new Mob('player', terrain, seed++);
      mob.presence = 0;
      this.addMob(mob, this.players);
    }

    const frnd = mulberry32(info.seed + 3);
    for (let i = 0; i < 160; i++) {
      const x = (frnd() - 0.5) * 38;
      const z = (frnd() - 0.5) * 38;
      const g = terrain.groundAt(x, z) ?? WATER + 1;
      this.fireflySeeds.set([x, g + 0.6 + frnd() * 2.2, z, frnd() * 100], i * 4);
    }

    this.setInfo(info);
  }

  private addMob(mob: Mob, list: Mob[]) {
    list.push(mob);
    this.group.add(mob.root);
  }

  setInfo(info: IslandInfo) {
    if (info.name !== this.info.name || !this.tag) {
      if (this.tag) {
        this.group.remove(this.tag);
        this.tag.material.map?.dispose();
        this.tag.material.dispose();
      }
      this.tag = makeNameTag(info.name);
      this.tag.scale.multiplyScalar(7);
      this.tag.position.set(0, 26, 0);
      this.group.add(this.tag);
    }
    this.info = info;
    const shown = info.online ? Math.min(info.playerCount, MAX_PLAYERS_SHOWN) : 0;
    this.players.forEach((p, i) => {
      p.presence = i < shown ? 1 : 0;
      p.setName(i < shown ? (info.playerNames[i] ?? null) : null);
    });
    this.serverBeams.forEach((b, i) => {
      const server = info.online ? info.servers[i] : undefined;
      b.cube.visible = Boolean(server);
      b.state = server?.state ?? 'stopped';
      const color = b.state === 'crashed' ? DANGER : SIGNAL;
      if (color !== b.color) {
        b.color = color;
        for (const m of b.mats) m.color.set(color);
      }
      b.cubeMat.color.set(b.state === 'running' ? '#c8f43a' : b.state === 'crashed' ? '#a8473d' : b.state === 'starting' ? '#7f9a2c' : '#2b3634');
    });
  }

  /** Name tag opacity: shown in the archipelago overview, hidden up close. */
  setTagOpacity(v: number) {
    if (!this.tag) return;
    this.tag.material.opacity = v;
    this.tag.visible = v > 0.02;
  }

  /** World position of a station (or the island centre). */
  stationWorld(id: keyof Terrain['stations'] | null) {
    const p = this.group.position;
    if (!id) return { x: p.x, y: p.y + 3.5, z: p.z, angle: null as number | null };
    const st = this.terrain.stations[id];
    return { x: p.x + st.x, y: p.y + st.y, z: p.z + st.z, angle: st.angle };
  }

  update(dt: number, time: number, night: number, animate: boolean) {
    const { info } = this;
    this.offlineLevel = damp(this.offlineLevel, info.online ? 0 : 1, 2, dt);
    this.sinkY = damp(this.sinkY, info.online ? 0 : -2.5, 1.5, dt);
    this.group.position.y = this.sinkY;
    this.solidMat.color.copy(this.white).lerp(this.grey, this.offlineLevel * 0.75);
    this.cloud.visible = this.offlineLevel > 0.02;
    this.cloud.children.forEach((c, i) => (c.position.y = 15 + Math.sin(time * 0.3 + i) * 0.4 + (i % 3)));

    const selected = info.online ? info.selectedState : 'offline';
    this.controlBeam.level = damp(this.controlBeam.level, beamGoal(selected, time), 3, dt);
    const pulse = 0.85 + Math.sin(time * 2.2) * 0.15;
    for (const m of this.controlBeam.mats) m.opacity = (m.userData.base as number) * this.controlBeam.level * pulse;
    this.controlBeam.group.visible = this.controlBeam.level > 0.01;

    for (const b of this.serverBeams) {
      b.level = damp(b.level, b.cube.visible ? beamGoal(b.state, time) : 0, 3, dt);
      for (const m of b.mats) m.opacity = (m.userData.base as number) * b.level * pulse * 0.8;
      b.group.visible = b.level > 0.01;
      // A crashed server's beam is a short red haze instead of a pillar of light.
      b.group.scale.y = b.state === 'crashed' ? 0.12 : 1;
    }

    this.portalMat.map!.offset.y -= dt * 0.18;
    this.portalMat.map!.offset.x = Math.sin(time * 0.6) * 0.1;

    this.installLevel = damp(this.installLevel, info.installing ? 1 : 0, 3, dt);
    this.chestLid.rotation.x = -this.installLevel * (1.1 + Math.sin(time * 3) * 0.08);

    for (const m of this.nightMobs) m.presence = info.online && night > 0.6 ? 1 : 0;
    const all = [...this.mobs, ...this.nightMobs, ...this.players];
    for (const m of this.mobs) m.presence = this.offlineLevel > 0.5 ? 0 : 1;
    for (const m of all) m.update(animate ? dt : 0, time, this.terrain);
  }

  dispose() {
    for (const m of [...this.mobs, ...this.nightMobs, ...this.players]) m.setName(null);
    if (this.tag) {
      this.tag.material.map?.dispose();
      this.tag.material.dispose();
    }
    for (const b of [this.controlBeam, ...this.serverBeams]) {
      for (const m of b.mats) m.dispose();
      b.group.traverse((o) => (o as Mesh).geometry?.dispose());
    }
    for (const d of this.disposables) d.dispose();
  }
}

