import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { RAPIER, GROUPS, groups, G } from '../physics/world';
import { ENEMIES, DIFFICULTY, type EnemyDef, type WeaponId } from '../config';
import { humanoid, quadruped, segEnds, type Rig, type Part } from './rig';
import { Ragdoll } from '../physics/ragdoll';
import { angleDiff, clamp, damp, rand, rayCapsule, raySphere, pick, smoothstep, lerp } from '../core/math';
import { bus } from '../core/events';

export type EnemyKind = 'infected' | 'runner' | 'dog' | 'crawler';
export type EState = 'idle' | 'feed' | 'wander' | 'dormant' | 'rise' | 'investigate' | 'chase' | 'attack' | 'grab' | 'stagger' | 'downed' | 'lunge' | 'flee' | 'drop' | 'climb' | 'dead';

export interface SpawnOpts {
  yaw?: number;
  state?: 'idle' | 'wander' | 'dormant' | 'chase' | 'ceiling' | 'feed';
  id?: string;
  wakeDist?: number;
  police?: boolean;
  doctor?: boolean;
  hpMul?: number;
  onDeath?: (e: Enemy) => void;
  /** stays dormant until woken by script */
  scripted?: boolean;
}

export interface HitResult {
  killed: boolean;
  headshot: boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

let seedCounter = 1;

export class Enemy {
  readonly rig: Rig;
  readonly def: EnemyDef;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  readonly pos = new THREE.Vector3();
  yaw: number;
  readonly vel = new THREE.Vector3();
  vy = 0;
  hp: number;
  maxHp: number;
  state: EState = 'idle';
  stateT = 0;
  private path: THREE.Vector3[] | null = null;
  private pathIdx = 0;
  private repathT = 0;
  private target = new THREE.Vector3();
  readonly lastSeen = new THREE.Vector3();
  private lastSeenT = 99;
  aware = false;
  private attackCd = 0;
  private attackHit = false;
  private phase = Math.random() * 10;
  private voiceCd = rand(2, 8);
  private visionT = Math.random() * 0.2;
  downed = false;
  dead = false;
  ragdoll: Ragdoll | null = null;
  headGone = false;
  onCeiling = false;
  private ceilingY = 3;
  private riseT = 0;
  private wakeDist: number;
  scripted: boolean;
  private home = new THREE.Vector3();
  private limp = Math.random() < 0.4 ? rand(0.2, 0.5) : 0;
  private armPose = Math.random();
  private flankSign = Math.random() < 0.5 ? -1 : 1;
  private stuckT = 0;
  private lastPos = new THREE.Vector3();
  private grounded = true;
  private knock = new THREE.Vector3();
  private lightFear = 0;
  private hitFlash = 0;
  deathTime = 0;
  readonly id: string;

