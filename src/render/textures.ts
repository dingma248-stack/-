import * as THREE from 'three';
import { seeded } from '../core/math';
import { textureOverrides } from '../core/assets';

/**
 * Procedural low-resolution textures drawn on canvas. Everything is sampled
 * with NearestFilter to keep the chunky texel look.
 */

type Draw = (ctx: CanvasRenderingContext2D, s: number, r: () => number) => void;

const cache = new Map<string, THREE.CanvasTexture>();

/**
 * How much relief (normal-map strength, blur passes) and gloss variation (see roughFrom) stdMat derives
 * from each surface texture. Kept here, next to the drawings they describe.
 */
const RELIEF: Record<string, { relief: number; blur?: number; gloss?: number }> = {
  concrete: { relief: 2.5, blur: 2 },
  concreteDark: { relief: 2.5, blur: 2 },
  asphalt: { relief: 1.5, blur: 2, gloss: -1.2 },
  roadLine: { relief: 1.5, blur: 2, gloss: -1.2 },
  sidewalk: { relief: 3, gloss: -1 },
  brick: { relief: 3.5 },
  plaster: { relief: 1.5, blur: 2 },
  wallpaper: { relief: 1.2 },
  woodPanel: { relief: 2, gloss: 0.5 },
  woodFloor: { relief: 2.5, gloss: 0.8 },
  crate: { relief: 2.5 },
  tileWhite: { relief: 3, gloss: 1.2 },
  tileGreen: { relief: 3, gloss: 1.2 },
  tileFloor: { relief: 1.2 },
  linoleum: { relief: 1, blur: 2 },
  carpet: { relief: 1.5 },
  metal: { relief: 2, gloss: 0.8 },
  steel: { relief: 1.2, gloss: 1 },
  rust: { relief: 2.5, blur: 2, gloss: -1.2 },
  grate: { relief: 3.5 },
  ceilingTile: { relief: 2 },
  sewer: { relief: 2.5, gloss: -1.2 },
  water: { relief: 1.2, blur: 2 },
  flesh: { relief: 2.5, gloss: -0.8 },
  skin: { relief: 1.2 },
  cloth: { relief: 1.2 },
  coat: { relief: 0.8 },
  fur: { relief: 2 },
  facade: { relief: 2 },
  paper: { relief: 0.6 },
};

function make(key: string, size: number, draw: Draw, seed = 1, srgb = true): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  // read back by noiseFill and the derived relief maps: keep the canvas on the CPU
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const ov = textureOverrides.get(key);
  if (ov) {
    // an external CC0 texture replaces the procedural one
    c.width = ov.naturalWidth;
    c.height = ov.naturalHeight;
    ctx.drawImage(ov, 0, 0);
  } else draw(ctx, size, seeded(seed * 9973 + key.length * 131));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  // crisp texels within a mip level, but blend between levels: hard mip switches draw bands across floors
  // that crawl along with the camera
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 1;
  t.name = key;
  if (RELIEF[key]) t.userData.relief = RELIEF[key];
  cache.set(key, t);
  return t;
}

const hex = (r: number, g: number, b: number, a = 1) =>
  `rgba(${Math.round(Math.max(0, Math.min(255, r)))},${Math.round(Math.max(0, Math.min(255, g)))},${Math.round(Math.max(0, Math.min(255, b)))},${a})`;

function parse(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Per-pixel value noise around a base colour. */
function noiseFill(ctx: CanvasRenderingContext2D, s: number, r: () => number, base: string, amt: number, x0 = 0, y0 = 0, w = s, h = s) {
  const [br, bg, bb] = parse(base);
  const img = ctx.getImageData(x0, y0, w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (r() - 0.5) * amt;
    img.data[i * 4] = br + n;
    img.data[i * 4 + 1] = bg + n;
    img.data[i * 4 + 2] = bb + n;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, x0, y0);
}

function blotches(ctx: CanvasRenderingContext2D, s: number, r: () => number, color: [number, number, number], count: number, maxR: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    const x = r() * s, y = r() * s, rad = maxR * (0.3 + r() * 0.7);
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      g.addColorStop(0, hex(color[0], color[1], color[2], alpha * (0.4 + r() * 0.6)));
      g.addColorStop(1, hex(color[0], color[1], color[2], 0));
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
}

function speckle(ctx: CanvasRenderingContext2D, s: number, r: () => number, color: string, count: number, size = 1) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) ctx.fillRect(Math.floor(r() * s), Math.floor(r() * s), size, size);
}

