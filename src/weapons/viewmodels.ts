import * as THREE from 'three';
import { stdMat, M } from '../render/materials';
import { TEX } from '../render/textures';
import { bx, cy } from '../levels/props';
import type { WeaponId } from '../config';

/**
 * First-person weapon models. Every model is a hierarchy with named parts
 * that the animation code drives directly (slide, mag, cylinder, pump...).
 * Local space: -Z forward, +Y up, origin at the grip/hand.
 */

export interface Viewmodel {
  id: WeaponId;
  root: THREE.Group; // positioned by the weapon system
  parts: Record<string, THREE.Object3D>;
  muzzle: THREE.Object3D;
  ejector: THREE.Object3D;
  hip: THREE.Vector3; // hip-fire offset (camera space)
  ads: THREE.Vector3; // aim-down-sight offset
  /** extra hip rotation so the model reads well (knife flat towards camera) */
  idleRot?: THREE.Euler;
}

const skin = () => stdMat({ map: TEX.skin(), color: 0xc8a890, roughness: 0.8 });
const sleeve = () => stdMat({ map: TEX.cloth(), color: 0x3a4048, roughness: 1 });
const glove = () => stdMat({ color: 0x1c1c1e, roughness: 0.9 });

function hand(parent: THREE.Object3D, right = true) {
  const g = new THREE.Group();
  const s = right ? 1 : -1;
  bx(g, 0.085, 0.09, 0.1, glove(), 0, 0, 0);
  // fingers curled around the grip
  for (let i = 0; i < 4; i++) bx(g, 0.02, 0.022, 0.07, glove(), -0.03 * s + 0.0 * i, -0.03 + i * 0.022, -0.05);
  bx(g, 0.025, 0.025, 0.07, glove(), 0.04 * s, 0.03, -0.04, 0.3 * s);
  // wrist + forearm
  const fore = new THREE.Group();
  fore.position.set(0, -0.02, 0.05);
  // forearm slopes down and back out of the frame so it never crosses the near plane
  fore.rotation.set(0.85, 0.25 * s, 0);
  bx(fore, 0.07, 0.065, 0.1, skin(), 0, 0, 0.04);
  bx(fore, 0.1, 0.095, 0.3, sleeve(), 0, -0.005, 0.22);
  g.add(fore);
  parent.add(g);
  return g;
}

function finalize(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
    }
  });
}

export function buildPistol(): Viewmodel {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  const metal = M.gunmetal();
  const poly = stdMat({ color: 0x1b1c1e, roughness: 0.7 });
  // frame
  bx(gun, 0.036, 0.03, 0.17, poly, 0, 0.012, -0.06);
  const grip = bx(gun, 0.034, 0.11, 0.05, poly, 0, -0.045, 0.005, 0, -0.22);
  void grip;
  bx(gun, 0.03, 0.012, 0.05, poly, 0, -0.012, -0.045); // trigger guard
  // slide
  const slide = new THREE.Group();
  slide.position.set(0, 0.04, -0.07);
  bx(slide, 0.034, 0.03, 0.19, metal, 0, 0, 0);
  bx(slide, 0.006, 0.012, 0.01, M.steel(), 0, 0.021, -0.088); // front sight
  bx(slide, 0.024, 0.01, 0.01, M.steel(), 0, 0.021, 0.085); // rear sight
  for (let i = 0; i < 5; i++) bx(slide, 0.035, 0.024, 0.003, M.black(), 0, 0, 0.06 + i * 0.006);
  gun.add(slide);
  // magazine
  const mag = new THREE.Group();
  mag.position.set(0, -0.05, 0.01);
  mag.rotation.x = -0.22;
  bx(mag, 0.026, 0.11, 0.035, M.black(), 0, -0.01, 0);
  gun.add(mag);
  const hammer = bx(gun, 0.008, 0.015, 0.01, metal, 0, 0.055, 0.03);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, -0.17);
  gun.add(muzzle);
  const ejector = new THREE.Object3D();
  ejector.position.set(0.02, 0.05, -0.04);
  gun.add(ejector);
  const rh = hand(gun, true);
  rh.position.set(0.005, -0.06, 0.02);
  rh.rotation.x = -0.22;
  const lh = hand(gun, false);
  lh.position.set(-0.04, -0.07, 0.0);
  lh.rotation.set(-0.2, 0.5, 0.15);
  const offHand = lh;
  finalize(root);
  return {
    id: 'pistol',
    root,
    parts: { gun, slide, mag, hammer, offHand },
    muzzle,
    ejector,
    hip: new THREE.Vector3(0.17, -0.17, -0.38),
    ads: new THREE.Vector3(0, -0.081, -0.3),
  };
}

