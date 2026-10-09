import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { bus } from '../core/events';
import { Enemy, type EnemyKind, type SpawnOpts, type HitResult } from './enemy';
import type { Part } from './rig';
import { PLAYER, QUALITY, type WeaponId } from '../config';
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
  /** footprint of a boss that walks the floor: other walkers keep out of it */
  readonly radius?: number;
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

  /**
   * Keep a walker's step (`d`, from its current position `at`) out of the other enemies and the
   * player, treated as circles. The character controller only handles the level: its autostep
   * reads the round bottom of a neighbour's capsule as a stair and pops the walker 15 cm over it,
   * and it sees neighbours where the last 60 Hz world step left them. An existing overlap is
   * eased apart instead of snapped.
   */
  keepApart(self: unknown, at: THREE.Vector3, r: number, d: { x: number; z: number }, dt: number) {
    const fit = (ox: number, oy: number, oz: number, rr: number) => {
      if (Math.abs(oy - at.y) > 1.2) return;
      const px = at.x + d.x - ox, pz = at.z + d.z - oz, d1 = Math.hypot(px, pz);
      const d0 = Math.hypot(at.x - ox, at.z - oz);
      const want = d0 >= rr ? rr : Math.min(rr, d0 + 1.5 * dt);
      if (d1 >= want || d1 < 1e-4) return;
      d.x += (px / d1) * (want - d1);
      d.z += (pz / d1) * (want - d1);
    };
    for (const o of this.list) if (o !== self && !o.dead && !o.onCeiling && o.state !== 'dormant') fit(o.pos.x, o.pos.y, o.pos.z, r + o.radius + 0.02);
    // (the Nightwatch's sweep ignores enemies, so it is kept out here too, or the infected walk into it)
    for (const b of this.bosses) if (b !== self && !b.dead && b.radius) fit(b.pos.x, b.pos.y, b.pos.z, r + b.radius + 0.02);
    const p = ctx.player;
    if (!p.dead) fit(p.pos.x, p.pos.y, p.pos.z, r + PLAYER.radius + 0.03);
  }

  update(dt: number) {
    for (const e of this.list) e.update(dt);
    for (const b of this.bosses) b.update?.(dt);
    for (const c of this.corpses) {
      c.updateCorpse(dt);
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