  constructor(readonly kind: EnemyKind, pos: THREE.Vector3, readonly opts: SpawnOpts = {}) {
    this.def = ENEMIES[kind];
    this.id = opts.id ?? `e${seedCounter}`;
    const seed = seedCounter++ * 7919;
    this.rig =
      kind === 'dog'
        ? quadruped(seed)
        : kind === 'crawler'
          ? humanoid(seed, { thin: true, long: 1.35, scale: 1.05 })
          : humanoid(seed, { police: opts.police, doctor: opts.doctor, scale: kind === 'runner' ? rand(0.98, 1.06) : undefined });
    if (kind === 'crawler') {
      for (const m of this.rig.mats) (m as THREE.MeshStandardMaterial).color?.multiplyScalar(0.55);
    }
    ctx.enemies.group.add(this.rig.root);
    const mul = DIFFICULTY[ctx.difficulty].enemyHp * (opts.hpMul ?? 1);
    this.hp = this.maxHp = this.def.hp * mul;
    this.yaw = opts.yaw ?? Math.random() * Math.PI * 2;
    this.pos.copy(pos);
    this.home.copy(pos);
    this.wakeDist = opts.wakeDist ?? 3.2;
    this.scripted = !!opts.scripted;
    const r = kind === 'dog' ? 0.28 : 0.3;
    const halfH = kind === 'dog' ? 0.12 : 0.55;
    const world = ctx.physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + halfH + r, pos.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfH, r).setCollisionGroups(GROUPS.enemy), this.body);
    ctx.physics.tag(this.collider, { kind: 'enemy', owner: this });
    ctx.physics.track(this.body);
    const st = opts.state ?? 'idle';
    if (st === 'dormant') this.setState('dormant');
    else if (st === 'ceiling') {
      this.onCeiling = true;
      this.setState('idle');
    } else if (st === 'chase') {
      this.aware = true;
      this.lastSeen.copy(ctx.player.pos);
      this.lastSeenT = 0;
      this.setState('chase');
    } else this.setState(st);
    this.lastPos.copy(pos);
    this.syncRig(0);
  }

  get capsuleHalf() {
    return this.kind === 'dog' ? 0.12 : 0.55;
  }

  headPos() {
    const h = this.rig.segs.head;
    h.pivot.updateWorldMatrix(true, false);
    return h.pivot.localToWorld(h.center.clone());
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  setState(s: EState) {
    this.state = s;
    this.stateT = 0;
    this.attackHit = false;
    if (s === 'dormant') this.collider.setEnabled(false);
    else if (!this.dead) this.collider.setEnabled(!this.onCeiling);
  }

  // --------------------------------------------------------- perception
  canSee(): boolean {
    const p = ctx.player;
    if (p.dead) return false;
    const head = this.onCeiling ? this.pos.clone().add(new THREE.Vector3(0, -0.4, 0)) : this.headPos();
    const eye = p.camera.position;
    const to = _a.copy(eye).sub(head);
    const dist = to.length();
    let range = this.def.sightRange;
    if (p.flashOn && p.battery > 0) range *= 1.35;
    if (p.crouching) range *= 0.6;
    const dark = !(p.flashOn && p.battery > 0);
    if (dark) range *= 0.75;
    if (dist > range) return false;
    const ang = Math.abs(angleDiff(this.yaw, Math.atan2(to.x, to.z)));
    const close = dist < (p.crouching ? 1.6 : 2.6);
    if (!close && ang > this.def.fov) return false;
    return ctx.physics.lineOfSight(head, eye);
  }

  hear(pos: THREE.Vector3, radius: number, source: string) {
    if (this.dead || this.state === 'dormant' || this.state === 'rise') return;
    const d = pos.distanceTo(this.pos);
    if (d > radius * this.def.hearMul) return;
    if (this.state === 'chase' || this.state === 'attack' || this.state === 'grab' || this.state === 'lunge' || this.state === 'stagger' || this.state === 'drop') return;
    if (this.state === 'feed') {
      if (d < radius * 0.6) this.alert(pos);
      return;
    }
    if (source === 'player' && d < radius * 0.35) {
      this.alert(pos);
      return;
    }
    this.target.copy(pos);
    this.path = null;
    if (this.state !== 'downed') this.setState('investigate');
    this.voice(0.5);
  }

  alert(at?: THREE.Vector3) {
    if (this.dead) return;
    const first = !this.aware;
    this.aware = true;
    this.lastSeen.copy(at ?? ctx.player.pos);
    this.lastSeenT = 0;
    if (this.state === 'dormant') {
      this.setState('rise');
      return;
    }
    if (this.state === 'downed' || this.state === 'rise' || this.state === 'drop' || this.state === 'climb') return;
    if (this.state !== 'attack' && this.state !== 'grab' && this.state !== 'lunge' && this.state !== 'stagger') this.setState('chase');
    if (first) this.voice(1, this.kind === 'runner' ? 'scream' : undefined);
  }

  wake() {
    if (this.state === 'dormant') this.setState('rise');
    this.scripted = false;
  }

  private voice(vol = 0.8, name?: string) {
    if (this.voiceCd > 0 && !name) return;
    const n = name ?? (this.kind === 'dog' ? (this.state === 'chase' ? 'bark' : 'dogGrowl') : this.kind === 'crawler' ? pick(['hiss', 'skitter']) : this.state === 'chase' ? pick(['groan', 'growl']) : 'groan');
    ctx.audio.play(n, { pos: this.headPos(), vol, rateVar: 0.12 });
    this.voiceCd = rand(3, 7);
  }

  // --------------------------------------------------------- hit testing
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxD: number, pad = 0): { dist: number; part: Part } | null {
    if (this.dead) return null;
    // broad phase
    const c = this.rig.hips.getWorldPosition(_c);
    if (raySphere(o, d, c, this.kind === 'dog' ? 1.0 : 1.6) < 0) return null;
    let best: { dist: number; part: Part } | null = null;
    for (const part of ['head', 'torso', 'armL', 'armR', 'legL', 'legR'] as Part[]) {
      if (part === 'head' && this.headGone) continue;
      const sg = this.rig.segs[part];
      segEnds(sg, _a, _b);
      const t = part === 'head' ? raySphere(o, d, _a, sg.radius + pad) : rayCapsule(o, d, _a, _b, sg.radius + pad);
      if (t >= 0 && t <= maxD && (!best || t < best.dist)) best = { dist: t, part };
    }
    return best;
  }

  /** Approximate centre of a part in world space. */
  partPos(part: Part) {
    const sg = this.rig.segs[part];
    segEnds(sg, _a, _b);
    return _a.clone().add(_b).multiplyScalar(0.5);
  }

  damage(amount: number, part: Part, point: THREE.Vector3, dir: THREE.Vector3, knockback: number, weapon: WeaponId | 'blast' | 'boss'): HitResult {
    if (this.dead) return { killed: false, headshot: false };
    const d = this.def;
    const mul = part === 'head' ? d.headMul : part === 'legL' || part === 'legR' ? d.legMul : part === 'torso' ? 1 : 0.8;
    let dmg = amount * mul;
    if (this.state === 'dormant' || this.state === 'downed') dmg *= 1.2;
    this.hp -= dmg;
    this.hitFlash = 0.1;
    // local physical reaction on the hit segment
    const sg = this.rig.segs[part];
    const local = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    const k = clamp(dmg / 30, 0.3, 2.2) * (1 + knockback);
    sg.sx.kick(local.z * 9 * k);
    sg.sz.kick(-local.x * 9 * k);
    this.rig.segs.torso.sx.kick(local.z * 3 * k);
    // blood
    const floorY = this.pos.y;
    ctx.particles.blood(point, dir.clone().negate().add(new THREE.Vector3(0, 0.3, 0)), part === 'head' ? 10 : 7, floorY);
    ctx.particles.blood(point, dir, 6, floorY);
    if (Math.random() < 0.35) ctx.decals.add('blood', new THREE.Vector3(point.x + rand(-0.4, 0.4), floorY + 0.01, point.z + rand(-0.4, 0.4)), new THREE.Vector3(0, 1, 0), rand(0.4, 0.9), 120);
    ctx.audio.play(part === 'head' && this.hp <= 0 ? 'headshot' : 'impactFlesh', { pos: point, vol: 0.9 });
    const headshot = part === 'head';
    if (this.hp <= 0) {
      this.die(part, point, dir, knockback, weapon);
      return { killed: true, headshot };
    }
    // reactions
    this.alert(ctx.player.pos);
    if (this.state === 'dormant' || this.state === 'rise') return { killed: false, headshot };
    if (this.onCeiling && dmg > 25) {
      this.dropFromCeiling();
      return { killed: false, headshot };
    }
    if (this.kind === 'runner' && (part === 'legL' || part === 'legR') && !this.downed && Math.random() < 0.65) {
      this.knockDown(dir);
      return { killed: false, headshot };
    }
    const stagger = knockback * (part === 'head' ? 1.6 : 1) * rand(0.6, 1.3);
    if (this.state === 'grab' && dmg > 20) {
      ctx.player.release(true);
    }
    if ((stagger > 0.55 || dmg > 60) && this.state !== 'downed') {
      this.knock.copy(dir).setY(0).normalize().multiplyScalar(knockback * 2.4);
      this.setState('stagger');
      if (this.kind === 'infected' && knockback > 1 && Math.random() < 0.4) this.knockDown(dir);
    }
    return { killed: false, headshot };
  }

  private knockDown(dir: THREE.Vector3) {
    this.downed = true;
    this.knock.copy(dir).setY(0).normalize().multiplyScalar(2);
    this.setState('downed');
    ctx.audio.play('bodyFall', { pos: this.pos, vol: 0.8 });
  }

  die(part: Part, point: THREE.Vector3, dir: THREE.Vector3, knockback: number, weapon: WeaponId | 'blast' | 'boss') {
    if (this.dead) return;
    this.dead = true;
    this.state = 'dead';
    this.deathTime = ctx.time;
    if (ctx.player.grabbedBy === this) ctx.player.release(true);
    this.collider.setEnabled(false);
    const headshot = part === 'head';
    if (headshot && (weapon !== 'knife' || Math.random() < 0.3)) {
      this.headGone = true;
      const hp = this.headPos();
      this.rig.headMesh.visible = false;
      ctx.particles.gore(hp, dir.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize(), this.pos.y);
      ctx.audio.play('headshot', { pos: hp, vol: 1 });
      for (let i = 0; i < 2; i++) ctx.decals.add('blood', new THREE.Vector3(hp.x + rand(-0.8, 0.8) + dir.x, this.pos.y + 0.01, hp.z + rand(-0.8, 0.8) + dir.z), new THREE.Vector3(0, 1, 0), rand(0.7, 1.4), 180);
    } else {
      ctx.audio.play(this.kind === 'dog' ? 'bark' : 'zombieDeath', { pos: this.headPos(), vol: 0.8, rate: 0.8 });
    }
    // ragdoll
    const include: Part[] = ['torso', 'armL', 'armR', 'legL', 'legR'];
    if (!this.headGone) include.push('head');
    const v = this.vel.clone();
    v.y = this.vy;
    const imp = weapon === 'shotgun' ? knockback * 26 : weapon === 'magnum' ? 22 : weapon === 'blast' ? 30 : 7 + knockback * 8;
    this.ragdoll = new Ragdoll(this.rig, include, v, { point, dir, impulse: imp, part }, this.kind === 'dog');
    if (weapon === 'shotgun' && knockback > 0.6) this.ragdoll.push(dir.clone().setY(0.35).multiplyScalar(knockback * 2.2));
    if (weapon === 'blast') this.ragdoll.push(dir.clone().setY(0.6).multiplyScalar(6));
    this.rig.root.visible = false; // remaining root (hips) empty
    ctx.enemies.onDeath(this, headshot);
    bus.emit('enemyKilled', { kind: this.kind, headshot });
    this.opts.onDeath?.(this);
  }

  /** Becomes a falling corpse without counting as a kill (scripted scares). */
  corpseDrop(vel: THREE.Vector3) {
    if (this.dead) return;
    this.dead = true;
    this.state = 'dead';
    this.collider.setEnabled(false);
    this.ragdoll = new Ragdoll(this.rig, ['torso', 'head', 'armL', 'armR', 'legL', 'legR'], vel, null);
    this.rig.root.visible = false;
    ctx.enemies.onDeath(this, false, false);
  }

  onGrabEnd(escaped: boolean) {
    if (this.dead) return;
    if (escaped) {
      this.knock.copy(this.forward()).multiplyScalar(-2.5);
      this.setState('stagger');
      this.stateT = -0.4;
    } else this.setState('chase');
    this.attackCd = this.def.attackCooldown * 1.5;
  }

  // --------------------------------------------------------- update
  update(dt: number) {
    if (this.dead) {
      this.ragdoll?.update(dt);
      return;
    }
    const p = ctx.player;
    this.stateT += dt;
    this.voiceCd -= dt;
    this.attackCd -= dt;
    this.lastSeenT += dt;
    this.hitFlash -= dt;
    const distP = this.pos.distanceTo(p.pos);
    // far away & unaware: sleep
    if (distP > 45 && !this.aware) {
      this.syncRig(dt);
      return;
    }
    // vision tick
    this.visionT -= dt;
    if (this.visionT <= 0 && this.state !== 'dormant') {
      this.visionT = 0.2;
      if (this.canSee()) {
        if (this.state !== 'feed' && (!this.aware || this.state === 'idle' || this.state === 'wander' || this.state === 'investigate')) this.alert(p.pos);
        this.lastSeen.copy(p.pos);
        this.lastSeenT = 0;
      }
      // crawlers fear the flashlight
      if (this.kind === 'crawler' && p.flashOn && p.battery > 0 && distP < 11 && this.state !== 'flee' && this.state !== 'drop') {
        const to = this.pos.clone().add(new THREE.Vector3(0, this.onCeiling ? -0.3 : 0.4, 0)).sub(p.camera.position);
        const ang = to.normalize().angleTo(p.forward);
        if (ang < 0.32) {
          this.lightFear += 0.2;
          if (this.lightFear > 0.6) {
            this.lightFear = 0;
            ctx.audio.play('screech', { pos: this.pos, vol: 1 });
            this.setState('flee');
          }
        } else this.lightFear = Math.max(0, this.lightFear - 0.1);
      }
    }
    if (this.state === 'dormant') {
      if (!this.scripted && distP < this.wakeDist) this.setState('rise');
      this.syncRig(dt);
      return;
    }
    // ---------------- behaviour ----------------
    let speed = 0;
    let face: number | null = null;
    const d = this.def;
    switch (this.state) {
      case 'rise':
        this.riseT = smoothstep(0, 1.6, this.stateT);
        if (this.stateT > 1.7) {
          this.riseT = 1;
          this.aware = true;
          this.setState('chase');
          this.voice(1, 'growl');
        }
        break;
      case 'feed':
        if (distP < 4.5 || (distP < 9 && this.lastSeenT < 0.25 && this.stateT > 1)) this.alert(p.pos);
        if (Math.random() < dt * 0.5) ctx.audio.play('squelch', { pos: this.headPos(), vol: 0.5 });
        break;
      case 'idle':
        this.collider.setEnabled(!this.onCeiling);
        if (this.stateT > rand(4, 10)) this.setState(Math.random() < 0.6 ? 'wander' : 'idle');
        if (Math.random() < dt * 0.15) this.voice(0.6);
        break;
      case 'wander': {
        if (!this.path) {
          const t = this.home.clone().add(new THREE.Vector3(rand(-5, 5), 0, rand(-5, 5)));
          this.path = ctx.level!.nav.findPath(this.pos, t, 600);
          this.pathIdx = 0;
          if (!this.path) this.setState('idle');
        }
        speed = d.walk * 0.7;
        if (this.followPath()) {
          this.path = null;
          this.setState('idle');
        }
        break;
      }
      case 'investigate': {
        if (!this.path || this.repathT <= 0) {
          this.path = ctx.level!.nav.findPath(this.pos, this.target, 1500);
          this.pathIdx = 0;
          this.repathT = 2;
        }
        this.repathT -= dt;
        speed = d.walk * 1.3;
        if (!this.path || this.followPath() || this.stateT > 15) {
          this.path = null;
          this.setState('idle');
        }
        break;
      }
      case 'chase': {
        const see = this.lastSeenT < 0.3;
        const goal = see ? p.pos : this.lastSeen;
        if (this.lastSeenT > 8 && !this.onCeiling) {
          this.aware = false;
          this.target.copy(this.lastSeen);
          this.setState('investigate');
          break;
        }
        let tgt = goal.clone();
        if (this.kind === 'dog' && distP > 2.6 && distP < 9) {
          // flank: circle around the player
          const ang = Math.atan2(this.pos.x - p.pos.x, this.pos.z - p.pos.z) + this.flankSign * 0.9;
          tgt = p.pos.clone().add(new THREE.Vector3(Math.sin(ang) * 2.4, 0, Math.cos(ang) * 2.4));
          if (Math.random() < dt * 0.3) this.flankSign *= -1;
        }
        this.repathT -= dt;
        const direct = see && distP < 6 && !this.onCeiling && ctx.physics.lineOfSight(this.pos.clone().setY(this.pos.y + 0.5), p.pos.clone().setY(p.pos.y + 0.5));
        if (direct && this.kind !== 'dog') {
          this.path = [tgt];
          this.pathIdx = 0;
        } else if (!this.path || this.repathT <= 0) {
          this.path = ctx.level!.nav.findPath(this.pos, tgt, 2500);
          this.pathIdx = 0;
          this.repathT = 0.4 + Math.random() * 0.2;
        }
        speed = d.chase * (this.kind === 'infected' ? 1 - this.limp * 0.4 : 1);
        if (this.path) this.followPath();
        if (see) face = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        if (Math.random() < dt * 0.4) this.voice(0.9);
        // attacks
        if (this.attackCd <= 0 && see && !p.dead) {
          if (this.onCeiling) {
            const horiz = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
            if (horiz < 2.2) this.dropFromCeiling();
          } else if (this.kind === 'runner' && distP < 4.5 && distP > 1.8) {
            this.setState('lunge');
            this.voice(1, 'scream');
          } else if (distP < d.attackRange) {
            this.setState('attack');
          }
        }
        break;
      }
      case 'attack': {
        face = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        const wind = this.kind === 'dog' ? 0.3 : this.kind === 'crawler' ? 0.35 : 0.5;
        if (!this.attackHit && this.stateT > wind) {
          this.attackHit = true;
          const near = this.pos.distanceTo(p.pos) < d.attackRange + 0.35;
          const facing = Math.abs(angleDiff(this.yaw, Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z))) < 0.9;
          if (near && facing && !p.dead) {
            if (this.kind === 'infected' && !p.grabbedBy && Math.random() < 0.6 && p.grab(this)) {
              this.setState('grab');
              ctx.audio.play('growl', { pos: this.headPos(), vol: 1 });
              break;
            }
            p.damage(d.attackDamage, this.pos);
            ctx.audio.play(this.kind === 'dog' ? 'bite' : 'impactFlesh', { pos: p.camera.position, vol: 0.9 });
          } else ctx.audio.play('whoosh', { pos: this.pos, vol: 0.5 });
        }
        if (this.stateT > wind + 0.55) {
          this.attackCd = d.attackCooldown * rand(0.8, 1.2);
          this.setState('chase');
        }
        break;
      }
      case 'grab': {
        face = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
        // hold position close to the player
        const to = p.pos.clone().sub(this.pos).setY(0);
        const dl = to.length();
        if (dl > 0.95) this.vel.copy(to.normalize().multiplyScalar(1.2));
        else if (dl < 0.8) this.vel.copy(to.normalize().multiplyScalar(-1.2));
        else this.vel.set(0, 0, 0);
        if (p.grabbedBy !== this) this.setState('chase');
        break;
      }
      case 'lunge': {
        if (this.stateT < 0.25) {
          face = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
          speed = 0;
        } else {
          speed = 8.5;
          this.vel.copy(this.forward()).multiplyScalar(speed);
          if (!this.attackHit && distP < 1.3) {
            this.attackHit = true;
            p.damage(d.attackDamage, this.pos);
            p.shake = 1.2;
            ctx.audio.play('bite', { pos: p.camera.position, vol: 1 });
            p.vel.add(this.forward().multiplyScalar(4));
          }
        }
        if (this.stateT > 0.75) {
          this.attackCd = d.attackCooldown;
          this.knock.copy(this.vel).multiplyScalar(0.3);
          this.setState('stagger');
        }
        break;
      }
      case 'stagger': {
        this.vel.copy(this.knock);
        this.knock.multiplyScalar(Math.exp(-6 * dt));
        if (this.stateT > 0.75) this.setState(this.aware ? 'chase' : 'idle');
        break;
      }
      case 'downed': {
        this.knock.multiplyScalar(Math.exp(-5 * dt));
        // crawl towards the player
        const to = p.pos.clone().sub(this.pos).setY(0);
        face = Math.atan2(to.x, to.z);
        speed = this.stateT > 0.8 ? 0.45 : 0;
        if (speed > 0) {
          if (!this.path || this.repathT <= 0) {
            this.path = ctx.level!.nav.findPath(this.pos, p.pos, 1500);
            this.pathIdx = 0;
            this.repathT = 0.8;
          }
          this.repathT -= dt;
          if (this.path) this.followPath();
        }
        this.vel.add(this.knock);
        if (this.attackCd <= 0 && distP < 1.1) {
          p.damage(d.attackDamage * 0.6, this.pos);
          ctx.audio.play('bite', { pos: this.pos, vol: 0.8 });
          this.attackCd = 1.8;
        }
        if (this.kind === 'runner' && this.stateT > 6) {
          this.downed = false;
          this.setState('chase');
        }
        if (this.kind === 'infected' && this.stateT > 4) {
          this.downed = false;
          this.setState('chase');
        }
        break;
      }
      case 'flee': {
        const away = this.pos.clone().sub(p.pos).setY(0).normalize();
        this.vel.copy(away.multiplyScalar(d.chase));
        face = Math.atan2(this.vel.x, this.vel.z);
        if (this.stateT > 2.2) this.setState('chase');
        break;
      }
      case 'drop': {
        this.vy -= 18 * dt;
        this.pos.y += this.vy * dt;
        const fy = ctx.level!.nav.heightAt(this.pos);
        if (this.pos.y <= fy) {
          this.pos.y = fy;
          this.vy = 0;
          this.onCeiling = false;
          this.collider.setEnabled(true);
          const t = this.body.translation();
          this.body.setTranslation({ x: t.x, y: fy + this.capsuleHalf + 0.3, z: t.z }, true);
          ctx.audio.play('land', { pos: this.pos, vol: 0.8 });
          ctx.audio.play('screech', { pos: this.pos, vol: 1 });
          this.attackCd = 0.2;
          this.setState('chase');
        }
        this.syncRig(dt);
        return;
      }
    }
    // ---------------- movement ----------------
    if (this.state !== 'stagger' && this.state !== 'lunge' && this.state !== 'grab' && this.state !== 'flee' && this.state !== 'downed') {
      if (speed > 0 && this.path) {
        const wp = this.path[Math.min(this.pathIdx, this.path.length - 1)];
        const to = _a.set(wp.x - this.pos.x, 0, wp.z - this.pos.z);
        const want = Math.atan2(to.x, to.z);
        const dy = angleDiff(this.yaw, want);
        this.yaw += clamp(dy, -d.turnRate * dt, d.turnRate * dt);
        const align = clamp(1 - Math.abs(dy) / 1.4, 0.25, 1);
        const fw = this.forward(_b).multiplyScalar(speed * align);
        this.vel.x = damp(this.vel.x, fw.x, 6, dt);
        this.vel.z = damp(this.vel.z, fw.z, 6, dt);
      } else {
        this.vel.x = damp(this.vel.x, 0, 8, dt);
        this.vel.z = damp(this.vel.z, 0, 8, dt);
      }
    } else if (this.state === 'downed' && speed > 0 && this.path) {
      const wp = this.path[Math.min(this.pathIdx, this.path.length - 1)];
      const to = _a.set(wp.x - this.pos.x, 0, wp.z - this.pos.z).normalize();
      this.vel.copy(to.multiplyScalar(speed)).add(this.knock);
    }
    if (face !== null && this.state !== 'lunge') {
      const dy = angleDiff(this.yaw, face);
      this.yaw += clamp(dy, -d.turnRate * 1.5 * dt, d.turnRate * 1.5 * dt);
    }
    // separation from other enemies
    for (const o of ctx.enemies.list) {
      if (o === this || o.dead) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const dd = dx * dx + dz * dz;
      if (dd < 0.7 && dd > 1e-4) {
        const f = (0.7 - dd) * 3;
        this.vel.x += (dx / Math.sqrt(dd)) * f;
        this.vel.z += (dz / Math.sqrt(dd)) * f;
      }
    }
    // doors
    if (this.aware || this.state === 'investigate')
      for (const door of ctx.level!.doors) {
        if (door.target === 0 && !door.locked && !door.broken && door.center.distanceTo(this.pos.clone().setY(door.center.y)) < 1.3) door.open(this.pos);
      }
    this.move(dt);
    // stuck detection → repath
    if (speed > 0.3) {
      if (this.pos.distanceTo(this.lastPos) < speed * dt * 0.2) this.stuckT += dt;
      else this.stuckT = 0;
      if (this.stuckT > 1) {
        this.path = null;
        this.repathT = 0;
        this.stuckT = 0;
        this.yaw += rand(-1, 1);
      }
    }
    this.lastPos.copy(this.pos);
    this.syncRig(dt);
  }

  private followPath(): boolean {
    if (!this.path) return true;
    const wp = this.path[this.pathIdx];
    if (!wp) return true;
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    if (dx * dx + dz * dz < 0.35 * 0.35) {
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) return true;
    }
    return false;
  }

  private dropFromCeiling() {
    if (!this.onCeiling) return;
    this.vy = 0;
    this.setState('drop');
    ctx.audio.play('hiss', { pos: this.pos, vol: 1 });
  }

  private move(dt: number) {
    if (this.onCeiling) {
      // glide along the ceiling, following the nav grid footprint
      const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
      const cell = ctx.level!.cellAt(new THREE.Vector3(nx, 0, nz));
      if (cell && cell.t === 'floor' && cell.cy !== null) {
        this.pos.x = nx;
        this.pos.z = nz;
        this.ceilingY = cell.cy;
        this.pos.y = cell.cy - 0.3;
      }
      this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.ceilingY - 0.5, z: this.pos.z });
      return;
    }
    const kcc = ctx.enemies.kcc;
    if (this.grounded) this.vy = -1;
    else this.vy -= 15 * dt;
    const desired = { x: this.vel.x * dt, y: this.vy * dt, z: this.vel.z * dt };
    kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G.STATIC | G.PROP | G.ENEMY | G.PLAYER));
    const mv = kcc.computedMovement();
    this.grounded = kcc.computedGrounded();
    const t = this.body.translation();
    const n = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(n);
    this.pos.set(n.x, n.y - this.capsuleHalf - (this.kind === 'dog' ? 0.28 : 0.3), n.z);
    if (this.pos.y < -20) this.die('torso', this.pos, new THREE.Vector3(0, 1, 0), 0, 'blast');
  }

  // --------------------------------------------------------- animation
  private syncRig(dt: number) {
    const r = this.rig;
    r.root.position.copy(this.pos);
    r.root.rotation.set(0, this.yaw, 0);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.phase += dt * (this.kind === 'dog' ? hs * 3.2 : hs * (this.kind === 'runner' ? 2.4 : 3.4));
    const S = r.segs;
    for (const k of Object.keys(S) as Part[]) {
      const sg = S[k];
      sg.sx.update(0, dt);
      sg.sz.update(0, dt);
    }
    if (this.kind === 'dog') return this.animDog(dt, hs);
    if (this.kind === 'crawler') return this.animCrawler(dt, hs);
    this.animHuman(dt, hs);
  }

  private animHuman(dt: number, hs: number) {
    const r = this.rig;
    const S = r.segs;
    const ph = this.phase;
    const run = this.kind === 'runner' && hs > 2;
    const amp = clamp(hs / (run ? 4 : 1.2), 0, 1) * (run ? 0.85 : 0.42);
    const tt = ctx.time + this.armPose * 10;
    // root pose for lying states
    let lie = 0;
    if (this.state === 'dormant') lie = 1;
    if (this.state === 'rise') lie = 1 - this.riseT;
    r.hips.position.y = 0.92 * (r.height / 1.8);
    r.root.rotation.x = 0;
    if (lie > 0) {
      r.root.rotation.x = -Math.PI / 2 * lie;
      r.root.position.y += 0.12 * lie;
    }
    if (this.state === 'downed') {
      r.root.rotation.x = Math.PI / 2 * 0.92;
      r.root.position.y += 0.15;
    }
    // legs
    const limp = this.limp;
    const swing = Math.sin(ph) * amp;
    S.legL.pivot.rotation.set(swing + S.legL.sx.value, 0, S.legL.sz.value);
    S.legR.pivot.rotation.set(-swing * (1 - limp * 0.6) + S.legR.sx.value, 0, S.legR.sz.value);
    S.legL.joint!.rotation.x = Math.max(0, -Math.sin(ph + 0.6)) * amp * 1.6;
    S.legR.joint!.rotation.x = Math.max(0, Math.sin(ph + 0.6)) * amp * 1.6 * (1 - limp * 0.5);
    // torso
    let lean = this.kind === 'runner' && hs > 2 ? 0.35 : 0.14 + limp * 0.1;
    let twist = Math.sin(ph) * 0.12 * amp * 2;
    let side = Math.sin(ph * 0.5) * 0.08 + limp * 0.08;
    // arms
    let aLx = 0, aRx = 0, aLz = -0.15, aRz = 0.15, eL = 0.3, eR = 0.3;
    const chasing = this.state === 'chase' || this.state === 'investigate' || this.state === 'attack' || this.state === 'grab';
    if (run) {
      aLx = -Math.sin(ph) * 1.0;
      aRx = Math.sin(ph) * 1.0;
      eL = eR = 1.3;
    } else if (chasing && this.kind === 'infected') {
      const reach = this.armPose > 0.3 ? 1 : 0.5;
      aLx = -1.25 * reach + Math.sin(tt * 2.1) * 0.15;
      aRx = -1.15 * reach + Math.sin(tt * 1.7 + 1) * 0.15;
      eL = 0.25;
      eR = 0.35;
    } else {
      aLx = Math.sin(ph) * amp * 0.6 + Math.sin(tt * 0.8) * 0.05;
      aRx = -Math.sin(ph) * amp * 0.6 + Math.sin(tt * 0.9) * 0.05;
      side += Math.sin(tt * 0.6) * 0.05;
    }
    if (this.state === 'attack') {
      const w = this.kind === 'runner' ? 0.4 : 0.5;
      const k = this.stateT < w ? this.stateT / w : 1 - (this.stateT - w) / 0.5;
      aLx = -1.4 - 0.6 * k;
      aRx = -1.4 - 0.6 * k;
      lean += 0.35 * (this.stateT > w ? 1 - (this.stateT - w) * 2 : this.stateT / w);
    }
    if (this.state === 'grab') {
      aLx = -1.45;
      aRx = -1.45;
      aLz = 0.35;
      aRz = -0.35;
      lean = 0.12 + Math.sin(ctx.time * 18) * 0.04;
    }
    if (this.state === 'lunge') {
      aLx = aRx = -1.6;
      lean = 0.6;
    }
    if (this.state === 'stagger') {
      const k = Math.sin(clamp(this.stateT / 0.75, 0, 1) * Math.PI);
      lean -= 0.5 * k;
      aLx += 0.6 * k;
      aRx += 0.4 * k;
      aLz -= 0.5 * k;
      aRz += 0.5 * k;
    }
    if (this.state === 'downed') {
      // crawling: arms reach forward alternately
      const c = ctx.time * 3;
      aLx = -2.6 + Math.sin(c) * 0.5;
      aRx = -2.6 - Math.sin(c) * 0.5;
      eL = 0.2;
      eR = 0.2;
      S.legL.pivot.rotation.x = 0.1 + Math.sin(c) * 0.1;
      S.legR.pivot.rotation.x = 0.1 - Math.sin(c) * 0.1;
      lean = -0.3;
    }
    if (this.state === 'feed') {
      const b = Math.sin(ctx.time * 5 + this.armPose * 3);
      r.hips.position.y = 0.42;
      S.legL.pivot.rotation.set(-1.4, 0, -0.1);
      S.legR.pivot.rotation.set(-0.3, 0, 0.1);
      S.legL.joint!.rotation.x = 2.4;
      S.legR.joint!.rotation.x = 1.9;
      lean = 0.95 + b * 0.06;
      aLx = -0.9 + b * 0.2;
      aRx = -1.1 - b * 0.15;
      eL = 0.9;
      eR = 1.1;
      twist = b * 0.05;
    }
    if (this.state === 'dormant') {
      aLx = 0.1;
      aRx = -0.2;
      aLz = -0.6;
      aRz = 0.9;
      lean = 0;
    }
    if (this.state === 'rise') {
      aLx = -0.8 * this.riseT;
      aRx = -0.6 * this.riseT;
      lean = 0.6 * (1 - this.riseT) + 0.14;
      twist = Math.sin(ctx.time * 9) * 0.1 * (1 - this.riseT);
    }
    S.torso.pivot.rotation.set(lean + S.torso.sx.value, twist, side + S.torso.sz.value);
    S.armL.pivot.rotation.set(aLx + S.armL.sx.value, 0, aLz + S.armL.sz.value);
    S.armR.pivot.rotation.set(aRx + S.armR.sx.value, 0, aRz + S.armR.sz.value);
    S.armL.joint!.rotation.x = -eL;
    S.armR.joint!.rotation.x = -eR;
    // head lolls
    const loll = this.kind === 'infected' ? 0.25 : 0.1;
    S.head.pivot.rotation.set(-lean * 0.5 + Math.sin(ctx.time * 0.7 + this.armPose * 5) * 0.08 + S.head.sx.value, Math.sin(ctx.time * 0.5 + this.armPose) * 0.15, loll * Math.sin(this.armPose * 9) + S.head.sz.value);
    if (this.state === 'feed') S.head.pivot.rotation.x = 0.6 + Math.abs(Math.sin(ctx.time * 5 + this.armPose * 3)) * 0.35;
    void lerp;
  }

  private animDog(dt: number, hs: number) {
    const r = this.rig;
    const S = r.segs;
    const ph = this.phase;
    const amp = clamp(hs / 5, 0, 1);
    const gal = Math.sin(ph) * 0.8 * amp;
    S.armL.pivot.rotation.set(gal + S.armL.sx.value, 0, 0);
    S.armR.pivot.rotation.set(gal * 0.8 + S.armR.sx.value, 0, 0);
    S.legL.pivot.rotation.set(-gal + S.legL.sx.value, 0, 0);
    S.legR.pivot.rotation.set(-gal * 0.8 + S.legR.sx.value, 0, 0);
    for (const k of ['armL', 'armR', 'legL', 'legR'] as Part[]) S[k].joint!.rotation.x = Math.max(0, Math.sin(ph + (k.startsWith('arm') ? 0 : Math.PI))) * 0.6 * amp * (k.startsWith('arm') ? -1 : 1);
    r.hips.position.y = 0.52 + Math.abs(Math.sin(ph)) * 0.06 * amp;
    let pitch = Math.sin(ph) * 0.12 * amp;
    if (this.state === 'attack') pitch -= 0.3 * Math.sin(clamp(this.stateT / 0.5, 0, 1) * Math.PI);
    S.torso.pivot.rotation.set(pitch + S.torso.sx.value, 0, S.torso.sz.value);
    S.head.pivot.rotation.set(-pitch + (this.state === 'attack' ? 0.3 : 0) + S.head.sx.value + Math.sin(ctx.time * 3) * 0.05, Math.sin(ctx.time * 1.3) * 0.1, S.head.sz.value);
    void dt;
  }

  private animCrawler(dt: number, hs: number) {
    const r = this.rig;
    const S = r.segs;
    const ph = this.phase * 1.4;
    const amp = clamp(hs / 3, 0, 1);
    // prone spider pose
    r.hips.position.y = 0.5;
    if (this.onCeiling) {
      r.root.rotation.set(0, this.yaw, Math.PI);
      r.root.position.y = this.ceilingY;
      r.root.rotation.order = 'YXZ';
    } else {
      r.root.rotation.set(0, this.yaw, 0);
    }
    const c = Math.sin(ph) * 0.5 * amp;
    S.torso.pivot.rotation.set(1.35 + S.torso.sx.value, Math.sin(ph) * 0.15 * amp, S.torso.sz.value);
    S.head.pivot.rotation.set(-1.2 + S.head.sx.value + Math.sin(ctx.time * 7) * 0.05, Math.sin(ctx.time * 2.3) * 0.35, 0.3 * Math.sin(ctx.time * 1.1));
    let reach = 0;
    if (this.state === 'attack') reach = Math.sin(clamp(this.stateT / 0.6, 0, 1) * Math.PI);
    S.armL.pivot.rotation.set(-0.3 - c - reach * 0.9, 0, -0.7);
    S.armR.pivot.rotation.set(-0.3 + c - reach * 0.9, 0, 0.7);
    S.armL.joint!.rotation.x = -1.3 + c;
    S.armR.joint!.rotation.x = -1.3 - c;
    S.legL.pivot.rotation.set(-0.5 + c, 0, -0.5);
    S.legR.pivot.rotation.set(-0.5 - c, 0, 0.5);
    S.legL.joint!.rotation.x = 1.6;
    S.legR.joint!.rotation.x = 1.6;
    void dt;
  }

  dispose() {
    this.ragdoll?.dispose();
    this.rig.root.removeFromParent();
  }
}
