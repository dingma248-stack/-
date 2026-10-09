import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { humanoid, type Rig } from '../enemies/rig';
import { Ragdoll } from '../physics/ragdoll';
import { angleDiff, clamp, damp } from '../core/math';
import { stdMat } from '../render/materials';
import { bx } from '../levels/props';

export type NpcPose = 'idle' | 'walk' | 'run' | 'aim' | 'wave' | 'sit' | 'hurt' | 'crouch';

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

  constructor(pos: THREE.Vector3, yaw: number, kind: 'zhou' | 'lin') {
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
    if (yaw !== undefined) this.yaw = yaw;
    this.path = [];
  }

  face(p: THREE.Vector3 | null) {
    this.lookAt = p ? p.clone() : null;
  }

  update(dt: number) {
    if (this.dead) {
      this.ragdoll?.update(dt);
      return;
    }
    if (this.path.length) {
      const wp = this.path[0];
      const d = new THREE.Vector3(wp.x - this.pos.x, 0, wp.z - this.pos.z);
      const len = d.length();
      if (len < 0.15) {
        this.path.shift();
        if (!this.path.length) {
          this.pose = 'idle';
          const r = this.resolveWalk;
          this.resolveWalk = null;
          r?.();
        }
      } else {
        const want = Math.atan2(d.x, d.z);
        this.yaw += clamp(angleDiff(this.yaw, want), -6 * dt, 6 * dt);
        const step = Math.min(len, this.speed * dt);
        this.pos.addScaledVector(d.normalize(), step);
        this.pos.y = damp(this.pos.y, ctx.level!.nav.heightAt(this.pos), 12, dt);
      }
    } else if (this.lookAt) {
      const want = Math.atan2(this.lookAt.x - this.pos.x, this.lookAt.z - this.pos.z);
      this.yaw += clamp(angleDiff(this.yaw, want), -4 * dt, 4 * dt);
    }
    this.sync(dt);
  }

  private sync(dt: number) {
    const r = this.rig;
    const S = r.segs;
    r.root.position.copy(this.pos);
    r.root.rotation.set(0, this.yaw, 0);
    const moving = this.pose === 'walk' || this.pose === 'run';
    const run = this.pose === 'run';
    this.phase += dt * (moving ? (run ? 9 : 5.2) : 0);
    const amp = moving ? (run ? 0.8 : 0.42) : 0;
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
  }

  die(dir: THREE.Vector3, impulse = 18) {
    if (this.dead) return;
    this.dead = true;
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
  }
}
