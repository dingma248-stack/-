import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { bus } from '../core/events';
import { clamp, damp, rand, pick } from '../core/math';
import { stdMat } from '../render/materials';
import type { Layer } from '../audio/music';

/**
 * Pacing director: tracks tension, drives the dynamic score and ambient
 * "did I just see that?" moments, and gates stalker intrusions.
 */
export class Director {
  tension = 0; // 0..1
  private combatT = 0;
  private sinceCombat = 60;
  private phantomCd = rand(40, 70);
  private phantom: THREE.Group | null = null;
  private phantomT = 0;
  stalkerNear = 0; // set by boss
  forced: Partial<Record<Layer, number>> | null = null;
  musicEnabled = true;
  private lastLayers = '';
  /** chapters can register ambient one-shots (distant sirens, explosions) */
  ambientPool: { name: string; vol: number; dist: [number, number] }[] = [];
  private ambientCd = 8;
  phantomsEnabled = true;

  constructor() {
    bus.on('playerDamaged', () => {
      this.tension = Math.min(1, this.tension + 0.25);
      this.combatT = 6;
    });
    bus.on('shotFired', () => {
      this.combatT = Math.max(this.combatT, 3);
    });
  }

  reset() {
    this.tension = 0;
    this.combatT = 0;
    this.sinceCombat = 60;
    this.removePhantom();
    this.forced = null;
    this.stalkerNear = 0;
    this.ambientPool = [];
    this.lastLayers = '';
  }

  update(dt: number) {
    const p = ctx.player;
    const lvl = ctx.level;
    if (!lvl) return;
    const aware = ctx.enemies.awareCount(26);
    if (aware > 0) this.combatT = Math.max(this.combatT, 2.5);
    this.combatT = Math.max(0, this.combatT - dt);
    const inCombat = this.combatT > 0;
    if (inCombat) this.sinceCombat = 0;
    else this.sinceCombat += dt;
    // tension from nearby unaware enemies & low health
    const near = ctx.enemies.nearest(16);
    const target = clamp((inCombat ? 0.8 : 0) + (near ? 0.35 : 0) + (p.health < 40 ? 0.2 : 0) + this.stalkerNear, 0, 1);
    this.tension = damp(this.tension, target, inCombat ? 2 : 0.3, dt);
    // ---- music ----
    if (this.musicEnabled) {
      let layers: Partial<Record<Layer, number>>;
      if (this.forced) layers = this.forced;
      else if (lvl.inSafeZone(p.pos)) layers = { safe: 0.9, ambient: 0.15 };
      else if (this.stalkerNear > 0.5) layers = { nightwatch: 0.85, tension: 0.3, ambient: 0.2 };
      else if (inCombat) layers = { combat: 0.6, tension: 0.25, ambient: 0.25 };
      else if (near || this.tension > 0.35) layers = { tension: 0.45, ambient: 0.55 };
      else layers = { ambient: 0.7 };
      const key = JSON.stringify(layers);
      if (key !== this.lastLayers) {
        this.lastLayers = key;
        ctx.music.only(layers, inCombat ? 0.6 : 1.8);
      }
    }
    // ---- ambient one-shots ----
    this.ambientCd -= dt;
    if (this.ambientCd <= 0 && this.ambientPool.length) {
      const a = pick(this.ambientPool);
      const ang = Math.random() * Math.PI * 2;
      const d = rand(a.dist[0], a.dist[1]);
      ctx.audio.play(a.name, { pos: p.pos.clone().add(new THREE.Vector3(Math.cos(ang) * d, 4, Math.sin(ang) * d)), vol: a.vol, ref: 8, rolloff: 0.4, occlude: false });
      this.ambientCd = rand(14, 30);
    }
    // ---- phantoms: a silhouette at the edge of the fog ----
    if (this.phantom) {
      this.phantomT += dt;
      const d = this.phantom.position.distanceTo(p.pos);
      const look = this.phantom.position.clone().sub(p.camera.position).normalize().angleTo(p.forward);
      if (d < 7 || this.phantomT > 3.5 || (this.phantomT > 0.6 && look < 0.15)) this.removePhantom();
    } else if (this.phantomsEnabled && !inCombat && this.sinceCombat > 30 && !lvl.inSafeZone(p.pos)) {
      this.phantomCd -= dt;
      if (this.phantomCd <= 0) {
        this.phantomCd = rand(55, 110);
        this.spawnPhantom();
      }
    }
  }

  private spawnPhantom() {
    const p = ctx.player;
    const lvl = ctx.level!;
    // pick a walkable cell ahead, at the edge of visibility, with line of sight
    const fwd = p.forward.setY(0).normalize();
    for (let i = 0; i < 12; i++) {
      const ang = rand(-0.5, 0.5);
      const dist = rand(11, 16);
      const dir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      const pos = p.pos.clone().addScaledVector(dir, dist);
      const [cx, cz] = lvl.nav.cellOf(pos);
      if (!lvl.nav.ok(cx, cz)) continue;
      const c = lvl.nav.center(cx, cz);
      if (!ctx.physics.lineOfSight(p.camera.position, c.clone().setY(c.y + 1.4))) continue;
      const g = new THREE.Group();
      const m = stdMat({ color: 0x050505, roughness: 1 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.25, 0.24), m);
      body.position.y = 1.0;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.22), m);
      head.position.set(0.04, 1.75, 0);
      head.rotation.z = 0.25;
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.18), m);
      legs.position.y = 0.25;
      g.add(body, head, legs);
      g.position.copy(c);
      g.lookAt(p.pos.x, c.y, p.pos.z);
      ctx.scene.add(g);
      this.phantom = g;
      this.phantomT = 0;
      if (Math.random() < 0.5) ctx.audio.play('groan', { pos: c.clone().setY(c.y + 1.6), vol: 0.35, rate: 0.8 });
      return;
    }
  }

  private removePhantom() {
    if (!this.phantom) return;
    this.phantom.removeFromParent();
    this.phantom.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.phantom = null;
  }

  get inCombat() {
    return this.combatT > 0;
  }

  /** Scripted scare: stinger + tension spike. */
  scare(kind: 'high' | 'low' = 'high', vol = 1) {
    ctx.audio.play(kind === 'high' ? 'stingerHigh' : 'stingerLow', { vol, bus: 'music', reverb: 0 });
    this.tension = 1;
    ctx.player.shake = Math.max(ctx.player.shake, 0.35);
  }
}
