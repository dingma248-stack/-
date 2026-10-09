import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { bus } from '../core/events';
import { Enemy, type EnemyKind, type SpawnOpts, type HitResult } from './enemy';
import type { Part } from './rig';
import { QUALITY, type WeaponId } from '../config';
import { settings } from '../core/settings';
import type { RAPIER } from '../physics/world';

/** Anything bullets can hit besides the world (enemies and bosses). */
export interface Hittable {
  dead: boolean;
  downed: boolean;
  pos: THREE.Vector3;
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxD: number, pad?: number): { dist: number; part: Part } | null;
  damage(amount: number, part: Part, point: THREE.Vector3, dir: THREE.Vector3, knockback: number, weapon: WeaponId | 'blast' | 'boss'): HitResult;
  partPos(part: Part): THREE.Vector3;
  update?(dt: number): void;
}

export class EnemyManager {
  readonly group = new THREE.Group();
  list: Enemy[] = [];
  bosses: Hittable[] = [];
  kcc!: RAPIER.KinematicCharacterController;
  kills = 0;
  headshots = 0;
  private corpses: Enemy[] = [];

  constructor() {
    bus.on('noise', (n) => {
      for (const e of this.list) e.hear(n.pos, n.radius, n.source);
    });
  }

  init() {
    this.kcc = ctx.physics.world.createCharacterController(0.03);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.enableAutostep(0.45, 0.15, false);
    this.kcc.enableSnapToGround(0.4);
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.kcc.setSlideEnabled(true);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(60);
  }

  spawn(kind: EnemyKind, pos: THREE.Vector3, opts: SpawnOpts = {}) {
    const e = new Enemy(kind, pos, opts);
    this.list.push(e);
    return e;
  }

  addBoss(b: Hittable) {
    this.bosses.push(b);
  }
  removeBoss(b: Hittable) {
    this.bosses = this.bosses.filter((x) => x !== b);
  }

  clear() {
    for (const e of this.list) e.dispose();
    for (const e of this.corpses) e.dispose();
    this.list = [];
    this.corpses = [];
    this.bosses = [];
  }

  get alive() {
    return this.list.filter((e) => !e.dead);
  }

  awareCount(radius = 30) {
    const p = ctx.player.pos;
    let n = 0;
    for (const e of this.list) if (!e.dead && e.aware && e.pos.distanceTo(p) < radius) n++;
    return n;
  }

  nearest(radius: number) {
    const p = ctx.player.pos;
    let best: Enemy | null = null;
    let bd = radius;
    for (const e of this.list) {
      if (e.dead) continue;
      const d = e.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  onDeath(e: Enemy, headshot: boolean, count = true) {
    if (count) {
      this.kills++;
      if (headshot) this.headshots++;
    }
    this.list = this.list.filter((x) => x !== e);
    this.corpses.push(e);
    const max = QUALITY[settings.quality].maxRagdolls;
    const live = this.corpses.filter((c) => c.ragdoll && !c.ragdoll.frozen);
    while (live.length > max) live.shift()!.ragdoll!.freeze();
    // cap total corpses to keep the scene light
    while (this.corpses.length > 24) this.corpses.shift()!.dispose();
  }

  update(dt: number) {
    for (const e of this.list) e.update(dt);
    for (const b of this.bosses) b.update?.(dt);
    for (const c of this.corpses) {
      c.ragdoll?.update(dt);
      if (c.ragdoll && !c.ragdoll.frozen && c.ragdoll.age > 12) c.ragdoll.freeze();
    }
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, maxD: number, pad = 0) {
    let best: { enemy: Hittable; dist: number; part: Part } | null = null;
    for (const e of this.list) {
      const h = e.raycast(o, d, maxD, pad);
      if (h && (!best || h.dist < best.dist)) best = { enemy: e, ...h };
    }
    for (const b of this.bosses) {
      if (b.dead) continue;
      const h = b.raycast(o, d, maxD, pad);
      if (h && (!best || h.dist < best.dist)) best = { enemy: b, ...h };
    }
    return best;
  }

  meleeTarget(o: THREE.Vector3, fwd: THREE.Vector3, range: number) {
    const h = this.raycast(o, fwd, range, 0.22);
    if (h) return { ...h, point: o.clone().addScaledVector(fwd, h.dist) };
    // generous cone for low targets (dogs, crawlers on the floor, downed infected)
    let best: { enemy: Hittable; dist: number; part: Part; point: THREE.Vector3 } | null = null;
    for (const e of [...this.list, ...this.bosses]) {
      if (e.dead) continue;
      const tp = e.partPos('torso');
      const to = tp.clone().sub(o);
      const dist = to.length();
      if (dist > range + 0.4) continue;
      if (to.normalize().angleTo(fwd) > 0.75) continue;
      if (!best || dist < best.dist) best = { enemy: e, dist, part: 'torso', point: tp };
    }
    return best;
  }

  /** Radial damage (grenades, gas tanks). */
  blast(center: THREE.Vector3, radius: number, damage: number) {
    for (const e of [...this.list, ...this.bosses]) {
      if (e.dead) continue;
      const tp = e.partPos('torso');
      const d = tp.distanceTo(center);
      if (d > radius) continue;
      if (!ctx.physics.lineOfSight(center, tp)) continue;
      const k = 1 - d / radius;
      const dir = tp.clone().sub(center).normalize();
      e.damage(damage * (0.35 + 0.65 * k), 'torso', tp, dir, 2 * k + 0.5, 'blast');
    }
    for (const c of this.corpses) {
      if (!c.ragdoll || c.ragdoll.frozen) continue;
      const p = c.ragdoll.position;
      const d = p.distanceTo(center);
      if (d < radius) c.ragdoll.push(p.clone().sub(center).normalize().setY(0.7).multiplyScalar(8 * (1 - d / radius)));
    }
  }
}
