import * as THREE from 'three';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. `rate` is 1/seconds. */
export const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const angleDiff = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Deterministic PRNG (mulberry32) for procedural content. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Critically damped spring for camera/viewmodel motion. */
export class Spring {
  value = 0;
  velocity = 0;
  constructor(public stiffness = 120, public damping = 14) {}
  update(target: number, dt: number) {
    const f = (target - this.value) * this.stiffness - this.velocity * this.damping;
    this.velocity += f * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
  kick(v: number) {
    this.velocity += v;
  }
}

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const tmpV = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

/** Distance from point p to segment ab, also returns closest t. */
export function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const len = abx * abx + aby * aby + abz * abz;
  const t = len > 0 ? clamp((apx * abx + apy * aby + apz * abz) / len, 0, 1) : 0;
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Ray vs sphere: returns distance along ray or -1. Ray dir must be normalized. */
export function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t = -b - s;
  if (t >= 0) return t;
  const t2 = -b + s;
  return t2 >= 0 ? 0 : -1;
}

const _cap = new THREE.Vector3();
/** Ray vs capsule (segment a-b with radius r). Returns distance or -1. Ray dir must be normalized. */
export function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number): number {
  // Closest approach between the ray line and the segment, then a sphere test there.
  const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
  const wx = o.x - a.x, wy = o.y - a.y, wz = o.z - a.z;
  const B = d.x * vx + d.y * vy + d.z * vz, C = vx * vx + vy * vy + vz * vz;
  const D = d.x * wx + d.y * wy + d.z * wz, E = vx * wx + vy * wy + vz * wz;
  const den = C - B * B;
  let tc = den < 1e-6 ? (C > 0 ? E / C : 0) : (E - B * D) / den;
  tc = clamp(tc, 0, 1);
  _cap.set(a.x + vx * tc, a.y + vy * tc, a.z + vz * tc);
  return raySphere(o, d, _cap, r);
}
