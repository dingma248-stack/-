import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { bx, fleshMaterial } from '../levels/props';
import { stdMat, M } from '../render/materials';
import { TEX } from '../render/textures';
import { angleDiff, clamp, rand, rayCapsule, raySphere, smoothstep, damp } from '../core/math';
import { DIFFICULTY, type WeaponId } from '../config';
import type { Hittable } from '../enemies/manager';
import type { HitResult } from '../enemies/enemy';
import type { Part } from '../enemies/rig';
import { GROUPS } from '../physics/world';

/**
 * 守夜人 · 形态三「忘川」. Rooted in the core chamber. Three health phases; the
 * heart in its chest is the only real weak point and is exposed after slams,
 * explosions and periodically while it breathes.
 */

type HState = 'dormant' | 'idle' | 'slam' | 'spit' | 'summon' | 'open' | 'phase' | 'dying' | 'dead';

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

class Tentacle implements Hittable {
  readonly g = new THREE.Group();
  readonly pos: THREE.Vector3;
  dead = false;
  downed = false;
  hp = 70;
  age = 0;
  private warned = false;
  private erupted = false;
  private whipCd = 1;
  private segs: THREE.Mesh[] = [];
  constructor(pos: THREE.Vector3) {
    this.pos = pos.clone();
    this.g.position.copy(pos);
    const mat = fleshMaterial();
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.16 - i * 0.02, 0.22 - i * 0.02, 0.5, 7), mat);
      s.position.y = 0.25 + i * 0.45;
      s.castShadow = true;
      this.g.add(s);
      this.segs.push(s);
    }
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 6), M.bone());
    tip.position.y = 2.9;
    this.g.add(tip);
    this.g.scale.set(1, 0.01, 1);
    ctx.level!.group.add(this.g);
    ctx.enemies.addBoss(this);
  }
  update(dt: number) {
    if (this.dead) return;
    this.age += dt;
    const p = ctx.player;
    if (!this.warned) {
      this.warned = true;
      ctx.audio.play('squelch', { pos: this.pos, vol: 1, rate: 0.6 });
    }
    if (this.age < 1.2) {
      // ground bulge warning
      if (Math.random() < dt * 30) ctx.particles.dust(this.pos.clone().add(V3(rand(-0.4, 0.4), 0.05, rand(-0.4, 0.4))), V3(0, 1, 0), 0x5a2020);
      return;
    }
    if (!this.erupted) {
      this.erupted = true;
      ctx.audio.play('bossImpact', { pos: this.pos, vol: 0.7, rate: 1.4 });
      ctx.particles.gore(this.pos.clone().add(V3(0, 0.3, 0)), V3(0, 1, 0), this.pos.y);
      if (p.pos.distanceTo(this.pos) < 1.4) {
        p.damage(24, this.pos);
        p.vel.add(V3(0, 5, 0));
      }
    }
    const k = smoothstep(1.2, 1.45, this.age);
    const sway = Math.sin(ctx.time * 3 + this.pos.x) * 0.25;
    this.g.scale.set(1, Math.max(0.01, k), 1);
    this.g.rotation.z = sway * k;
    this.g.rotation.x = Math.cos(ctx.time * 2.3 + this.pos.z) * 0.2 * k;
    this.whipCd -= dt;
    if (this.whipCd <= 0 && p.pos.distanceTo(this.pos) < 2.6) {
      this.whipCd = 1.6;
      ctx.audio.play('whoosh', { pos: this.pos, vol: 0.8 });
      p.damage(12, this.pos);
    }
    if (this.age > 7.5) {
      this.g.scale.y = Math.max(0.01, this.g.scale.y - dt * 2);
      if (this.g.scale.y <= 0.02) this.remove();
    }
  }
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxD: number, pad = 0) {
    if (this.dead || this.age < 1.3) return null;
    const t = rayCapsule(o, d, this.pos, this.pos.clone().add(V3(0, 2.8, 0)), 0.3 + pad);
    return t >= 0 && t <= maxD ? { dist: t, part: 'torso' as Part } : null;
  }
  damage(amount: number, _part: Part, point: THREE.Vector3, dir: THREE.Vector3): HitResult {
    if (this.dead) return { killed: false, headshot: false };
    this.hp -= amount;
    ctx.particles.blood(point, dir.clone().negate(), 6, this.pos.y);
    ctx.audio.play('impactFlesh', { pos: point, vol: 0.7 });
    if (this.hp <= 0) {
      ctx.particles.gore(point, V3(0, 1, 0), this.pos.y);
      ctx.audio.play('squelch', { pos: point, vol: 1 });
      this.remove();
      return { killed: true, headshot: false };
    }
    return { killed: false, headshot: false };
  }
  partPos() {
    return this.pos.clone().add(V3(0, 1.4, 0));
  }
  remove() {
    this.dead = true;
    this.g.removeFromParent();
    ctx.enemies.removeBoss(this);
  }
}

