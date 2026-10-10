import { BufferGeometry, Float32BufferAttribute } from 'three';
import { makeNoise, mulberry32, smoothstep } from './random';
import { TILE, tileUV } from './textures';

export const SIZE = 48;
export const HALF = SIZE / 2;
export const MAX_H = 28;
export const WATER = 5;

export const BLOCK = {
  air: 0,
  grass: 1,
  dirt: 2,
  stone: 3,
  sand: 4,
  log: 5,
  leaves: 6,
  planks: 7,
  cobble: 8,
  obsidian: 9,
  beacon: 10,
  crafting: 11,
  gravel: 12,
  iron: 13,
} as const;

// [side, top, bottom] tile per block
const FACE_TILES: Record<number, [number, number, number]> = {
  [BLOCK.grass]: [TILE.grassSide, TILE.grassTop, TILE.dirt],
  [BLOCK.dirt]: [TILE.dirt, TILE.dirt, TILE.dirt],
  [BLOCK.stone]: [TILE.stone, TILE.stone, TILE.stone],
  [BLOCK.sand]: [TILE.sand, TILE.sand, TILE.sand],
  [BLOCK.log]: [TILE.logSide, TILE.logTop, TILE.logTop],
  [BLOCK.leaves]: [TILE.leaves, TILE.leaves, TILE.leaves],
  [BLOCK.planks]: [TILE.planks, TILE.planks, TILE.planks],
  [BLOCK.cobble]: [TILE.cobble, TILE.cobble, TILE.cobble],
  [BLOCK.obsidian]: [TILE.obsidian, TILE.obsidian, TILE.obsidian],
  [BLOCK.beacon]: [TILE.beacon, TILE.beacon, TILE.beacon],
  [BLOCK.crafting]: [TILE.craftSide, TILE.craftTop, TILE.planks],
  [BLOCK.gravel]: [TILE.gravel, TILE.gravel, TILE.gravel],
  [BLOCK.iron]: [TILE.iron, TILE.iron, TILE.iron],
};

export type StationId = 'control' | 'packs' | 'settings' | 'instances';
export interface Station {
  id: StationId;
  /** World position of the station's focus point. */
  x: number;
  y: number;
  z: number;
  /** Direction from the island centre, used as the camera azimuth. */
  angle: number;
}

const STATION_ANGLES: Record<StationId, number> = {
  control: 0,
  packs: Math.PI / 2,
  settings: Math.PI,
  instances: -Math.PI / 2,
};
const STATION_RADIUS = 10;

/** One beacon per installed server, on the diagonals between the stations: [radius, angle]. */
const BEACON_SPOTS: [number, number][] = [
  [6, Math.PI / 4],
  [6, (3 * Math.PI) / 4],
  [6, (-3 * Math.PI) / 4],
  [6, -Math.PI / 4],
  [15, Math.PI / 4],
  [15, (3 * Math.PI) / 4],
  [15, (-3 * Math.PI) / 4],
  [15, -Math.PI / 4],
];
export const MAX_BEACONS = BEACON_SPOTS.length;

export class Terrain {
  blocks = new Uint8Array(SIZE * SIZE * MAX_H);
  /** Height a mob stands on for each column. */
  heights = new Int16Array(SIZE * SIZE);
  /** Columns mobs must not enter: water, trunks, stations. */
  blocked = new Uint8Array(SIZE * SIZE);
  stations = {} as Record<StationId, Station>;
  flowers: { x: number; y: number; z: number; color: number }[] = [];
  /** Top of each server beacon's iron base, in island coordinates. */
  beacons: { x: number; y: number; z: number }[] = [];

  constructor(seed = 0xea) {
    this.generate(seed);
  }

  private index(x: number, y: number, z: number) {
    return (y * SIZE + z) * SIZE + x;
  }

