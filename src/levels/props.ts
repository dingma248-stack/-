import * as THREE from 'three';
import { M, stdMat } from '../render/materials';
import { TEX } from '../render/textures';
import { seeded } from '../core/math';

/** Procedural low-poly prop factories. Each returns a group plus local-space box colliders. */

export interface ColDef {
  c: THREE.Vector3; // centre (local)
  h: THREE.Vector3; // half extents
}
export interface PropBuild {
  g: THREE.Group;
  cols: ColDef[];
  /** footprint half-size for nav blocking (local XZ) */
  foot?: [number, number];
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function boxGeo(w: number, h: number, d: number) {
  const k = `b${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}`;
  let g = geoCache.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    // world-ish UVs so textures don't stretch
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
      const su = nx > 0.5 ? d : w;
      const sv = ny > 0.5 ? d : h;
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
    geoCache.set(k, g);
  }
  return g;
}
function cylGeo(rt: number, rb: number, h: number, seg = 8) {
  const k = `c${rt}:${rb}:${h}:${seg}`;
  let g = geoCache.get(k);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg);
    geoCache.set(k, g);
  }
  return g;
}

export function bx(g: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}
export function cy(g: THREE.Object3D, r: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 8, rx = 0, rz = 0, rTop?: number) {
  const m = new THREE.Mesh(cylGeo(rTop ?? r, r, h, seg), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, 0, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}
const col = (x: number, y: number, z: number, hx: number, hy: number, hz: number): ColDef => ({ c: new THREE.Vector3(x, y, z), h: new THREE.Vector3(hx, hy, hz) });

export const P = {
  desk(w = 1.6, d = 0.8): PropBuild {
    const g = new THREE.Group();
    const wood = M.wood();
    bx(g, w, 0.05, d, wood, 0, 0.76, 0);
    bx(g, 0.05, 0.74, d - 0.05, wood, -w / 2 + 0.03, 0.37, 0);
    bx(g, 0.45, 0.74, d - 0.05, wood, w / 2 - 0.23, 0.37, 0);
    bx(g, w - 0.1, 0.4, 0.03, wood, 0, 0.5, -d / 2 + 0.03);
    for (let i = 0; i < 3; i++) bx(g, 0.4, 0.02, 0.01, M.dark(), w / 2 - 0.23, 0.2 + i * 0.22, d / 2 - 0.02);
    return { g, cols: [col(0, 0.4, 0, w / 2, 0.4, d / 2)], foot: [w / 2, d / 2] };
  },
  chair(): PropBuild {
    const g = new THREE.Group();
    const m = M.metal();
    bx(g, 0.45, 0.05, 0.45, M.fabric(), 0, 0.46, 0);
    bx(g, 0.45, 0.45, 0.05, M.fabric(), 0, 0.72, -0.2, 0, -0.1);
    for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) bx(g, 0.03, 0.45, 0.03, m, x, 0.22, z);
    return { g, cols: [col(0, 0.47, 0, 0.23, 0.47, 0.23)] };
  },
  cabinet(h = 1.32): PropBuild {
    const g = new THREE.Group();
    const m = stdMat({ map: TEX.metal(), color: 0x6d7466, roughness: 0.6, metalness: 0.4 });
    bx(g, 0.5, h, 0.62, m, 0, h / 2, 0);
    const n = Math.round(h / 0.33);
    for (let i = 0; i < n; i++) {
      bx(g, 0.44, 0.005, 0.01, M.dark(), 0, (i + 1) * (h / n) - 0.02, 0.315);
      bx(g, 0.12, 0.025, 0.03, M.steel(), 0, (i + 0.6) * (h / n), 0.32);
    }
    return { g, cols: [col(0, h / 2, 0, 0.25, h / 2, 0.31)], foot: [0.25, 0.31] };
  },
  shelf(w = 1.8, h = 2, d = 0.45, seed = 1): PropBuild {
    const g = new THREE.Group();
    const m = M.metal();
    const r = seeded(seed);
    for (const x of [-w / 2, w / 2]) bx(g, 0.04, h, d, m, x, h / 2, 0);
    for (let i = 0; i < 5; i++) {
      const y = 0.08 + i * (h / 4.4);
      bx(g, w, 0.03, d, m, 0, y, 0);
      let x = -w / 2 + 0.1;
      while (x < w / 2 - 0.2) {
        const bw = 0.12 + r() * 0.3;
        const bh = 0.15 + r() * 0.25;
        if (r() < 0.75) {
          const mat = r() < 0.5 ? M.crate() : r() < 0.5 ? M.paper() : M.fabric();
          bx(g, bw, bh, d * (0.5 + r() * 0.4), mat, x + bw / 2, y + bh / 2 + 0.015, 0, (r() - 0.5) * 0.2);
        }
        x += bw + 0.03;
      }
    }
    return { g, cols: [col(0, h / 2, 0, w / 2, h / 2, d / 2)], foot: [w / 2, d / 2] };
  },
  locker(n = 3): PropBuild {
    const g = new THREE.Group();
    const m = stdMat({ map: TEX.metal(), color: 0x55626b, roughness: 0.55, metalness: 0.5 });
    const w = 0.45 * n;
    bx(g, w, 1.9, 0.5, m, 0, 0.95, 0);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.225 + i * 0.45;
      bx(g, 0.005, 1.86, 0.01, M.dark(), x + 0.225, 0.95, 0.255);
      for (let k = 0; k < 4; k++) bx(g, 0.25, 0.012, 0.01, M.dark(), x, 1.6 + k * 0.04, 0.255);
      bx(g, 0.03, 0.1, 0.03, M.steel(), x + 0.15, 1.0, 0.26);
    }
    return { g, cols: [col(0, 0.95, 0, w / 2, 0.95, 0.25)], foot: [w / 2, 0.25] };
  },
  crate(s = 0.8): PropBuild {
    const g = new THREE.Group();
    bx(g, s, s, s, M.crate(), 0, s / 2, 0);
    return { g, cols: [col(0, s / 2, 0, s / 2, s / 2, s / 2)], foot: [s / 2, s / 2] };
  },
  barrel(rust = true): PropBuild {
    const g = new THREE.Group();
    const m = rust ? M.rust() : stdMat({ color: 0x2a4a6a, roughness: 0.5, metalness: 0.4 });
    cy(g, 0.3, 0.9, m, 0, 0.45, 0, 10);
    cy(g, 0.31, 0.04, M.dark(), 0, 0.3, 0, 10);
    cy(g, 0.31, 0.04, M.dark(), 0, 0.62, 0, 10);
    return { g, cols: [col(0, 0.45, 0, 0.3, 0.45, 0.3)], foot: [0.3, 0.3] };
  },
  bin(): PropBuild {
    const g = new THREE.Group();
    cy(g, 0.24, 0.7, stdMat({ map: TEX.metal(), color: 0x445044, roughness: 0.6, metalness: 0.4 }), 0, 0.35, 0, 8, 0, 0, 0.28);
    bx(g, 0.5, 0.05, 0.5, M.dark(), 0, 0.72, 0);
    return { g, cols: [col(0, 0.36, 0, 0.25, 0.36, 0.25)] };
  },
  cart(): PropBuild {
    const g = new THREE.Group();
    const s = M.steel();
    bx(g, 0.9, 0.04, 0.55, s, 0, 0.85, 0);
    bx(g, 0.9, 0.04, 0.55, s, 0, 0.4, 0);
    for (const [x, z] of [[-0.42, -0.25], [0.42, -0.25], [-0.42, 0.25], [0.42, 0.25]]) {
      bx(g, 0.03, 0.8, 0.03, s, x, 0.45, z);
      cy(g, 0.05, 0.04, M.rubber(), x, 0.05, z, 6, Math.PI / 2);
    }
    bx(g, 0.2, 0.12, 0.15, M.white(), -0.2, 0.93, 0);
    bx(g, 0.1, 0.18, 0.1, M.glass(), 0.25, 0.96, 0.1);
    return { g, cols: [col(0, 0.45, 0, 0.45, 0.45, 0.28)] };
  },
  gurney(): PropBuild {
    const g = new THREE.Group();
    const s = M.steel();
    bx(g, 2, 0.08, 0.7, s, 0, 0.75, 0);
    bx(g, 1.9, 0.1, 0.65, stdMat({ color: 0x9fb0a8, roughness: 0.8 }), 0, 0.83, 0);
    bx(g, 0.5, 0.12, 0.5, M.white(), -0.7, 0.92, 0);
    for (const [x, z] of [[-0.9, -0.3], [0.9, -0.3], [-0.9, 0.3], [0.9, 0.3]]) bx(g, 0.04, 0.7, 0.04, s, x, 0.37, z);
    bx(g, 1.8, 0.03, 0.03, s, 0, 0.25, -0.3);
    bx(g, 1.8, 0.03, 0.03, s, 0, 0.25, 0.3);
    return { g, cols: [col(0, 0.45, 0, 1, 0.45, 0.35)], foot: [1, 0.35] };
  },
  bed(): PropBuild {
    const g = new THREE.Group();
    const s = M.steel();
    bx(g, 2, 0.1, 0.95, s, 0, 0.5, 0);
    bx(g, 1.95, 0.16, 0.9, stdMat({ color: 0xb8bcb0, roughness: 0.9 }), 0, 0.62, 0);
    bx(g, 0.04, 0.9, 0.95, s, -1, 0.5, 0);
    bx(g, 0.04, 0.6, 0.95, s, 1, 0.35, 0);
    bx(g, 0.45, 0.1, 0.6, M.white(), -0.72, 0.74, 0);
    bx(g, 1.2, 0.04, 0.95, stdMat({ map: TEX.cloth(), color: 0x8a9a92, roughness: 1 }), 0.3, 0.72, 0, 0, 0, 0.02);
    return { g, cols: [col(0, 0.4, 0, 1, 0.4, 0.48)], foot: [1, 0.48] };
  },
  car(tint = 0x5a6670, burnt = false): PropBuild {
    const g = new THREE.Group();
    const body = burnt ? stdMat({ map: TEX.rust(), color: 0x3a3430, roughness: 0.9 }) : M.car(tint);
    bx(g, 4.2, 0.65, 1.8, body, 0, 0.62, 0);
    bx(g, 2.2, 0.55, 1.6, body, -0.2, 1.22, 0);
    const glass = burnt ? M.black() : stdMat({ color: 0x0e1418, roughness: 0.08, metalness: 0.6 });
    bx(g, 2.1, 0.45, 1.62, glass, -0.2, 1.22, 0);
    bx(g, 0.05, 0.42, 1.5, glass, 0.93, 1.2, 0, 0, 0, 0.5);
    for (const [x, z] of [[-1.35, -0.85], [1.35, -0.85], [-1.35, 0.85], [1.35, 0.85]]) cy(g, 0.36, 0.25, M.rubber(), x, 0.36, z, 10, Math.PI / 2);
    if (!burnt) {
      bx(g, 0.04, 0.15, 0.35, M.glow(0xfff0c8), 2.11, 0.75, -0.6);
      bx(g, 0.04, 0.15, 0.35, M.glow(0xfff0c8), 2.11, 0.75, 0.6);
      bx(g, 0.04, 0.12, 0.3, M.glow(0x9a1010), -2.11, 0.8, -0.65);
      bx(g, 0.04, 0.12, 0.3, M.glow(0x9a1010), -2.11, 0.8, 0.65);
    }
    bx(g, 0.1, 0.2, 1.7, M.dark(), 2.12, 0.45, 0);
    bx(g, 0.1, 0.2, 1.7, M.dark(), -2.12, 0.45, 0);
    return { g, cols: [col(0, 0.65, 0, 2.1, 0.65, 0.9), col(-0.2, 1.3, 0, 1.1, 0.3, 0.8)], foot: [2.1, 0.9] };
  },
  policeCar(): PropBuild & { bar: THREE.Group } {
    const p = P.car(0x1b1e24);
    const g = p.g;
    bx(g, 1.4, 0.05, 1.82, M.white(), 0.4, 0.97, 0); // stripe
    const bar = new THREE.Group();
    bar.position.set(-0.2, 1.53, 0);
    bx(bar, 0.25, 0.1, 1.2, M.dark(), 0, 0, 0);
    bx(bar, 0.22, 0.09, 0.5, M.glow(0xff2020), 0, 0.02, -0.3).name = 'red';
    bx(bar, 0.22, 0.09, 0.5, M.glow(0x2050ff), 0, 0.02, 0.3).name = 'blue';
    g.add(bar);
    return { ...p, bar };
  },
  streetLamp(h = 5.2): PropBuild & { head: THREE.Mesh } {
    const g = new THREE.Group();
    const m = stdMat({ color: 0x2a2c2c, roughness: 0.6, metalness: 0.6 });
    cy(g, 0.08, h, m, 0, h / 2, 0, 6);
    bx(g, 0.08, 0.08, 1.2, m, 0, h, 0.55);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffb060, fog: true });
    const head = bx(g, 0.3, 0.12, 0.5, headMat, 0, h - 0.06, 1.05);
    return { g, cols: [col(0, h / 2, 0, 0.1, h / 2, 0.1)], head };
  },
  bench(): PropBuild {
    const g = new THREE.Group();
    const w = M.wood();
    for (let i = 0; i < 3; i++) bx(g, 1.6, 0.04, 0.12, w, 0, 0.45, -0.15 + i * 0.15);
    for (let i = 0; i < 2; i++) bx(g, 1.6, 0.12, 0.04, w, 0, 0.7 + i * 0.16, -0.25, 0, -0.15);
    for (const x of [-0.7, 0.7]) bx(g, 0.06, 0.45, 0.5, M.black(), x, 0.22, -0.05);
    return { g, cols: [col(0, 0.45, 0, 0.8, 0.45, 0.3)], foot: [0.8, 0.3] };
  },
  vending(color = 0x7a1a1a): PropBuild & { screen: THREE.Mesh } {
    const g = new THREE.Group();
    bx(g, 0.95, 1.9, 0.8, stdMat({ color, roughness: 0.5, metalness: 0.3 }), 0, 0.95, 0);
    const scr = bx(g, 0.6, 1.2, 0.02, stdMat({ color: 0x111111, emissive: 0xc8e0ff, emissiveIntensity: 0.6, roughness: 0.2 }), -0.1, 1.15, 0.41);
    bx(g, 0.6, 0.18, 0.04, M.black(), -0.1, 0.25, 0.41);
    bx(g, 0.15, 0.5, 0.02, M.steel(), 0.32, 1.1, 0.41);
    return { g, cols: [col(0, 0.95, 0, 0.48, 0.95, 0.4)], foot: [0.48, 0.4], screen: scr };
  },
  monitorDesk(screens = 3): PropBuild & { screens: THREE.Mesh[] } {
    const d = P.desk(2.2, 0.9);
    const screensOut: THREE.Mesh[] = [];
    for (let i = 0; i < screens; i++) {
      const x = -0.7 + i * 0.7;
      bx(d.g, 0.5, 0.42, 0.45, stdMat({ color: 0x8a8678, roughness: 0.7 }), x, 1.0, -0.1);
      const mat = stdMat({ map: TEX.monitor(), color: 0x000000, emissive: 0xffffff, emissiveMap: TEX.monitor(), emissiveIntensity: 1.2 });
      screensOut.push(bx(d.g, 0.4, 0.32, 0.01, mat, x, 1.02, 0.13));
    }
    bx(d.g, 0.5, 0.03, 0.18, M.dark(), 0, 0.79, 0.2);
    return { ...d, screens: screensOut };
  },
  tubeLight(len = 1.4): PropBuild & { tube: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
    const g = new THREE.Group();
    bx(g, len + 0.1, 0.06, 0.22, M.metal(), 0, 0.03, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff4dc, fog: true });
    const tube = bx(g, len, 0.04, 0.06, mat, 0, -0.01, 0);
    tube.castShadow = false;
    return { g, cols: [], tube, mat };
  },
  pipe(len: number, r = 0.1, mat?: THREE.Material): PropBuild {
    const g = new THREE.Group();
    cy(g, r, len, mat ?? M.rust(), 0, 0, 0, 8, 0, Math.PI / 2);
    for (let x = -len / 2 + 0.5; x < len / 2; x += 2) cy(g, r * 1.3, 0.08, M.dark(), x, 0, 0, 8, 0, Math.PI / 2);
    return { g, cols: [] };
  },
  gasTank(): PropBuild {
    const g = new THREE.Group();
    const red = stdMat({ color: 0x8a1a12, roughness: 0.45, metalness: 0.5 });
    cy(g, 0.28, 1.25, red, 0, 0.7, 0, 10);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), red);
    top.position.y = 1.32;
    g.add(top);
    cy(g, 0.06, 0.15, M.steel(), 0, 1.65, 0, 6);
    bx(g, 0.4, 0.12, 0.02, M.yellow(), 0, 0.8, 0.28);
    return { g, cols: [col(0, 0.8, 0, 0.28, 0.8, 0.28)], foot: [0.3, 0.3] };
  },
  incubator(liquid = 0x2a9a6a, specimen = true): PropBuild & { liquidMat: THREE.MeshStandardMaterial } {
    const g = new THREE.Group();
    const s = M.steel();
    cy(g, 0.75, 0.4, s, 0, 0.2, 0, 12);
    cy(g, 0.75, 0.3, s, 0, 2.65, 0, 12);
    const liquidMat = stdMat({ color: 0x0a2018, emissive: liquid, emissiveIntensity: 0.5, transparent: true, opacity: 0.55, roughness: 0.1, depthWrite: false });
    const liq = cy(g, 0.62, 2.1, liquidMat, 0, 1.45, 0, 12);
    liq.castShadow = false;
    const gl = cy(g, 0.66, 2.1, M.glass(), 0, 1.45, 0, 12);
    gl.castShadow = false;
    if (specimen) {
      const sm = stdMat({ color: 0x1a2a20, roughness: 0.6 });
      bx(g, 0.35, 0.6, 0.22, sm, 0, 1.6, 0);
      bx(g, 0.2, 0.22, 0.2, sm, 0, 2.05, 0);
      bx(g, 0.1, 0.6, 0.1, sm, -0.22, 1.5, 0, 0, 0, 0.3);
      bx(g, 0.1, 0.6, 0.1, sm, 0.22, 1.45, 0, 0, 0, -0.25);
      bx(g, 0.12, 0.55, 0.12, sm, -0.1, 1.0, 0, 0, 0, 0.1);
      bx(g, 0.12, 0.55, 0.12, sm, 0.1, 1.0, 0, 0, 0, -0.08);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      cy(g, 0.04, 2.2, M.dark(), Math.cos(a) * 0.7, 1.45, Math.sin(a) * 0.7, 6);
    }
    return { g, cols: [col(0, 1.45, 0, 0.72, 1.45, 0.72)], foot: [0.75, 0.75], liquidMat };
  },
  counter(w = 3): PropBuild {
    const g = new THREE.Group();
    bx(g, w, 1.05, 0.7, M.wood(), 0, 0.525, 0);
    bx(g, w + 0.1, 0.05, 0.8, stdMat({ color: 0x3a3632, roughness: 0.4 }), 0, 1.07, 0);
    return { g, cols: [col(0, 0.55, 0, w / 2, 0.55, 0.38)], foot: [w / 2, 0.38] };
  },
  sofa(): PropBuild {
    const g = new THREE.Group();
    const m = stdMat({ map: TEX.cloth(), color: 0x5a3a2a, roughness: 1 });
    bx(g, 2, 0.4, 0.85, m, 0, 0.25, 0);
    bx(g, 2, 0.5, 0.2, m, 0, 0.6, -0.33);
    bx(g, 0.2, 0.3, 0.85, m, -0.95, 0.55, 0);
    bx(g, 0.2, 0.3, 0.85, m, 0.95, 0.55, 0);
    return { g, cols: [col(0, 0.4, 0, 1, 0.4, 0.43)], foot: [1, 0.43] };
  },
  table(w = 1.2, d = 0.8): PropBuild {
    const g = new THREE.Group();
    bx(g, w, 0.05, d, M.wood(), 0, 0.74, 0);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(g, 0.05, 0.72, 0.05, M.wood(), x * (w / 2 - 0.05), 0.36, z * (d / 2 - 0.05));
    return { g, cols: [col(0, 0.4, 0, w / 2, 0.4, d / 2)] };
  },
  radio(): PropBuild {
    // save point: an old shortwave radio on a small table, warm dial glow
    const t = P.table(0.8, 0.55);
    const body = stdMat({ map: TEX.woodPanel(), roughness: 0.6 });
    bx(t.g, 0.5, 0.28, 0.25, body, 0, 0.91, 0);
    bx(t.g, 0.22, 0.12, 0.01, stdMat({ color: 0x221a10, emissive: 0xffa040, emissiveIntensity: 1.4 }), -0.08, 0.95, 0.126);
    cy(t.g, 0.03, 0.03, M.steel(), 0.15, 0.95, 0.13, 8, Math.PI / 2);
    cy(t.g, 0.03, 0.03, M.steel(), 0.15, 0.86, 0.13, 8, Math.PI / 2);
    bx(t.g, 0.01, 0.5, 0.01, M.steel(), 0.2, 1.3, -0.05, 0, 0, -0.3);
    return t;
  },
  barricade(w = 2.4): PropBuild {
    const g = new THREE.Group();
    const stripe = stdMat({ map: TEX.sign('', '#c8b030', '#000', 64, 16), color: 0xffffff, roughness: 0.7 });
    bx(g, w, 0.25, 0.08, stripe, 0, 0.85, 0);
    bx(g, w, 0.25, 0.08, stripe, 0, 0.45, 0);
    for (const x of [-w / 2 + 0.15, w / 2 - 0.15]) bx(g, 0.08, 1.05, 0.5, M.dark(), x, 0.52, 0);
    return { g, cols: [col(0, 0.55, 0, w / 2, 0.55, 0.12)], foot: [w / 2, 0.15] };
  },
  sign(text: string, w = 1.2, h = 0.3, bg = '#1a3b26', fg = '#d8e8d0', glow = 0.6): PropBuild {
    const g = new THREE.Group();
    const tex = TEX.sign(text, bg, fg, Math.round(w * 110), Math.round(h * 110), `bold ${Math.round(h * 70)}px "Noto Serif SC", serif`);
    const m = stdMat({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow, roughness: 0.6 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    g.add(mesh);
    return { g, cols: [] };
  },
  debris(seed = 1, n = 8, spread = 1): PropBuild {
    const g = new THREE.Group();
    const r = seeded(seed);
    const mats = [M.dark(), M.paper(), M.crate(), stdMat({ map: TEX.concrete(), roughness: 1 })];
    for (let i = 0; i < n; i++) {
      const s = 0.08 + r() * 0.3;
      bx(g, s * (1 + r()), s * 0.4, s, mats[Math.floor(r() * mats.length)], (r() - 0.5) * spread * 2, s * 0.2, (r() - 0.5) * spread * 2, r() * 3, r() * 0.3, r() * 0.3);
    }
    return { g, cols: [] };
  },
  papers(seed = 1, n = 10, spread = 1.2): PropBuild {
    const g = new THREE.Group();
    const r = seeded(seed);
    const geo = new THREE.PlaneGeometry(0.21, 0.29);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, M.paper());
      m.rotation.set(-Math.PI / 2, 0, r() * 6);
      m.position.set((r() - 0.5) * spread * 2, 0.005 + i * 0.001, (r() - 0.5) * spread * 2);
      m.receiveShadow = true;
      g.add(m);
    }
    return { g, cols: [] };
  },
  bottle(): PropBuild {
    const g = new THREE.Group();
    const m = stdMat({ color: 0x2a5a2a, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.75 });
    cy(g, 0.04, 0.2, m, 0, 0.1, 0, 6);
    cy(g, 0.015, 0.09, m, 0, 0.245, 0, 5);
    return { g, cols: [col(0, 0.15, 0, 0.04, 0.15, 0.04)] };
  },
  trainCar(len = 14): PropBuild {
    const g = new THREE.Group();
    const body = stdMat({ map: TEX.steel(), color: 0x8a9496, roughness: 0.35, metalness: 0.6 });
    bx(g, len, 2.6, 2.8, body, 0, 1.55, 0);
    const stripe = stdMat({ color: 0x1a5a3a, roughness: 0.5 });
    bx(g, len + 0.02, 0.3, 2.82, stripe, 0, 1.0, 0);
    const win = stdMat({ color: 0x050808, emissive: 0x2a3a30, emissiveIntensity: 0.3, roughness: 0.05, metalness: 0.5 });
    for (let x = -len / 2 + 1.2; x < len / 2 - 1; x += 1.6) {
      bx(g, 1.1, 0.7, 2.84, win, x, 2.0, 0);
    }
    for (const x of [-len / 2 + 3, len / 2 - 3]) bx(g, 1.3, 2.0, 2.86, stdMat({ color: 0x4a5254, roughness: 0.4, metalness: 0.6 }), x, 1.25, 0);
    return { g, cols: [col(0, 1.55, 0, len / 2, 1.3, 1.4)], foot: [len / 2, 1.4] };
  },
  helicopter(): PropBuild & { rotor: THREE.Group; tailRotor: THREE.Group } {
    const g = new THREE.Group();
    const body = stdMat({ color: 0x2c3a2c, roughness: 0.5, metalness: 0.4 });
    bx(g, 3.6, 1.7, 1.9, body, 0, 1.4, 0);
    bx(g, 1.3, 1.2, 1.7, stdMat({ color: 0x0a1014, roughness: 0.05, metalness: 0.6 }), 2.1, 1.35, 0);
    bx(g, 4.5, 0.45, 0.45, body, -3.8, 1.8, 0);
    bx(g, 0.8, 1.3, 0.1, body, -5.9, 2.3, 0);
    for (const z of [-0.85, 0.85]) bx(g, 3.6, 0.07, 0.07, M.dark(), 0.2, 0.25, z);
    for (const [x, z] of [[-1, -0.85], [1.2, -0.85], [-1, 0.85], [1.2, 0.85]]) bx(g, 0.06, 0.4, 0.06, M.dark(), x, 0.45, z);
    const rotor = new THREE.Group();
    rotor.position.set(0, 2.45, 0);
    cy(rotor, 0.12, 0.3, M.dark(), 0, 0, 0, 6);
    for (let i = 0; i < 2; i++) bx(rotor, 10, 0.04, 0.28, M.dark(), 0, 0.12, 0, (i * Math.PI) / 2);
    g.add(rotor);
    const tailRotor = new THREE.Group();
    tailRotor.position.set(-5.9, 2.4, 0.12);
    bx(tailRotor, 1.3, 0.12, 0.03, M.dark(), 0, 0, 0);
    bx(tailRotor, 0.12, 1.3, 0.03, M.dark(), 0, 0, 0);
    g.add(tailRotor);
    bx(g, 0.1, 0.1, 0.1, M.glow(0xff2020), -6.2, 3, 0);
    return { g, cols: [col(0, 1.4, 0, 1.8, 0.9, 0.95)], foot: [2.5, 1], rotor, tailRotor };
  },
  fleshGrowth(r = 0.8, seed = 1): PropBuild & { mat: THREE.MeshStandardMaterial } {
    const g = new THREE.Group();
    const mat = fleshMaterial();
    const rnd = seeded(seed);
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const s = r * (0.35 + rnd() * 0.65);
      const geo = new THREE.IcosahedronGeometry(s, 1);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        const f = 0.75 + rnd() * 0.5;
        pos.setXYZ(k, pos.getX(k) * f, pos.getY(k) * f * 0.7, pos.getZ(k) * f);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat);
      m.position.set((rnd() - 0.5) * r * 1.5, s * 0.3, (rnd() - 0.5) * r * 1.5);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    return { g, cols: [], mat };
  },
};

let fleshMat: THREE.MeshStandardMaterial | null = null;
export const fleshUniforms = { uTime: { value: 0 }, uPulse: { value: 1 } };
/** Organic material with a pulsing vertex displacement. */
export function fleshMaterial() {
  if (fleshMat) return fleshMat;
  const m = new THREE.MeshStandardMaterial({ map: TEX.flesh(), roughness: 0.3, metalness: 0.1, emissive: 0x3a0608, emissiveIntensity: 1 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = fleshUniforms.uTime;
    shader.uniforms.uPulse = fleshUniforms.uPulse;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uPulse;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float beat = pow(max(0.0, sin(uTime * 2.6 + wp.x * 0.7 + wp.z * 0.5)), 6.0);
        transformed += normal * (beat * 0.06 * uPulse + sin(uTime * 1.3 + wp.y * 3.0) * 0.015);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= 0.6 + 0.6 * pow(max(0.0, sin(uTime * 2.6)), 6.0);');
    shader.uniforms.uTime = fleshUniforms.uTime;
  };
  fleshMat = m;
  return m;
}

export function disposePropGeometry() {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
}
