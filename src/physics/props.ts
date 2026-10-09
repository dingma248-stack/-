import * as THREE from 'three';
import { RAPIER, GROUPS, toV3, toQuat, type ColliderTag } from './world';
import { ctx } from '../core/ctx';
import { bus } from '../core/events';
import { NOISE, QUALITY } from '../config';
import { settings } from '../core/settings';
import { M, stdMat } from '../render/materials';
import { TEX } from '../render/textures';
import { rand } from '../core/math';
import type { PropBuild } from '../levels/props';

export type BreakKind = 'wood' | 'glass' | 'bottle' | 'tank';

export interface DynProp {
  g: THREE.Object3D;
  body: RAPIER.RigidBody;
  offset: THREE.Vector3;
  surface: string;
  breakable?: { hp: number; kind: BreakKind; onBreak?: (p: DynProp) => void };
  lastVel: THREE.Vector3;
  soundCd: number;
  alive: boolean;
}

interface Debris {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  life: number;
  max: number;
  sound?: string;
  lastVy: number;
  cd: number;
}

interface Pane {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  w: number;
  h: number;
  alive: boolean;
  onBreak?: () => void;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Props {
  readonly group = new THREE.Group();
  dyn: DynProp[] = [];
  private debris: Debris[] = [];
  private panes: Pane[] = [];
  private shellGeo = new THREE.BoxGeometry(0.012, 0.012, 0.03);
  private shellGeoBig = new THREE.BoxGeometry(0.022, 0.022, 0.06);
  private shellMat = stdMat({ color: 0xb08a3a, roughness: 0.25, metalness: 0.9 });
  private shellMatRed = stdMat({ color: 0x8a1c14, roughness: 0.5, metalness: 0.2 });

  clear() {
    for (const p of this.dyn) this.group.remove(p.g);
    for (const d of this.debris) this.group.remove(d.mesh);
    for (const p of this.panes) this.group.remove(p.mesh);
    this.dyn = [];
    this.debris = [];
    this.panes = [];
  }

  add(build: PropBuild, pos: THREE.Vector3, rotY: number, mass: number, surface = 'wood', breakable?: DynProp['breakable']): DynProp {
    const c = build.cols[0];
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const center = c.c.clone().applyQuaternion(q).add(pos);
    const tag: ColliderTag = { kind: 'prop', surface };
    const { body, collider } = ctx.physics.addDynamicBox(center, c.h, mass, GROUPS.prop, tag, q);
    const p: DynProp = { g: build.g, body, offset: c.c.clone().negate(), surface, breakable, lastVel: new THREE.Vector3(), soundCd: 0.5, alive: true };
    tag.owner = p;
    collider.setRestitution(0.1);
    build.g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.group.add(build.g);
    this.dyn.push(p);
    this.sync(p);
    return p;
  }

  /** A breakable glass pane (static until shattered). axis: 'x' = pane spans x, faces z. */
  addPane(center: THREE.Vector3, w: number, h: number, axis: 'x' | 'z', onBreak?: () => void) {
    const geo = new THREE.PlaneGeometry(w, h);
    const mesh = new THREE.Mesh(geo, M.glass());
    mesh.position.copy(center);
    if (axis === 'z') mesh.rotation.y = Math.PI / 2;
    this.group.add(mesh);
    const half = axis === 'x' ? new THREE.Vector3(w / 2, h / 2, 0.03) : new THREE.Vector3(0.03, h / 2, w / 2);
    const tag: ColliderTag = { kind: 'prop', surface: 'glass' };
    // fixed, not kinematic: the character controller takes a touching kinematic body for a moving
    // platform and cancels any move along its normal, so you couldn't step back off the ledge under it
    const { body, collider } = ctx.physics.addStaticBox(center, half, 'glass');
    ctx.physics.tag(collider, tag);
    const pane: Pane = { mesh, body, center: center.clone(), normal: axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), w, h, alive: true, onBreak };
    tag.owner = pane;
    this.panes.push(pane);
    return pane;
  }

  private sync(p: DynProp) {
    const t = p.body.translation();
    const r = p.body.rotation();
    toQuat(r, _q);
    p.g.quaternion.copy(_q);
    p.g.position.set(t.x, t.y, t.z).add(_v.copy(p.offset).applyQuaternion(_q));
  }

