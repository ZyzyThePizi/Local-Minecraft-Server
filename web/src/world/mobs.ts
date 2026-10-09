import {
  BoxGeometry,
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { damp, dampAngle, mulberry32 } from './random';
import type { Terrain } from './terrain';
import { pixelTexture, shadeRGB } from './textures';

const P = 1 / 16; // one Minecraft pixel

export type MobKind = 'pig' | 'cow' | 'sheep' | 'chicken' | 'creeper' | 'zombie' | 'player';

interface Rig {
  root: Group;
  head: Object3D;
  legs: Object3D[];
  arms: Object3D[];
  wings: Object3D[];
}

// ---------- materials ----------

const materialCache = new Map<string, MeshLambertMaterial>();
const geometries: BoxGeometry[] = [];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A slightly noisy flat colour, like a Minecraft texture seen from afar. */
function noisy(hex: string, amount = 0.08) {
  const key = `n:${hex}:${amount}`;
  let m = materialCache.get(key);
  if (!m) {
    const base = hexToRgb(hex);
    const map = pixelTexture(8, 8, (set, rnd) => {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) set(x, y, shadeRGB(base, 1 + (rnd() - 0.5) * 2 * amount));
    }, hex.length * 31 + base[0]);
    m = new MeshLambertMaterial({ map });
    materialCache.set(key, m);
  }
  return m;
}

function faceMaterial(key: string, w: number, h: number, base: string, pixels: [number, number, string][], amount = 0.06) {
  let m = materialCache.get(key);
  if (!m) {
    const rgb = hexToRgb(base);
    const map = pixelTexture(w, h, (set, rnd) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, shadeRGB(rgb, 1 + (rnd() - 0.5) * 2 * amount));
      for (const [x, y, color] of pixels) set(x, y, color);
    });
    m = new MeshLambertMaterial({ map });
    materialCache.set(key, m);
  }
  return m;
}

function patterned(key: string, base: string, spot: string, chance: number) {
  let m = materialCache.get(key);
  if (!m) {
    const a = hexToRgb(base);
    const b = hexToRgb(spot);
    const map = pixelTexture(8, 8, (set, rnd) => {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const blob = Math.sin(x * 1.3 + y * 0.7) + Math.cos(y * 1.1 - x * 0.5) > 2 - chance * 4;
          set(x, y, shadeRGB(blob ? b : a, 1 + (rnd() - 0.5) * 0.1));
        }
      }
    });
    m = new MeshLambertMaterial({ map });
    materialCache.set(key, m);
  }
  return m;
}

// ---------- geometry helpers ----------

/** Box in Minecraft pixels; `front` replaces the +z face (the way a mob looks). */
function part(w: number, h: number, d: number, mat: Material, front?: Material, top?: Material) {
  const geo = new BoxGeometry(w * P, h * P, d * P);
  geometries.push(geo);
  const mats = [mat, mat, top ?? mat, mat, front ?? mat, mat];
  const mesh = new Mesh(geo, mats);
  mesh.castShadow = true;
  return mesh;
}

/** A limb that swings from its top (hip / shoulder). */
function limb(w: number, h: number, d: number, mat: Material, x: number, y: number, z: number) {
  const pivot = new Group();
  pivot.position.set(x * P, y * P, z * P);
  const mesh = part(w, h, d, mat);
  mesh.position.y = (-h / 2) * P;
  pivot.add(mesh);
  return pivot;
}

function at<T extends Object3D>(obj: T, x: number, y: number, z: number) {
  obj.position.set(x * P, y * P, z * P);
  return obj;
}

// ---------- mob builders ----------

const BLACK = '#1b1b1b';
const WHITE = '#f4f4f4';

function quadruped(legMat: Material, legW: number, legH: number, spreadX: number, spreadZ: number) {
  return [
    limb(legW, legH, legW, legMat, -spreadX, legH, spreadZ),
    limb(legW, legH, legW, legMat, spreadX, legH, spreadZ),
    limb(legW, legH, legW, legMat, -spreadX, legH, -spreadZ),
    limb(legW, legH, legW, legMat, spreadX, legH, -spreadZ),
  ];
}

function buildPig(): Rig {
  const root = new Group();
  const skin = noisy('#efa3a0');
  const face = faceMaterial('pigface', 8, 8, '#efa3a0', [
    [1, 3, WHITE], [2, 3, BLACK], [5, 3, BLACK], [6, 3, WHITE],
  ]);
  const legs = quadruped(skin, 4, 6, 3, 5);
  const body = at(part(10, 8, 16, skin), 0, 10, 0);
  const head = at(new Group(), 0, 12, 10);
  head.add(at(part(8, 8, 8, skin, face), 0, 0, 2));
  head.add(at(part(4, 3, 1, noisy('#d9817f'), faceMaterial('snout', 4, 3, '#d9817f', [[0, 1, '#9c5352'], [3, 1, '#9c5352']])), 0, -1.5, 6.5));
  root.add(body, head, ...legs);
  return { root, head, legs, arms: [], wings: [] };
}