function cracks(ctx: CanvasRenderingContext2D, s: number, r: () => number, color: string, count: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    let x = r() * s, y = r() * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 3 + Math.floor(r() * 5);
    for (let j = 0; j < segs; j++) {
      x += (r() - 0.5) * s * 0.2;
      y += (r() - 0.5) * s * 0.2;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drips(ctx: CanvasRenderingContext2D, s: number, r: () => number, color: [number, number, number], count: number, alpha = 0.35) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(r() * s);
    const len = s * (0.2 + r() * 0.7);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, hex(color[0], color[1], color[2], alpha));
    g.addColorStop(1, hex(color[0], color[1], color[2], 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 1 + Math.floor(r() * 2), len);
  }
}

/** Standing water: flat, dark, noise-free blobs (smooth + recessed once roughFrom/normalFrom read them). */
function puddles(ctx: CanvasRenderingContext2D, s: number, r: () => number, count: number, maxR: number) {
  ctx.fillStyle = '#1d1f23';
  for (let i = 0; i < count; i++) {
    const x = r() * s, y = r() * s;
    for (let j = 0; j < 4; j++) {
      const ex = x + (r() - 0.5) * maxR * 1.4, ey = y + (r() - 0.5) * maxR * 0.8;
      const rx = maxR * (0.35 + r() * 0.65), ry = rx * (0.4 + r() * 0.4), rot = r() * 0.6 - 0.3;
      for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
        ctx.beginPath();
        ctx.ellipse(ex + ox, ey + oy, rx, ry, rot, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function tiles(ctx: CanvasRenderingContext2D, s: number, r: () => number, n: number, base: string, grout: string, vary: number, dirt = 0.1) {
  const t = s / n;
  const [br, bg, bb] = parse(base);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = (r() - 0.5) * vary;
      ctx.fillStyle = hex(br + v, bg + v, bb + v);
      ctx.fillRect(x * t, y * t, t, t);
      // subtle tile sheen
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x * t + 1, y * t + 1, t - 2, 1);
    }
  speckle(ctx, s, r, 'rgba(0,0,0,0.08)', s * 2);
  ctx.fillStyle = grout;
  for (let i = 0; i <= n; i++) {
    ctx.fillRect(i * t - 0.5, 0, 1, s);
    ctx.fillRect(0, i * t - 0.5, s, 1);
  }
  blotches(ctx, s, r, [40, 34, 20], Math.floor(6 * dirt * 10), s * 0.25, dirt);
}

/**
 * One window layout shared by the facade albedo and its emissive map, so the windows that glow are the
 * windows that are drawn lit (4×4 windows per 128 px tile = 8 m of wall).
 */
let facadeLayout: { x: number; y: number; lit: boolean; warm: boolean; curtain: number; glint: boolean; ac: boolean; streak: number }[] | null = null;
function facadeWindows() {
  if (facadeLayout) return facadeLayout;
  const r = seeded(4111);
  facadeLayout = [];
  for (let y = 8; y < 128; y += 32)
    for (let x = 8; x < 128; x += 32) {
      const lit = r() < 0.3;
      facadeLayout.push({
        x, y, lit,
        warm: r() < 0.7,
        curtain: r() < 0.45 ? 4 + Math.floor(r() * 6) : 0,
        glint: r() < 0.5,
        ac: r() < 0.15,
        streak: 4 + Math.floor(r() * 10),
      });
    }
  return facadeLayout;
}

export const TEX = {
  concrete: () =>
    make('concrete', 64, (c, s, r) => {
      noiseFill(c, s, r, '#6b6862', 26);
      blotches(c, s, r, [40, 38, 34], 8, 18, 0.35);
      speckle(c, s, r, 'rgba(20,18,16,0.5)', 60);
      cracks(c, s, r, 'rgba(25,22,20,0.55)', 2);
    }),
  concreteDark: () =>
    make('concreteDark', 64, (c, s, r) => {
      noiseFill(c, s, r, '#45433f', 22);
      blotches(c, s, r, [20, 18, 16], 10, 20, 0.45);
      drips(c, s, r, [15, 14, 12], 10, 0.35);
      cracks(c, s, r, 'rgba(10,10,10,0.5)', 3);
    }),
  asphalt: () =>
    make('asphalt', 128, (c, s, r) => {
      noiseFill(c, s, r, '#2a2b2e', 30);
      speckle(c, s, r, 'rgba(120,120,125,0.25)', 400);
      blotches(c, s, r, [10, 12, 16], 14, 30, 0.5);
      cracks(c, s, r, 'rgba(8,8,10,0.7)', 5);
      puddles(c, s, r, 3, 13);
    }),
  roadLine: () =>
    make('roadLine', 64, (c, s, r) => {
      noiseFill(c, s, r, '#2a2b2e', 30);
      c.fillStyle = 'rgba(200,170,90,0.75)';
      c.fillRect(s / 2 - 3, 0, 6, s * 0.6);
      speckle(c, s, r, 'rgba(30,30,30,0.6)', 120);
      puddles(c, s, r, 1, 6);
    }),
  sidewalk: () =>
    make('sidewalk', 64, (c, s, r) => tiles(c, s, r, 2, '#5b5853', 'rgba(25,24,22,0.9)', 18, 0.2)),
  brick: () =>
    make('brick', 64, (c, s, r) => {
      noiseFill(c, s, r, '#3a2a24', 10);
      const bh = 8, bw = 16;
      for (let y = 0; y < s / bh; y++)
        for (let x = -1; x < s / bw + 1; x++) {
          const off = y % 2 ? bw / 2 : 0;
          const v = (r() - 0.5) * 40;
          c.fillStyle = hex(110 + v, 52 + v * 0.5, 40 + v * 0.4);
          c.fillRect(x * bw + off + 1, y * bh + 1, bw - 2, bh - 2);
        }
      speckle(c, s, r, 'rgba(0,0,0,0.25)', 200);
      drips(c, s, r, [10, 10, 10], 6, 0.4);
    }),
  plaster: () =>
    make('plaster', 64, (c, s, r) => {
      noiseFill(c, s, r, '#8b8577', 14);
      blotches(c, s, r, [70, 60, 40], 6, 22, 0.25);
      drips(c, s, r, [60, 50, 35], 8, 0.25);
      c.fillStyle = 'rgba(40,34,28,0.85)';
      c.fillRect(0, s - 7, s, 7);
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.fillRect(0, s - 7, s, 1);
    }),
  wallpaper: () =>
    make('wallpaper', 64, (c, s, r) => {
      noiseFill(c, s, r, '#5d5545', 10);
      for (let x = 0; x < s; x += 8) {
        c.fillStyle = 'rgba(30,26,20,0.25)';
        c.fillRect(x, 0, 2, s);
      }
      blotches(c, s, r, [40, 30, 20], 6, 20, 0.4);
      drips(c, s, r, [35, 28, 18], 10, 0.3);
    }),
  woodPanel: () =>
    make('woodPanel', 64, (c, s, r) => {
      for (let x = 0; x < s; x += 8) {
        const v = (r() - 0.5) * 20;
        c.fillStyle = hex(78 + v, 50 + v * 0.7, 30 + v * 0.5);
        c.fillRect(x, 0, 8, s);
        for (let i = 0; i < 6; i++) {
          c.fillStyle = 'rgba(30,18,8,0.25)';
          c.fillRect(x + Math.floor(r() * 7), 0, 1, s);
        }
        c.fillStyle = 'rgba(15,8,4,0.6)';
        c.fillRect(x, 0, 1, s);
      }
      c.fillStyle = 'rgba(20,12,6,0.8)';
      c.fillRect(0, s * 0.55, s, 3);
      blotches(c, s, r, [20, 10, 5], 5, 16, 0.3);
    }),
  woodFloor: () =>
    make('woodFloor', 64, (c, s, r) => {
      for (let y = 0; y < s; y += 8) {
        const off = Math.floor(r() * s);
        const v = (r() - 0.5) * 24;
        c.fillStyle = hex(92 + v, 62 + v * 0.7, 38 + v * 0.5);
        c.fillRect(0, y, s, 8);
        c.fillStyle = 'rgba(25,14,6,0.7)';
        c.fillRect(0, y, s, 1);
        c.fillRect(off, y, 1, 8);
      }
      speckle(c, s, r, 'rgba(30,16,6,0.25)', 300);
    }),
  crate: () =>
    make('crate', 32, (c, s, r) => {
      noiseFill(c, s, r, '#6e5534', 22);
      c.strokeStyle = 'rgba(40,26,12,0.9)';
      c.lineWidth = 3;
      c.strokeRect(1.5, 1.5, s - 3, s - 3);
      c.beginPath();
      c.moveTo(2, 2);
      c.lineTo(s - 2, s - 2);
      c.stroke();
      speckle(c, s, r, 'rgba(20,12,6,0.4)', 40);
    }),
  tileWhite: () => make('tileWhite', 64, (c, s, r) => tiles(c, s, r, 4, '#b7b8ae', 'rgba(60,60,52,0.9)', 14, 0.18)),
  tileGreen: () =>
    make('tileGreen', 64, (c, s, r) => {
      tiles(c, s, r, 4, '#7d9a8c', 'rgba(36,48,42,0.9)', 16, 0.2);
      drips(c, s, r, [50, 40, 20], 10, 0.3);
    }),
  tileFloor: () =>
    make('tileFloor', 64, (c, s, r) => {
      const n = 4, t = s / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const dark = (x + y) % 2 === 0;
          const v = (r() - 0.5) * 12;
          c.fillStyle = dark ? hex(64 + v, 66 + v, 62 + v) : hex(150 + v, 150 + v, 140 + v);
          c.fillRect(x * t, y * t, t, t);
        }
      speckle(c, s, r, 'rgba(0,0,0,0.15)', 200);
      blotches(c, s, r, [30, 26, 16], 8, 18, 0.3);
    }),
  linoleum: () =>
    make('linoleum', 64, (c, s, r) => {
      noiseFill(c, s, r, '#6d7a70', 12);
      speckle(c, s, r, 'rgba(255,255,255,0.12)', 180);
      speckle(c, s, r, 'rgba(0,0,0,0.2)', 180);
      blotches(c, s, r, [30, 34, 22], 8, 22, 0.35);
      c.fillStyle = 'rgba(30,36,30,0.5)';
      c.fillRect(0, 0, s, 1);
      c.fillRect(0, 0, 1, s);
    }),
  carpet: () =>
    make('carpet', 64, (c, s, r) => {
      noiseFill(c, s, r, '#3d2b30', 26);
      for (let y = 0; y < s; y += 16)
        for (let x = 0; x < s; x += 16) {
          c.fillStyle = 'rgba(120,90,60,0.12)';
          c.fillRect(x + 6, y + 6, 4, 4);
        }
      blotches(c, s, r, [20, 10, 10], 6, 14, 0.4);
    }),
  metal: () =>
    make('metal', 64, (c, s, r) => {
      noiseFill(c, s, r, '#5d6366', 12);
      for (let y = 0; y < s; y++) {
        c.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.04})`;
        c.fillRect(0, y, s, 1);
      }
      c.fillStyle = 'rgba(20,22,24,0.8)';
      c.fillRect(0, 0, s, 1);
      c.fillRect(0, 0, 1, s);
      c.fillStyle = 'rgba(140,150,150,0.6)';
      for (const [x, y] of [[4, 4], [s - 5, 4], [4, s - 5], [s - 5, s - 5]]) c.fillRect(x, y, 2, 2);
      blotches(c, s, r, [70, 40, 20], 4, 14, 0.3);
    }),
  steel: () =>
    make('steel', 64, (c, s, r) => {
      noiseFill(c, s, r, '#9aa1a3', 8);
      for (let x = 0; x < s; x++) {
        c.fillStyle = `rgba(255,255,255,${r() * 0.06})`;
        c.fillRect(x, 0, 1, s);
      }
      c.fillStyle = 'rgba(40,44,46,0.7)';
      c.fillRect(0, 0, s, 1);
      c.fillRect(0, s / 2, s, 1);
    }),
  rust: () =>
    make('rust', 64, (c, s, r) => {
      noiseFill(c, s, r, '#5a3a26', 30);
      blotches(c, s, r, [120, 60, 25], 10, 18, 0.5);
      blotches(c, s, r, [30, 20, 15], 8, 14, 0.5);
      speckle(c, s, r, 'rgba(160,90,40,0.4)', 120);
    }),
  grate: () =>
    make('grate', 32, (c, s, r) => {
      noiseFill(c, s, r, '#2b2d2e', 12);
      c.fillStyle = 'rgba(110,112,108,0.9)';
      for (let i = 0; i < s; i += 4) {
        c.fillRect(i, 0, 1, s);
        c.fillRect(0, i, s, 1);
      }
      speckle(c, s, r, 'rgba(90,50,20,0.5)', 40);
    }),
  ceilingTile: () =>
    make('ceilingTile', 64, (c, s, r) => {
      noiseFill(c, s, r, '#7e7b72', 14);
      speckle(c, s, r, 'rgba(40,40,36,0.5)', 260);
      c.fillStyle = 'rgba(40,38,32,0.9)';
      c.fillRect(0, 0, s, 2);
      c.fillRect(0, 0, 2, s);
      blotches(c, s, r, [80, 60, 30], 3, 20, 0.4);
    }),
  sewer: () =>
    make('sewer', 64, (c, s, r) => {
      noiseFill(c, s, r, '#3b3d30', 26);
      const bh = 8;
      for (let y = 0; y < s; y += bh) {
        c.fillStyle = 'rgba(15,16,10,0.6)';
        c.fillRect(0, y, s, 1);
        for (let x = (y / bh) % 2 ? 8 : 0; x < s; x += 16) c.fillRect(x, y, 1, bh);
      }
      blotches(c, s, r, [50, 60, 20], 8, 16, 0.4);
      drips(c, s, r, [20, 30, 10], 12, 0.5);
    }),
  water: () =>
    make('water', 64, (c, s, r) => {
      noiseFill(c, s, r, '#1d2522', 16);
      for (let i = 0; i < 30; i++) {
        c.fillStyle = 'rgba(120,140,130,0.12)';
        c.fillRect(Math.floor(r() * s), Math.floor(r() * s), 3 + Math.floor(r() * 6), 1);
      }
    }),
  flesh: () =>
    make('flesh', 64, (c, s, r) => {
      noiseFill(c, s, r, '#4a1c1c', 30);
      blotches(c, s, r, [120, 40, 40], 14, 14, 0.5);
      blotches(c, s, r, [20, 5, 8], 10, 12, 0.6);
      c.strokeStyle = 'rgba(140,60,70,0.55)';
      for (let i = 0; i < 10; i++) {
        c.beginPath();
        let x = r() * s, y = r() * s;
        c.moveTo(x, y);
        for (let j = 0; j < 6; j++) {
          x += (r() - 0.5) * 14;
          y += (r() - 0.5) * 14;
          c.lineTo(x, y);
        }
        c.stroke();
      }
    }),
  skin: () =>
    make('skin', 32, (c, s, r) => {
      noiseFill(c, s, r, '#7c7166', 22);
      blotches(c, s, r, [60, 70, 50], 6, 8, 0.5);
      blotches(c, s, r, [90, 20, 20], 4, 6, 0.5);
    }),
  cloth: () =>
    make('cloth', 32, (c, s, r) => {
      noiseFill(c, s, r, '#4b4a46', 26);
      for (let y = 0; y < s; y += 2) {
        c.fillStyle = 'rgba(0,0,0,0.08)';
        c.fillRect(0, y, s, 1);
      }
      blotches(c, s, r, [70, 10, 10], 4, 8, 0.6);
    }),
  coat: () =>
    make('coat', 32, (c, s, r) => {
      noiseFill(c, s, r, '#26282c', 14);
      for (let x = 0; x < s; x += 3) {
        c.fillStyle = 'rgba(255,255,255,0.03)';
        c.fillRect(x, 0, 1, s);
      }
      blotches(c, s, r, [5, 5, 6], 4, 10, 0.5);
    }),
  fur: () =>
    make('fur', 32, (c, s, r) => {
      noiseFill(c, s, r, '#3a2e26', 36);
      blotches(c, s, r, [90, 20, 20], 5, 6, 0.6);
    }),
  car: () =>
    make('car', 32, (c, s, r) => {
      noiseFill(c, s, r, '#5c626b', 10);
      blotches(c, s, r, [30, 25, 20], 4, 10, 0.4);
      speckle(c, s, r, 'rgba(90,50,20,0.6)', 20);
    }),
  facade: () =>
    make('facade', 128, (c, s, r) => {
      noiseFill(c, s, r, '#2a2a2d', 12);
      blotches(c, s, r, [14, 14, 16], 10, 26, 0.35);
      for (const w of facadeWindows()) {
        // floor slab ledge: lit edge on top, shadow under it
        c.fillStyle = 'rgba(70,70,74,0.55)';
        c.fillRect(w.x - 8, w.y - 6, 32, 2);
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.fillRect(w.x - 8, w.y - 4, 32, 1);
        c.fillStyle = 'rgb(58,58,62)'; // frame
        c.fillRect(w.x - 1, w.y - 1, 18, 22);
        c.fillStyle = w.lit ? (w.warm ? 'rgb(220,170,90)' : 'rgb(150,180,200)') : 'rgb(12,13,16)';
        c.fillRect(w.x, w.y, 16, 20);
        if (w.lit && w.curtain) {
          c.fillStyle = w.warm ? 'rgb(120,70,38)' : 'rgb(70,86,100)';
          c.fillRect(w.x, w.y, w.curtain, 20);
        }
        if (!w.lit && w.glint) {
          c.fillStyle = 'rgba(120,130,140,0.25)'; // sky reflected in a dark pane
          c.fillRect(w.x + 2, w.y + 2, 3, 9);
        }
        c.fillStyle = 'rgb(34,34,38)'; // mullions
        c.fillRect(w.x + 7, w.y, 2, 20);
        c.fillRect(w.x, w.y + 8, 16, 1);
        c.fillStyle = 'rgb(84,84,88)'; // sill
        c.fillRect(w.x - 2, w.y + 21, 20, 2);
        if (w.ac) {
          c.fillStyle = 'rgb(96,98,96)';
          c.fillRect(w.x + 17, w.y + 12, 6, 6);
          c.fillStyle = 'rgba(0,0,0,0.5)';
          c.fillRect(w.x + 18, w.y + 13, 4, 1);
          c.fillRect(w.x + 18, w.y + 15, 4, 1);
        }
        // grime washed down from the sill
        const g = c.createLinearGradient(0, w.y + 23, 0, w.y + 23 + w.streak);
        g.addColorStop(0, 'rgba(6,6,6,0.45)');
        g.addColorStop(1, 'rgba(6,6,6,0)');
        c.fillStyle = g;
        c.fillRect(w.x + 1, w.y + 23, 14, w.streak);
      }
      drips(c, s, r, [5, 5, 5], 14, 0.4);
    }),
  facadeEmissive: () =>
    make('facadeEmissive', 128, (c, s) => {
      c.fillStyle = '#000';
      c.fillRect(0, 0, s, s);
      for (const w of facadeWindows()) {
        if (!w.lit) continue;
        c.fillStyle = w.warm ? 'rgb(220,150,70)' : 'rgb(120,160,190)';
        c.fillRect(w.x, w.y, 16, 20);
        c.fillStyle = w.warm ? 'rgb(90,50,22)' : 'rgb(40,56,70)';
        if (w.curtain) c.fillRect(w.x, w.y, w.curtain, 20);
        c.fillStyle = '#000';
        c.fillRect(w.x + 7, w.y, 2, 20);
        c.fillRect(w.x, w.y + 8, 16, 1);
      }
    }, 1),
  glass: () =>
    make('glass', 32, (c, s, r) => {
      c.fillStyle = 'rgba(150,180,190,0.3)';
      c.fillRect(0, 0, s, s);
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.fillRect(3, 3, 2, s - 6);
      c.fillRect(7, 3, 1, s / 2);
      speckle(c, s, r, 'rgba(40,40,40,0.3)', 30);
    }),
  bloodDecal: (v = 0) =>
    make('blood' + v, 64, (c, s, r) => {
      c.clearRect(0, 0, s, s);
      const cx = s / 2, cy = s / 2;
      for (let i = 0; i < 26; i++) {
        const a = r() * Math.PI * 2, d = r() * s * 0.3 * (i < 6 ? 0.3 : 1);
        const rad = 2 + r() * (i < 6 ? 12 : 5);
        c.fillStyle = `rgba(${70 + r() * 30},${4 + r() * 6},${6 + r() * 6},${0.85})`;
        c.beginPath();
        c.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rad, 0, Math.PI * 2);
        c.fill();
      }
      for (let i = 0; i < 8; i++) {
        const a = r() * Math.PI * 2;
        c.strokeStyle = 'rgba(80,6,8,0.8)';
        c.lineWidth = 1 + r() * 2;
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(a) * s * 0.45, cy + Math.sin(a) * s * 0.45);
        c.stroke();
      }
    }, 3 + v),
  handprint: () =>
    make('handprint', 64, (c, s, r) => {
      c.clearRect(0, 0, s, s);
      c.fillStyle = 'rgba(90,8,10,0.9)';
      c.beginPath();
      c.ellipse(32, 40, 12, 14, 0, 0, Math.PI * 2);
      c.fill();
      const fingers = [[-10, -6, -0.5], [-4, -14, -0.15], [3, -16, 0], [10, -13, 0.2], [17, 0, 0.9]];
      for (const [fx, fy, rot] of fingers) {
        c.save();
        c.translate(32 + fx, 32 + fy);
        c.rotate(rot);
        c.fillRect(-2.5, -10, 5, 14);
        c.restore();
      }
      for (let i = 0; i < 6; i++) {
        const x = 22 + r() * 22;
        c.fillRect(x, 50, 2, 6 + r() * 12);
      }
    }),
  bulletHole: () =>
    make('bulletHole', 16, (c, s) => {
      c.clearRect(0, 0, s, s);
      const g = c.createRadialGradient(8, 8, 0, 8, 8, 8);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.3, 'rgba(10,10,10,0.95)');
      g.addColorStop(0.45, 'rgba(40,36,32,0.6)');
      g.addColorStop(1, 'rgba(40,36,32,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    }),
  scorch: () =>
    make('scorch', 64, (c, s, r) => {
      c.clearRect(0, 0, s, s);
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(0,0,0,0.95)');
      g.addColorStop(0.6, 'rgba(10,8,6,0.6)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
      speckle(c, s, r, 'rgba(0,0,0,0.5)', 60, 2);
    }),
  drag: () =>
    make('drag', 64, (c, s, r) => {
      c.clearRect(0, 0, s, s);
      for (let i = 0; i < 5; i++) {
        const x = 18 + i * 6 + r() * 3;
        c.fillStyle = `rgba(70,6,8,${0.5 + r() * 0.3})`;
        c.fillRect(x, 0, 3 + r() * 3, s);
      }
      speckle(c, s, r, 'rgba(70,6,8,0.6)', 80, 2);
    }),
  flashlightCookie: () => {
    const t = make('cookie', 128, (c, s, r) => {
      c.fillStyle = '#000';
      c.fillRect(0, 0, s, s);
      // hot centre, a faint reflector ring, long soft spill (a hard dark/bright ring read as a target reticle)
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgb(255,250,235)');
      g.addColorStop(0.18, 'rgb(242,234,214)');
      g.addColorStop(0.32, 'rgb(196,189,172)');
      g.addColorStop(0.4, 'rgb(208,200,182)');
      g.addColorStop(0.5, 'rgb(130,124,112)');
      g.addColorStop(0.85, 'rgb(34,32,29)');
      g.addColorStop(1, 'rgb(0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
      // lens dirt
      for (let i = 0; i < 24; i++) {
        c.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
        c.beginPath();
        c.arc(r() * s, r() * s, 3 + r() * 8, 0, Math.PI * 2);
        c.fill();
      }
    }, 7);
    // a beam of light, not a surface: filtered, or its texels step across every wall it hits
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  },
  sign: (text: string, bg = '#1a3b26', fg = '#d8e8d0', w = 128, h = 32, font = 'bold 18px "Noto Serif SC", serif') => {
    const key = `sign:${text}:${bg}:${fg}:${w}:${h}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d')!;
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.fillStyle = fg;
    c.font = font;
    // shrink to fit
    const m = c.measureText(text).width;
    if (m > w * 0.9) {
      const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '18');
      c.font = font.replace(/\d+(?:\.\d+)?px/, `${Math.floor((px * w * 0.9) / m)}px`);
    }
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 1);
    const r = seeded(text.length * 77);
    speckle(c, Math.max(w, h), r, 'rgba(0,0,0,0.25)', 80);
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    cache.set(key, t);
    return t;
  },
  paper: () =>
    make('paper', 32, (c, s, r) => {
      noiseFill(c, s, r, '#cfc6b0', 12);
      c.fillStyle = 'rgba(40,40,60,0.5)';
      for (let y = 6; y < s - 4; y += 3) c.fillRect(4, y, 8 + Math.floor(r() * 18), 1);
    }),
  monitor: () =>
    make('monitor', 64, (c, s, r) => {
      c.fillStyle = '#0b120e';
      c.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 2) {
        c.fillStyle = `rgba(120,170,140,${0.1 + r() * 0.15})`;
        c.fillRect(0, y, s, 1);
      }
      c.fillStyle = 'rgba(180,230,200,0.8)';
      c.font = '8px monospace';
      c.fillText('CAM 03', 4, 10);
      c.fillText('REC ●', 36, 10);
    }),
};

