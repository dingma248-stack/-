import * as THREE from 'three';
import { RAPIER, GROUPS, toV3, toQuat, type ColliderTag } from './world';
import { ctx } from '../core/ctx';
import type { Rig, Seg, Part } from '../enemies/rig';
import { rand } from '../core/math';

interface RPart {
  seg: Seg;
  obj: THREE.Object3D;
  body: RAPIER.RigidBody;
  offset: THREE.Vector3;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/**
 * Converts an animated rig into jointed rigid bodies. Segment pivots are
 * re-parented to the scene and driven by their bodies.
 */
export class Ragdoll {
  parts: RPart[] = [];
  frozen = false;
  age = 0;
  private soundCd = 0.3;
  private lastVy = 0;

  constructor(rig: Rig, include: Part[], vel: THREE.Vector3, hit: { point: THREE.Vector3; dir: THREE.Vector3; impulse: number; part: Part } | null, single = false) {
    const scene = ctx.scene;
    const world = ctx.physics.world;
    rig.root.updateMatrixWorld(true);
    const order: Part[] = single ? ['torso'] : ['head', 'armL', 'armR', 'legL', 'legR', 'torso'];
    for (const p of order) {
      if (!include.includes(p)) continue;
      const seg = rig.segs[p];
      const obj = single ? rig.hips : seg.pivot;
      scene.attach(obj);
      obj.updateMatrixWorld(true);
      const center = single ? seg.center.clone().add(seg.pivot.position) : seg.center.clone();
      const wp = obj.localToWorld(center.clone());
      const wq = obj.getWorldQuaternion(new THREE.Quaternion());
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(wp.x, wp.y, wp.z)
          .setRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w })
          .setLinearDamping(0.4)
          .setAngularDamping(1.6)
          .setLinvel(vel.x, vel.y, vel.z),
      );
      const mass = p === 'torso' ? 28 : p === 'head' ? 5 : p.startsWith('leg') ? 9 : 4;
      const h = seg.half;
      const vol = h.x * h.y * h.z * 8;
      const c = world.createCollider(RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setDensity(mass / vol).setCollisionGroups(GROUPS.ragdoll).setFriction(0.9).setRestitution(0.05), body);
      const tag: ColliderTag = { kind: 'ragdoll', surface: 'flesh', owner: this };
      ctx.physics.tag(c, tag);
      ctx.physics.track(body);
      this.parts.push({ seg, obj, body, offset: center.clone() });
    }
    // joints to the torso
    const torso = this.parts.find((x) => x.seg.part === 'torso');
    if (torso && !single) {
      const tq = toQuat(torso.body.rotation()).invert();
      const tp = toV3(torso.body.translation());
      for (const rp of this.parts) {
        if (rp === torso) continue;
        const anchor = rp.obj.getWorldPosition(new THREE.Vector3());
        const a1 = anchor.clone().sub(tp).applyQuaternion(tq);
        const cq = toQuat(rp.body.rotation()).invert();
        const a2 = anchor.clone().sub(toV3(rp.body.translation())).applyQuaternion(cq);
        const j = world.createImpulseJoint(RAPIER.JointData.spherical({ x: a1.x, y: a1.y, z: a1.z }, { x: a2.x, y: a2.y, z: a2.z }), torso.body, rp.body, true);
        j.setContactsEnabled(false);
      }
    }
    if (hit) this.hit(hit.point, hit.dir, hit.impulse, hit.part);
  }

  /** Impulse on the body nearest to a point. */
  hit(point: THREE.Vector3, dir: THREE.Vector3, impulse: number, part?: Part) {
    if (this.frozen) return;
    let best: RPart | null = null;
    let bd = Infinity;
    for (const p of this.parts) {
      if (part && p.seg.part === part) {
        best = p;
        break;
      }
      const d = toV3(p.body.translation(), _v).distanceTo(point);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return;
    best.body.applyImpulseAtPoint({ x: dir.x * impulse, y: dir.y * impulse + impulse * 0.25, z: dir.z * impulse }, { x: point.x, y: point.y, z: point.z }, true);
  }

  /** Whole-body shove (explosions, shotgun blasts). */
  push(v: THREE.Vector3) {
    for (const p of this.parts) {
      const m = p.body.mass();
      p.body.applyImpulse({ x: v.x * m, y: v.y * m, z: v.z * m }, true);
      p.body.applyTorqueImpulse({ x: rand(-1, 1) * m * 0.3, y: rand(-1, 1) * m * 0.3, z: rand(-1, 1) * m * 0.3 }, true);
    }
  }

  update(dt: number) {
    if (this.frozen) return;
    this.age += dt;
    this.soundCd -= dt;
    for (const p of this.parts) {
      const t = p.body.translation();
      toQuat(p.body.rotation(), _q);
      p.obj.quaternion.copy(_q);
      p.obj.position.set(t.x, t.y, t.z).sub(_v.copy(p.offset).applyQuaternion(_q));
    }
    const torso = this.parts.find((x) => x.seg.part === 'torso') ?? this.parts[0];
    if (torso) {
      const vy = torso.body.linvel().y;
      if (this.soundCd <= 0 && this.lastVy < -2.5 && vy > this.lastVy + 2) {
        ctx.audio.play('bodyFall', { pos: toV3(torso.body.translation()), vol: Math.min(1, -this.lastVy / 6) });
        this.soundCd = 0.4;
      }
      this.lastVy = vy;
    }
  }

  get position() {
    const torso = this.parts.find((x) => x.seg.part === 'torso') ?? this.parts[0];
    return torso ? toV3(torso.body.translation()) : new THREE.Vector3();
  }

  /** Stop simulating (keeps the corpse pose). */
  freeze() {
    if (this.frozen) return;
    this.frozen = true;
    for (const p of this.parts) ctx.physics.removeBody(p.body);
  }

  dispose() {
    this.freeze();
    for (const p of this.parts) p.obj.removeFromParent();
    this.parts = [];
  }
}
