import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { input } from '../core/input';
import { WEAPONS, WEAPON_ORDER, GRENADE, type WeaponId, type WeaponDef } from '../config';
import { VIEWMODELS, type Viewmodel } from './viewmodels';
import { Spring, clamp, damp, lerp, rand, easeOutCubic, smoothstep } from '../core/math';
import { GROUPS } from '../physics/world';
import { bus } from '../core/events';
import { surface } from '../render/materials';
import type { Door } from '../levels/level';

type WState = 'idle' | 'reload' | 'holster' | 'equip' | 'melee' | 'shellStart' | 'shellLoop' | 'shellEnd' | 'pump';

interface Grenade {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  bounces: number;
}

const _v = new THREE.Vector3();

export class Weapons {
  owned: WeaponId[] = ['knife'];
  private held: WeaponId = 'knife';
  /**
   * Setting this also swaps the visible viewmodel. Chapter select and Continue assign it straight after
   * reset(); without the swap the knife stayed shown, unposed at the view camera's origin, as a huge dark
   * blade across the top of the screen, and the gun in hand stayed invisible.
   */
  get current(): WeaponId {
    return this.held;
  }
  set current(id: WeaponId) {
    this.held = id;
    this.show(id);
  }
  last: WeaponId = 'knife';
  private pending: WeaponId | null = null;
  mags: Record<WeaponId, number> = { knife: 0, pistol: 0, shotgun: 0, magnum: 0, launcher: 0 };
  state: WState = 'idle';
  private t = 0; // time in state
  private dur = 0;
  private reloadEmpty = false;
  private loaded = false; // ammo transferred this reload
  private fireCd = 0;
  private interruptShells = false;
  private pumpAfter = false;
  adsT = 0;
  private sprintT = 0;
  private bloom = 0;
  private quickMelee = false;
  private meleeSide = 1;
  private meleeHitDone = false;

  readonly viewScene = new THREE.Scene();
  readonly viewCam = new THREE.PerspectiveCamera(56, 1, 0.01, 10);
  private vms = {} as Record<WeaponId, Viewmodel>;
  private holder = new THREE.Group();
  private kickZ = new Spring(260, 20);
  private kickRot = new Spring(220, 16);
  private swayX = new Spring(90, 12);
  private swayY = new Spring(90, 12);
  private swayRoll = new Spring(80, 10);
  private bobPhase = 0;
  readonly viewHemi = new THREE.HemisphereLight(0x8090a0, 0x201810, 0.6);
  private viewKey = new THREE.DirectionalLight(0xfff0e0, 0.6);
  private viewMuzzle = new THREE.PointLight(0xffb060, 0, 2, 2);
  private viewFlash = new THREE.PointLight(0xfff1dc, 0, 1.2, 2);
  private worldMuzzle = new THREE.PointLight(0xffb060, 0, 9, 2);
  private muzzleT = 0;
  private flashMesh: THREE.Mesh;
  private grenades: Grenade[] = [];
  private grenadeGeo = new THREE.SphereGeometry(0.035, 6, 4);
  private grenadeMat = new THREE.MeshStandardMaterial({ color: 0x4a5a2a, roughness: 0.6 });
  // stats
  shots = 0;
  hits = 0;
  infiniteAmmo = false;

