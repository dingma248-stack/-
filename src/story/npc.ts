import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { humanoid, plant, type Rig } from '../enemies/rig';
import { Ragdoll } from '../physics/ragdoll';
import { RAPIER, groups, G } from '../physics/world';
import { angleDiff, clamp, damp } from '../core/math';
import { PLAYER } from '../config';
import { stdMat } from '../render/materials';
import { bx } from '../levels/props';

export type NpcPose = 'idle' | 'walk' | 'run' | 'aim' | 'wave' | 'sit' | 'hurt' | 'crouch';

const RADIUS = 0.3;
const HALF = 0.45;
const _d = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Scripted story character (Zhou, Lin Wei). No AI — scripts drive it. */
export class NPC {
  readonly rig: Rig;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pose: NpcPose = 'idle';
  private path: THREE.Vector3[] = [];
  private speed = 1.4;
  private phase = 0;
  private lookAt: THREE.Vector3 | null = null;
  dead = false;
  ragdoll: Ragdoll | null = null;
  private resolveWalk: (() => void) | null = null;
  readonly gun: THREE.Object3D | null = null;
  /** loosely follow the player */
  following = false;
  private followT = 0;
  /**
   * Swept against walls, props and the player so the body never passes through them. It belongs
   * to no collision group, so nothing else (player, bullets, enemies) ever touches it.
   */
  private collider: RAPIER.Collider | null = null;
  private world: RAPIER.World;
  private yawVel = 0;
  private gait = 0;
  private curSpeed = 0;
  private stuckT = 0;
  /** after being wedged for a moment it walks through, so a script can never stall on it */
  private ghostT = 0;