  get(x: number, y: number, z: number) {
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || y >= MAX_H) return BLOCK.air;
    if (y < 0) return BLOCK.stone;
    return this.blocks[this.index(x, y, z)]!;
  }

  private set(x: number, y: number, z: number, b: number) {
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || y < 0 || y >= MAX_H) return;
    this.blocks[this.index(x, y, z)] = b;
  }

  /** Standing height at a world position, or null when the spot is not walkable. */
  groundAt(wx: number, wz: number) {
    const x = Math.floor(wx + HALF);
    const z = Math.floor(wz + HALF);
    if (x < 1 || z < 1 || x >= SIZE - 1 || z >= SIZE - 1) return null;
    const col = z * SIZE + x;
    return this.blocked[col] ? null : this.heights[col]!;
  }

  private generate(seed: number) {
    const noise = makeNoise(seed);
    const rnd = mulberry32(seed + 1);

    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        const d = Math.hypot(x - HALF + 0.5, z - HALF + 0.5) / HALF;
        const island = 1 - smoothstep(0.48, 0.95, d);
        const n = noise(x * 0.055 + 3.1, z * 0.055 + 7.7, 4);
        const ridge = noise(x * 0.14 + 11, z * 0.14 - 4, 2);
        const h = Math.round(2 + island * (4 + n * 9 + ridge * 2.5));
        this.heights[z * SIZE + x] = Math.max(1, Math.min(MAX_H - 10, h));
      }
    }

    // Flatten a 5×5 pad for each station so its props sit on level ground.
    const pads: { id: StationId; gx: number; gz: number; h: number }[] = [];
    for (const id of Object.keys(STATION_ANGLES) as StationId[]) {
      const a = STATION_ANGLES[id];
      const gx = Math.round(HALF + Math.sin(a) * STATION_RADIUS);
      const gz = Math.round(HALF + Math.cos(a) * STATION_RADIUS);
      const h = Math.max(WATER + 2, this.heights[gz * SIZE + gx]!);
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) this.heights[(gz + dz) * SIZE + gx + dx] = h;
      pads.push({ id, gx, gz, h });
    }
    const spots: { gx: number; gz: number; h: number }[] = [];
    for (const [r, a] of BEACON_SPOTS) {
      const gx = Math.round(HALF + Math.sin(a) * r);
      const gz = Math.round(HALF + Math.cos(a) * r);
      const h = Math.max(WATER + 2, this.heights[gz * SIZE + gx]!);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.heights[(gz + dz) * SIZE + gx + dx] = h;
      spots.push({ gx, gz, h });
    }

    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        const col = z * SIZE + x;
        const h = this.heights[col]!;
        const beach = h <= WATER + 1;
        for (let y = 0; y < h; y++) {
          const depth = h - 1 - y;
          let b: number = BLOCK.stone;
          if (h >= 14) b = depth === 0 ? (rnd() < 0.5 ? BLOCK.gravel : BLOCK.stone) : BLOCK.stone;
          else if (beach) b = depth < 3 ? BLOCK.sand : BLOCK.stone;
          else b = depth === 0 ? BLOCK.grass : depth < 4 ? BLOCK.dirt : BLOCK.stone;
          this.set(x, y, z, b);
        }
        if (h <= WATER) this.blocked[col] = 1;
      }
    }

    const nearPad = (x: number, z: number, r: number) =>
      pads.some((p) => Math.abs(p.gx - x) <= r && Math.abs(p.gz - z) <= r) || spots.some((p) => Math.abs(p.gx - x) <= r - 1 && Math.abs(p.gz - z) <= r - 1);

    // Trees
    const trees: [number, number][] = [];
    for (let attempt = 0; attempt < 600 && trees.length < 19; attempt++) {
      const x = 3 + Math.floor(rnd() * (SIZE - 6));
      const z = 3 + Math.floor(rnd() * (SIZE - 6));
      const h = this.heights[z * SIZE + x]!;
      if (h <= WATER + 1 || this.get(x, h - 1, z) !== BLOCK.grass) continue;
      if (nearPad(x, z, 6) || trees.some(([tx, tz]) => Math.abs(tx - x) < 5 && Math.abs(tz - z) < 5)) continue;
      trees.push([x, z]);
      const trunk = 4 + Math.floor(rnd() * 2);
      for (let y = h; y < h + trunk; y++) this.set(x, y, z, BLOCK.log);
      const top = h + trunk;
      for (let y = top - 3; y <= top; y++) {
        const r = y >= top - 1 ? 1 : 2;
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const corner = Math.abs(dx) === r && Math.abs(dz) === r;
            if (corner && (r === 1 ? y === top : rnd() < 0.55)) continue;
            if (this.get(x + dx, y, z + dz) === BLOCK.air) this.set(x + dx, y, z + dz, BLOCK.leaves);
          }
        }
      }
      this.blocked[z * SIZE + x] = 1;
    }

    // Flowers on open grass
    const FLOWER_COLORS = [0xe8473f, 0xf4d03f, 0xf0f0f0, 0x6f8df0];
    for (let attempt = 0; attempt < 500 && this.flowers.length < 70; attempt++) {
      const x = 2 + Math.floor(rnd() * (SIZE - 4));
      const z = 2 + Math.floor(rnd() * (SIZE - 4));
      const h = this.heights[z * SIZE + x]!;
      if (this.get(x, h - 1, z) !== BLOCK.grass || this.get(x, h, z) !== BLOCK.air || nearPad(x, z, 2)) continue;
      this.flowers.push({ x: x - HALF + 0.5, y: h, z: z - HALF + 0.5, color: FLOWER_COLORS[Math.floor(rnd() * FLOWER_COLORS.length)]! });
    }

    for (const p of pads) this.buildStation(p.id, p.gx, p.gz, p.h);
    for (const p of spots) {
      this.set(p.gx, p.h, p.gz, BLOCK.iron);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.blocked[(p.gz + dz) * SIZE + p.gx + dx] = 1;
      this.beacons.push({ x: p.gx - HALF + 0.5, y: p.h + 1, z: p.gz - HALF + 0.5 });
    }
  }

  private buildStation(id: StationId, gx: number, gz: number, h: number) {
    const block = (dx: number, y: number, dz: number, b: number) => this.set(gx + dx, y, gz + dz, b);
    const blockCol = (dx: number, dz: number) => (this.blocked[(gz + dz) * SIZE + gx + dx] = 1);
    let focusY = h + 1;

    if (id === 'control') {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          block(dx, h, dz, BLOCK.iron);
          blockCol(dx, dz);
        }
      }
      block(0, h + 1, 0, BLOCK.beacon);
      focusY = h + 1.5;
    } else if (id === 'settings') {
      block(0, h, 0, BLOCK.crafting);
      block(1, h, 0, BLOCK.cobble);
      block(-1, h, 0, BLOCK.planks);
      for (const dx of [-1, 0, 1]) blockCol(dx, 0);
      focusY = h + 0.8;
    } else if (id === 'instances') {
      // Nether portal frame along z, facing ±x (towards the camera on that side).
      for (let dz = -2; dz <= 1; dz++) {
        block(0, h, dz, BLOCK.obsidian);
        block(0, h + 4, dz, BLOCK.obsidian);
        blockCol(0, dz);
      }
      for (let y = h + 1; y <= h + 3; y++) {
        block(0, y, -2, BLOCK.obsidian);
        block(0, y, 1, BLOCK.obsidian);
      }
      focusY = h + 2.5;
    } else {
      blockCol(0, 0); // the chest is a separate mesh
      focusY = h + 0.6;
    }

    // Keep mobs off the props (their bodies are wider than one column).
    const keepOut = id === 'control' || id === 'instances' ? 2 : 1;
    for (let dz = -keepOut; dz <= keepOut; dz++) for (let dx = -keepOut; dx <= keepOut; dx++) blockCol(dx, dz);

    this.stations[id] = { id, x: gx - HALF + 0.5, y: focusY, z: gz - HALF + 0.5, angle: STATION_ANGLES[id] };
  }
}

