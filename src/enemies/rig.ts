import * as THREE from 'three';
import { stdMat, M } from '../render/materials';
import { TEX } from '../render/textures';
import { bx } from '../levels/props';
import { Spring, seeded } from '../core/math';

export type Part = 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR';

export interface Seg {
  part: Part;
  pivot: THREE.Group;
  /** child joint (elbow/knee) */
  joint?: THREE.Group;
  len: number;
  radius: number;
  /** local offset of the segment's mass centre from its pivot */
  center: THREE.Vector3;
  half: THREE.Vector3;
  /** hit capsule endpoints: ca in pivot space, cb in joint space (if any) or pivot space */
  ca: THREE.Vector3;
  cb: THREE.Vector3;
  sx: Spring;
  sz: Spring;
}

export interface Rig {
  root: THREE.Group;
  hips: THREE.Group;
  segs: Record<Part, Seg>;
  headMesh: THREE.Object3D;
  height: number;
  mats: THREE.Material[];
}

const SHIRTS = [0x4a4a46, 0x3a4250, 0x5a3a30, 0x6a6a5a, 0x2a3a2a, 0x7a7a72, 0x403040, 0x55463a];
const PANTS = [0x2a2a30, 0x3a3428, 0x22262c, 0x4a4438, 0x1e1e20];

function seg(part: Part, pivot: THREE.Group, len: number, radius: number, center: THREE.Vector3, half: THREE.Vector3, joint?: THREE.Group, ca?: THREE.Vector3, cb?: THREE.Vector3): Seg {
  return {
    part, pivot, joint, len, radius, center, half,
    ca: ca ?? new THREE.Vector3(),
    cb: cb ?? center.clone().multiplyScalar(2),
    sx: new Spring(140, 9),
    sz: new Spring(140, 9),
  };
}