function buildCow(): Rig {
  const root = new Group();
  const hide = patterned('cowhide', '#3d2b1f', '#e6e1d8', 0.33);
  const brown = noisy('#3d2b1f');
  const face = faceMaterial('cowface', 8, 8, '#3d2b1f', [
    [1, 3, BLACK], [2, 3, WHITE], [5, 3, WHITE], [6, 3, BLACK],
    [2, 4, '#e6e1d8'], [3, 4, '#e6e1d8'], [4, 4, '#e6e1d8'], [5, 4, '#e6e1d8'],
    [2, 5, '#c89a8a'], [3, 5, '#c89a8a'], [4, 5, '#c89a8a'], [5, 5, '#c89a8a'],
    [2, 6, '#c89a8a'], [3, 6, '#5a3a33'], [4, 6, '#5a3a33'], [5, 6, '#c89a8a'],
  ]);
  const legs = quadruped(brown, 4, 12, 4, 6);
  const body = at(part(12, 10, 18, hide), 0, 17, 0);
  const head = at(new Group(), 0, 20, 9);
  head.add(at(part(8, 8, 6, brown, face), 0, 0, 3));
  head.add(at(part(1, 3, 1, noisy('#e8e0d0')), -4.5, 4, 3), at(part(1, 3, 1, noisy('#e8e0d0')), 4.5, 4, 3));
  root.add(body, head, ...legs);
  return { root, head, legs, arms: [], wings: [] };
}

function buildSheep(): Rig {
  const root = new Group();
  const wool = noisy('#ececec', 0.06);
  const skin = noisy('#d9c1a6');
  const face = faceMaterial('sheepface', 6, 6, '#d9c1a6', [
    [1, 2, BLACK], [4, 2, BLACK], [2, 4, '#c9958a'], [3, 4, '#c9958a'],
  ]);
  const legs = quadruped(skin, 4, 12, 3, 5);
  const body = at(part(12, 10, 16, wool), 0, 17, 0);
  const head = at(new Group(), 0, 20, 8);
  head.add(at(part(6, 6, 8, skin, face), 0, 0, 3));
  head.add(at(part(7, 3, 7, wool), 0, 2.5, 2));
  root.add(body, head, ...legs);
  return { root, head, legs, arms: [], wings: [] };
}

function buildChicken(): Rig {
  const root = new Group();
  const feather = noisy('#f2f2f2', 0.05);
  const yellow = noisy('#f0b23a');
  const face = faceMaterial('chickface', 4, 6, '#f2f2f2', [[0, 2, BLACK], [3, 2, BLACK]]);
  const legs = [limb(1, 5, 1, yellow, -1.5, 5, 0), limb(1, 5, 1, yellow, 1.5, 5, 0)];
  const body = at(part(6, 6, 8, feather), 0, 8, 0);
  const head = at(new Group(), 0, 11, 3.5);
  head.add(at(part(4, 6, 3, feather, face), 0, 1, 0));
  head.add(at(part(4, 2, 2, yellow), 0, 1, 2.5), at(part(2, 2, 1, noisy('#d8312d')), 0, -1, 2));
  const wings = [at(part(1, 4, 6, feather), -3.5, 9, 0), at(part(1, 4, 6, feather), 3.5, 9, 0)];
  root.add(body, head, ...legs, ...wings);
  return { root, head, legs, arms: [], wings };
}

function buildCreeper(): Rig {
  const root = new Group();
  const green = patterned('creeper', '#4ea43c', '#2f6e25', 0.32);
  const face = faceMaterial('creeperface', 8, 8, '#4ea43c', [
    [1, 2, BLACK], [2, 2, BLACK], [1, 3, BLACK], [2, 3, BLACK],
    [5, 2, BLACK], [6, 2, BLACK], [5, 3, BLACK], [6, 3, BLACK],
    [3, 4, BLACK], [4, 4, BLACK], [2, 5, BLACK], [3, 5, BLACK], [4, 5, BLACK], [5, 5, BLACK],
    [2, 6, BLACK], [5, 6, BLACK],
  ], 0.12);
  const legs = quadruped(green, 4, 6, 2, 4);
  const body = at(part(8, 12, 4, green), 0, 12, 0);
  const head = at(new Group(), 0, 18, 0);
  head.add(at(part(8, 8, 8, green, face), 0, 4, 0));
  root.add(body, head, ...legs);
  return { root, head, legs, arms: [], wings: [] };
}

