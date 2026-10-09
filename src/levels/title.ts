import * as THREE from 'three';
import type { Level } from './level';
import { P } from './props';
import { V } from './kit';
import { ctx } from '../core/ctx';
import { stdMat } from '../render/materials';
import { TEX } from '../render/textures';

export interface TitleRun {
  update(dt: number, t: number, cam: THREE.PerspectiveCamera): void;
}

/**
 * Title backdrop: a rain-soaked Mistport street at night. Long perspective,
 * flickering sodium lamps, a burning wreck and distant patrol lights.
 */
export function buildTitle(L: Level): TitleRun {
  const W = 'B', S = 's', R = '=', M = '-';
  const rows: string[] = [];
  const len = 90;
  for (let z = 0; z < len; z++) {
    // building | sidewalk | road (with centre line) | sidewalk | building
    const row = W + W + S + S + R + R + R + (z % 6 < 3 ? M : R) + R + R + R + S + S + W + W;
    rows.push(row);
  }
  L.buildMap({
    rows,
    legend: {
      B: { t: 'wall', wall: 'facade' },
      s: { t: 'floor', floor: 'sidewalk', ceil: null, cy: null, fy: 0.12 },
      '=': { t: 'floor', floor: 'asphalt', ceil: null, cy: null },
      '-': { t: 'floor', floor: 'roadLine', ceil: null, cy: null },
      '.': { t: 'floor', floor: 'asphalt', ceil: null, cy: null },
    },
    wallHeight: 16,
  });
  // street lamps alternating sides
  for (let z = 6; z < len; z += 9) {
    const left = (z / 9) % 2 < 1;
    const x = left ? 2.6 : 12.4;
    const lamp = P.streetLamp(5.4);
    L.place(lamp, V(x, 0.12, z), left ? Math.PI / 2 : -Math.PI / 2, { collide: false, keep: true });
    const head = V(left ? x + 1.05 : x - 1.05, 5.2, z);
    const flick = Math.random() < 0.3 ? 'flicker' : 'steady';
    L.light(head, 0xff9a48, 14, 13, flick, { emissive: [lamp.head.material as THREE.Material], emissiveBase: 1 });
  }
  // parked / abandoned cars
  L.place(P.car(0x4a3a30), V(4.4, 0, 20), 0.05);
  L.place(P.car(0x2a3438), V(10.5, 0, 33), Math.PI + 0.1);
  L.place(P.car(0x5a5a52), V(4.6, 0, 47), -0.12);
  // burning wreck in the distance
  const wreck = P.car(0x333333, true);
  L.place(wreck, V(8, 0, 62), 0.6);
  const fire = V(8, 1.2, 62);
  L.light(fire, 0xff6a20, 30, 16, 'fire');
  L.ambient('fire', fire, 0.6, 3);
  L.onUpdate(() => ctx.particles.fire(fire, 0.9, 2));
  // police car with beacon lights further back
  const pc = P.policeCar();
  L.place(pc, V(6, 0, 76), Math.PI / 2 + 0.3, { keep: true });
  const red = L.light(V(6, 2.2, 75.4), 0xff2020, 18, 12, 'beacon', { phase: 0, speed: 1 });
  const blue = L.light(V(6, 2.2, 76.6), 0x2050ff, 18, 12, 'beacon', { phase: 0.4, speed: 1 });
  void red;
  void blue;
  // barricade + debris + papers
  L.place(P.barricade(3), V(7.5, 0, 56), 0.2);
  L.place(P.debris(3, 10, 1.5), V(5, 0, 28));
  L.place(P.papers(4, 14, 3), V(7, 0.01, 15), 0, { collide: false });
  // shop signs (neon) on facades
  const signs: [string, number, number, string, string][] = [
    ['潮音药房', 1.98, 14, '#0a2a1a', '#7affb0'],
    ['旅 馆', 12.02, 24, '#2a0a0a', '#ff6a5a'],
    ['24h 便利', 1.98, 38, '#0a1a2a', '#8ad0ff'],
    ['典当', 12.02, 52, '#2a1a0a', '#ffc070'],
  ];
  for (const [txt, x, z, bg, fg] of signs) {
    const s = P.sign(txt, 2.2, 0.6, bg, fg, 1.2);
    L.place(s, V(x, 3.6, z), x < 7 ? Math.PI / 2 : -Math.PI / 2, { collide: false, keep: true });
    const col = new THREE.Color(fg);
    L.light(V(x < 7 ? x + 0.6 : x - 0.6, 3.4, z), col, 5, 5, Math.random() < 0.5 ? 'buzz' : 'flicker');
  }
  // puddles (glossy planes)
  const puddle = stdMat({ map: TEX.water(), color: 0x0a0c10, roughness: 0.02, metalness: 0.6, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.6 + Math.random() * 1.2, 10), puddle);
    m.rotation.x = -Math.PI / 2;
    m.position.set(4.5 + Math.random() * 6, 0.012, 4 + i * 5 + Math.random() * 3);
    m.scale.set(1, 0.5 + Math.random() * 0.8, 1);
    m.receiveShadow = true;
    L.group.add(m);
  }
  L.ambient('rain', undefined, 0.5);
  L.ambient('wind', undefined, 0.25);
  // occasional distant thunder flash + siren
  let thunderT = 6;
  L.onUpdate((dt) => {
    thunderT -= dt;
    if (thunderT <= 0) {
      thunderT = 14 + Math.random() * 18;
      ctx.renderer.fx.flash = 0.25;
      ctx.audio.play('thunder', { vol: 0.6, delay: 0.6 + Math.random() });
    }
  });
  const cam0 = V(7.2, 1.7, 2);
  return {
    update(dt, t, cam) {
      // very slow dolly with handheld drift
      const k = (t * 0.22) % 46;
      cam.position.set(cam0.x + Math.sin(t * 0.13) * 0.35, cam0.y + Math.sin(t * 0.31) * 0.05, cam0.z + k);
      cam.rotation.set(0, 0, 0);
      cam.quaternion.setFromEuler(new THREE.Euler(0.02 + Math.sin(t * 0.21) * 0.01, Math.PI + Math.sin(t * 0.09) * 0.06 + 0.12, Math.sin(t * 0.17) * 0.008, 'YXZ'));
      if (Math.abs(cam.fov - 62) > 0.01) {
        cam.fov = 62;
        cam.updateProjectionMatrix();
      }
      void dt;
    },
  };
}