  constructor(scene: THREE.Scene) {
    this.viewScene.add(this.viewHemi, this.viewKey, this.viewMuzzle, this.viewFlash, this.holder);
    this.viewKey.position.set(0.3, 1, 0.4);
    this.viewKey.intensity = 0.35;
    this.viewFlash.position.set(0.12, 0.08, -0.55);
    this.viewFlash.distance = 1.4;
    scene.add(this.worldMuzzle);
    for (const id of WEAPON_ORDER) {
      const vm = VIEWMODELS[id]();
      vm.root.visible = false;
      this.holder.add(vm.root);
      this.vms[id] = vm;
    }
    // muzzle flash sprite (camera space)
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d')!;
    const grd = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,250,220,1)');
    grd.addColorStop(0.3, 'rgba(255,190,90,0.9)');
    grd.addColorStop(1, 'rgba(255,90,20,0)');
    x.fillStyle = grd;
    x.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = i % 2 ? 6 : 16;
      x.lineTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r);
    }
    x.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    this.flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.075), new THREE.MeshBasicMaterial({ map: tex, color: 0xffc890, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flashMesh.visible = false;
    this.flashMesh.renderOrder = 10;
    this.viewScene.add(this.flashMesh);
  }

  get def(): WeaponDef {
    return WEAPONS[this.current];
  }

  reset() {
    this.owned = ['knife'];
    this.current = 'knife';
    this.last = 'knife';
    this.mags = { knife: 0, pistol: 0, shotgun: 0, magnum: 0, launcher: 0 };
    this.setState('equip', 0.3);
    this.shots = this.hits = 0;
    this.clearProjectiles();
    this.show(this.current);
  }

  clearProjectiles() {
    for (const g of this.grenades) g.mesh.removeFromParent();
    this.grenades = [];
  }

  give(id: WeaponId, ammoInMag = 0) {
    if (!this.owned.includes(id)) {
      this.owned.push(id);
      this.owned.sort((a, b) => WEAPONS[a].slot - WEAPONS[b].slot);
      this.mags[id] = Math.min(WEAPONS[id].mag, ammoInMag);
    }
    this.switchTo(id);
  }

  reserve(id: WeaponId = this.current) {
    const a = WEAPONS[id].ammo;
    if (!a) return 0;
    if (this.infiniteAmmo) return 99;
    return ctx.inventory.count(a);
  }

  canSprint() {
    return this.state !== 'melee' || this.t > 0.2;
  }

  private show(id: WeaponId) {
    for (const k of WEAPON_ORDER) this.vms[k].root.visible = k === id;
  }

  private setState(s: WState, dur: number) {
    this.state = s;
    this.t = 0;
    this.dur = dur;
  }

  switchTo(id: WeaponId) {
    if (!this.owned.includes(id)) return;
    if (id === this.current && this.state !== 'holster') return;
    this.quickMelee = false;
    this.pending = id;
    if (this.state === 'equip' && this.t < 0.1) {
      // switch instantly if we only just started equipping
      this.finishSwitch();
      return;
    }
    this.setState('holster', 0.16);
  }

  private finishSwitch() {
    if (!this.pending) return;
    if (this.pending !== this.current) this.last = this.current;
    this.current = this.pending;
    this.pending = null;
    this.show(this.current);
    ctx.audio.play('slide', { vol: 0.25, rate: 1.3, reverb: 0.05 });
    this.setState('equip', WEAPONS[this.current].equipTime);
    ctx.ui.weaponChanged();
  }

  private cycle(dir: number) {
    const list = this.owned;
    const i = list.indexOf(this.pending ?? this.current);
    const n = list[(i + dir + list.length) % list.length];
    this.switchTo(n);
  }

  // ------------------------------------------------------------ update
  update(dt: number) {
    const p = ctx.player;
    const canAct = p.control && !p.frozen && !p.dead && !p.grabbedBy;
    this.t += dt;
    this.fireCd -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 2.5);
    this.muzzleT -= dt;
    // ---- input ----
    if (canAct) {
      if (input.wasPressed('weapon1')) this.switchTo('pistol');
      if (input.wasPressed('weapon2')) this.switchTo('shotgun');
      if (input.wasPressed('weapon3')) this.switchTo('magnum');
      if (input.wasPressed('weapon4')) this.switchTo('launcher');
      if (input.wasPressed('lastWeapon')) this.switchTo(this.last);
      if (input.wheel !== 0) this.cycle(input.wheel > 0 ? 1 : -1);
      if (input.wasPressed('melee') && this.state !== 'melee' && this.state !== 'holster') this.startMelee(this.current !== 'knife');
      if (input.wasPressed('reload')) this.tryReload();
    }
    const aimHeld = canAct && input.isDown('aim') && this.current !== 'knife' && this.state !== 'melee' && !p.sprinting;
    this.adsT = damp(this.adsT, aimHeld ? 1 : 0, aimHeld ? 13 : 16, dt);
    p.adsFovMul = lerp(1, this.def.adsFov || 1, this.adsT);
    this.sprintT = damp(this.sprintT, p.sprinting && this.state !== 'reload' && this.state !== 'melee' ? 1 : 0, 9, dt);

    // ---- fire input ----
    const firePressed = canAct && input.wasPressed('fire');
    const fireHeld = canAct && input.isDown('fire');
    const wantsFire = this.def.auto ? fireHeld : firePressed;
    if (firePressed && (this.state === 'shellLoop' || this.state === 'shellStart')) this.interruptShells = true;
    if (wantsFire && this.state === 'idle' && this.fireCd <= 0 && this.sprintT < 0.5) {
      if (this.current === 'knife') this.startMelee(false);
      else this.fire();
    }

    // ---- state machine ----
    switch (this.state) {
      case 'holster':
        if (this.t >= this.dur) this.finishSwitch();
        break;
      case 'equip':
        if (this.t >= this.dur) this.setState('idle', 0);
        break;
      case 'reload': {
        const k = this.t / this.dur;
        this.reloadSounds(k);
        if (!this.loaded && k >= 0.72) this.transferAmmo();
        if (this.t >= this.dur) this.setState('idle', 0);
        break;
      }
      case 'shellStart':
        if (this.t >= this.dur) this.setState('shellLoop', WEAPONS.shotgun.perShell!);
        break;
      case 'shellLoop': {
        const k = this.t / this.dur;
        if (!this.loaded && k >= 0.6) {
          this.loaded = true;
          const got = this.infiniteAmmo ? 1 : ctx.inventory.take('shells', 1);
          if (got) this.mags.shotgun++;
          ctx.audio.play('shellInsert', { vol: 0.7, reverb: 0.1 });
        }
        if (this.t >= this.dur) {
          this.loaded = false;
          const full = this.mags.shotgun >= WEAPONS.shotgun.mag;
          if (full || this.reserve() <= 0 || this.interruptShells) this.setState('shellEnd', this.pumpAfter ? 0.55 : 0.32);
          else this.setState('shellLoop', WEAPONS.shotgun.perShell!);
        }
        break;
      }
      case 'shellEnd':
        if (this.pumpAfter && this.t > 0.18 && this.t - dt <= 0.18) ctx.audio.play('pump', { vol: 0.8, reverb: 0.1 });
        if (this.t >= this.dur) {
          this.pumpAfter = false;
          this.interruptShells = false;
          this.setState('idle', 0);
        }
        break;
      case 'pump':
        if (this.t > 0.08 && this.t - dt <= 0.08) {
          ctx.audio.play('pump', { vol: 0.8, reverb: 0.1 });
        }
        if (this.t > 0.2 && this.t - dt <= 0.2) this.ejectShell('shotgun');
        if (this.t >= this.dur) this.setState('idle', 0);
        break;
      case 'melee': {
        if (!this.meleeHitDone && this.t >= 0.11) {
          this.meleeHitDone = true;
          this.meleeHit();
        }
        if (this.t >= this.dur) {
          if (this.quickMelee) {
            this.quickMelee = false;
            this.show(this.current);
            this.setState('equip', 0.22);
          } else this.setState('idle', 0);
        }
        break;
      }
      case 'idle':
        // auto-reload on empty when trigger pressed handled in fire()
        break;
    }
    this.updateGrenades(dt);
    this.animate(dt);
  }

  private tryReload() {
    if (this.current === 'knife' || this.state !== 'idle') return;
    const d = this.def;
    if (this.mags[this.current] >= d.mag) return;
    if (this.reserve() <= 0) {
      ctx.ui.toast('没有备用弹药');
      return;
    }
    this.reloadEmpty = this.mags[this.current] === 0;
    this.loaded = false;
    if (this.current === 'shotgun') {
      this.pumpAfter = this.reloadEmpty;
      this.interruptShells = false;
      this.setState('shellStart', 0.3);
      return;
    }
    this.setState('reload', this.reloadEmpty ? d.reloadEmpty : d.reloadTactical);
    this.sfxMarks = new Set();
  }

  private sfxMarks = new Set<string>();
  private mark(key: string, k: number, at: number, fn: () => void) {
    if (k >= at && !this.sfxMarks.has(key)) {
      this.sfxMarks.add(key);
      fn();
    }
  }

  private reloadSounds(k: number) {
    const id = this.current;
    if (id === 'pistol') {
      this.mark('out', k, 0.18, () => ctx.audio.play('magOut', { vol: 0.8, reverb: 0.1 }));
      this.mark('in', k, 0.62, () => ctx.audio.play('magIn', { vol: 0.9, reverb: 0.1 }));
      if (this.reloadEmpty) this.mark('slide', k, 0.86, () => ctx.audio.play('slide', { vol: 0.9, reverb: 0.1 }));
    } else if (id === 'magnum') {
      this.mark('open', k, 0.12, () => ctx.audio.play('revolverOpen', { vol: 0.8 }));
      this.mark('eject', k, 0.26, () => {
        ctx.audio.play('revolverEject', { vol: 0.8 });
        const spent = WEAPONS.magnum.mag - this.mags.magnum;
        for (let i = 0; i < spent; i++) this.ejectShell('big', true);
      });
      for (let i = 0; i < 3; i++) this.mark('ins' + i, k, 0.45 + i * 0.1, () => ctx.audio.play('shellInsert', { vol: 0.5, rate: 1.4 }));
      this.mark('close', k, 0.86, () => ctx.audio.play('revolverClose', { vol: 0.9 }));
    } else if (id === 'launcher') {
      this.mark('open', k, 0.15, () => ctx.audio.play('glOpen', { vol: 0.9 }));
      this.mark('eject', k, 0.3, () => this.ejectShell('big', true));
      this.mark('ins', k, 0.6, () => ctx.audio.play('shellInsert', { vol: 0.8, rate: 0.7 }));
      this.mark('close', k, 0.84, () => ctx.audio.play('glClose', { vol: 1 }));
    }
  }

  private transferAmmo() {
    this.loaded = true;
    const d = this.def;
    const need = d.mag - this.mags[this.current];
    const got = this.infiniteAmmo ? need : ctx.inventory.take(d.ammo!, need);
    this.mags[this.current] += got;
  }

  // ------------------------------------------------------------ firing
  private fire() {
    const d = this.def;
    const id = this.current;
    if (this.mags[id] <= 0) {
      ctx.audio.play('dryfire', { vol: 0.7, reverb: 0 });
      this.fireCd = 0.25;
      if (this.reserve() > 0) this.tryReload();
      return;
    }
    if (!this.infiniteAmmo) this.mags[id]--;
    else this.mags[id] = Math.max(this.mags[id] - 1, 0) || d.mag;
    this.fireCd = d.fireInterval;
    this.shots++;
    const p = ctx.player;
    const cam = p.camera;
    const vm = this.vms[id];
    // sound + noise
    ctx.audio.play(id, { vol: 1, rateVar: 0.04, reverb: 0.55, occlude: false });
    bus.emit('noise', { pos: p.pos.clone(), radius: d.noise, source: 'player' });
    bus.emit('shotFired', { weapon: id });
    // muzzle flash
    this.muzzleT = 0.05;
    const muzzleWorld = this.muzzleWorld();
    this.worldMuzzle.position.copy(muzzleWorld);
    this.worldMuzzle.intensity = id === 'shotgun' || id === 'magnum' ? 26 : 14;
    this.viewMuzzle.intensity = 3;
    this.viewMuzzle.position.copy(vm.muzzle.getWorldPosition(_v));
    this.flashMesh.visible = id !== 'launcher';
    this.flashMesh.position.copy(_v);
    this.flashMesh.rotation.z = Math.random() * 6;
    this.flashMesh.scale.setScalar(id === 'shotgun' ? 1.6 : id === 'magnum' ? 1.4 : 1);
    ctx.particles.muzzle(muzzleWorld, p.forward, id !== 'pistol');
    // recoil
    const adsMul = lerp(1, 0.65, this.adsT);
    p.addRecoil(d.recoilPitch * adsMul, d.recoilYaw * adsMul);
    this.kickZ.kick(d.kick * 22);
    this.kickRot.kick(d.kick * 30);
    p.shake = Math.min(1, p.shake + (id === 'shotgun' || id === 'magnum' ? 0.35 : id === 'launcher' ? 0.3 : 0.08));
    // projectiles
    if (id === 'launcher') {
      this.launchGrenade(muzzleWorld, p.forward);
    } else {
      const spread = lerp(d.spreadHip, d.spreadAds, this.adsT) + d.spreadMove * clamp(Math.hypot(p.vel.x, p.vel.z) / 3.3, 0, 1) + this.bloom * 0.02;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const fwd = p.forward;
      let anyHit = false;
      let headshot = false;
      for (let i = 0; i < d.pellets; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * spread;
        const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
        const res = this.trace(cam.position.clone(), dir, d, i === 0);
        if (res.enemy) anyHit = true;
        if (res.headshot) headshot = true;
      }
      if (anyHit) {
        this.hits++;
        ctx.ui.hitmarker(headshot);
        ctx.audio.play(headshot ? 'headmarker' : 'hitmarker', { bus: 'ui', vol: 0.5 });
      }
      this.bloom = Math.min(1.5, this.bloom + (d.pellets > 1 ? 1 : 0.5));
    }
    ctx.ui.crosshairKick(d.pellets > 1 ? 1 : 0.6);
    // shells / mechanics
    if (id === 'pistol') this.ejectShell('brass');
    if (id === 'shotgun' && this.mags.shotgun >= 0) this.setState('pump', 0.62);
    if (this.mags[id] === 0 && id === 'pistol') ctx.audio.play('dryfire', { vol: 0.3, delay: 0.05 });
  }

  /** One hitscan ray. */
  private trace(origin: THREE.Vector3, dir: THREE.Vector3, d: WeaponDef, primary: boolean) {
    const world = ctx.physics.raycast(origin, dir, d.range, GROUPS.bullet);
    const maxD = world ? world.dist : d.range;
    const eh = ctx.enemies.raycast(origin, dir, maxD);
    if (eh) {
      const point = origin.clone().addScaledVector(dir, eh.dist);
      const dist = eh.dist;
      const falloff = d.pellets > 1 ? clamp(1.4 - dist / 14, 0.25, 1.15) : 1;
      const res = eh.enemy.damage(d.damage * falloff, eh.part, point, dir, d.knockback * falloff, d.id);
      // splatter behind the target
      const behind = ctx.physics.raycast(point, dir, 3, GROUPS.sight);
      if (behind && Math.random() < 0.6) ctx.decals.add('blood', behind.point, behind.normal, rand(0.5, 1.1), 90);
      return { enemy: true, headshot: res.headshot && primary };
    }
    if (!world) return { enemy: false, headshot: false };
    const tag = world.tag;
    const surf = tag?.surface ?? 'concrete';
    const n = world.normal;
    if (tag?.kind === 'ragdoll') {
      (tag.owner as { hit?: (p: THREE.Vector3, d: THREE.Vector3, imp: number) => void })?.hit?.(world.point, dir, d.impulse);
      ctx.particles.blood(world.point, n, 6);
      ctx.audio.play('impactFlesh', { pos: world.point, vol: 0.6 });
      return { enemy: false, headshot: false };
    }
    if (tag?.kind === 'prop') {
      ctx.props.hit(tag, world.point, dir, d.impulse, d.damage);
    }
    if (tag?.kind === 'door') {
      const door = tag.owner as Door;
      if (door && !door.locked && door.kind === 'wood' && d.id === 'shotgun') door.open(ctx.player.pos, true);
    }
    this.impact(world.point, n, surf, primary || d.pellets < 3);
    return { enemy: false, headshot: false };
  }

  impact(point: THREE.Vector3, n: THREE.Vector3, surf: string, withSound: boolean) {
    const step = surface(surf === 'glass' ? 'concrete' : surf).step;
    const metal = step === 'metal' || surf === 'metal' || surf === 'steel';
    const wood = step === 'wood' || surf === 'woodPanel' || surf === 'crate';
    if (metal) ctx.particles.sparks(point, n, 10);
    else if (step === 'water') ctx.particles.splash(point);
    else if (step === 'flesh') ctx.particles.blood(point, n, 8);
    else ctx.particles.dust(point, n, wood ? 0x7a5a34 : step === 'tile' ? 0xb8b8b0 : 0x8a857a);
    if (step !== 'water') ctx.decals.add(step === 'flesh' ? 'blood' : 'hole', point, n, step === 'flesh' ? 0.4 : rand(0.05, 0.075), 120);
    if (withSound) ctx.audio.play(metal ? 'impactMetal' : wood ? 'impactWood' : step === 'flesh' ? 'impactFlesh' : 'impactConcrete', { pos: point, vol: 0.55 });
  }

  muzzleWorld() {
    const vm = this.vms[this.current];
    vm.root.updateMatrixWorld(true);
    const local = vm.muzzle.getWorldPosition(new THREE.Vector3());
    // view space -> world space using the main camera
    const cam = ctx.player.camera;
    local.z *= 0.9;
    return cam.localToWorld(local.clone());
  }

  private ejectShell(kind: 'brass' | 'shotgun' | 'big', fromCylinder = false) {
    const vm = this.vms[this.current];
    const cam = ctx.player.camera;
    const local = vm.ejector.getWorldPosition(new THREE.Vector3());
    const world = cam.localToWorld(local.clone());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const vel = fromCylinder
      ? new THREE.Vector3(rand(-0.3, 0.3), rand(-1, 0), rand(-0.3, 0.3))
      : right.multiplyScalar(rand(1.6, 2.6)).addScaledVector(up, rand(1.4, 2.2)).add(ctx.player.vel.clone().multiplyScalar(0.8));
    ctx.props.spawnShell(world, vel, kind);
  }

  // ------------------------------------------------------------ melee
  private startMelee(quick: boolean) {
    if (this.state === 'reload' || this.state === 'shellLoop') {
      // melee cancels reloads (ammo already transferred stays)
    }
    this.quickMelee = quick;
    if (quick) {
      for (const k of WEAPON_ORDER) this.vms[k].root.visible = k === 'knife';
    }
    this.meleeSide *= -1;
    this.meleeHitDone = false;
    this.setState('melee', WEAPONS.knife.fireInterval);
    ctx.audio.play('knifeSwing', { vol: 0.7, reverb: 0.05 });
  }

  private meleeHit() {
    const p = ctx.player;
    const cam = p.camera;
    const fwd = p.forward;
    const d = WEAPONS.knife;
    const target = ctx.enemies.meleeTarget(cam.position, fwd, d.range);
    if (target) {
      const mult = target.enemy.downed ? 3.5 : 1;
      const res = target.enemy.damage(d.damage * mult, target.part, target.point, fwd, d.knockback, 'knife');
      ctx.audio.play('knifeHit', { pos: target.point, vol: 0.9 });
      ctx.ui.hitmarker(res.headshot);
      p.shake = Math.min(1, p.shake + 0.2);
      p.recoilYaw.kick(this.meleeSide * 1.2);
      this.hits++;
      this.shots++;
      return;
    }
    const hit = ctx.physics.raycast(cam.position, fwd, d.range, GROUPS.bullet);
    if (hit) {
      this.impact(hit.point, hit.normal, hit.tag?.surface ?? 'concrete', true);
      if (hit.tag?.kind === 'prop') ctx.props.hit(hit.tag, hit.point, fwd, 3, 40);
      if (hit.tag?.kind === 'ragdoll') (hit.tag.owner as any)?.hit?.(hit.point, fwd, 3);
      p.recoilYaw.kick(this.meleeSide * 2);
      p.shake = Math.min(1, p.shake + 0.15);
    }
  }

  // ------------------------------------------------------------ grenades
  private launchGrenade(pos: THREE.Vector3, dir: THREE.Vector3) {
    const mesh = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
    mesh.position.copy(pos);
    ctx.scene.add(mesh);
    this.grenades.push({ mesh, pos: pos.clone(), vel: dir.clone().multiplyScalar(GRENADE.speed).add(new THREE.Vector3(0, 1.2, 0)), age: 0, bounces: 0 });
  }

  private updateGrenades(dt: number) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.age += dt;
      g.vel.y -= GRENADE.gravity * dt;
      const step = g.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const dir = step.clone().normalize();
      const hit = ctx.physics.raycast(g.pos, dir, len + 0.04, GROUPS.bullet);
      const eh = ctx.enemies.raycast(g.pos, dir, hit ? hit.dist : len + 0.1, 0.25);
      let explodeAt: THREE.Vector3 | null = null;
      if (eh) explodeAt = g.pos.clone().addScaledVector(dir, eh.dist);
      else if (hit) {
        if (g.age > GRENADE.fuseMin) explodeAt = hit.point.clone().addScaledVector(hit.normal, 0.15);
        else {
          // too close: dud bounce
          g.vel.reflect(hit.normal).multiplyScalar(0.4);
          g.pos.copy(hit.point).addScaledVector(hit.normal, 0.05);
          ctx.audio.play('grenadeBounce', { pos: g.pos });
          g.bounces++;
          if (g.bounces > 3) explodeAt = g.pos.clone();
        }
      } else g.pos.add(step);
      g.mesh.position.copy(g.pos);
      if (g.age > 6) explodeAt = g.pos.clone();
      if (explodeAt) {
        g.mesh.removeFromParent();
        this.grenades.splice(i, 1);
        ctx.game.explode(explodeAt, GRENADE.radius, WEAPONS.launcher.damage, 'grenade');
      }
    }
  }

  // ------------------------------------------------------------ animation
  private animate(dt: number) {
    const p = ctx.player;
    const vm = this.vms[this.state === 'melee' && this.quickMelee ? 'knife' : this.current];
    const id = vm.id;
    const parts = vm.parts;
    // base pose
    const base = vm.hip.clone().lerp(vm.ads, this.adsT);
    // at the hip the gun is canted slightly inward so its side profile reads
    const rot = new THREE.Euler(0.02 * (1 - this.adsT), 0.1 * (1 - this.adsT), -0.04 * (1 - this.adsT));
    if (vm.idleRot) {
      rot.x += vm.idleRot.x;
      rot.y += vm.idleRot.y;
      rot.z += vm.idleRot.z;
    }
    // sway from look
    const sx = this.swayX.update(clamp(-input.mouseDX * 0.0004, -0.04, 0.04) * (1 - this.adsT * 0.8), dt);
    const sy = this.swayY.update(clamp(input.mouseDY * 0.0004, -0.04, 0.04) * (1 - this.adsT * 0.8), dt);
    const roll = this.swayRoll.update(clamp(-input.mouseDX * 0.002, -0.12, 0.12), dt);
    // movement bob
    const hs = Math.hypot(p.vel.x, p.vel.z);
    if (p.grounded) this.bobPhase += hs * dt * (p.sprinting ? 2.1 : 2.6);
    const bobA = clamp(hs / 3.3, 0, 1.4) * (1 - this.adsT * 0.85);
    const bx = Math.sin(this.bobPhase) * 0.012 * bobA;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.01 * bobA;
    // idle breathing
    const tt = ctx.time;
    const breathe = Math.sin(tt * 1.6) * 0.0025 * (1 - this.adsT * 0.7) * (p.exhausted ? 3 : 1);
    base.x += sx + bx;
    base.y += sy + by + breathe;
    rot.z += roll + bx * 2;
    rot.x += sy * 2;
    rot.y += sx * 2;
    // kick
    const kz = this.kickZ.update(0, dt);
    const kr = this.kickRot.update(0, dt);
    base.z += kz * 0.02;
    rot.x += kr * 0.05;
    // sprint pose
    const s = this.sprintT;
    base.x -= 0.05 * s;
    base.y -= 0.04 * s;
    rot.y += 0.65 * s;
    rot.x -= 0.25 * s;
    rot.z += 0.15 * s;
    // crouch / landing offset
    base.y -= 0.01 * p.crouchT;
    const k = this.dur > 0 ? clamp(this.t / this.dur, 0, 1) : 1;
    // state animations
    switch (this.state) {
      case 'holster':
        base.y -= 0.25 * easeOutCubic(k);
        rot.x -= 0.6 * k;
        break;
      case 'equip': {
        const e = 1 - easeOutCubic(k);
        base.y -= 0.25 * e;
        rot.x -= 0.6 * e;
        rot.z += 0.3 * e;
        break;
      }
      case 'reload':
        this.animReload(vm, k, base, rot);
        break;
      case 'shellStart':
        rot.z += 0.45 * easeOutCubic(k);
        rot.x += 0.15 * k;
        base.y += 0.02 * k;
        break;
      case 'shellLoop': {
        rot.z += 0.45;
        rot.x += 0.15;
        base.y += 0.02;
        const sh = parts.shell;
        sh.visible = k < 0.6;
        const push = smoothstep(0.2, 0.6, k);
        parts.offHand.position.set(0, -0.045 - 0.06 * (1 - push) + 0.02, 0.28 * (1 - Math.abs(push - 0.5) * 2) * 0);
        parts.offHand.rotation.z = 0.4 + 0.5 * (1 - push);
        parts.pump.position.z = -0.4 + 0.22 * Math.sin(Math.min(1, k * 1.4) * Math.PI) * 0.0;
        // hand travels from below to the loading port
        parts.offHand.position.y = -0.045 - 0.08 * Math.sin(k * Math.PI);
        parts.offHand.position.z = 0.25 * Math.sin(k * Math.PI);
        break;
      }
      case 'shellEnd': {
        const e = 1 - easeOutCubic(k);
        rot.z += 0.45 * e;
        rot.x += 0.15 * e;
        parts.shell.visible = false;
        parts.offHand.position.set(0, -0.045, 0);
        parts.offHand.rotation.z = 0.4;
        if (this.pumpAfter) parts.pump.position.z = -0.4 + 0.1 * Math.sin(smoothstep(0.2, 0.8, k) * Math.PI);
        break;
      }
      case 'pump': {
        const pk = smoothstep(0.05, 0.75, k);
        parts.pump.position.z = -0.4 + 0.1 * Math.sin(pk * Math.PI);
        rot.z += 0.06 * Math.sin(pk * Math.PI);
        break;
      }
      case 'melee': {
        const sw = this.meleeSide;
        const a = easeOutCubic(clamp(k * 1.6, 0, 1));
        const back = 1 - smoothstep(0.55, 1, k);
        base.x += (0.12 * sw - 0.28 * sw * a) * back;
        base.y += (0.05 - 0.08 * a) * back;
        base.z += -0.08 * Math.sin(a * Math.PI) * back;
        rot.y += (0.7 * sw - 1.6 * sw * a) * back;
        rot.z += (-0.9 * sw + 0.4 * a * sw) * back;
        rot.x += -0.3 * Math.sin(a * Math.PI) * back;
        break;
      }
    }
    // weapon-specific idle mechanics
    if (id === 'pistol') {
      const slideBack = this.mags.pistol === 0 && this.state !== 'reload' ? 0.045 : Math.max(0, this.fireCd / WEAPONS.pistol.fireInterval) * 0.045;
      parts.slide.position.z = -0.07 + slideBack;
    }
    if (id === 'magnum') {
      parts.hammer.rotation.x = -0.4 - Math.max(0, this.fireCd / WEAPONS.magnum.fireInterval) * 0.6;
      if (this.state !== 'reload') {
        parts.crane.rotation.z = damp(parts.crane.rotation.z, 0, 20, dt);
      }
      parts.cyl.rotation.z = damp(parts.cyl.rotation.z, ((WEAPONS.magnum.mag - this.mags.magnum) * Math.PI) / 3, 18, dt);
    }
    if (id === 'shotgun' && this.state !== 'shellLoop' && this.state !== 'shellEnd') {
      parts.shell.visible = false;
      parts.offHand.position.set(0, -0.045, 0);
      parts.offHand.rotation.z = 0.4;
      if (this.state !== 'pump') parts.pump.position.z = damp(parts.pump.position.z, -0.4, 20, dt);
    }
    vm.root.position.copy(base);
    vm.root.rotation.copy(rot);
    // muzzle flash fade
    if (this.muzzleT <= 0) {
      this.flashMesh.visible = false;
      this.worldMuzzle.intensity = damp(this.worldMuzzle.intensity, 0, 40, dt);
      this.viewMuzzle.intensity = damp(this.viewMuzzle.intensity, 0, 40, dt);
    }
    // flashlight spill on hands
    this.viewFlash.intensity = p.flashOn && p.battery > 0 ? 0.45 : 0;
    // keep view camera in sync with aspect
    const aspect = window.innerWidth / window.innerHeight;
    if (Math.abs(this.viewCam.aspect - aspect) > 0.001) {
      this.viewCam.aspect = aspect;
      this.viewCam.updateProjectionMatrix();
    }
    const vf = lerp(56, 46, this.adsT);
    if (Math.abs(this.viewCam.fov - vf) > 0.01) {
      this.viewCam.fov = vf;
      this.viewCam.updateProjectionMatrix();
    }
  }

  private animReload(vm: Viewmodel, k: number, base: THREE.Vector3, rot: THREE.Euler) {
    const parts = vm.parts;
    const inOut = Math.sin(Math.min(1, k * 1.15) * Math.PI); // tilt in, hold, tilt out
    const tilt = smoothstep(0, 0.15, k) * (1 - smoothstep(0.85, 1, k));
    void inOut;
    if (vm.id === 'pistol') {
      rot.z += 0.55 * tilt;
      rot.x += 0.25 * tilt;
      base.y -= 0.02 * tilt;
      base.x -= 0.03 * tilt;
      // magazine drops out then new one rises
      const outT = smoothstep(0.12, 0.3, k);
      const inT = smoothstep(0.38, 0.62, k);
      parts.mag.position.y = -0.05 - 0.3 * outT * (1 - inT) - 0.0 * inT;
      if (k > 0.3 && k < 0.38) parts.mag.visible = false;
      else parts.mag.visible = true;
      parts.offHand.position.set(-0.04, -0.07 - 0.18 * Math.sin(smoothstep(0.25, 0.62, k) * Math.PI), 0.0);
      if (this.reloadEmpty) {
        const sl = smoothstep(0.82, 0.9, k) * (1 - smoothstep(0.9, 0.95, k));
        parts.slide.position.z = -0.07 + 0.045 * (k < 0.88 ? 1 : 1 - smoothstep(0.88, 0.92, k)) + sl * 0.002;
        rot.z += 0.15 * Math.sin(smoothstep(0.8, 0.95, k) * Math.PI);
      }
      if (k >= 0.99) parts.mag.position.y = -0.05;
    } else if (vm.id === 'magnum') {
      rot.z += 0.8 * tilt;
      rot.x += 0.35 * tilt;
      base.x -= 0.06 * tilt;
      const open = smoothstep(0.08, 0.18, k) * (1 - smoothstep(0.8, 0.9, k));
      parts.crane.rotation.z = 1.1 * open;
      // flick muzzle up to dump shells
      rot.x -= 0.5 * Math.sin(smoothstep(0.2, 0.34, k) * Math.PI);
      parts.offHand.position.set(-0.045, -0.07 - 0.12 * Math.sin(smoothstep(0.38, 0.78, k) * Math.PI * 3) * 0.3, 0.02);
      if (k > 0.86) parts.cyl.rotation.z = 0;
    } else if (vm.id === 'launcher') {
      rot.z += 0.35 * tilt;
      rot.x -= 0.2 * tilt;
      const open = smoothstep(0.1, 0.22, k) * (1 - smoothstep(0.78, 0.88, k));
      parts.barrel.rotation.x = -0.6 * open;
      parts.round.visible = k > 0.35 && k < 0.62;
      parts.offHand.position.set(-0.01, -0.06 - 0.15 * Math.sin(smoothstep(0.3, 0.6, k) * Math.PI), -0.2 + 0.25 * smoothstep(0.35, 0.6, k) * (1 - smoothstep(0.65, 0.8, k)));
    }
  }

  /** Called by the game when the HUD needs ammo numbers. */
  ammoText() {
    if (this.current === 'knife') return null;
    return { mag: this.mags[this.current], reserve: this.reserve() };
  }
}