function buildHumanoid(kind: 'player' | 'zombie'): Rig {
  const root = new Group();
  const zombie = kind === 'zombie';
  const skinHex = zombie ? '#5f9446' : '#c48d6a';
  const skin = noisy(skinHex, 0.05);
  const shirt = noisy(zombie ? '#2f8f9a' : '#38a8bd', 0.06);
  const pants = noisy(zombie ? '#3d3f8f' : '#36399b', 0.06);
  const hair = noisy(zombie ? skinHex : '#3b2a1d', 0.08);
  const face = zombie
    ? faceMaterial('zombieface', 8, 8, skinHex, [
        [1, 4, '#1c2b18'], [2, 4, '#1c2b18'], [5, 4, '#1c2b18'], [6, 4, '#1c2b18'],
        [3, 5, '#3f6a2e'], [4, 5, '#3f6a2e'], [2, 6, '#2c4a22'], [3, 6, '#2c4a22'], [4, 6, '#2c4a22'], [5, 6, '#2c4a22'],
      ])
    : faceMaterial('steveface', 8, 8, skinHex, [
        ...Array.from({ length: 16 }, (_, i) => [i % 8, Math.floor(i / 8), '#3b2a1d'] as [number, number, string]),
        [0, 2, '#3b2a1d'], [7, 2, '#3b2a1d'],
        [1, 4, WHITE], [2, 4, '#3b48a6'], [5, 4, '#3b48a6'], [6, 4, WHITE],
        [3, 5, '#9c6a4a'], [4, 5, '#9c6a4a'],
        [2, 6, '#7a4a33'], [3, 6, '#7a4a33'], [4, 6, '#7a4a33'], [5, 6, '#7a4a33'],
      ]);
  const legs = [limb(4, 12, 4, pants, -2, 12, 0), limb(4, 12, 4, pants, 2, 12, 0)];
  const arms = [limb(4, 12, 4, skin, -6, 24, 0), limb(4, 12, 4, skin, 6, 24, 0)];
  // short sleeves
  for (const arm of arms) arm.add(at(part(4.2, 4, 4.2, shirt), 0, -2, 0));
  const body = at(part(8, 12, 4, shirt), 0, 18, 0);
  const head = at(new Group(), 0, 24, 0);
  head.add(at(part(8, 8, 8, skin, face, hair), 0, 4, 0));
  root.add(body, head, ...legs, ...arms);
  return { root, head, legs, arms, wings: [] };
}

const BUILDERS: Record<MobKind, () => Rig> = {
  pig: buildPig,
  cow: buildCow,
  sheep: buildSheep,
  chicken: buildChicken,
  creeper: buildCreeper,
  zombie: () => buildHumanoid('zombie'),
  player: () => buildHumanoid('player'),
};

const SPEED: Record<MobKind, number> = {
  pig: 0.9,
  cow: 0.8,
  sheep: 0.8,
  chicken: 1.1,
  creeper: 1.0,
  zombie: 0.9,
  player: 1.6,
};

// ---------- name tags ----------