interface Acid {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
}
interface Pool {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  age: number;
}

export class HeartBoss implements Hittable {
  readonly root = new THREE.Group();
  readonly pos: THREE.Vector3;
  yaw = 0;
  hp: number;
  readonly maxHp: number;
  phase = 1;
  state: HState = 'dormant';
  stateT = 0;
  dead = false;
  downed = false;
  private cd = 3;
  private breathCd = 10;
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private foreL = new THREE.Group();
  private foreR = new THREE.Group();
  private plateL: THREE.Mesh;
  private plateR: THREE.Mesh;
  private heart: THREE.Mesh;
  private heartMat: THREE.MeshStandardMaterial;
  private mouths: THREE.Mesh[] = [];
  private heartLight: ReturnType<typeof ctx.lights.add>;
  private open = 0; // chest openness 0..1
  private tentacles: Tentacle[] = [];
  private acids: Acid[] = [];
  private pools: Pool[] = [];
  private acidGeo = new THREE.IcosahedronGeometry(0.22, 0);
  private acidMat = new THREE.MeshBasicMaterial({ color: 0x9aff3a, fog: true });
  private poolMat = new THREE.MeshBasicMaterial({ color: 0x5aaa1a, transparent: true, opacity: 0.55, depthWrite: false, fog: true });
  onPhase?: (phase: number) => void;
  onDeath?: () => void;
  private slamHit = false;
  private spat = 0;