/**
 * Relief and gloss maps derived from a colour texture, so every procedural (or CC0 override) surface
 * gets them for free. Height is the blurred luminance: grout, mortar, plank gaps, cracks and puddles are
 * darker than their surroundings and so read as recessed.
 */
const derived = new Map<string, THREE.Texture>();

function luminance(src: THREE.Texture, blur: number) {
  const img = src.image as HTMLCanvasElement;
  const w = img.width, h = img.height;
  let px: Uint8ClampedArray;
  try {
    px = img.getContext('2d')!.getImageData(0, 0, w, h).data;
  } catch {
    return null; // a cross-origin override taints the canvas: keep the flat look
  }
  let a = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
  // 3×3 box passes; wrap around because every surface texture tiles
  for (let pass = 0; pass < blur; pass++) {
    const b = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) s += a[((y + dy + h) % h) * w + ((x + dx + w) % w)];
        b[y * w + x] = s / 9;
      }
    a = b;
  }
  return { a, w, h };
}

function derivedTexture(key: string, w: number, h: number, fill: (data: Uint8ClampedArray) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  fill(img.data);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  // chunky up close like the colour texels; trilinear far away so relief doesn't sparkle at distance
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  derived.set(key, t);
  return t;
}

/**
 * Tangent-space normal map (OpenGL convention, +Y = +v; canvas rows run down, so v runs up), built at
 * twice the colour resolution from the bilinearly resampled height: bevels come out half a colour texel
 * wide, so grout and seams read as edges instead of a mosaic of tilted texels. Large CC0 overrides
 * already have the detail and stay 1:1.
 */