/** Humanoid: infected, runner, crawler (thin), and the stalker (scaled). */
export function humanoid(seed: number, opts: { scale?: number; thin?: boolean; coat?: boolean; police?: boolean; doctor?: boolean; long?: number } = {}): Rig {
  const r = seeded(seed);
  const s = opts.scale ?? 0.95 + r() * 0.12;
  const thin = opts.thin ? 0.75 : 1;
  const skinTint = new THREE.Color().setHSL(0.08 + r() * 0.04, 0.15 + r() * 0.1, 0.38 + r() * 0.12);
  const skin = stdMat({ map: TEX.skin(), color: skinTint, roughness: 0.7 });
  const shirtColor = opts.police ? 0x1e2a3e : opts.doctor ? 0x9aa8a0 : SHIRTS[Math.floor(r() * SHIRTS.length)];
  const shirt = stdMat({ map: TEX.cloth(), color: shirtColor, roughness: 1 });
  const pants = stdMat({ map: TEX.cloth(), color: opts.doctor ? 0x7a8a84 : PANTS[Math.floor(r() * PANTS.length)], roughness: 1 });
  const coat = opts.coat ? stdMat({ map: TEX.coat(), roughness: 0.85 }) : null;
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.92 * s;
  root.add(hips);
  // torso
  const torso = new THREE.Group();
  hips.add(torso);
  bx(torso, 0.34 * s * thin, 0.22 * s, 0.2 * s * thin, pants, 0, 0.08 * s, 0);
  bx(torso, 0.38 * s * thin, 0.42 * s, 0.22 * s * thin, coat ?? shirt, 0, 0.4 * s, 0);
  if (opts.police) bx(torso, 0.39 * s, 0.05 * s, 0.23 * s, M.dark(), 0, 0.2 * s, 0);
  // neck + head
  const neck = new THREE.Group();
  neck.position.y = 0.63 * s;
  torso.add(neck);
  bx(neck, 0.08 * s, 0.08 * s, 0.08 * s, skin, 0, 0.03 * s, 0);
  const head = new THREE.Group();
  head.position.y = 0.06 * s;
  neck.add(head);
  bx(head, 0.19 * s, 0.22 * s, 0.21 * s, skin, 0, 0.12 * s, 0.01 * s);
  bx(head, 0.2 * s, 0.07 * s, 0.22 * s, stdMat({ color: 0x1a1612, roughness: 1 }), 0, 0.22 * s, -0.01 * s); // hair
  // sunken eyes + jaw
  const eyes = stdMat({ color: 0x0a0505, emissive: 0x2a0000, emissiveIntensity: 1, roughness: 1 });
  bx(head, 0.05 * s, 0.025 * s, 0.01 * s, eyes, -0.045 * s, 0.14 * s, 0.115 * s);
  bx(head, 0.05 * s, 0.025 * s, 0.01 * s, eyes, 0.045 * s, 0.14 * s, 0.115 * s);
  bx(head, 0.14 * s, 0.05 * s, 0.1 * s, stdMat({ map: TEX.skin(), color: skinTint.clone().multiplyScalar(0.7), roughness: 0.6 }), 0, 0.03 * s, 0.07 * s, 0, 0.25);
  // arms
  const mkArm = (side: number) => {
    const sh = new THREE.Group();
    sh.position.set(0.23 * s * thin * side, 0.56 * s, 0);
    torso.add(sh);
    const ul = 0.3 * s * (opts.long ?? 1);
    bx(sh, 0.1 * s * thin, ul, 0.1 * s * thin, coat ?? shirt, 0, -ul / 2, 0);
    const el = new THREE.Group();
    el.position.y = -ul;
    sh.add(el);
    const fl = 0.28 * s * (opts.long ?? 1);
    bx(el, 0.08 * s * thin, fl, 0.08 * s * thin, r() < 0.5 && !coat ? skin : coat ?? shirt, 0, -fl / 2, 0);
    bx(el, 0.08 * s, 0.1 * s, 0.05 * s, skin, 0, -fl - 0.04 * s, 0);
    return { sh, el, len: ul + fl, fl };
  };
  const aL = mkArm(-1), aR = mkArm(1);
  // legs
  const mkLeg = (side: number) => {
    const hp = new THREE.Group();
    hp.position.set(0.1 * s * side, 0, 0);
    hips.add(hp);
    bx(hp, 0.14 * s * thin, 0.44 * s, 0.15 * s * thin, pants, 0, -0.22 * s, 0);
    const kn = new THREE.Group();
    kn.position.y = -0.44 * s;
    hp.add(kn);
    bx(kn, 0.12 * s * thin, 0.42 * s, 0.13 * s * thin, pants, 0, -0.21 * s, 0);
    bx(kn, 0.12 * s, 0.07 * s, 0.24 * s, M.dark(), 0, -0.44 * s, 0.05 * s);
    return { hp, kn };
  };
  const lL = mkLeg(-1), lR = mkLeg(1);
  if (coat) {
    // long coat tails swinging below the hips
    const tail = new THREE.Group();
    tail.name = 'coatTail';
    hips.add(tail);
    bx(tail, 0.42 * s, 0.7 * s, 0.03 * s, coat, 0, -0.35 * s, -0.12 * s);
    bx(tail, 0.2 * s, 0.7 * s, 0.03 * s, coat, -0.15 * s, -0.35 * s, 0.1 * s, 0.4);
    bx(tail, 0.2 * s, 0.7 * s, 0.03 * s, coat, 0.15 * s, -0.35 * s, 0.1 * s, -0.4);
  }
  // blood stains
  const blood = stdMat({ map: TEX.bloodDecal(0), color: 0x6a0408, transparent: true, roughness: 0.3, depthWrite: false });
  if (r() < 0.8) bx(torso, 0.2 * s, 0.2 * s, 0.005, blood, (r() - 0.5) * 0.15 * s, 0.4 * s, 0.112 * s * thin);
  const segs: Record<Part, Seg> = {
    torso: seg('torso', torso, 0.66 * s, 0.2 * s * thin, new THREE.Vector3(0, 0.33 * s, 0), new THREE.Vector3(0.18 * s * thin, 0.32 * s, 0.11 * s * thin), undefined, new THREE.Vector3(0, 0.08 * s, 0), new THREE.Vector3(0, 0.56 * s, 0)),
    head: seg('head', neck, 0.3 * s, 0.13 * s, new THREE.Vector3(0, 0.18 * s, 0.01), new THREE.Vector3(0.11 * s, 0.13 * s, 0.11 * s)),
    armL: seg('armL', aL.sh, aL.len, 0.07 * s, new THREE.Vector3(0, -aL.len / 2, 0), new THREE.Vector3(0.05 * s, aL.len / 2, 0.05 * s), aL.el, new THREE.Vector3(), new THREE.Vector3(0, -aL.fl, 0)),
    armR: seg('armR', aR.sh, aR.len, 0.07 * s, new THREE.Vector3(0, -aR.len / 2, 0), new THREE.Vector3(0.05 * s, aR.len / 2, 0.05 * s), aR.el, new THREE.Vector3(), new THREE.Vector3(0, -aR.fl, 0)),
    legL: seg('legL', lL.hp, 0.88 * s, 0.09 * s, new THREE.Vector3(0, -0.44 * s, 0), new THREE.Vector3(0.07 * s, 0.44 * s, 0.07 * s), lL.kn, new THREE.Vector3(), new THREE.Vector3(0, -0.42 * s, 0)),
    legR: seg('legR', lR.hp, 0.88 * s, 0.09 * s, new THREE.Vector3(0, -0.44 * s, 0), new THREE.Vector3(0.07 * s, 0.44 * s, 0.07 * s), lR.kn, new THREE.Vector3(), new THREE.Vector3(0, -0.42 * s, 0)),
  };
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return { root, hips, segs, headMesh: head, height: 1.8 * s, mats: [skin, shirt, pants] };
}