  constructor(pos: THREE.Vector3) {
    this.pos = pos.clone();
    const mul = DIFFICULTY[ctx.difficulty].enemyHp;
    this.hp = this.maxHp = 2400 * mul;
    const flesh = fleshMaterial();
    const bone = stdMat({ color: 0xd6cbb0, roughness: 0.4 });
    const coat = stdMat({ map: TEX.coat(), roughness: 0.9 });
    // rooted base mound
    for (let i = 0; i < 9; i++) {
      const s = 0.9 + Math.random() * 1.2;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), flesh);
      const a = (i / 9) * Math.PI * 2;
      m.position.set(Math.cos(a) * 1.8, s * 0.3, Math.sin(a) * 1.8);
      m.scale.y = 0.6;
      m.castShadow = true;
      this.root.add(m);
    }
    this.root.add(this.torso);
    this.torso.position.y = 2.2;
    // torso mass
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 1), flesh);
    body.scale.set(1.15, 1.45, 0.9);
    body.position.y = 1.4;
    body.castShadow = true;
    this.torso.add(body);
    bx(this.torso, 2.2, 1.6, 0.2, coat, 0, 2.2, -0.75, 0, 0.1).castShadow = true;
    bx(this.torso, 0.9, 2.4, 0.15, coat, -1.1, 1.0, -0.4, 0.4, 0.15);
    bx(this.torso, 0.9, 2.2, 0.15, coat, 1.1, 1.0, -0.4, -0.4, -0.1);
    // ribs / chest plates over the heart
    this.plateL = bx(this.torso, 0.65, 1.3, 0.25, bone, -0.36, 1.5, 1.2, 0.1);
    this.plateR = bx(this.torso, 0.65, 1.3, 0.25, bone, 0.36, 1.5, 1.2, -0.1);
    for (let i = 0; i < 4; i++) bx(this.torso, 1.9, 0.12, 0.12, bone, 0, 0.8 + i * 0.35, 1.05, 0, 0, Math.sin(i) * 0.1);
    this.heartMat = new THREE.MeshStandardMaterial({ color: 0x5a0408, emissive: 0xff2010, emissiveIntensity: 1.5, roughness: 0.3 });
    this.heart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), this.heartMat);
    this.heart.position.set(0, 1.5, 0.95);
    this.torso.add(this.heart);
    // glowing nodules
    const nod = new THREE.MeshBasicMaterial({ color: 0xffa040, fog: true });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08 + Math.random() * 0.1, 0), nod);
      const a = Math.random() * Math.PI * 2;
      m.position.set(Math.cos(a) * 1.5, 0.5 + Math.random() * 2.2, Math.sin(a) * 1.1);
      this.torso.add(m);
    }
    // head with three mouths
    this.head.position.set(0, 3.3, 0.3);
    this.torso.add(this.head);
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), flesh);
    skull.scale.set(1.1, 0.9, 1);
    this.head.add(skull);
    const mask = bx(this.head, 0.5, 0.6, 0.1, stdMat({ color: 0xcfc8b6, roughness: 0.5 }), 0.35, 0.25, 0.78, 0.3, 0.4, 0.3);
    void mask;
    for (const [x, y, r] of [[0, -0.25, 0], [-0.55, 0.1, 0.5], [0.55, -0.05, -0.5]] as [number, number, number][]) {
      const mouth = new THREE.Group();
      mouth.position.set(x, y, 0.75);
      mouth.rotation.y = r;
      const hole = bx(mouth, 0.55, 0.3, 0.08, stdMat({ color: 0x120202, emissive: 0x400000, emissiveIntensity: 1 }), 0, 0, 0);
      for (let i = 0; i < 5; i++) {
        bx(mouth, 0.05, 0.12, 0.05, M.bone(), -0.2 + i * 0.1, 0.12, 0.04);
        bx(mouth, 0.05, 0.12, 0.05, M.bone(), -0.2 + i * 0.1, -0.12, 0.04);
      }
      this.head.add(mouth);
      this.mouths.push(hole);
    }
    // arms
    const arm = (g: THREE.Group, fore: THREE.Group, side: number) => {
      g.position.set(1.4 * side, 2.6, 0.2);
      this.torso.add(g);
      const up = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 2.6, 8), flesh);
      up.position.y = -1.3;
      up.castShadow = true;
      g.add(up);
      fore.position.y = -2.6;
      g.add(fore);
      const lo = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.8, 8), flesh);
      lo.position.y = -1.4;
      lo.castShadow = true;
      fore.add(lo);
      for (let i = 0; i < 3; i++) {
        const c = bx(fore, 0.12, 1.1, 0.12, bone, (i - 1) * 0.22, -3, 0.2, 0.4, 0, (i - 1) * 0.3);
        c.castShadow = true;
      }
    };
    arm(this.armL, this.foreL, -1);
    arm(this.armR, this.foreR, 1);
    this.root.position.copy(this.pos);
    ctx.level!.group.add(this.root);
    this.heartLight = ctx.lights.add({ pos: this.pos.clone().add(V3(0, 3.7, 1)), color: 0xff2010, intensity: 10, distance: 12, kind: 'steady' });
    ctx.level!.lights.push(this.heartLight);
    ctx.enemies.addBoss(this);
    this.pose(0);
  }

  wake() {
    this.state = 'idle';
    this.stateT = 0;
    this.cd = 2;
  }

  private setState(s: HState) {
    this.state = s;
    this.stateT = 0;
    this.slamHit = false;
    this.spat = 0;
  }

  heartPos() {
    this.heart.updateWorldMatrix(true, false);
    return this.heart.getWorldPosition(new THREE.Vector3());
  }

  partPos(part: Part) {
    return part === 'head' ? this.heartPos() : this.pos.clone().add(V3(0, 3.4, 0));
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, maxD: number, pad = 0) {
    if (this.dead || this.state === 'dormant') return null;
    let best: { dist: number; part: Part } | null = null;
    const hp = this.heartPos();
    const th = raySphere(o, d, hp, 0.6 + pad);
    if (th >= 0 && th <= maxD) best = { dist: th, part: 'head' };
    const tb = rayCapsule(o, d, this.pos.clone().add(V3(0, 1, 0)), this.pos.clone().add(V3(0, 5.6, 0)), 1.5 + pad);
    if (tb >= 0 && tb <= maxD && (!best || tb < best.dist - 0.25)) best = { dist: tb, part: 'torso' };
    for (const [g, part] of [[this.foreL, 'armL'], [this.foreR, 'armR']] as [THREE.Group, Part][]) {
      g.updateWorldMatrix(true, false);
      g.getWorldPosition(_a);
      g.localToWorld(_b.set(0, -3, 0));
      const t = rayCapsule(o, d, _a, _b, 0.4 + pad);
      if (t >= 0 && t <= maxD && (!best || t < best.dist)) best = { dist: t, part };
    }
    return best;
  }

  damage(amount: number, part: Part, point: THREE.Vector3, dir: THREE.Vector3, _kb: number, weapon: WeaponId | 'blast' | 'boss'): HitResult {
    if (this.dead || this.state === 'dormant' || this.state === 'phase' || this.state === 'dying') return { killed: false, headshot: false };
    let dmg: number;
    if (weapon === 'blast') {
      dmg = amount * (this.open > 0.5 ? 1 : 0.45);
      this.openChest();
    } else if (part === 'head') {
      if (this.open > 0.5) {
        dmg = amount * 1.25;
        ctx.particles.gore(point, dir.clone().negate(), this.pos.y);
        ctx.audio.play('headshot', { pos: point, vol: 0.8, rate: 0.7 });
      } else {
        dmg = amount * 0.1;
        ctx.particles.sparks(point, dir.clone().negate(), 8);
        ctx.audio.play('impactMetal', { pos: point, vol: 0.6, rate: 0.6 });
      }
    } else {
      dmg = amount * 0.15;
      ctx.particles.blood(point, dir.clone().negate(), 6, this.pos.y);
    }
    this.hp = Math.max(0, this.hp - dmg);
    this.heartMat.emissiveIntensity = 4;
    const threshold = this.maxHp * (this.phase === 1 ? 2 / 3 : this.phase === 2 ? 1 / 3 : 0);
    if (this.hp <= threshold) {
      if (this.phase < 3) {
        this.phase++;
        this.hp = threshold;
        this.setState('phase');
        ctx.audio.play('bossRoar', { pos: this.heartPos(), vol: 1, rate: 0.7 });
        this.onPhase?.(this.phase);
      } else {
        this.setState('dying');
        ctx.audio.play('bossRoar', { pos: this.heartPos(), vol: 1, rate: 0.6 });
      }
    }
    return { killed: false, headshot: part === 'head' && this.open > 0.5 };
  }

  /** Explosions and slams force the ribcage open. */
  openChest(time = 3.2) {
    // not refused during 'phase': that roar ends by opening the chest, or the boss would stay
    // invulnerable for good (damage() already ignores blasts while it roars)
    if (this.state === 'dying' || this.state === 'dead') return;
    this.setState('open');
    this.stateT = -time + 3.2;
    ctx.audio.play('squelch', { pos: this.heartPos(), vol: 1, rate: 0.6 });
  }

  update(dt: number) {
    if (this.dead) return;
    const p = ctx.player;
    this.stateT += dt;
    this.cd -= dt;
    this.breathCd -= dt;
    this.heartMat.emissiveIntensity = damp(this.heartMat.emissiveIntensity, 1.4 + Math.pow(Math.max(0, Math.sin(ctx.time * 3.2)), 4) * 1.5, 6, dt);
    this.heartLight.intensity = 6 + this.open * 18 + Math.max(0, Math.sin(ctx.time * 3.2)) * 4;
    this.heartLight.pos.copy(this.heartPos()).add(V3(0, 0, 0.3));
    const toP = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const dist = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    ctx.director.stalkerNear = this.state === 'dormant' ? 0 : 1;
    let wantOpen = 0;
    switch (this.state) {
      case 'dormant':
        break;
      case 'idle': {
        this.yaw += clamp(angleDiff(this.yaw, toP), -0.9 * dt, 0.9 * dt);
        // it wakes during its own intro cutscene: no spitting or slamming at a player who can't move
        if (!p.control) break;
        if (this.breathCd <= 0) {
          this.breathCd = this.phase === 3 ? 8 : 11;
          this.openChest(2.2);
          break;
        }
        if (this.cd <= 0) {
          if (dist < 7.5) this.setState('slam');
          else if (this.phase >= 2 && Math.random() < 0.4) this.setState('summon');
          else this.setState('spit');
        }
        break;
      }
      case 'slam': {
        this.yaw += clamp(angleDiff(this.yaw, toP), -0.6 * dt, 0.6 * dt);
        if (!this.slamHit && this.stateT > 1.15) {
          this.slamHit = true;
          ctx.audio.play('bossImpact', { pos: this.pos.clone().add(V3(Math.sin(this.yaw) * 4, 0, Math.cos(this.yaw) * 4)), vol: 1 });
          const front = Math.abs(angleDiff(this.yaw, toP)) < 1.1;
          p.shake = Math.max(p.shake, 1.2 - dist / 14);
          if (front && dist < 7.2) {
            p.damage(36, this.pos);
            p.vel.add(V3(Math.sin(toP), 0.5, Math.cos(toP)).multiplyScalar(9));
          }
          const hit = this.pos.clone().add(V3(Math.sin(this.yaw) * 4.5, 0.2, Math.cos(this.yaw) * 4.5));
          ctx.particles.dust(hit, V3(0, 1, 0), 0x5a3030);
          ctx.particles.explosion(hit.clone().setY(this.pos.y + 0.3));
          ctx.props.blast(hit, 4, 14);
        }
        if (this.stateT > 1.9) {
          this.openChest(this.phase === 3 ? 2.4 : 2.8);
          this.cd = 1.5;
        }
        break;
      }
      case 'spit': {
        this.yaw += clamp(angleDiff(this.yaw, toP), -1.2 * dt, 1.2 * dt);
        const shots = this.phase === 3 ? 3 : this.phase === 2 ? 2 : 1;
        if (this.stateT > 0.6 + this.spat * 0.35 && this.spat < shots) {
          this.spat++;
          this.spit();
        }
        if (this.stateT > 0.8 + shots * 0.35) {
          this.cd = this.phase === 3 ? 1.6 : 2.4;
          this.setState('idle');
        }
        break;
      }
      case 'summon':
        if (this.stateT < dt * 1.5) ctx.audio.play('bossRoar', { pos: this.heartPos(), vol: 0.8, rate: 1.1 });
        if (this.stateT > 0.9 && this.spat === 0) {
          this.spat = 1;
          const n = this.phase === 3 ? 4 : 3;
          for (let i = 0; i < n; i++) {
            const off = i === 0 ? V3(0, 0, 0) : V3(rand(-3, 3), 0, rand(-3, 3));
            const tp = p.pos.clone().add(off).setY(this.pos.y);
            if (Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z) < 3.5) continue;
            this.tentacles.push(new Tentacle(tp));
          }
        }
        if (this.stateT > 1.6) {
          this.cd = 2.5;
          this.setState('idle');
        }
        break;
      case 'open':
        wantOpen = 1;
        if (this.stateT > 3.2) {
          this.cd = Math.min(this.cd, 1.2);
          this.setState('idle');
        }
        break;
      case 'phase':
        wantOpen = 0;
        if (this.stateT < dt * 1.5) {
          p.shake = 1.5;
          ctx.renderer.fx.flash = 0.2;
          if (dist < 9) p.vel.add(V3(Math.sin(toP), 0.4, Math.cos(toP)).multiplyScalar(8));
        }
        if (this.stateT > 2.4) this.openChest(3.5);
        break;
      case 'dying':
        wantOpen = 1;
        if (Math.random() < dt * 18) ctx.particles.gore(this.heartPos().add(V3(rand(-1, 1), rand(-1, 1), rand(-0.5, 0.5))), V3(0, 1, 0), this.pos.y);
        this.root.position.y = this.pos.y - smoothstep(0.5, 4, this.stateT) * 2.5;
        if (this.stateT > 4) {
          this.dead = true;
          this.state = 'dead';
          ctx.game.explode(this.heartPos(), 6, 0, 'tank');
          this.root.visible = false;
          for (const t of this.tentacles) t.remove();
          ctx.enemies.removeBoss(this);
          ctx.director.stalkerNear = 0;
          ctx.lights.remove(this.heartLight);
          this.onDeath?.();
        }
        break;
    }
    this.open = damp(this.open, wantOpen, wantOpen ? 6 : 3, dt);
    this.tentacles = this.tentacles.filter((t) => !t.dead);
    for (const t of this.tentacles) t.update(dt);
    this.updateAcid(dt);
    this.pose(dt);
  }

  private spit() {
    const p = ctx.player;
    const mouth = this.head.localToWorld(V3(0, -0.25, 1));
    const target = p.pos.clone().add(p.vel.clone().multiplyScalar(0.7)).add(V3(rand(-1, 1), 0, rand(-1, 1)));
    const flight = 1.1;
    const vel = target.clone().sub(mouth).divideScalar(flight);
    vel.y += 0.5 * 9.8 * flight;
    const mesh = new THREE.Mesh(this.acidGeo, this.acidMat);
    mesh.position.copy(mouth);
    ctx.level!.group.add(mesh);
    this.acids.push({ mesh, pos: mouth.clone(), vel, age: 0 });
    ctx.audio.play('acid', { pos: mouth, vol: 1 });
  }

  private updateAcid(dt: number) {
    const p = ctx.player;
    for (let i = this.acids.length - 1; i >= 0; i--) {
      const a = this.acids[i];
      a.age += dt;
      a.vel.y -= 9.8 * dt;
      const step = a.vel.clone().multiplyScalar(dt);
      const hit = ctx.physics.raycast(a.pos, step.clone().normalize(), step.length() + 0.1, GROUPS.bullet);
      a.pos.add(step);
      a.mesh.position.copy(a.pos);
      a.mesh.rotation.x += dt * 8;
      if (Math.random() < dt * 36) ctx.particles.acid(a.pos, V3(0, 0.2, 0), a.pos.y - 3);
      const nearP = a.pos.distanceTo(p.camera.position.clone().setY(p.pos.y + 1)) < 0.8;
      if (hit || nearP || a.age > 4) {
        const at = hit ? hit.point : a.pos.clone();
        ctx.particles.acid(at, V3(0, 1, 0), at.y - 0.1);
        ctx.audio.play('acid', { pos: at, vol: 0.8, rate: 1.3 });
        if (at.distanceTo(p.pos.clone().setY(at.y)) < 1.7) p.damage(14, at);
        const floor = ctx.level!.floorY(at.x, at.z);
        if (Math.abs(at.y - floor) < 1.5) {
          const m = new THREE.Mesh(new THREE.CircleGeometry(1.2, 10), this.poolMat);
          m.rotation.x = -Math.PI / 2;
          m.position.set(at.x, floor + 0.02, at.z);
          ctx.level!.group.add(m);
          this.pools.push({ mesh: m, pos: m.position.clone(), age: 0 });
        }
        a.mesh.removeFromParent();
        this.acids.splice(i, 1);
      }
    }
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const pl = this.pools[i];
      pl.age += dt;
      pl.mesh.scale.setScalar(Math.max(0.01, 1 - Math.max(0, pl.age - 4)));
      if (Math.hypot(p.pos.x - pl.pos.x, p.pos.z - pl.pos.z) < 1.1 && pl.age < 4.5 && Math.random() < dt * 3) {
        p.invuln = 0;
        p.damage(4, pl.pos);
      }
      if (pl.age > 5) {
        pl.mesh.removeFromParent();
        this.pools.splice(i, 1);
      }
    }
  }

  private pose(dt: number) {
    const t = ctx.time;
    this.root.rotation.y = this.yaw;
    const breath = Math.sin(t * 1.6) * 0.04;
    this.torso.scale.set(1 + breath, 1 - breath * 0.5, 1 + breath);
    let armX = -0.3 + Math.sin(t * 0.9) * 0.08, foreX = -0.6;
    let lean = 0.15 + Math.sin(t * 0.7) * 0.03;
    let headX = 0;
    const k = this.stateT;
    switch (this.state) {
      case 'dormant':
        lean = 0.6;
        headX = 0.5;
        armX = 0.3;
        break;
      case 'slam': {
        const up = smoothstep(0, 1.0, k), down = smoothstep(1.0, 1.18, k), back = smoothstep(1.4, 1.9, k);
        armX = -0.3 - 2.4 * up * (1 - down) + 0.6 * down * (1 - back);
        foreX = -0.6 - 0.8 * up * (1 - down) - 0.3 * down;
        lean = 0.15 - 0.35 * up * (1 - down) + 0.5 * down * (1 - back);
        break;
      }
      case 'spit':
        headX = -0.5 * Math.sin(clamp(k / 0.6, 0, 1) * Math.PI * 0.5) + (k > 0.6 ? 0.4 : 0);
        lean = -0.1;
        break;
      case 'summon':
      case 'phase':
        lean = -0.35 + Math.sin(t * 25) * 0.03;
        headX = -0.6;
        armX = -1.6;
        foreX = -0.2;
        break;
      case 'open':
        lean = -0.2;
        armX = 0.2;
        headX = -0.3;
        break;
      case 'dying':
        lean = 0.3 + Math.sin(t * 9) * 0.1;
        headX = 0.6;
        armX = 0.6 + Math.sin(t * 7) * 0.3;
        break;
    }
    this.torso.rotation.x = lean;
    this.head.rotation.x = headX + Math.sin(t * 1.3) * 0.05;
    this.armL.rotation.set(armX, 0, -0.35);
    this.armR.rotation.set(armX + (this.state === 'slam' ? 0 : Math.sin(t * 1.1) * 0.1), 0, 0.35);
    this.foreL.rotation.x = foreX;
    this.foreR.rotation.x = foreX;
    this.plateL.position.x = -0.36 - this.open * 0.55;
    this.plateR.position.x = 0.36 + this.open * 0.55;
    this.plateL.rotation.y = -this.open * 0.9;
    this.plateR.rotation.y = this.open * 0.9;
    this.heart.scale.setScalar(1 + Math.pow(Math.max(0, Math.sin(t * 3.2)), 6) * 0.25);
    for (const [i, m] of this.mouths.entries()) m.scale.y = 1 + Math.max(0, Math.sin(t * 2 + i * 2)) * (this.state === 'spit' || this.state === 'summon' ? 2.5 : 0.8);
    void dt;
  }
}
