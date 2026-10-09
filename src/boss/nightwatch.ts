import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { RAPIER, GROUPS, groups, G } from '../physics/world';
import { humanoid, segEnds, type Rig, type Part } from '../enemies/rig';
import { bx } from '../levels/props';
import { stdMat, M } from '../render/materials';
import { TEX } from '../render/textures';
import { angleDiff, clamp, damp, rand, rayCapsule, raySphere, smoothstep } from '../core/math';
import { DIFFICULTY, type WeaponId } from '../config';
import type { Hittable } from '../enemies/manager';
import type { HitResult } from '../enemies/enemy';

/**
 * 守夜人 · NIGHTWATCH. Form 1 ("trench coat") cannot be killed, only
 * staggered. Form 2 ("torn") grows a bone blade, charges and leaps; it can be
 * worn down and is vulnerable while stunned or electrocuted.
 */

type NState = 'idle' | 'stalk' | 'punch' | 'stagger' | 'slash' | 'roar' | 'charge' | 'stunned' | 'leap' | 'shocked' | 'scripted' | 'climb' | 'defeated';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Nightwatch implements Hittable {
  readonly rig: Rig;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  readonly vel = new THREE.Vector3();
  private vy = 0;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  state: NState = 'idle';
  stateT = 0;
  hp: number;
  maxHp: number;
  dead = false;
  downed = false;
  private staggerDmg = 0;
  private phase = 0;
  private lastStep = 0;
  private path: THREE.Vector3[] | null = null;
  private pathIdx = 0;
  private repath = 0;
  private attackCd = 1;
  private hitDone = false;
  private chargeDir = new THREE.Vector3();
  private leapFrom = new THREE.Vector3();
  private leapTo = new THREE.Vector3();
  private grounded = true;
  private blade: THREE.Group | null = null;
  private coatTail: THREE.Object3D | null = null;
  private roarCd = 0;
  active = true;
  /** stalk speed multiplier (scripts can slow it for pacing) */
  pace = 1;
  /** called when shocked / stunned etc. for chapter logic */
  onDamaged?: (hp: number) => void;
  readonly form: 1 | 2;
  private flashT = 0;

  constructor(pos: THREE.Vector3, yaw: number, form: 1 | 2) {
    this.form = form;
    this.rig = humanoid(9001, { coat: true, scale: 1.32 });
    const head = this.rig.headMesh;
    // bone-white mask with dark slits, no hair
    head.children.forEach((c) => (c.visible = false));
    const mask = stdMat({ color: 0xcfc8b6, roughness: 0.45, metalness: 0.05, emissive: 0x3a3630, emissiveIntensity: 0.6 });
    bx(head, 0.24, 0.3, 0.26, stdMat({ map: TEX.coat(), roughness: 0.9 }), 0, 0.15, 0); // hood
    bx(head, 0.2, 0.25, 0.05, mask, 0, 0.14, 0.14);
    const slit = stdMat({ color: 0x050202, emissive: form === 2 ? 0x600000 : 0x100000, emissiveIntensity: 1.5 });
    bx(head, 0.06, 0.012, 0.01, slit, -0.045, 0.17, 0.168);
    bx(head, 0.06, 0.012, 0.01, slit, 0.045, 0.17, 0.168);
    bx(head, 0.1, 0.008, 0.01, slit, 0, 0.07, 0.168);
    // heavy gloves
    for (const k of ['armL', 'armR'] as Part[]) {
      const j = this.rig.segs[k].joint!;
      bx(j, 0.14, 0.16, 0.1, M.black(), 0, -0.42, 0);
    }
    this.coatTail = this.rig.hips.getObjectByName('coatTail') ?? null;
    if (form === 2) {
      // the right forearm splits into a bone blade; exposed flesh on the shoulder
      const j = this.rig.segs.armR.joint!;
      j.children.forEach((c) => (c.visible = false));
      const blade = new THREE.Group();
      const bone = stdMat({ color: 0xd8ccb0, roughness: 0.35 });
      bx(blade, 0.12, 0.3, 0.14, M.flesh(), 0, -0.12, 0);
      bx(blade, 0.05, 0.75, 0.16, bone, 0, -0.6, 0.03, 0, 0.08);
      bx(blade, 0.035, 0.45, 0.1, bone, 0, -1.1, 0.07, 0, 0.18);
      j.add(blade);
      this.blade = blade;
      bx(this.rig.segs.torso.pivot, 0.24, 0.26, 0.26, M.flesh(), 0.17, 0.52, 0.02);
      bx(this.rig.segs.torso.pivot, 0.18, 0.2, 0.05, M.flesh(), -0.05, 0.35, 0.13);
      if (this.coatTail) this.coatTail.scale.set(0.8, 0.6, 1);
    }
    ctx.enemies.group.add(this.rig.root);
    this.pos.copy(pos);
    this.yaw = yaw;
    const r = 0.45, halfH = 0.75;
    const world = ctx.physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + halfH + r, pos.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfH, r).setCollisionGroups(GROUPS.enemy), this.body);
    ctx.physics.tag(this.collider, { kind: 'enemy', owner: this });
    ctx.physics.track(this.body);
    const mul = DIFFICULTY[ctx.difficulty].enemyHp;
    this.hp = this.maxHp = form === 1 ? 1e9 : 1500 * mul;
    ctx.enemies.addBoss(this);
    this.sync(0);
  }

  setState(s: NState) {
    this.state = s;
    this.stateT = 0;
    this.hitDone = false;
  }

  /** Begin hunting the player. */
  hunt() {
    this.active = true;
    this.setState('stalk');
  }

  headPos() {
    const h = this.rig.segs.head;
    h.pivot.updateWorldMatrix(true, false);
    return h.pivot.localToWorld(h.center.clone());
  }

  partPos(part: Part) {
    segEnds(this.rig.segs[part], _a, _b);
    return _a.clone().add(_b).multiplyScalar(0.5);
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, maxD: number, pad = 0) {
    if (this.dead || !this.rig.root.visible) return null;
    const c = this.rig.hips.getWorldPosition(_a);
    if (raySphere(o, d, c, 2.2) < 0) return null;
    let best: { dist: number; part: Part } | null = null;
    for (const part of ['head', 'torso', 'armL', 'armR', 'legL', 'legR'] as Part[]) {
      const sg = this.rig.segs[part];
      segEnds(sg, _a, _b);
      const r = sg.radius * 1.15 + pad;
      const t = part === 'head' ? raySphere(o, d, _a, r) : rayCapsule(o, d, _a, _b, r);
      if (t >= 0 && t <= maxD && (!best || t < best.dist)) best = { dist: t, part };
    }
    return best;
  }

  damage(amount: number, part: Part, point: THREE.Vector3, dir: THREE.Vector3, knockback: number, weapon: WeaponId | 'blast' | 'boss'): HitResult {
    if (this.dead || this.state === 'defeated') return { killed: false, headshot: false };
    const vuln = this.state === 'stunned' || this.state === 'shocked' ? 2 : 1;
    const mul = part === 'head' ? 1.5 : part === 'torso' ? 1 : 0.7;
    const dmg = amount * mul * vuln;
    this.flashT = 0.08;
    ctx.particles.blood(point, dir.clone().negate(), 8, this.pos.y);
    ctx.audio.play('impactFlesh', { pos: point, vol: 0.8, rate: 0.7 });
    const sg = this.rig.segs[part];
    const local = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    sg.sx.kick(local.z * 3 * clamp(dmg / 40, 0.3, 1.5));
    sg.sz.kick(-local.x * 3 * clamp(dmg / 40, 0.3, 1.5));
    if (this.form === 1) {
      this.staggerDmg += dmg;
      if (this.staggerDmg > 140 && this.state !== 'stagger' && this.state !== 'scripted') {
        this.staggerDmg = 0;
        this.setState('stagger');
        ctx.audio.play('bossRoar', { pos: this.headPos(), vol: 0.6, rate: 1.2 });
      }
      return { killed: false, headshot: part === 'head' };
    }
    this.hp -= dmg;
    this.staggerDmg += dmg;
    this.onDamaged?.(this.hp);
    if (this.hp <= 0) {
      this.hp = 0;
      this.setState('defeated');
      return { killed: false, headshot: false };
    }
    if (weapon === 'blast' || (this.staggerDmg > 260 && this.state !== 'stunned' && this.state !== 'shocked' && this.state !== 'leap')) {
      this.staggerDmg = 0;
      this.setState('stagger');
    }
    return { killed: false, headshot: part === 'head' };
  }

  /** Electrified rail hit. */
  shock() {
    if (this.state === 'shocked' || this.state === 'defeated') return;
    this.setState('shocked');
    const dmg = 420 * DIFFICULTY[ctx.difficulty].enemyHp;
    this.hp -= dmg;
    this.onDamaged?.(this.hp);
    ctx.audio.play('zap', { pos: this.pos, vol: 1 });
    ctx.audio.play('bossRoar', { pos: this.headPos(), vol: 1, rate: 1.3 });
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    if (this.dead) return;
    const p = ctx.player;
    this.stateT += dt;
    this.attackCd -= dt;
    this.roarCd -= dt;
    this.flashT -= dt;
    const dist = this.pos.distanceTo(p.pos);
    ctx.director.stalkerNear = this.active && dist < 32 && this.state !== 'defeated' ? 1 : Math.max(0, ctx.director.stalkerNear - dt);
    let speed = 0;
    let face: number | null = null;
    const toP = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const ground = ctx.level!.nav.heightAt(this.pos);
    // fell into a pit (subway tracks): it hauls itself out after a moment
    if (this.grounded && this.inPit() && (this.state === 'stalk' || (this.state === 'charge' && this.stateT > 0.4))) {
      this.setState('climb');
      ctx.audio.play('bossImpact', { pos: this.pos, vol: 0.8 });
    }
    switch (this.state) {
      case 'idle':
      case 'scripted':
        break;
      case 'stalk': {
        if (!this.active) break;
        speed = (this.form === 1 ? (dist > 16 ? 3.3 : 2.45) : dist > 12 ? 4.2 : 3.1) * this.pace;
        this.repath -= dt;
        const los = dist < 9 && ctx.physics.lineOfSight(this.pos.clone().setY(this.pos.y + 1), p.pos.clone().setY(p.pos.y + 1));
        if (los) {
          this.path = [p.pos.clone()];
          this.pathIdx = 0;
        } else if (!this.path || this.repath <= 0) {
          this.path = ctx.level!.nav.findPath(this.pos, p.pos, 4000);
          this.pathIdx = 0;
          this.repath = 0.5;
        }
        if (los) face = toP;
        if (this.attackCd <= 0 && !p.dead) {
          if (this.form === 1 && dist < 2.4) this.setState('punch');
          else if (this.form === 2) {
            if (dist < 2.6) this.setState('slash');
            else if (los && dist > 5 && dist < 13 && Math.random() < 0.012) {
              this.setState('roar');
              ctx.audio.play('bossRoar', { pos: this.headPos(), vol: 1 });
            } else if (dist > 4 && dist < 11 && Math.random() < 0.006 && ctx.physics.lineOfSight(this.headPos(), p.camera.position)) {
              this.leapFrom.copy(this.pos);
              this.leapTo.copy(p.pos);
              this.setState('leap');
              ctx.audio.play('whoosh', { pos: this.pos, vol: 1, rate: 0.6 });
            }
          }
        }
        if (this.form === 1 && this.roarCd <= 0 && dist < 14 && Math.random() < dt * 0.05) {
          this.roarCd = 12;
          ctx.audio.play('bossRoar', { pos: this.headPos(), vol: 0.9 });
        }
        break;
      }
      case 'punch': {
        face = toP;
        if (!this.hitDone && this.stateT > 0.62) {
          this.hitDone = true;
          ctx.audio.play('whoosh', { pos: this.pos, vol: 1, rate: 0.7 });
          if (dist < 2.6 && Math.abs(angleDiff(this.yaw, toP)) < 1) {
            p.damage(30, this.pos);
            p.vel.add(new THREE.Vector3(Math.sin(this.yaw), 0.25, Math.cos(this.yaw)).multiplyScalar(9));
            p.shake = 1.4;
            ctx.audio.play('bossImpact', { pos: p.camera.position, vol: 0.9 });
          }
        }
        if (this.stateT > 1.25) {
          this.attackCd = 1.4;
          this.setState('stalk');
        }
        break;
      }
      case 'slash': {
        face = toP;
        if (!this.hitDone && this.stateT > 0.48) {
          this.hitDone = true;
          ctx.audio.play('whoosh', { pos: this.pos, vol: 1, rate: 0.9 });
          if (dist < 3 && Math.abs(angleDiff(this.yaw, toP)) < 1.2) {
            p.damage(34, this.pos);
            p.shake = 1;
            ctx.particles.blood(p.camera.position.clone().add(p.forward.multiplyScalar(0.3)), V3(0, 0.5, 0), 14);
          }
        }
        if (this.stateT > 1.0) {
          this.attackCd = 1.1;
          this.setState('stalk');
        }
        break;
      }
      case 'roar':
        face = toP;
        if (this.stateT > 0.9) {
          this.chargeDir.set(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z).normalize();
          this.yaw = Math.atan2(this.chargeDir.x, this.chargeDir.z);
          this.setState('charge');
        }
        break;
      case 'charge': {
        this.vel.copy(this.chargeDir).multiplyScalar(11);
        if (!this.hitDone && dist < 1.6) {
          this.hitDone = true;
          p.damage(40, this.pos);
          p.vel.add(this.chargeDir.clone().multiplyScalar(12).setY(3));
          p.shake = 1.5;
          ctx.audio.play('bossImpact', { pos: p.camera.position, vol: 1 });
        }
        if (this.stateT > 1.7) {
          this.attackCd = 1.5;
          this.setState('stalk');
        }
        break;
      }
      case 'stunned':
        if (this.stateT > 2.4) {
          this.attackCd = 0.8;
          this.setState('stalk');
        }
        break;
      case 'shocked':
        if (Math.random() < 0.5) ctx.particles.electric(this.partPos('torso').add(V3(rand(-0.4, 0.4), rand(-0.6, 0.6), rand(-0.4, 0.4))), 4);
        this.flashT = Math.sin(this.stateT * 40) > 0 ? 0.05 : 0;
        if (this.stateT > 2.6) {
          if (this.hp <= 0) this.setState('defeated');
          else this.setState(this.pos.y < ground - 0.5 || this.inPit() ? 'climb' : 'stalk');
        }
        break;
      case 'stagger':
        this.vel.multiplyScalar(Math.exp(-5 * dt));
        if (this.stateT > (this.form === 1 ? 1.5 : 1.1)) {
          this.attackCd = 0.6;
          this.setState('stalk');
        }
        break;
      case 'leap': {
        const k = clamp(this.stateT / 1.0, 0, 1);
        if (this.stateT < 0.25) face = toP;
        else {
          this.pos.lerpVectors(this.leapFrom, this.leapTo, smoothstep(0.25, 1, this.stateT));
          this.pos.y += Math.sin(clamp((this.stateT - 0.25) / 0.75, 0, 1) * Math.PI) * 2.6;
          this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + 1.2, z: this.pos.z });
        }
        if (k >= 1 && !this.hitDone) {
          this.hitDone = true;
          ctx.audio.play('bossImpact', { pos: this.pos, vol: 1 });
          ctx.particles.dust(this.pos.clone().setY(this.pos.y + 0.1), V3(0, 1, 0), 0x6a645a);
          const d = this.pos.distanceTo(p.pos);
          p.shake = Math.max(p.shake, 1.3 - d / 10);
          if (d < 3.2) {
            p.damage(28, this.pos);
            p.vel.add(p.pos.clone().sub(this.pos).setY(0).normalize().multiplyScalar(7).setY(2));
          }
          ctx.props.blast(this.pos, 4, 10);
        }
        if (this.stateT > 1.6) {
          this.attackCd = 1.4;
          this.setState('stalk');
        }
        this.sync(dt);
        return;
      }
      case 'climb': {
        // haul itself back up out of a pit towards the nearest walkable high cell
        if (this.stateT > 1.6) {
          const lvl = ctx.level!;
          const [cx, cz] = lvl.nav.cellOf(p.pos);
          const c = lvl.nav.nearestWalkable(cx, cz, 6);
          if (c) {
            const target = lvl.nav.center(c[0], c[1]);
            const dir = target.clone().sub(this.pos).setY(0).normalize();
            const exit = this.pos.clone().addScaledVector(dir, 1.8);
            exit.y = lvl.nav.heightAt(exit);
            this.leapFrom.copy(this.pos);
            this.leapTo.copy(exit);
            this.setState('leap');
            this.hitDone = true;
          } else this.setState('stalk');
        }
        break;
      }
      case 'defeated':
        this.vel.multiplyScalar(Math.exp(-4 * dt));
        break;
    }
    // ---- movement ----
    if (this.state === 'stalk' && speed > 0 && this.path) {
      const wp = this.path[Math.min(this.pathIdx, this.path.length - 1)];
      const to = _a.set(wp.x - this.pos.x, 0, wp.z - this.pos.z);
      if (to.length() < 0.5 && this.pathIdx < this.path.length - 1) this.pathIdx++;
      const want = Math.atan2(to.x, to.z);
      this.yaw += clamp(angleDiff(this.yaw, want), -2.5 * dt, 2.5 * dt);
      const fw = V3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(speed);
      this.vel.x = damp(this.vel.x, fw.x, 4, dt);
      this.vel.z = damp(this.vel.z, fw.z, 4, dt);
    } else if (this.state !== 'charge' && this.state !== 'stagger') {
      this.vel.x = damp(this.vel.x, 0, 6, dt);
      this.vel.z = damp(this.vel.z, 0, 6, dt);
    }
    if (this.state === 'stagger' && this.stateT < 0.05) this.vel.copy(V3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(2));
    if (face !== null) this.yaw += clamp(angleDiff(this.yaw, face), -3 * dt, 3 * dt);
    // doors in the way get smashed off their hinges
    if (this.active && (this.state === 'stalk' || this.state === 'charge'))
      for (const door of ctx.level!.doors) {
        if (door.broken || door.angle > 1.2) continue;
        const dd = door.center.clone().setY(this.pos.y).distanceTo(this.pos);
        if (dd < 1.7) {
          door.blast(V3(Math.sin(this.yaw), 0, Math.cos(this.yaw)));
          ctx.player.shake = Math.max(ctx.player.shake, 0.6);
        }
      }
    this.move(dt);
    this.sync(dt);
  }

  /** cells with floor below this height count as a pit (subway tracks) */
  pitBelow = -Infinity;
  inPit() {
    const c = ctx.level!.cellAt(this.pos);
    return !!c && c.t === 'floor' && c.fy < this.pitBelow;
  }

  private move(dt: number) {
    const kcc = ctx.enemies.kcc;
    if (this.grounded) this.vy = -1;
    else this.vy -= 18 * dt;
    const desired = { x: this.vel.x * dt, y: this.vy * dt, z: this.vel.z * dt };
    kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G.STATIC | G.PROP | G.PLAYER));
    const mv = kcc.computedMovement();
    this.grounded = kcc.computedGrounded();
    // charging into a wall stuns it
    if (this.state === 'charge' && this.stateT > 0.15 && Math.hypot(mv.x, mv.z) < Math.hypot(desired.x, desired.z) * 0.35) {
      this.setState('stunned');
      ctx.audio.play('bossImpact', { pos: this.pos, vol: 1 });
      ctx.player.shake = Math.max(ctx.player.shake, 0.9);
      ctx.particles.dust(this.headPos(), V3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), 0x8a857a);
    }
    const t = this.body.translation();
    const n = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(n);
    this.pos.set(n.x, n.y - 0.75 - 0.45, n.z);
  }

  warp(p: THREE.Vector3, yaw?: number) {
    this.pos.copy(p);
    if (yaw !== undefined) this.yaw = yaw;
    this.body.setTranslation({ x: p.x, y: p.y + 1.2, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + 1.2, z: p.z });
    this.vel.set(0, 0, 0);
    this.sync(0);
  }

  /** Scripted leap between two points (entrances). */
  leapFromTo(a: THREE.Vector3, b: THREE.Vector3) {
    this.warp(a, Math.atan2(b.x - a.x, b.z - a.z));
    this.leapFrom.copy(a);
    this.leapTo.copy(b);
    this.setState('leap');
    this.stateT = 0.25;
    this.hitDone = false;
  }

  /** Scripted walk without AI (entrances). */
  walkToward(target: THREE.Vector3, speed: number, dt: number) {
    const to = target.clone().sub(this.pos).setY(0);
    if (to.length() < 0.3) {
      this.vel.set(0, 0, 0);
      return true;
    }
    this.yaw += clamp(angleDiff(this.yaw, Math.atan2(to.x, to.z)), -3 * dt, 3 * dt);
    this.vel.copy(to.normalize().multiplyScalar(speed));
    return false;
  }

  // ------------------------------------------------------------------ animation
  private sync(dt: number) {
    const r = this.rig;
    const S = r.segs;
    r.root.position.copy(this.pos);
    r.root.rotation.set(0, this.yaw, 0);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const charging = this.state === 'charge';
    this.phase += dt * hs * (charging ? 1.3 : 2.1);
    for (const k of Object.keys(S) as Part[]) {
      S[k].sx.update(0, dt);
      S[k].sz.update(0, dt);
    }
    // heavy footsteps
    const step = Math.floor(this.phase / Math.PI);
    if (step !== this.lastStep && hs > 0.5) {
      this.lastStep = step;
      ctx.audio.play('bossStep', { pos: this.pos, vol: 1, ref: 4, rolloff: 0.8, occlude: true });
      const d = this.pos.distanceTo(ctx.player.pos);
      if (d < 14) ctx.player.shake = Math.max(ctx.player.shake, (1 - d / 14) * 0.55);
    }
    const amp = clamp(hs / 3, 0, 1) * (charging ? 0.9 : 0.55);
    const sw = Math.sin(this.phase) * amp;
    const t = ctx.time;
    r.hips.position.y = 0.92 * 1.32 - Math.abs(Math.sin(this.phase)) * 0.05 * amp;
    S.legL.pivot.rotation.set(sw + S.legL.sx.value, 0, 0);
    S.legR.pivot.rotation.set(-sw + S.legR.sx.value, 0, 0);
    S.legL.joint!.rotation.x = Math.max(0, -Math.sin(this.phase + 0.5)) * amp * 1.4;
    S.legR.joint!.rotation.x = Math.max(0, Math.sin(this.phase + 0.5)) * amp * 1.4;
    let lean = 0.08 + (charging ? 0.55 : 0);
    let aL = -sw * 0.5, aR = sw * 0.5, zL = -0.12, zR = 0.12, eL = 0.25, eR = 0.25;
    let headX = 0;
    let twist = Math.sin(this.phase) * 0.06;
    const k = this.stateT;
    switch (this.state) {
      case 'punch': {
        const wind = smoothstep(0, 0.55, k), hit = smoothstep(0.55, 0.7, k), back = smoothstep(0.85, 1.25, k);
        aR = -0.3 - 1.2 * wind * (1 - hit) - 1.6 * hit * (1 - back);
        zR = 0.4 * wind * (1 - hit);
        eR = 1.6 * wind * (1 - hit) + 0.1;
        twist = -0.5 * wind * (1 - hit) + 0.4 * hit * (1 - back);
        lean += 0.25 * hit * (1 - back);
        break;
      }
      case 'slash': {
        const wind = smoothstep(0, 0.45, k), hit = smoothstep(0.45, 0.6, k), back = smoothstep(0.7, 1, k);
        aR = -1.4 * (wind + hit) * (1 - back);
        zR = 1.2 * wind * (1 - hit) - 0.9 * hit * (1 - back);
        twist = -0.7 * wind * (1 - hit) + 0.7 * hit * (1 - back);
        eR = 0.1;
        break;
      }
      case 'roar':
        lean = -0.25;
        headX = -0.5;
        aL = -0.4;
        aR = -0.4;
        zL = -0.8;
        zR = 0.8;
        twist = Math.sin(t * 30) * 0.03;
        break;
      case 'charge':
        aL = 0.6;
        aR = 0.6;
        headX = 0.4;
        break;
      case 'stunned':
        lean = -0.2 + Math.sin(t * 2) * 0.05;
        aL = 0.1;
        aR = 0.1;
        headX = 0.6;
        r.hips.position.y -= 0.15;
        break;
      case 'shocked':
        lean = Math.sin(t * 50) * 0.15;
        aL = -1.2 + Math.sin(t * 37) * 0.4;
        aR = -1.4 + Math.sin(t * 43) * 0.4;
        zL = -1;
        zR = 1;
        headX = -0.6 + Math.sin(t * 47) * 0.2;
        break;
      case 'stagger':
        lean = -0.35 * Math.sin(clamp(k / 1.2, 0, 1) * Math.PI);
        aL = -0.6;
        zL = -0.6;
        break;
      case 'leap': {
        const crouch = k < 0.25 ? k / 0.25 : 0;
        r.hips.position.y -= crouch * 0.4;
        lean = 0.4;
        aL = aR = k < 0.25 ? 0.5 : -2.2;
        if (k > 0.25 && k < 1) {
          S.legL.pivot.rotation.x = -1;
          S.legR.pivot.rotation.x = -0.6;
          S.legL.joint!.rotation.x = 1.2;
          S.legR.joint!.rotation.x = 1.4;
        }
        break;
      }
      case 'climb':
        lean = 0.5;
        aL = aR = -2.6;
        break;
      case 'defeated':
        r.hips.position.y = 0.6;
        S.legL.pivot.rotation.set(-1.5, 0, -0.2);
        S.legR.pivot.rotation.set(-0.3, 0, 0.2);
        S.legL.joint!.rotation.x = 2;
        S.legR.joint!.rotation.x = 1.2;
        lean = 0.9;
        aL = 0.3;
        aR = 0.3;
        headX = 0.6;
        break;
    }
    const breath = Math.sin(t * 1.3) * 0.03;
    S.torso.pivot.rotation.set(lean + breath + S.torso.sx.value, twist, Math.sin(this.phase * 0.5) * 0.04 + S.torso.sz.value);
    S.armL.pivot.rotation.set(aL + S.armL.sx.value, 0, zL + S.armL.sz.value);
    S.armR.pivot.rotation.set(aR + S.armR.sx.value, 0, zR + S.armR.sz.value);
    S.armL.joint!.rotation.x = -eL;
    S.armR.joint!.rotation.x = -eR;
    S.head.pivot.rotation.set(headX - lean * 0.3 + S.head.sx.value, 0, Math.sin(t * 0.4) * 0.05);
    if (this.coatTail) {
      this.coatTail.rotation.x = -Math.abs(Math.sin(this.phase)) * 0.25 * amp - (charging ? 0.5 : 0) + Math.sin(t * 1.7) * 0.03;
    }
    if (this.blade) this.blade.rotation.z = Math.sin(t * 3) * 0.02;
  }

  remove() {
    ctx.physics.removeBody(this.body);
    this.rig.root.removeFromParent();
    ctx.enemies.removeBoss(this);
    this.dead = true;
    ctx.director.stalkerNear = 0;
  }
}

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
