import { CanvasTexture, NearestFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32 } from './random';

// 16×16 pixel tiles painted at runtime, so the page ships no image assets.

export const TILE = {
  grassTop: 0,
  grassSide: 1,
  dirt: 2,
  stone: 3,
  sand: 4,
  logSide: 5,
  logTop: 6,
  leaves: 7,
  planks: 8,
  cobble: 9,
  obsidian: 10,
  beacon: 11,
  craftTop: 12,
  craftSide: 13,
  gravel: 14,
  iron: 15,
} as const;

const PX = 16;
const COLS = 4;
const SIZE = PX * COLS;

type RGB = readonly [number, number, number];
const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const rgb = ([r, g, b]: RGB, f = 1) => `rgb(${c(r * f)},${c(g * f)},${c(b * f)})`;

function texture(canvas: HTMLCanvasElement, repeat = false) {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(1337);
  const jitter = (amt: number) => 1 + (rnd() - 0.5) * 2 * amt;

  const paint = (tile: number, fn: (x: number, y: number) => string) => {
    const ox = (tile % COLS) * PX;
    const oy = Math.floor(tile / COLS) * PX;
    for (let y = 0; y < PX; y++) {
      for (let x = 0; x < PX; x++) {
        ctx.fillStyle = fn(x, y);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  };

  const GRASS: RGB = [104, 158, 58];
  const DIRT: RGB = [134, 96, 67];
  const dirt = () => {
    const v = rnd();
    return rgb(v < 0.12 ? [99, 70, 48] : v < 0.2 ? [161, 120, 86] : DIRT, jitter(0.07));
  };

  paint(TILE.grassTop, () => rgb(rnd() < 0.08 ? [84, 134, 44] : GRASS, jitter(0.12)));
  paint(TILE.dirt, dirt);
  const fringe = Array.from({ length: PX }, () => 3 + Math.floor(rnd() * 3));
  paint(TILE.grassSide, (x, y) => (y < fringe[x]! ? rgb(GRASS, jitter(0.12) * (y === fringe[x]! - 1 ? 0.82 : 1)) : dirt()));
  paint(TILE.stone, (x, y) => {
    const blotch = Math.sin(x * 1.7 + y * 0.6) * Math.cos(y * 1.3 - x * 0.4) > 0.55;
    return rgb(blotch ? [104, 104, 106] : [127, 127, 129], jitter(0.08));
  });
  paint(TILE.sand, () => rgb([219, 206, 160], jitter(0.06)));
  paint(TILE.gravel, () => {
    const v = rnd();
    return rgb(v < 0.3 ? [95, 90, 88] : v < 0.6 ? [140, 132, 128] : [118, 112, 108], jitter(0.06));
  });
  paint(TILE.logSide, (x) => {
    const dark = x % 4 === 0 || (x % 5 === 2 && rnd() < 0.5);
    return rgb(dark ? [76, 58, 35] : [104, 82, 50], jitter(0.08));
  });
  paint(TILE.logTop, (x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) return rgb([104, 82, 50], jitter(0.08));
    return rgb(Math.floor(d) % 2 ? [176, 143, 88] : [150, 118, 70], jitter(0.05));
  });
  paint(TILE.leaves, () => {
    const v = rnd();
    return rgb(v < 0.18 ? [36, 82, 26] : v < 0.3 ? [72, 130, 48] : [52, 108, 36], jitter(0.08));
  });
  const PLANK: RGB = [162, 130, 78];
  paint(TILE.planks, (x, y) => {
    if (y % 4 === 3) return rgb([112, 88, 52]);
    const seam = (Math.floor(y / 4) * 5 + 3) % PX;
    return rgb(x === seam ? [126, 100, 60] : PLANK, jitter(0.05));
  });
  paint(TILE.cobble, (x, y) => {
    const cell = Math.sin(x * 0.9 + Math.floor(y / 3) * 2.1) + Math.cos(y * 1.1 + Math.floor(x / 4));
    return rgb(cell > 1.2 ? [72, 72, 74] : cell > 0.2 ? [118, 118, 120] : [140, 140, 142], jitter(0.06));
  });
  paint(TILE.obsidian, () => {
    const v = rnd();
    return rgb(v < 0.08 ? [74, 44, 110] : v < 0.25 ? [30, 22, 44] : [18, 14, 28], jitter(0.08));
  });
  paint(TILE.iron, (x, y) => {
    const edge = x === 0 || y === 0 || x === PX - 1 || y === PX - 1;
    return rgb(edge ? [170, 170, 172] : [214, 214, 216], jitter(0.03));
  });
  // The server block: dark glass with the signal-lime core used by the UI.
  paint(TILE.beacon, (x, y) => {
    const edge = x <= 1 || y <= 1 || x >= PX - 2 || y >= PX - 2;
    const core = x >= 5 && x <= 10 && y >= 5 && y <= 10;
    if (edge) return rgb([150, 220, 210], jitter(0.04));
    if (core) return rgb([200, 244, 58], jitter(0.05));
    return rgb([46, 92, 96], jitter(0.08));
  });
  paint(TILE.craftTop, (x, y) => {
    const grid = x === 0 || y === 0 || x === PX - 1 || y === PX - 1 || x === 5 || x === 10 || y === 5 || y === 10;
    return grid ? rgb([96, 72, 42]) : rgb(PLANK, jitter(0.05));
  });
  paint(TILE.craftSide, (x, y) => {
    if (y <= 2) return rgb([112, 88, 52], jitter(0.05));
    const tool = (x >= 3 && x <= 5 && y >= 6 && y <= 12) || (x >= 9 && x <= 12 && y >= 5 && y <= 7);
    return tool ? rgb([120, 120, 124]) : rgb(PLANK, jitter(0.05));
  });

  return texture(canvas);
}

/** UV rectangle of a tile, inset half a texel so neighbours never bleed in. */
export function tileUV(tile: number) {
  const col = tile % COLS;
  const row = Math.floor(tile / COLS);
  const eps = 0.02;
  return {
    u0: (col * PX + eps) / SIZE,
    u1: ((col + 1) * PX - eps) / SIZE,
    vTop: 1 - (row * PX + eps) / SIZE,
    vBottom: 1 - ((row + 1) * PX - eps) / SIZE,
  };
}

export function buildWaterTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PX;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(42);
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      // Neutral light texture: the material colour (per mood) gives the hue.
      const wave = Math.sin((x + y * 0.5) * 0.8) * 0.05;
      ctx.fillStyle = rgb([226, 232, 240], 1 + wave + (rnd() - 0.5) * 0.08);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return texture(canvas, true);
}

export function buildPortalTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PX;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(9);
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      const swirl = Math.sin(x * 0.7 + Math.sin(y * 0.5) * 2) * 0.5 + 0.5;
      ctx.fillStyle = rgb([120 + swirl * 70, 40 + swirl * 30, 220], 0.85 + rnd() * 0.3);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return texture(canvas, true);
}

/** A small pixel canvas texture for mob faces and bodies. */
export function pixelTexture(w: number, h: number, draw: (set: (x: number, y: number, color: string) => void, rnd: () => number) => void, seed = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw((x, y, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  }, mulberry32(seed));
  return texture(canvas);
}

export const shadeRGB = rgb;