  constructor(pos: THREE.Vector3, yaw: number, kind: 'zhou' | 'lin' | 'pilot') {
    if (kind === 'zhou') {
      this.rig = humanoid(4242, { police: true, scale: 1.04 });
      // cap
      const head = this.rig.headMesh;
      bx(head, 0.22, 0.06, 0.24, stdMat({ color: 0x141a26, roughness: 0.8 }), 0, 0.25, 0.01);
      bx(head, 0.2, 0.02, 0.1, stdMat({ color: 0x0c0e12, roughness: 0.5 }), 0, 0.22, 0.14);
      // grey stubble
      bx(head, 0.16, 0.05, 0.02, stdMat({ color: 0x5a5650, roughness: 1 }), 0, 0.05, 0.125);
      const gun = new THREE.Group();
      bx(gun, 0.03, 0.04, 0.18, stdMat({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.6 }), 0, 0, 0.08);
      this.rig.segs.armR.joint!.add(gun);
      gun.position.set(0, -0.3, 0.02);
      gun.rotation.x = -Math.PI / 2;
      this.gun = gun;
    } else if (kind === 'pilot') {
      this.rig = humanoid(3131, { scale: 1 });
      const head = this.rig.headMesh;
      bx(head, 0.24, 0.16, 0.25, stdMat({ color: 0x2a3a2a, roughness: 0.6 }), 0, 0.22, 0);
      bx(head, 0.2, 0.06, 0.04, stdMat({ color: 0x0a0a0a, roughness: 0.1, metalness: 0.6 }), 0, 0.15, 0.12);
      for (const m of this.rig.mats.slice(1)) (m as THREE.MeshStandardMaterial).color.set(0x3a4a34);
    } else {
      this.rig = humanoid(1717, { doctor: true, scale: 0.93, thin: true });
      const head = this.rig.headMesh;
      // long dark hair tied back + lab coat tails
      bx(head, 0.21, 0.26, 0.08, stdMat({ color: 0x120e0c, roughness: 0.9 }), 0, 0.12, -0.1);
      bx(head, 0.07, 0.18, 0.07, stdMat({ color: 0x120e0c, roughness: 0.9 }), 0, 0.0, -0.15);
      const coat = stdMat({ color: 0xd8dcd6, roughness: 0.9 });
      bx(this.rig.hips, 0.34, 0.5, 0.03, coat, 0, -0.2, -0.11);
      bx(this.rig.hips, 0.14, 0.5, 0.03, coat, -0.12, -0.2, 0.1);
      bx(this.rig.hips, 0.14, 0.5, 0.03, coat, 0.12, -0.2, 0.1);
      // glasses
      bx(head, 0.16, 0.025, 0.01, stdMat({ color: 0x0a0a0a }), 0, 0.14, 0.12);
    }
    this.pos.copy(pos);
    this.yaw = yaw;
    this.world = ctx.physics.world;
    this.collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS).setTranslation(pos.x, pos.y + HALF + RADIUS + 0.06, pos.z).setCollisionGroups(groups(0, 0)));
    ctx.level!.group.add(this.rig.root);
    this.sync(0);
    ctx.level!.onUpdate((dt) => this.update(dt));
  }

  walkTo(points: THREE.Vector3 | THREE.Vector3[], run = false): Promise<void> {
    this.path = (Array.isArray(points) ? points : [points]).map((p) => p.clone());
    this.speed = run ? 3.8 : 1.5;
    this.pose = run ? 'run' : 'walk';
    return new Promise((r) => (this.resolveWalk = r));
  }

  /** Path-find through the nav grid to a destination. */
  goTo(dest: THREE.Vector3, run = false) {
    const p = ctx.level!.nav.findPath(this.pos, dest, 3000) ?? [dest];
    return this.walkTo(p, run);
  }

  teleport(p: THREE.Vector3, yaw?: number) {
    this.pos.copy(p);
    if (yaw !== undefined) {
      this.yaw = yaw;
      this.yawVel = 0;
    }
    this.path = [];
    this.gait = 0;
  }

  /** Step along the ground, sliding on walls / props / the player instead of passing through. */
  private moveBy(step: THREE.Vector3, dt: number) {
    this.ghostT -= dt;
    const c = this.collider;
    if (!c || this.ghostT > 0 || this.world !== ctx.physics.world) {
      this.pos.add(step);
      return;
    }
    c.setTranslation({ x: this.pos.x, y: this.pos.y + HALF + RADIUS + 0.06, z: this.pos.z });
    // walk around the player (as a circle: autostep would climb the round bottom of their capsule)
    const p = ctx.player.pos;
    const rr = RADIUS + PLAYER.radius + 0.05;
    const px = this.pos.x + step.x - p.x, pz = this.pos.z + step.z - p.z, d1 = Math.hypot(px, pz);
    if (d1 < rr && d1 > 1e-4 && Math.abs(p.y - this.pos.y) < 1.5 && Math.hypot(this.pos.x - p.x, this.pos.z - p.z) >= d1) {
      step.x += (px / d1) * (rr - d1);
      step.z += (pz / d1) * (rr - d1);
    }
    const kcc = ctx.enemies.kcc;
    kcc.computeColliderMovement(c, { x: step.x, y: 0, z: step.z }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G.STATIC | G.PROP));
    const mv = kcc.computedMovement();
    this.pos.x += mv.x;
    this.pos.z += mv.z;
    const want = Math.hypot(step.x, step.z), got = Math.hypot(mv.x, mv.z);
    if (got < want * 0.3) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 0.8) {
      this.stuckT = 0;
      this.ghostT = 1.2;
    }
  }

  face(p: THREE.Vector3 | null) {
    this.lookAt = p ? p.clone() : null;
  }

  update(dt: number) {
    if (this.dead) {
      this.ragdoll?.update(dt);
      return;
    }
    if (this.following) {
      this.followT -= dt;
      const d = this.pos.distanceTo(ctx.player.pos);
      if (this.followT <= 0) {
        this.followT = 1.2;
        if (d > 3.2) {
          const back = ctx.player.pos.clone().add(ctx.player.forward.setY(0).normalize().multiplyScalar(-1.6));
          const path = ctx.level!.nav.findPath(this.pos, back, 2500);
          if (path) {
            this.path = path;
            this.speed = d > 7 ? 3.6 : 1.7;
            this.pose = d > 7 ? 'run' : 'walk';
          }
        }
      }
      // ease off when catching up instead of stopping dead from a run
      if (this.path.length && d < 3.2) this.speed = Math.min(this.speed, 1.2);
      if (d < 2.2 && this.path.length) {
        this.path = [];
        this.pose = 'idle';
      }
    }
    const wx = this.pos.x, wz = this.pos.z;
    let want: number | null = null;
    if (this.path.length) {
      const wp = this.path[0];
      const d = _d.set(wp.x - this.pos.x, 0, wp.z - this.pos.z);
      const len = d.length();
      if (len < 0.15 || (this.ghostT <= 0 && this.stuckT > 0.4 && len < 0.6)) {
        this.path.shift();
        if (!this.path.length) {
          this.pose = 'idle';
          const r = this.resolveWalk;
          this.resolveWalk = null;
          r?.();
        }
      } else {
        // face a little way down the path so corners turn early and smoothly
        const nx = this.path[1];
        const ahead = nx && len < 0.8 ? _c.set(wp.x + (nx.x - wp.x) * (0.8 - len) * 0.5, 0, wp.z + (nx.z - wp.z) * (0.8 - len) * 0.5) : wp;
        want = Math.atan2(ahead.x - this.pos.x, ahead.z - this.pos.z);
        // swing shut doors open on the way (they collide now)
        for (const door of ctx.level!.doors)
          if (door.target === 0 && door.angle < 0.05 && !door.locked && !door.broken && Math.hypot(door.center.x - this.pos.x, door.center.z - this.pos.z) < 1.3) door.open(this.pos);
        this.curSpeed = damp(this.curSpeed, this.speed, 5, dt);
        this.moveBy(d.normalize().multiplyScalar(Math.min(len, this.curSpeed * dt)), dt);
        this.pos.y = damp(this.pos.y, ctx.level!.nav.heightAt(this.pos), 12, dt);
      }
    } else {
      this.curSpeed = 0;
      if (this.lookAt) want = Math.atan2(this.lookAt.x - this.pos.x, this.lookAt.z - this.pos.z);
    }
    // eased turning: no constant-rate pivots
    const target = want === null ? 0 : clamp(angleDiff(this.yaw, want) * 5, -5, 5);
    this.yawVel = damp(this.yawVel, target, 12, dt);
    this.yaw += this.yawVel * dt;
    const moved = Math.hypot(this.pos.x - wx, this.pos.z - wz);
    this.gait = damp(this.gait, Math.min(moved / Math.max(dt, 1e-4), 8), 10, dt);
    this.sync(dt);
  }

  private sync(dt: number) {
    const r = this.rig;
    const S = r.segs;
    r.root.position.copy(this.pos);
    r.root.rotation.set(0, this.yaw, 0);
    // the legs follow the ground really covered (slowing when blocked, never skating)
    const moving = this.pose === 'walk' || this.pose === 'run';
    const run = this.pose === 'run' && this.gait > 2;
    const v = moving ? this.gait : 0;
    this.phase += dt * (run ? 1.65 * Math.max(v, 3.5) : 3.1 * Math.max(v, 1.15)) * clamp(v * 2, 0, 1);
    const amp = run ? 0.8 * clamp(v / 3.5, 0, 1) : 0.42 * clamp(v / 1.2, 0, 1);
    const sw = Math.sin(this.phase) * amp;
    const t = ctx.time;
    S.legL.pivot.rotation.set(sw, 0, 0);
    S.legR.pivot.rotation.set(-sw, 0, 0);
    S.legL.joint!.rotation.x = Math.max(0, -Math.sin(this.phase + 0.6)) * amp * 1.5;
    S.legR.joint!.rotation.x = Math.max(0, Math.sin(this.phase + 0.6)) * amp * 1.5;
    r.hips.position.y = 0.92 * (r.height / 1.8) + (moving ? Math.abs(Math.sin(this.phase)) * 0.03 : 0);
    let lean = run ? 0.25 : 0.03;
    let aL = -sw * 0.7, aR = sw * 0.7, eL = 0.25, eR = 0.25;
    let zL = -0.08, zR = 0.08;
    const breathe = Math.sin(t * 1.7) * 0.02;
    switch (this.pose) {
      case 'aim':
        aR = -1.5;
        aL = -1.35;
        zL = 0.45;
        eR = 0.05;
        eL = 0.3;
        break;
      case 'wave':
        aR = -2.6 + Math.sin(t * 8) * 0.25;
        zR = 0.3;
        eR = 0.6;
        break;
      case 'hurt':
        lean = 0.35;
        aL = -0.6;
        zL = 0.6;
        eL = 1.4;
        r.hips.position.y -= 0.05;
        break;
      case 'sit':
        r.hips.position.y = 0.32;
        S.legL.pivot.rotation.set(-1.45, 0, -0.15);
        S.legR.pivot.rotation.set(-1.3, 0, 0.12);
        S.legL.joint!.rotation.x = 0.4;
        S.legR.joint!.rotation.x = 0.7;
        lean = -0.15;
        aL = -0.3;
        aR = -0.2;
        zL = -0.3;
        zR = 0.4;
        eR = 0.8;
        break;
      case 'crouch':
        r.hips.position.y = 0.5;
        S.legL.pivot.rotation.set(-1.2, 0, -0.1);
        S.legR.pivot.rotation.set(-0.4, 0, 0.1);
        S.legL.joint!.rotation.x = 2.2;
        S.legR.joint!.rotation.x = 1.6;
        lean = 0.45;
        aL = -0.8;
        aR = -0.9;
        break;
    }
    S.torso.pivot.rotation.set(lean + breathe, run ? Math.sin(this.phase) * 0.1 : 0, 0);
    S.armL.pivot.rotation.set(aL, 0, zL);
    S.armR.pivot.rotation.set(aR, 0, zR);
    S.armL.joint!.rotation.x = -eL;
    S.armR.joint!.rotation.x = -eR;
    // head tracks the player loosely
    let hy = 0;
    const p = ctx.player?.camera?.position;
    if (p && !moving) {
      const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
      hy = clamp(angleDiff(this.yaw, want), -0.9, 0.9);
    }
    S.head.pivot.rotation.set(-lean * 0.4 + Math.sin(t * 0.6) * 0.03, hy, 0);
    if (this.pose !== 'sit' && this.pose !== 'crouch') {
      const sc = r.height / 1.8;
      const sole = _d.set(0, -0.475 * sc, 0.05 * sc);
      plant(r, [[S.legL.joint!, sole], [S.legR.joint!, sole]], this.pos.y + 0.01, -0.3, 0.03);
    }
  }

  die(dir: THREE.Vector3, impulse = 18) {
    if (this.dead) return;
    this.dead = true;
    this.dropCollider();
    this.ragdoll = new Ragdoll(this.rig, ['torso', 'head', 'armL', 'armR', 'legL', 'legR'], new THREE.Vector3(), {
      point: this.pos.clone().add(new THREE.Vector3(0, 1.3, 0)),
      dir,
      impulse,
      part: 'torso',
    });
    this.rig.root.visible = false;
  }

  remove() {
    this.ragdoll?.dispose();
    this.rig.root.removeFromParent();
    this.dead = true;
    this.dropCollider();
  }

  private dropCollider() {
    // a collider from a previous level's (freed) world must not be touched
    if (this.collider && this.world === ctx.physics.world && this.collider.isValid()) this.world.removeCollider(this.collider, false);
    this.collider = null;
  }
}
