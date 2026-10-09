import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
} from 'three';
import { damp, makeNoise, mulberry32 } from './random';

// ---------- moods: the world's lighting follows the server state ----------

export interface Mood {
  skyTop: Color;
  skyHorizon: Color;
  skyBottom: Color;
  sun: Color;
  sunIntensity: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  /** 0 = moon up, 1 = sun up */
  daylight: number;
  stars: number;
  fireflies: number;
  exposure: number;
  water: Color;
}

const mood = (m: { [K in keyof Mood]: Mood[K] extends Color ? string : number }): Mood =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'string' ? new Color(v) : v])) as unknown as Mood;

export const MOODS = {
  day: mood({
    skyTop: '#3d7fd9',
    skyHorizon: '#a9cdf2',
    skyBottom: '#6b8fb8',
    sun: '#fff1d9',
    sunIntensity: 2.4,
    hemiSky: '#d6e8ff',
    hemiGround: '#5d4a33',
    hemiIntensity: 1.25,
    daylight: 1,
    stars: 0,
    fireflies: 0,
    exposure: 1.05,
    water: '#3d79c2',
  }),
  dawn: mood({
    skyTop: '#2c3f78',
    skyHorizon: '#f29a5c',
    skyBottom: '#4a3a52',
    sun: '#ffb27a',
    sunIntensity: 1.6,
    hemiSky: '#f0b48c',
    hemiGround: '#3a2c2a',
    hemiIntensity: 0.8,
    daylight: 0.55,
    stars: 0.25,
    fireflies: 0.35,
    exposure: 1,
    water: '#5a6aa0',
  }),
  night: mood({
    skyTop: '#050913',
    skyHorizon: '#1c2b4d',
    skyBottom: '#0a0f1c',
    sun: '#b4c4ff',
    sunIntensity: 1.25,
    hemiSky: '#6d7fb8',
    hemiGround: '#1a1d26',
    hemiIntensity: 1.05,
    daylight: 0,
    stars: 1,
    fireflies: 1,
    exposure: 1.3,
    water: '#2a4378',
  }),
  crashed: mood({
    skyTop: '#07040a',
    skyHorizon: '#3a1010',
    skyBottom: '#0a0606',
    sun: '#ff9a8a',
    sunIntensity: 1.1,
    hemiSky: '#8a4a4a',
    hemiGround: '#1a1414',
    hemiIntensity: 0.9,
    daylight: 0,
    stars: 0.6,
    fireflies: 0.3,
    exposure: 1.25,
    water: '#3a2430',
  }),
} satisfies Record<string, Mood>;

export type MoodName = keyof typeof MOODS;

export function cloneMood(m: Mood): Mood {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v instanceof Color ? v.clone() : v])) as unknown as Mood;
}

/** Eases every value of `current` towards `target`. */
export function dampMood(current: Mood, target: Mood, lambda: number, dt: number) {
  const t = 1 - Math.exp(-lambda * dt);
  for (const key of Object.keys(current) as (keyof Mood)[]) {
    const c = current[key];
    const goal = target[key];
    if (c instanceof Color) c.lerp(goal as Color, t);
    else (current[key] as number) = damp(c, goal as number, lambda, dt);
  }
}

// ---------- sky dome ----------

export function createSkyDome() {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new Color() },
      horizon: { value: new Color() },
      bottom: { value: new Color() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 bottom;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(min(1.0, h * 1.6), 0.7)) : mix(horizon, bottom, pow(min(1.0, -h * 3.0), 0.6));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(new SphereGeometry(400, 32, 16), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, material };
}

// ---------- sun, moon, stars ----------

export function createCelestials() {
  const group = new Group();
  const sun = new Mesh(new PlaneGeometry(26, 26), new MeshBasicMaterial({ color: '#fff3c4', fog: false, transparent: true, depthWrite: false }));
  const sunGlow = new Mesh(new PlaneGeometry(60, 60), new MeshBasicMaterial({ color: '#ffd98a', fog: false, transparent: true, opacity: 0.18, depthWrite: false, blending: AdditiveBlending }));
  const moon = new Mesh(new PlaneGeometry(18, 18), new MeshBasicMaterial({ color: '#e8ecf6', fog: false, transparent: true, depthWrite: false }));
  group.add(sunGlow, sun, moon);

  const rnd = mulberry32(77);
  const positions: number[] = [];
  for (let i = 0; i < 900; i++) {
    const theta = rnd() * Math.PI * 2;
    const y = 0.08 + rnd() * 0.92;
    const r = Math.sqrt(1 - y * y);
    positions.push(Math.cos(theta) * r * 380, y * 380, Math.sin(theta) * r * 380);
  }
  const starGeo = new BufferGeometry();
  starGeo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const starMat = new PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false });
  const stars = new Points(starGeo, starMat);
  stars.frustumCulled = false;
  return { group, sun, sunGlow, moon, stars, starMat };
}

// ---------- clouds ----------

export function createClouds() {
  const noise = makeNoise(5);
  const CELL = 6;
  const GRID = 48;
  const dummy = new Object3D();
  const cells: [number, number][] = [];
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) {
      if (noise(x * 0.16, z * 0.16, 3) > 0.6) cells.push([x, z]);
    }
  }
  const material = new MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.88, depthWrite: false });
  const mesh = new InstancedMesh(new BoxGeometry(CELL, 1.4, CELL), material, cells.length);
  cells.forEach(([x, z], i) => {
    dummy.position.set((x - GRID / 2) * CELL, 34, (z - GRID / 2) * CELL);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.frustumCulled = false;
  const span = GRID * CELL;
  return {
    mesh,
    material,
    update(dt: number) {
      mesh.position.x += dt * 0.6;
      if (mesh.position.x > span / 2) mesh.position.x -= span;
    },
  };
}

// ---------- glowing particles (fireflies, install sparks) ----------

export function dotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new CanvasTexture(canvas);
}

export function createParticles(count: number, color: string, size: number, map: CanvasTexture) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 3), 3));
  const material = new PointsMaterial({
    color,
    size,
    map,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    opacity: 0,
  });
  const points = new Points(geo, material);
  points.frustumCulled = false;
  return { points, material, positions: geo.getAttribute('position') as Float32BufferAttribute };
}
