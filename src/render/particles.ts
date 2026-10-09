import * as THREE from 'three';
import { rand } from '../core/math';

/**
 * CPU-simulated point particles rendered as square low-res pixels.
 * Two systems: additive (fire, sparks, muzzle) and alpha-blended (blood, smoke, dust).
 */

const VS = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const FS = /* glsl */ `
varying vec4 vColor;
uniform float uSoft;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = vColor.a;
  if (uSoft > 0.5) { a *= smoothstep(0.5, 0.15, d); }
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <fog_fragment>
}
`;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; grow: number;
  r: number; g: number; b: number; a: number;
  gravity: number; drag: number;
  bounce: number;
  floorY: number;
}

export interface EmitOpts {
  pos: THREE.Vector3;
  dir?: THREE.Vector3;
  speed?: [number, number];
  spread?: number; // 0..1 cone factor; 1 = sphere
  count: number;
  life?: [number, number];
  size?: [number, number];
  grow?: number;
  color: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  alpha?: number;
  gravity?: number;
  drag?: number;
  bounce?: number;
  floorY?: number;
}

class System {
  readonly points: THREE.Points;
  private ps: P[] = [];
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  readonly mat: THREE.ShaderMaterial;

  constructor(private max: number, additive: boolean, soft: boolean) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uScale: { value: 270 }, uSoft: { value: soft ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(o: EmitOpts, mul: number) {
    const n = Math.max(1, Math.round(o.count * mul));
    const c1 = new THREE.Color(o.color);
    const c2 = new THREE.Color(o.color2 ?? o.color);
    const dir = o.dir ?? new THREE.Vector3(0, 1, 0);
    const spread = o.spread ?? 1;
    for (let i = 0; i < n; i++) {
      if (this.ps.length >= this.max) this.ps.shift();
      const sp = rand(...(o.speed ?? [1, 3]));
      // random direction in cone around dir
      let vx = dir.x + (Math.random() * 2 - 1) * spread;
      let vy = dir.y + (Math.random() * 2 - 1) * spread;
      let vz = dir.z + (Math.random() * 2 - 1) * spread;
      const l = Math.hypot(vx, vy, vz) || 1;
      vx = (vx / l) * sp;
      vy = (vy / l) * sp;
      vz = (vz / l) * sp;
      const t = Math.random();
      const life = rand(...(o.life ?? [0.4, 0.9]));
      this.ps.push({
        x: o.pos.x, y: o.pos.y, z: o.pos.z, vx, vy, vz,
        life, max: life,
        size: rand(...(o.size ?? [0.05, 0.1])),
        grow: o.grow ?? 0,
        r: c1.r + (c2.r - c1.r) * t, g: c1.g + (c2.g - c1.g) * t, b: c1.b + (c2.b - c1.b) * t,
        a: o.alpha ?? 1,
        gravity: o.gravity ?? 0,
        drag: o.drag ?? 0,
        bounce: o.bounce ?? 0,
        floorY: o.floorY ?? -1e9,
      });
    }
  }

  update(dt: number) {
    const ps = this.ps;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.gravity * dt;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vy *= dr;
      p.vz *= dr;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < p.floorY) {
        p.y = p.floorY;
        if (p.bounce > 0) {
          p.vy = -p.vy * p.bounce;
          p.vx *= 0.6;
          p.vz *= 0.6;
        } else {
          p.vx = p.vy = p.vz = 0;
        }
      }
      p.size += p.grow * dt;
      ps[w++] = p;
    }
    ps.length = w;
    for (let i = 0; i < w; i++) {
      const p = ps[i];
      const k = p.life / p.max;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.col[i * 4] = p.r;
      this.col[i * 4 + 1] = p.g;
      this.col[i * 4 + 2] = p.b;
      this.col[i * 4 + 3] = p.a * Math.min(1, k * 2.5);
      this.size[i] = p.size;
    }
    this.geo.setDrawRange(0, w);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.ps.length = 0;
    this.geo.setDrawRange(0, 0);
  }
}

export class Particles {
  readonly add = new System(1400, true, false);
  readonly alpha = new System(1600, false, false);
  readonly soft = new System(500, false, true);
  mul = 1;