/** Infected dog. Segments are mapped onto the same Part keys for shared logic. */
export function quadruped(seed: number): Rig {
  const r = seeded(seed);
  const s = 0.9 + r() * 0.15;
  const fur = stdMat({ map: TEX.fur(), color: new THREE.Color().setHSL(0.07, 0.2, 0.2 + r() * 0.12), roughness: 1 });
  const flesh = M.flesh();
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.52 * s;
  root.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);
  bx(torso, 0.26 * s, 0.28 * s, 0.75 * s, fur, 0, 0, 0.05 * s);
  bx(torso, 0.18 * s, 0.1 * s, 0.4 * s, flesh, 0.06 * s, 0.1 * s, 0.1 * s); // exposed ribs
  const neck = new THREE.Group();
  neck.position.set(0, 0.1 * s, 0.42 * s);
  torso.add(neck);
  const head = new THREE.Group();
  neck.add(head);
  bx(head, 0.18 * s, 0.18 * s, 0.22 * s, fur, 0, 0.05 * s, 0.1 * s);
  bx(head, 0.11 * s, 0.09 * s, 0.18 * s, fur, 0, 0.0, 0.26 * s);
  bx(head, 0.1 * s, 0.03 * s, 0.16 * s, M.bone(), 0, -0.05 * s, 0.27 * s); // teeth
  bx(head, 0.04 * s, 0.08 * s, 0.03 * s, fur, -0.06 * s, 0.17 * s, 0.05 * s, 0, 0.3);
  bx(head, 0.04 * s, 0.08 * s, 0.03 * s, fur, 0.06 * s, 0.17 * s, 0.05 * s, 0, 0.3);
  const eye = stdMat({ color: 0x200000, emissive: 0x801010, emissiveIntensity: 1.5 });
  bx(head, 0.03 * s, 0.02 * s, 0.01 * s, eye, -0.05 * s, 0.08 * s, 0.215 * s);
  bx(head, 0.03 * s, 0.02 * s, 0.01 * s, eye, 0.05 * s, 0.08 * s, 0.215 * s);
  const leg = (x: number, z: number) => {
    const p = new THREE.Group();
    p.position.set(x * s, -0.08 * s, z * s);
    torso.add(p);
    bx(p, 0.07 * s, 0.25 * s, 0.08 * s, fur, 0, -0.12 * s, 0);
    const k = new THREE.Group();
    k.position.y = -0.24 * s;
    p.add(k);
    bx(k, 0.05 * s, 0.22 * s, 0.05 * s, fur, 0, -0.1 * s, 0);
    return { p, k };
  };
  const fl = leg(-0.1, 0.32), fr = leg(0.1, 0.32), bl = leg(-0.1, -0.25), br = leg(0.1, -0.25);
  const tail = new THREE.Group();
  tail.position.set(0, 0.08 * s, -0.33 * s);
  torso.add(tail);
  bx(tail, 0.04 * s, 0.04 * s, 0.25 * s, fur, 0, 0, -0.12 * s, 0, 0.5);
  const segs: Record<Part, Seg> = {
    torso: seg('torso', torso, 0.75 * s, 0.17 * s, new THREE.Vector3(0, 0, 0.05 * s), new THREE.Vector3(0.13 * s, 0.14 * s, 0.38 * s), undefined, new THREE.Vector3(0, 0, -0.3 * s), new THREE.Vector3(0, 0, 0.38 * s)),
    head: seg('head', neck, 0.3 * s, 0.13 * s, new THREE.Vector3(0, 0.04 * s, 0.15 * s), new THREE.Vector3(0.09 * s, 0.09 * s, 0.15 * s)),
    armL: seg('armL', fl.p, 0.46 * s, 0.06 * s, new THREE.Vector3(0, -0.23 * s, 0), new THREE.Vector3(0.04, 0.23 * s, 0.04), fl.k, new THREE.Vector3(), new THREE.Vector3(0, -0.2 * s, 0)),
    armR: seg('armR', fr.p, 0.46 * s, 0.06 * s, new THREE.Vector3(0, -0.23 * s, 0), new THREE.Vector3(0.04, 0.23 * s, 0.04), fr.k, new THREE.Vector3(), new THREE.Vector3(0, -0.2 * s, 0)),
    legL: seg('legL', bl.p, 0.46 * s, 0.06 * s, new THREE.Vector3(0, -0.23 * s, 0), new THREE.Vector3(0.04, 0.23 * s, 0.04), bl.k, new THREE.Vector3(), new THREE.Vector3(0, -0.2 * s, 0)),
    legR: seg('legR', br.p, 0.46 * s, 0.06 * s, new THREE.Vector3(0, -0.23 * s, 0), new THREE.Vector3(0.04, 0.23 * s, 0.04), br.k, new THREE.Vector3(), new THREE.Vector3(0, -0.2 * s, 0)),
  };
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return { root, hips, segs, headMesh: head, height: 0.8 * s, mats: [fur] };
}

/** World-space endpoints for a segment's hit capsule. */
export function segEnds(sg: Seg, a: THREE.Vector3, b: THREE.Vector3) {
  sg.pivot.updateWorldMatrix(true, true);
  if (sg.part === 'head') {
    sg.pivot.localToWorld(a.copy(sg.center));
    b.copy(a);
    return;
  }
  sg.pivot.localToWorld(a.copy(sg.ca));
  if (sg.joint) sg.joint.localToWorld(b.copy(sg.cb));
  else sg.pivot.localToWorld(b.copy(sg.cb));
}