export function buildShotgun(): Viewmodel {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  const metal = M.gunmetal();
  const wood = stdMat({ map: TEX.woodFloor(), color: 0x8a5a34, roughness: 0.55 });
  bx(gun, 0.045, 0.06, 0.3, metal, 0, 0.02, -0.12); // receiver
  cy(gun, 0.016, 0.62, metal, 0, 0.04, -0.58, 8, Math.PI / 2); // barrel
  cy(gun, 0.016, 0.5, M.black(), 0, 0.005, -0.52, 8, Math.PI / 2); // tube mag
  bx(gun, 0.008, 0.012, 0.01, M.steel(), 0, 0.062, -0.88); // bead
  // stock
  bx(gun, 0.04, 0.06, 0.12, wood, 0, -0.005, 0.07, 0, -0.25);
  bx(gun, 0.042, 0.11, 0.3, wood, 0, -0.04, 0.25, 0, -0.08);
  // pump
  const pump = new THREE.Group();
  pump.position.set(0, 0.0, -0.4);
  bx(pump, 0.05, 0.05, 0.18, wood, 0, 0, 0);
  for (let i = 0; i < 5; i++) bx(pump, 0.052, 0.004, 0.01, M.black(), 0, 0.02, -0.07 + i * 0.035);
  gun.add(pump);
  const port = new THREE.Object3D();
  port.position.set(0, -0.02, -0.12);
  gun.add(port);
  // loose shell held by off hand during reload
  const shell = new THREE.Group();
  cy(shell, 0.011, 0.065, stdMat({ color: 0x8a1c14, roughness: 0.5 }), 0, 0, 0, 6, Math.PI / 2);
  cy(shell, 0.0115, 0.015, stdMat({ color: 0xb08a3a, metalness: 0.9, roughness: 0.3 }), 0, 0, 0.035, 6, Math.PI / 2);
  shell.visible = false;
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, -0.9);
  gun.add(muzzle);
  const ejector = new THREE.Object3D();
  ejector.position.set(0.025, 0.04, -0.1);
  gun.add(ejector);
  const rh = hand(gun, true);
  rh.position.set(0.005, -0.04, 0.02);
  rh.rotation.x = -0.35;
  const lh = hand(pump, false);
  lh.position.set(0, -0.045, 0);
  lh.rotation.set(-0.1, 0.25, 0.4);
  lh.add(shell);
  shell.position.set(0, 0.05, -0.06);
  finalize(root);
  return {
    id: 'shotgun',
    root,
    parts: { gun, pump, shell, offHand: lh },
    muzzle,
    ejector,
    hip: new THREE.Vector3(0.17, -0.2, -0.36),
    ads: new THREE.Vector3(0, -0.103, -0.28),
  };
}

export function buildMagnum(): Viewmodel {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  const steel = stdMat({ map: TEX.steel(), color: 0xb8bcc0, roughness: 0.25, metalness: 0.85 });
  const wood = stdMat({ map: TEX.woodFloor(), color: 0x6a3a1e, roughness: 0.5 });
  bx(gun, 0.03, 0.05, 0.08, steel, 0, 0.03, -0.03); // frame
  cy(gun, 0.012, 0.2, steel, 0, 0.05, -0.17, 8, Math.PI / 2); // barrel
  bx(gun, 0.016, 0.014, 0.2, steel, 0, 0.066, -0.17); // rib
  bx(gun, 0.006, 0.014, 0.01, steel, 0, 0.078, -0.26);
  bx(gun, 0.034, 0.11, 0.05, wood, 0, -0.04, 0.03, 0, -0.35);
  const hammer = bx(gun, 0.01, 0.025, 0.02, steel, 0, 0.07, 0.015, 0, -0.4);
  // swing-out cylinder on a crane
  const crane = new THREE.Group();
  crane.position.set(-0.012, 0.012, -0.03);
  gun.add(crane);
  const cyl = new THREE.Group();
  cyl.position.set(0.012, 0.024, 0);
  cy(cyl, 0.026, 0.055, steel, 0, 0, 0, 6, Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cy(cyl, 0.006, 0.056, M.black(), Math.cos(a) * 0.015, Math.sin(a) * 0.015, 0, 5, Math.PI / 2);
  }
  crane.add(cyl);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.05, -0.28);
  gun.add(muzzle);
  const ejector = new THREE.Object3D();
  ejector.position.set(0, 0.04, -0.03);
  gun.add(ejector);
  const rh = hand(gun, true);
  rh.position.set(0.005, -0.06, 0.04);
  rh.rotation.x = -0.35;
  const lh = hand(gun, false);
  lh.position.set(-0.045, -0.07, 0.02);
  lh.rotation.set(-0.2, 0.5, 0.15);
  finalize(root);
  return {
    id: 'magnum',
    root,
    parts: { gun, crane, cyl, hammer, offHand: lh },
    muzzle,
    ejector,
    hip: new THREE.Vector3(0.17, -0.18, -0.4),
    ads: new THREE.Vector3(0, -0.103, -0.32),
  };
}