  attach(scene: THREE.Scene) {
    scene.add(this.add.points, this.alpha.points, this.soft.points);
  }

  setScale(lowH: number, fovDeg: number) {
    const s = lowH / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (const sys of [this.add, this.alpha, this.soft]) sys.mat.uniforms.uScale.value = s;
  }

  update(dt: number) {
    this.add.update(dt);
    this.alpha.update(dt);
    this.soft.update(dt);
  }

  clear() {
    this.add.clear();
    this.alpha.clear();
    this.soft.clear();
  }

  // ---- presets ----
  sparks(pos: THREE.Vector3, normal: THREE.Vector3, n = 10) {
    this.add.emit({ pos, dir: normal, spread: 0.8, speed: [2, 7], count: n, life: [0.12, 0.4], size: [0.025, 0.05], color: 0xffd28a, color2: 0xff7a2a, gravity: 9, bounce: 0.3, floorY: pos.y - 3 }, this.mul);
    this.soft.emit({ pos, dir: normal, spread: 0.5, speed: [0.3, 0.9], count: 3, life: [0.5, 1.1], size: [0.12, 0.22], grow: 0.5, color: 0x77746e, alpha: 0.35, drag: 2 }, this.mul);
  }
  dust(pos: THREE.Vector3, normal: THREE.Vector3, color: THREE.ColorRepresentation = 0x8a857a) {
    this.alpha.emit({ pos, dir: normal, spread: 0.6, speed: [0.8, 2.6], count: 7, life: [0.25, 0.6], size: [0.025, 0.05], color, gravity: 6 }, this.mul);
    this.soft.emit({ pos, dir: normal, spread: 0.4, speed: [0.2, 0.8], count: 3, life: [0.6, 1.2], size: [0.1, 0.2], grow: 0.35, color, alpha: 0.35, drag: 2.5 }, this.mul);
  }
  blood(pos: THREE.Vector3, dir: THREE.Vector3, n = 14, floorY = -1e9) {
    this.alpha.emit({ pos, dir, spread: 0.55, speed: [1.2, 4.5], count: n, life: [0.4, 0.9], size: [0.03, 0.07], color: 0x6a0408, color2: 0x2a0002, gravity: 9.8, floorY }, this.mul);
    this.soft.emit({ pos, dir, spread: 0.4, speed: [0.3, 1.2], count: Math.ceil(n / 4), life: [0.35, 0.7], size: [0.12, 0.25], grow: 0.6, color: 0x5a0306, alpha: 0.55, drag: 3 }, this.mul);
  }
  gore(pos: THREE.Vector3, dir: THREE.Vector3, floorY: number) {
    this.alpha.emit({ pos, dir, spread: 1, speed: [1.5, 5], count: 18, life: [1.2, 2.2], size: [0.06, 0.13], color: 0x4a0306, color2: 0xa89a88, gravity: 11, bounce: 0.15, floorY }, this.mul);
    this.blood(pos, dir, 30, floorY);
    this.soft.emit({ pos, dir: new THREE.Vector3(0, 1, 0), spread: 1, speed: [0.5, 1.6], count: 8, life: [0.6, 1.2], size: [0.2, 0.4], grow: 0.8, color: 0x500206, alpha: 0.5, drag: 3 }, this.mul);
  }
  muzzle(pos: THREE.Vector3, dir: THREE.Vector3, big = false) {
    this.add.emit({ pos, dir, spread: 0.25, speed: [2, 6], count: big ? 10 : 5, life: [0.03, 0.08], size: [0.04, 0.1], color: 0xffe0a0, color2: 0xff8a30 }, this.mul);
    this.soft.emit({ pos, dir, spread: 0.3, speed: [0.4, 1.4], count: big ? 6 : 3, life: [0.4, 1.0], size: [0.06, 0.12], grow: 0.4, color: 0x9a968e, alpha: 0.18, drag: 3, gravity: -0.4 }, this.mul);
  }
  fire(pos: THREE.Vector3, radius = 0.6, n = 3) {
    for (let i = 0; i < n; i++) {
      const p = pos.clone().add(new THREE.Vector3(rand(-radius, radius), 0, rand(-radius, radius)));
      this.add.emit({ pos: p, dir: new THREE.Vector3(0, 1, 0), spread: 0.15, speed: [0.8, 2.2], count: 1, life: [0.35, 0.8], size: [0.15, 0.3], grow: -0.2, color: 0xffa640, color2: 0xff3a10, alpha: 0.8 }, 1);
    }
    if (Math.random() < 0.35)
      this.soft.emit({ pos: pos.clone().add(new THREE.Vector3(0, 0.8, 0)), dir: new THREE.Vector3(0, 1, 0), spread: 0.2, speed: [0.6, 1.2], count: 1, life: [1.5, 3], size: [0.3, 0.5], grow: 0.8, color: 0x161412, alpha: 0.45, drag: 0.4 }, 1);
    if (Math.random() < 0.15)
      this.add.emit({ pos: pos.clone().add(new THREE.Vector3(0, 0.5, 0)), dir: new THREE.Vector3(0, 1, 0), spread: 0.5, speed: [1, 3], count: 1, life: [0.8, 1.8], size: [0.02, 0.035], color: 0xffb060, gravity: -0.5 }, 1);
  }
  explosion(pos: THREE.Vector3) {
    this.add.emit({ pos, spread: 1, speed: [3, 12], count: 70, life: [0.15, 0.6], size: [0.2, 0.5], grow: -0.4, color: 0xfff0b0, color2: 0xff5a10, drag: 3 }, this.mul);
    this.add.emit({ pos, spread: 1, speed: [6, 16], count: 40, life: [0.5, 1.4], size: [0.03, 0.06], color: 0xffc070, gravity: 9, bounce: 0.3, floorY: pos.y - 0.3 }, this.mul);
    this.soft.emit({ pos, spread: 1, speed: [1, 4], count: 30, life: [1.5, 3.5], size: [0.6, 1.1], grow: 1.2, color: 0x1a1816, alpha: 0.65, drag: 1.8, gravity: -0.6 }, this.mul);
  }
  glass(pos: THREE.Vector3, dir: THREE.Vector3, floorY: number) {
    this.add.emit({ pos, dir, spread: 0.9, speed: [1, 4], count: 30, life: [0.6, 1.4], size: [0.02, 0.05], color: 0xcfe6ef, alpha: 0.6, gravity: 9.8, bounce: 0.25, floorY }, this.mul);
  }
  splinters(pos: THREE.Vector3, floorY: number) {
    this.alpha.emit({ pos, spread: 1, speed: [1, 4], count: 22, life: [0.8, 1.5], size: [0.03, 0.06], color: 0x7a5a34, color2: 0x3a2814, gravity: 10, bounce: 0.2, floorY }, this.mul);
    this.soft.emit({ pos, spread: 1, speed: [0.3, 1], count: 6, life: [0.8, 1.6], size: [0.25, 0.4], grow: 0.4, color: 0x6a6050, alpha: 0.3, drag: 2 }, this.mul);
  }
  acid(pos: THREE.Vector3, dir: THREE.Vector3, floorY: number) {
    this.add.emit({ pos, dir, spread: 0.6, speed: [1, 4], count: 18, life: [0.4, 1], size: [0.04, 0.09], color: 0xb6ff3a, color2: 0x4a8a10, gravity: 9, floorY }, this.mul);
  }
  electric(pos: THREE.Vector3, n = 12) {
    this.add.emit({ pos, spread: 1, speed: [2, 8], count: n, life: [0.05, 0.25], size: [0.03, 0.07], color: 0xd6ecff, color2: 0x6aa8ff, gravity: 4 }, this.mul);
  }
  splash(pos: THREE.Vector3) {
    this.alpha.emit({ pos, dir: new THREE.Vector3(0, 1, 0), spread: 0.5, speed: [1, 2.5], count: 6, life: [0.2, 0.45], size: [0.02, 0.04], color: 0x8a9a96, alpha: 0.6, gravity: 9, floorY: pos.y }, this.mul);
  }
}
