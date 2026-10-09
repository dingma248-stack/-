import * as THREE from 'three';
import { seeded } from '../core/math';

/**
 * Procedural low-resolution textures drawn on canvas. Everything is sampled
 * with NearestFilter to keep the chunky texel look.
 */

type Draw = (ctx: CanvasRenderingContext2D, s: number, r: () => number) => void;

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, size: number, draw: Draw, seed = 1, srgb = true): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size, seeded(seed * 9973 + key.length * 131));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 1;
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
    }),
  roadLine: () =>
    make('roadLine', 64, (c, s, r) => {
      noiseFill(c, s, r, '#2a2b2e', 30);
      c.fillStyle = 'rgba(200,170,90,0.75)';
      c.fillRect(s / 2 - 3, 0, 6, s * 0.6);
      speckle(c, s, r, 'rgba(30,30,30,0.6)', 120);
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
      noiseFill(c, s, r, '#18191b', 12);
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
    make('facade', 64, (c, s, r) => {
      noiseFill(c, s, r, '#2a2a2d', 14);
      for (let y = 4; y < s; y += 16)
        for (let x = 4; x < s; x += 16) {
          const lit = r() < 0.18;
          const warm = r() < 0.7;
          c.fillStyle = lit ? (warm ? 'rgba(220,170,90,1)' : 'rgba(150,180,200,1)') : 'rgba(12,13,16,1)';
          c.fillRect(x, y, 8, 10);
          c.fillStyle = 'rgba(0,0,0,0.5)';
          c.fillRect(x, y + 5, 8, 1);
        }
      drips(c, s, r, [5, 5, 5], 10, 0.5);
    }),
  facadeEmissive: () =>
    make('facadeEmissive', 64, (c, s, r) => {
      c.fillStyle = '#000';
      c.fillRect(0, 0, s, s);
      for (let y = 4; y < s; y += 16)
        for (let x = 4; x < s; x += 16) {
          const lit = r() < 0.18;
          const warm = r() < 0.7;
          if (lit) {
            c.fillStyle = warm ? 'rgba(220,150,70,1)' : 'rgba(120,160,190,1)';
            c.fillRect(x, y, 8, 10);
          }
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
  flashlightCookie: () =>
    make('cookie', 128, (c, s, r) => {
      c.fillStyle = '#000';
      c.fillRect(0, 0, s, s);
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgb(255,250,235)');
      g.addColorStop(0.18, 'rgb(240,232,210)');
      g.addColorStop(0.32, 'rgb(150,145,130)');
      g.addColorStop(0.42, 'rgb(190,180,160)');
      g.addColorStop(0.5, 'rgb(90,86,78)');
      g.addColorStop(0.85, 'rgb(30,28,26)');
      g.addColorStop(1, 'rgb(0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
      // lens dirt
      for (let i = 0; i < 40; i++) {
        c.fillStyle = `rgba(0,0,0,${r() * 0.15})`;
        c.beginPath();
        c.arc(r() * s, r() * s, 2 + r() * 8, 0, Math.PI * 2);
        c.fill();
      }
    }, 7),
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

export function disposeTextureCache() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