export function makeNameTag(text: string) {
  const canvas = document.createElement('canvas');
  const font = '600 44px "JetBrains Mono Variable", ui-monospace, monospace';
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 36;
  canvas.width = w;
  canvas.height = 68;
  ctx.font = font;
  ctx.fillStyle = 'rgba(11,12,14,0.62)';
  ctx.fillRect(0, 0, w, 68);
  ctx.fillStyle = '#c8f43a';
  ctx.fillRect(0, 64, w, 4);
  ctx.fillStyle = '#e9e7e1';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 18, 34);
  const map: Texture = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.minFilter = LinearFilter;
  const sprite = new Sprite(new SpriteMaterial({ map, depthWrite: false, fog: false }));
  const h = 0.32;
  sprite.scale.set((w / 68) * h, h, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// ---------- behaviour ----------

export class Mob {
  readonly kind: MobKind;
  readonly root: Group;
  name: string | null = null;
  /** 1 = shown, 0 = hidden (night-only mobs, players who left). */
  presence = 1;
  private presenceShown = 0;
  private rig: Rig;
  private rnd: () => number;
  private x = 0;
  private z = 0;
  private y = 0;
  private yaw: number;
  private target: { x: number; z: number } | null = null;
  private wait: number;
  private phase = 0;
  private moving = 0;
  private tag: Sprite | null = null;

  constructor(kind: MobKind, terrain: Terrain, seed: number) {
    this.kind = kind;
    this.rnd = mulberry32(seed);
    this.rig = BUILDERS[kind]();
    this.root = this.rig.root;
    this.yaw = this.rnd() * Math.PI * 2;
    this.wait = this.rnd() * 3;
    this.spawn(terrain);
    this.root.scale.setScalar(0.001);
  }

  private spawn(terrain: Terrain) {
    for (let i = 0; i < 200; i++) {
      const x = (this.rnd() - 0.5) * 36;
      const z = (this.rnd() - 0.5) * 36;
      const g = terrain.groundAt(x, z);
      if (g !== null) {
        this.x = x;
        this.z = z;
        this.y = g;
        return;
      }
    }
  }

  setName(name: string | null) {
    if (name === this.name) return;
    this.name = name;
    if (this.tag) {
      this.root.remove(this.tag);
      this.tag.material.map?.dispose();
      this.tag.material.dispose();
      this.tag = null;
    }
    if (name) {
      this.tag = makeNameTag(name);
      this.tag.position.y = 2.35;
      this.root.add(this.tag);
    }
  }

  private pickTarget(terrain: Terrain) {
    const here = terrain.groundAt(this.x, this.z) ?? this.y;
    for (let i = 0; i < 12; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = 2 + this.rnd() * (this.kind === 'player' ? 10 : 6);
      const x = this.x + Math.sin(a) * r;
      const z = this.z + Math.cos(a) * r;
      const g = terrain.groundAt(x, z);
      if (g !== null && Math.abs(g - here) <= 4) {
        this.target = { x, z };
        return;
      }
    }
    this.wait = 1;
  }

  update(dt: number, time: number, terrain: Terrain) {
    this.presenceShown = damp(this.presenceShown, this.presence, 3, dt);
    const s = Math.max(0.001, this.presenceShown);
    this.root.scale.setScalar(s);
    this.root.visible = s > 0.01;
    if (!this.root.visible) return;

    if (this.wait > 0) {
      this.wait -= dt;
      this.moving = damp(this.moving, 0, 8, dt);
      this.rig.head.rotation.y = Math.sin(time * 0.6 + this.yaw * 3) * 0.45;
    } else {
      if (!this.target) this.pickTarget(terrain);
      const t = this.target;
      if (t) {
        const dx = t.x - this.x;
        const dz = t.z - this.z;
        if (Math.hypot(dx, dz) < 0.2) {
          this.target = null;
          this.wait = 1 + this.rnd() * (this.kind === 'player' ? 2 : 5);
        } else {
          const desired = Math.atan2(dx, dz);
          this.yaw = dampAngle(this.yaw, desired, 5, dt);
          const facing = Math.max(0, Math.cos(desired - this.yaw));
          const step = SPEED[this.kind] * dt * facing;
          const nx = this.x + Math.sin(this.yaw) * step;
          const nz = this.z + Math.cos(this.yaw) * step;
          const g = terrain.groundAt(nx, nz);
          if (g === null || g - this.y > 1.2) {
            this.target = null;
            this.wait = 0.4;
          } else {
            this.x = nx;
            this.z = nz;
            this.moving = damp(this.moving, facing, 8, dt);
          }
          this.rig.head.rotation.y = damp(this.rig.head.rotation.y, 0, 4, dt);
        }
      }
    }

    const ground = terrain.groundAt(this.x, this.z) ?? this.y;
    // Step up quickly (a hop), step down a little slower.
    this.y = damp(this.y, ground, ground > this.y ? 14 : 9, dt);

    this.phase += dt * SPEED[this.kind] * 7 * this.moving;
    const swing = Math.sin(this.phase) * 0.75 * this.moving;
    const legs = this.rig.legs;
    if (legs.length === 4) {
      legs[0]!.rotation.x = swing;
      legs[3]!.rotation.x = swing;
      legs[1]!.rotation.x = -swing;
      legs[2]!.rotation.x = -swing;
    } else if (legs.length === 2) {
      legs[0]!.rotation.x = swing;
      legs[1]!.rotation.x = -swing;
    }
    const arms = this.rig.arms;
    if (arms.length === 2) {
      if (this.kind === 'zombie') {
        arms[0]!.rotation.x = -1.45 + Math.sin(time * 1.3) * 0.08;
        arms[1]!.rotation.x = -1.45 + Math.sin(time * 1.3 + 1) * 0.08;
      } else {
        arms[0]!.rotation.x = -swing * 0.8;
        arms[1]!.rotation.x = swing * 0.8;
      }
    }
    for (const [i, wing] of this.rig.wings.entries()) {
      wing.rotation.z = (i ? -1 : 1) * Math.max(0, Math.sin(time * 14)) * 0.5 * this.moving;
    }

    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.yaw;
  }
}

export function disposeMobResources() {
  for (const m of materialCache.values()) {
    m.map?.dispose();
    m.dispose();
  }
  materialCache.clear();
  for (const g of geometries.splice(0)) g.dispose();
}