export function normalFrom(src: THREE.Texture, strength: number, blur = 1): THREE.Texture | null {
  const key = `n:${src.uuid}:${strength}:${blur}`;
  const hit = derived.get(key);
  if (hit) return hit;
  const lum = luminance(src, blur);
  if (!lum) return null;
  const { a, w, h } = lum;
  const up = Math.max(w, h) < 256 ? 2 : 1;
  const W = w * up, H = h * up;
  const hf = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = (x + 0.5) / up - 0.5, sy = (y + 0.5) / up - 0.5;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const at = (xx: number, yy: number) => a[((yy + h) % h) * w + ((xx + w) % w)];
      const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
      const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
      hf[y * W + x] = top * (1 - fy) + bot * fy;
    }
  const k = strength * up; // slope per colour texel, whatever the resampling
  return derivedTexture(key, W, H, (d) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const du = hf[y * W + ((x + 1) % W)] - hf[y * W + ((x - 1 + W) % W)];
        const dv = hf[((y - 1 + H) % H) * W + x] - hf[((y + 1) % H) * W + x];
        let nx = -du * k, ny = -dv * k, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l;
        ny /= l;
        nz /= l;
        const i = (y * W + x) * 4;
        d[i] = (nx * 0.5 + 0.5) * 255;
        d[i + 1] = (ny * 0.5 + 0.5) * 255;
        d[i + 2] = (nz * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
  });
}

/**
 * Roughness map (three reads .g and multiplies it by material.roughness, so pair it with roughness 1).
 * `gloss` > 0: brighter texels are smoother (glazed tile vs grout); < 0: darker texels are smoother
 * (puddles on asphalt, oily stains).
 */
export function roughFrom(src: THREE.Texture, rough: number, gloss: number): THREE.Texture | null {
  const key = `r:${src.uuid}:${rough}:${gloss}`;
  const hit = derived.get(key);
  if (hit) return hit;
  // lightly blurred: per-texel roughness noise turns highlights into glitter
  const lum = luminance(src, 1);
  if (!lum) return null;
  const { a, w, h } = lum;
  let mean = 0;
  for (const v of a) mean += v;
  mean /= a.length;
  return derivedTexture(key, w, h, (d) => {
    for (let i = 0; i < w * h; i++) {
      const r = Math.max(0.04, Math.min(1, rough - gloss * (a[i] - mean)));
      d[i * 4] = d[i * 4 + 2] = 0;
      d[i * 4 + 1] = r * 255;
      d[i * 4 + 3] = 255;
    }
  });
}

export function disposeTextureCache() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
  for (const t of derived.values()) t.dispose();
  derived.clear();
}