export function buildLauncher(): Viewmodel {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  const od = stdMat({ color: 0x3e4632, roughness: 0.6, metalness: 0.2 });
  const metal = M.gunmetal();
  bx(gun, 0.06, 0.08, 0.22, od, 0, 0.0, -0.05); // receiver
  bx(gun, 0.04, 0.12, 0.05, M.black(), 0, -0.07, 0.0, 0, -0.25); // grip
  bx(gun, 0.05, 0.08, 0.3, metal, 0, 0.0, 0.22); // stock
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.03, -0.15);
  cy(barrel, 0.045, 0.36, od, 0, 0, -0.18, 12, Math.PI / 2);
  cy(barrel, 0.035, 0.37, M.black(), 0, 0, -0.18, 12, Math.PI / 2);
  bx(barrel, 0.012, 0.04, 0.02, metal, 0, 0.055, -0.3); // sight post
  gun.add(barrel);
  const round = new THREE.Group();
  cy(round, 0.034, 0.08, stdMat({ color: 0x4a5a2a }), 0, 0, 0, 10, Math.PI / 2);
  cy(round, 0.035, 0.03, stdMat({ color: 0xb08a3a, metalness: 0.8, roughness: 0.3 }), 0, 0, 0.05, 10, Math.PI / 2);
  round.visible = false;
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -0.53);
  gun.add(muzzle);
  const ejector = new THREE.Object3D();
  ejector.position.set(0, 0.03, -0.12);
  gun.add(ejector);
  const rh = hand(gun, true);
  rh.position.set(0.005, -0.08, 0.02);
  rh.rotation.x = -0.25;
  const lh = hand(barrel, false);
  lh.position.set(-0.01, -0.06, -0.2);
  lh.rotation.set(-0.1, 0.25, 0.3);
  lh.add(round);
  round.position.set(0, 0.06, -0.05);
  finalize(root);
  return {
    id: 'launcher',
    root,
    parts: { gun, barrel, round, offHand: lh },
    muzzle,
    ejector,
    hip: new THREE.Vector3(0.18, -0.19, -0.42),
    ads: new THREE.Vector3(0, -0.125, -0.36),
  };
}

export function buildKnife(): Viewmodel {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  const blade = new THREE.Group();
  blade.position.set(0, 0.02, -0.06);
  const steel = stdMat({ map: TEX.steel(), color: 0xd0d4d8, roughness: 0.15, metalness: 0.9 });
  bx(blade, 0.004, 0.028, 0.16, steel, 0, 0.0, -0.09);
  bx(blade, 0.0045, 0.012, 0.04, steel, 0, 0.012, -0.19, -0.5);
  bx(blade, 0.03, 0.01, 0.012, M.black(), 0, 0, -0.005);
  bx(blade, 0.022, 0.026, 0.1, stdMat({ color: 0x1a1a1a, roughness: 0.8 }), 0, -0.002, 0.05);
  gun.add(blade);
  const rh = hand(gun, true);
  rh.position.set(0.005, -0.0, 0.08);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.25);
  gun.add(muzzle);
  finalize(root);
  return {
    id: 'knife',
    root,
    parts: { gun, blade },
    muzzle,
    ejector: muzzle,
    hip: new THREE.Vector3(0.2, -0.21, -0.4),
    ads: new THREE.Vector3(0.2, -0.21, -0.4),
    idleRot: new THREE.Euler(0.2, 0.3, -0.75),
  };
}

export const VIEWMODELS: Record<WeaponId, () => Viewmodel> = {
  knife: buildKnife,
  pistol: buildPistol,
  shotgun: buildShotgun,
  magnum: buildMagnum,
  launcher: buildLauncher,
};