// Face layout from the three.js voxel guide: corner positions and their tile UVs.
const FACES = [
  { dir: [-1, 0, 0], shade: 0.78, side: 0, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], shade: 0.78, side: 0, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], shade: 0.5, side: 2, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], shade: 1, side: 1, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], shade: 0.64, side: 0, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], shade: 0.64, side: 0, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
] as const;

const AO = [0.5, 0.68, 0.84, 1];

/** Builds one merged geometry of every visible face for the blocks `include` accepts. */
export function buildGeometry(t: Terrain, include: (b: number) => boolean) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const solid = (x: number, y: number, z: number) => t.get(x, y, z) !== BLOCK.air;

  for (let y = 0; y < MAX_H; y++) {
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        const b = t.get(x, y, z);
        if (b === BLOCK.air || !include(b)) continue;
        const tiles = FACE_TILES[b]!;
        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          const nb = t.get(x + dx, y + dy, z + dz);
          if (nb !== BLOCK.air && nb !== BLOCK.beacon) continue;
          const uv = tileUV(tiles[face.side]!);
          const start = positions.length / 3;
          for (const [cx, cy, cz, u, v] of face.corners) {
            positions.push(x + cx - HALF, y + cy, z + cz - HALF);
            normals.push(dx, dy, dz);
            uvs.push(u ? uv.u1 : uv.u0, v ? uv.vTop : uv.vBottom);
            let ao = 3;
            if (dy === 1) {
              // Darken top-face corners next to taller neighbours (classic voxel AO).
              const sx = cx ? 1 : -1;
              const sz = cz ? 1 : -1;
              const s1 = solid(x + sx, y + 1, z);
              const s2 = solid(x, y + 1, z + sz);
              const corner = solid(x + sx, y + 1, z + sz);
              ao = s1 && s2 ? 0 : 3 - (Number(s1) + Number(s2) + Number(corner));
            }
            const shade = face.shade * AO[ao]!;
            colors.push(shade, shade, shade);
          }
          indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
        }
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