  /** Bullet / melee / blast hit on whatever collider the ray touched. */
  hit(tag: ColliderTag | undefined, point: THREE.Vector3, dir: THREE.Vector3, impulse: number, damage: number) {
    if (!tag?.owner) return;
    const owner = tag.owner as DynProp | Pane;
    if ('w' in owner) {
      if (owner.alive) this.shatter(owner, dir);
      return;
    }
    const p = owner as DynProp;
    if (!p.alive) return;
    p.body.applyImpulseAtPoint({ x: dir.x * impulse, y: dir.y * impulse + impulse * 0.15, z: dir.z * impulse }, { x: point.x, y: point.y, z: point.z }, true);
    if (p.breakable) {
      p.breakable.hp -= damage;
      if (p.breakable.hp <= 0) this.breakProp(p, dir);
    }
  }

  shatter(pane: Pane, dir: THREE.Vector3) {
    pane.alive = false;
    this.group.remove(pane.mesh);
    ctx.physics.removeBody(pane.body);
    ctx.audio.play('glass', { pos: pane.center, vol: 1 });
    bus.emit('noise', { pos: pane.center, radius: NOISE.glass, source: 'player' });
    for (let i = 0; i < 6; i++) {
      const p = pane.center.clone().add(new THREE.Vector3(rand(-pane.w / 2, pane.w / 2), rand(-pane.h / 2, pane.h / 2), 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), pane.normal.x !== 0 ? Math.PI / 2 : 0));
      ctx.particles.glass(p, dir, ctx.player.pos.y - 0.1);
    }
    for (let i = 0; i < 8; i++) {
      const s = rand(0.08, 0.22);
      const pos = pane.center.clone().add(new THREE.Vector3(rand(-pane.w / 2, pane.w / 2), rand(-pane.h / 2, pane.h / 2), 0));
      this.spawnDebris(new THREE.BoxGeometry(s, s * 1.4, 0.01), M.glass(), pos, dir.clone().multiplyScalar(rand(1, 3)), 4, 'bottle');
    }
    pane.onBreak?.();
  }

  breakProp(p: DynProp, dir: THREE.Vector3) {
    if (!p.alive || !p.breakable) return;
    p.alive = false;
    const pos = toV3(p.body.translation());
    this.group.remove(p.g);
    ctx.physics.removeBody(p.body);
    const kind = p.breakable.kind;
    const floorY = pos.y - 0.5;
    if (kind === 'wood') {
      ctx.audio.play('woodBreak', { pos });
      ctx.particles.splinters(pos, floorY);
      for (let i = 0; i < 7; i++) {
        const geo = new THREE.BoxGeometry(rand(0.3, 0.75), 0.03, rand(0.08, 0.16));
        const at = pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3)));
        const v = at.clone().sub(pos).normalize().multiplyScalar(rand(1.5, 3.5)).addScaledVector(dir, 2);
        this.spawnDebris(geo, M.crate(), at, v, 5, 'impactWood');
      }
      bus.emit('noise', { pos, radius: NOISE.crate, source: 'player' });
    } else if (kind === 'bottle') {
      ctx.audio.play('bottle', { pos });
      ctx.particles.glass(pos, dir, floorY);
      bus.emit('noise', { pos, radius: NOISE.glass * 0.6, source: 'player' });
    } else if (kind === 'glass') {
      ctx.audio.play('glass', { pos });
      ctx.particles.glass(pos, dir, floorY);
    } else if (kind === 'tank') {
      ctx.game.explode(pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 6, 400, 'tank');
    }
    p.breakable.onBreak?.(p);
  }

  spawnDebris(geo: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3, vel: THREE.Vector3, life: number, sound?: string) {
    const max = QUALITY[settings.quality].maxDebris;
    while (this.debris.length >= max) this.removeDebris(this.debris[0]);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const half = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(0.006, 0.006, 0.006));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    this.group.add(mesh);
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)));
    const { body } = ctx.physics.addDynamicBox(pos, half, Math.max(0.02, half.x * half.y * half.z * 8 * 600), GROUPS.debris, { kind: 'debris' }, rot, half.x < 0.03);
    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    body.setAngvel({ x: rand(-15, 15), y: rand(-15, 15), z: rand(-15, 15) }, true);
    const d: Debris = { mesh, body, life, max: life, sound, lastVy: vel.y, cd: 0.05 };
    this.debris.push(d);
    return d;
  }

  spawnShell(pos: THREE.Vector3, vel: THREE.Vector3, kind: 'brass' | 'shotgun' | 'big') {
    const geo = kind === 'shotgun' ? this.shellGeoBig : kind === 'big' ? this.shellGeoBig : this.shellGeo;
    const mat = kind === 'shotgun' ? this.shellMatRed : this.shellMat;
    const d = this.spawnDebris(geo, mat, pos, vel, 7, kind === 'shotgun' ? 'shellShotgun' : 'shell');
    d.cd = 0.08;
  }

  private removeDebris(d: Debris) {
    this.group.remove(d.mesh);
    ctx.physics.removeBody(d.body);
    const i = this.debris.indexOf(d);
    if (i >= 0) this.debris.splice(i, 1);
  }

  /** Radial blast impulse to every dynamic body nearby. */
  blast(center: THREE.Vector3, radius: number, impulse: number) {
    ctx.physics.bodiesInRadius(center, radius, (b, tag) => {
      const t = toV3(b.translation());
      const d = t.clone().sub(center);
      const dist = Math.max(0.3, d.length());
      const k = (1 - Math.min(1, dist / radius)) * impulse * b.mass();
      d.normalize().multiplyScalar(k).add(new THREE.Vector3(0, k * 0.5, 0));
      b.applyImpulse({ x: d.x * 0.15, y: d.y * 0.15, z: d.z * 0.15 }, true);
      b.applyTorqueImpulse({ x: rand(-1, 1) * k * 0.02, y: rand(-1, 1) * k * 0.02, z: rand(-1, 1) * k * 0.02 }, true);
      if (tag?.kind === 'prop' && tag.owner && (tag.owner as DynProp).breakable && dist < radius * 0.6) this.breakProp(tag.owner as DynProp, d.normalize());
    });
    for (const pane of this.panes) if (pane.alive && pane.center.distanceTo(center) < radius) this.shatter(pane, pane.center.clone().sub(center).normalize());
  }

  update(dt: number) {
    for (const p of this.dyn) {
      if (!p.alive) continue;
      if (p.body.isSleeping()) continue;
      this.sync(p);
      const v = toV3(p.body.linvel(), _v);
      const dv = v.distanceTo(p.lastVel);
      p.soundCd -= dt;
      if (dv > 2.2 && p.soundCd <= 0) {
        const pos = p.g.position;
        p.soundCd = 0.15;
        const vol = Math.min(1, dv / 6);
        if (p.breakable?.kind === 'bottle' && dv > 3.5) this.breakProp(p, v.clone().normalize());
        else ctx.audio.play(p.surface === 'metal' ? 'impactMetal' : 'propHit', { pos, vol });
        bus.emit('noise', { pos: pos.clone(), radius: NOISE.prop * vol, source: 'world' });
      }
      p.lastVel.copy(v);
    }
    this.dyn = this.dyn.filter((p) => p.alive);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.cd -= dt;
      const t = d.body.translation();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.copy(toQuat(d.body.rotation(), _q));
      const vy = d.body.linvel().y;
      if (d.sound && d.cd <= 0 && d.lastVy < -1 && vy > d.lastVy + 1.2) {
        ctx.audio.play(d.sound, { pos: d.mesh.position, vol: Math.min(1, -d.lastVy / 4), rateVar: 0.1 });
        d.cd = 0.06;
      }
      d.lastVy = vy;
      if (d.life < 1) d.mesh.scale.setScalar(Math.max(0.01, d.life));
      if (d.life <= 0) this.removeDebris(d);
    }
  }

  /** Let the player nudge light props and bodies they walk into. */
  pushNear(pos: THREE.Vector3, vel: THREE.Vector3) {
    if (vel.lengthSq() < 0.5) return;
    ctx.physics.bodiesInRadius(pos, 0.7, (b, tag) => {
      if (tag?.kind !== 'ragdoll' && tag?.kind !== 'debris') return;
      const t = b.translation();
      if (t.y > pos.y + 0.6) return;
      const k = Math.min(b.mass(), 8) * 0.04;
      b.applyImpulse({ x: vel.x * k, y: 0.05 * k, z: vel.z * k }, true);
    });
  }
}

/** Helper: wood crate material accessible for drops etc. */
export const crateMat = () => stdMat({ map: TEX.crate(), roughness: 0.85 });
