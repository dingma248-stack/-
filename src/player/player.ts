import * as THREE from 'three';
import { RAPIER, GROUPS, groups, G } from '../physics/world';
import { ctx } from '../core/ctx';
import { input } from '../core/input';
import { settings } from '../core/settings';
import { PLAYER, NOISE, DIFFICULTY, QUALITY } from '../config';
import { Spring, clamp, damp, lerp, rand } from '../core/math';
import { bus } from '../core/events';
import { TEX } from '../render/textures';
import type { Enemy } from '../enemies/enemy';

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  kcc!: RAPIER.KinematicCharacterController;
  readonly pos = new THREE.Vector3(); // feet
  private prevPos = new THREE.Vector3();
  readonly renderPos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  crouching = false;
  private crouchToggled = false;
  crouchT = 0;
  grounded = true;
  private coyote = 0;
  private jumpBuf = 0;
  stamina = PLAYER.staminaMax;
  exhausted = false;
  private staminaDelay = 0;
  sprinting = false;
  health = PLAYER.maxHealth;
  dead = false;
  invuln = 0;
  battery = PLAYER.flashlightMax;
  flashOn = true;
  /** set false during cutscenes / menus */
  control = true;
  frozen = false;

  // camera fx
  readonly camera: THREE.PerspectiveCamera;
  private bobPhase = 0;
  private bobAmt = 0;
  private landSpring = new Spring(160, 13);
  readonly recoilPitch = new Spring(180, 18);
  readonly recoilYaw = new Spring(180, 18);
  private recoilAccum = 0;
  shake = 0;
  private fovBoost = 0;
  adsFovMul = 1;
  private lastStepPhase = 0;
  private fallSpeed = 0;
  private breath: ReturnType<typeof ctx.audio.loop> = null;
  private heartCd = 0;
  damageFx = 0;
  noiseLevel = 0; // 0..1 how loud the player currently is (for AI)

  // flashlight
  readonly flash: THREE.SpotLight;
  private flashRig = new THREE.Object3D();
  private flashQ = new THREE.Quaternion();
  private flashFlicker = 0;

  // grab state
  grabbedBy: Enemy | null = null;
  grabProgress = 0;
  private grabTimer = 0;
  private grabTick = 0;

  // stats
  distance = 0;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.flash = new THREE.SpotLight(0xfff1dc, 60, 26, 0.48, 0.55, 1.6);
    this.flash.map = TEX.flashlightCookie();
    this.flash.shadow.mapSize.set(512, 512);
    this.flash.shadow.camera.near = 0.15;
    this.flash.shadow.camera.far = 24;
    this.flash.shadow.bias = -0.0008;
    this.flash.shadow.normalBias = 0.02;
    this.flashRig.add(this.flash);
    this.flashRig.add(this.flash.target);
    this.flash.position.set(0.18, -0.16, 0.05);
    this.flash.target.position.set(0, -0.15, -6);
    scene.add(this.flashRig);
    this.applyQuality();
  }

  applyQuality() {
    const q = QUALITY[settings.quality];
    this.flash.castShadow = q.shadows;
  }

  spawn(pos: THREE.Vector3, yaw: number) {
    const world = ctx.physics.world;
    const halfH = (PLAYER.height - PLAYER.radius * 2) / 2;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + halfH + PLAYER.radius + 0.02, pos.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfH, PLAYER.radius).setCollisionGroups(GROUPS.player), this.body);
    ctx.physics.tag(this.collider, { kind: 'player' });
    ctx.physics.track(this.body);
    this.kcc = world.createCharacterController(0.02);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.enableAutostep(0.42, 0.18, false);
    this.kcc.enableSnapToGround(0.35);
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.kcc.setSlideEnabled(true);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(75);
    this.pos.copy(pos);
    this.prevPos.copy(pos);
    this.renderPos.copy(pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.crouching = false;
    this.crouchToggled = false;
    this.crouchT = 0;
    this.jumpBuf = 0;
    // a checkpoint restart begins rested, not still winded from the run that ended in death
    this.stamina = PLAYER.staminaMax;
    this.exhausted = false;
    this.staminaDelay = 0;
    this.stopBreath(); // drop the stale handle (stopAll already silenced it) so the next exhaustion pants again
    this.dead = false;
    this.grabbedBy = null;
    this.control = true;
    this.frozen = false;
    this.fallSpeed = 0;
  }

  teleport(pos: THREE.Vector3, yaw?: number) {
    const halfH = this.halfHeight();
    this.body.setTranslation({ x: pos.x, y: pos.y + halfH + PLAYER.radius + 0.02, z: pos.z }, true);
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y + halfH + PLAYER.radius + 0.02, z: pos.z });
    this.pos.copy(pos);
    this.prevPos.copy(pos);
    this.renderPos.copy(pos);
    this.vel.set(0, 0, 0);
    if (yaw !== undefined) {
      this.yaw = yaw;
      this.pitch = 0;
    }
  }

  private halfHeight() {
    const h = this.crouching ? PLAYER.crouchHeight : PLAYER.height;
    return (h - PLAYER.radius * 2) / 2;
  }

  get eyeHeight() {
    return lerp(PLAYER.height, PLAYER.crouchHeight, this.crouchT) - PLAYER.eyeOffset;
  }

  get eye() {
    return this.camera.position;
  }

  get forward() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  get moving() {
    return Math.hypot(this.vel.x, this.vel.z) > 0.5;
  }

  /** Mouse look (per frame, unsmoothed). */
  look(dt: number) {
    if (!this.control || this.frozen || this.dead) return;
    const sens = 0.0022 * settings.sensitivity * (ctx.weapons.adsT > 0.5 ? 0.72 : 1);
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens * (settings.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.52, 1.52);
    void dt;
  }

  addRecoil(pitch: number, yaw: number) {
    this.recoilPitch.kick(pitch * 22);
    this.recoilYaw.kick(yaw * (Math.random() < 0.5 ? -1 : 1) * 22);
    this.recoilAccum += pitch;
  }

  /**
   * Latch edge-triggered input once per rendered frame. Physics runs 0–4 fixed
   * steps per frame (none at all on many frames of a 144 Hz display), so reading
   * wasPressed() inside fixedUpdate dropped jumps and crouch toggles.
   */
  pollInput() {
    if (!this.control || this.frozen || this.dead || this.grabbedBy) return;
    if (settings.crouchToggle && input.wasPressed('crouch')) this.crouchToggled = !this.crouchToggled;
    if (input.wasPressed('jump')) {
      this.jumpBuf = PLAYER.jumpBuffer;
      if (settings.crouchToggle) this.crouchToggled = false; // jumping stands you up
    }
  }

  /** Fixed-step movement. */
  fixedUpdate(h: number) {
    if (!this.body) return;
    this.prevPos.copy(this.pos);
    const wantCrouch = settings.crouchToggle ? this.crouchToggled : input.isDown('crouch');
    if (this.control && !this.frozen && !this.dead && !this.grabbedBy) this.setCrouch(wantCrouch);
    // ---- input direction ----
    let ix = 0, iz = 0;
    const canMove = this.control && !this.frozen && !this.dead && !this.grabbedBy;
    if (canMove) {
      if (input.isDown('forward')) iz -= 1;
      if (input.isDown('back')) iz += 1;
      if (input.isDown('left')) ix -= 1;
      if (input.isDown('right')) ix += 1;
    }
    const len = Math.hypot(ix, iz);
    if (len > 0) {
      ix /= len;
      iz /= len;
    }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = ix * cos + iz * sin;
    const wz = -ix * sin + iz * cos;
    const ads = ctx.weapons.adsT > 0.3;
    const wantsSprint = canMove && input.isDown('sprint') && iz < 0 && !this.crouching && !ads && !this.exhausted && ctx.weapons.canSprint();
    this.sprinting = wantsSprint && this.stamina > 0 && len > 0;
    let speed = this.crouching ? PLAYER.crouchSpeed : this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    if (ads) speed *= PLAYER.adsSpeedMul;
    if (this.exhausted) speed *= PLAYER.exhaustedSpeedMul;
    if (this.health < 25) speed *= 0.85;
    // ---- stamina ----
    if (this.sprinting) {
      this.stamina -= PLAYER.staminaDrain * h;
      this.staminaDelay = PLAYER.staminaRegenDelay;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
        this.startBreath();
      }
    } else {
      this.staminaDelay -= h;
      if (this.staminaDelay <= 0) this.stamina = Math.min(PLAYER.staminaMax, this.stamina + PLAYER.staminaRegen * h * (this.moving ? 0.6 : 1));
      if (this.exhausted && this.stamina >= PLAYER.exhaustedRecover) {
        this.exhausted = false;
        this.stopBreath();
      }
    }
    // ---- horizontal velocity with short ramp ----
    const tx = wx * speed, tz = wz * speed;
    const accel = this.grounded ? PLAYER.accelTime : PLAYER.airAccelTime;
    const k = 1 - Math.exp(-h / (accel * 0.45));
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    // ---- jump with coyote time + buffer (presses are latched per frame in pollInput) ----
    if (this.grounded) this.coyote = PLAYER.coyoteTime;
    else this.coyote -= h;
    if (canMove && this.jumpBuf > 0 && this.coyote > 0) {
      // always full height: running out of stamina only slows you down
      this.vel.y = PLAYER.jumpVelocity;
      this.jumpBuf = 0;
      this.coyote = 0;
      this.grounded = false;
      this.stamina = Math.max(0, this.stamina - 6);
      this.staminaDelay = PLAYER.staminaRegenDelay;
    }
    this.jumpBuf -= h;
    this.vel.y -= PLAYER.gravity * h;
    if (this.grounded && this.vel.y < 0) this.vel.y = -2;
    // ---- move ----
    const desired = { x: this.vel.x * h, y: this.vel.y * h, z: this.vel.z * h };
    this.kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G.STATIC | G.PROP | G.ENEMY));
    const mv = this.kcc.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded();
    const t = this.body.translation();
    const nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    // ceiling bump
    if (this.vel.y > 0 && mv.y < desired.y * 0.5) this.vel.y = 0;
    // actual horizontal velocity (for sliding along walls)
    if (h > 0) {
      const ax = mv.x / h, az = mv.z / h;
      if (Math.hypot(ax, az) < Math.hypot(this.vel.x, this.vel.z) * 0.5 && len > 0) {
        this.vel.x = damp(this.vel.x, ax, 20, h);
        this.vel.z = damp(this.vel.z, az, 20, h);
      }
    }
    this.pos.set(nx, ny - this.halfHeight() - PLAYER.radius - 0.02, nz);
    this.distance += Math.hypot(mv.x, mv.z);
    // landing
    if (!wasGrounded && this.grounded) {
      const impact = this.fallSpeed;
      if (impact > 3) {
        this.landSpring.kick(-impact * 0.09);
        ctx.audio.play('land', { pos: this.pos, vol: clamp(impact / 9, 0.3, 1) });
        this.footstep(0.9);
        bus.emit('noise', { pos: this.pos.clone(), radius: NOISE.land, source: 'player' });
      }
      if (impact > 11) this.damage((impact - 11) * 6);
    }
    this.fallSpeed = this.grounded ? 0 : Math.max(this.fallSpeed, -this.vel.y);
    if (!this.grounded && this.vel.y < 0) this.fallSpeed = -this.vel.y;
    ctx.props.pushNear(this.pos, this.vel);
  }

  private setCrouch(want: boolean) {
    if (want === this.crouching) return;
    if (!want) {
      // need headroom to stand
      const halfStand = (PLAYER.height - PLAYER.radius * 2) / 2;
      const c = { x: this.pos.x, y: this.pos.y + halfStand + PLAYER.radius + 0.05, z: this.pos.z };
      const hit = ctx.physics.world.intersectionWithShape(c, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(halfStand, PLAYER.radius * 0.95), undefined, groups(0xffff, G.STATIC), this.collider);
      if (hit) return;
    }
    this.crouching = want;
    const halfH = this.halfHeight();
    this.collider.setHalfHeight(halfH);
    const t = this.body.translation();
    const feet = this.pos.y;
    this.body.setTranslation({ x: t.x, y: feet + halfH + PLAYER.radius + 0.02, z: t.z }, true);
  }

  /** Per-frame camera + effects (alpha = physics interpolation factor). */
  update(dt: number, alpha: number) {
    this.renderPos.lerpVectors(this.prevPos, this.pos, alpha);
    this.crouchT = damp(this.crouchT, this.crouching ? 1 : 0, 12, dt);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    // head bob + footsteps
    if (this.grounded && hs > 0.4) {
      const stride = this.sprinting ? PLAYER.stepLength * 1.25 : this.crouching ? PLAYER.stepLength * 0.7 : PLAYER.stepLength;
      this.bobPhase += (hs / stride) * Math.PI * dt;
      this.bobAmt = damp(this.bobAmt, Math.min(1, hs / PLAYER.walkSpeed), 10, dt);
      const stepIdx = Math.floor(this.bobPhase / Math.PI);
      if (stepIdx !== this.lastStepPhase) {
        this.lastStepPhase = stepIdx;
        this.footstep(this.sprinting ? 1 : this.crouching ? 0.35 : 0.65);
        bus.emit('noise', {
          pos: this.pos.clone(),
          radius: this.sprinting ? NOISE.sprintStep : this.crouching ? NOISE.crouchStep : NOISE.walkStep,
          source: 'player',
        });
      }
    } else this.bobAmt = damp(this.bobAmt, 0, 8, dt);
    this.noiseLevel = damp(this.noiseLevel, this.sprinting ? 1 : this.crouching ? 0.1 : hs > 0.5 ? 0.4 : 0.05, 4, dt);
    const bobOn = settings.headBob ? 1 : 0.15;
    const bob = PLAYER.bobAmount * this.bobAmt * bobOn * (this.sprinting ? 1.5 : 1) * (1 - ctx.weapons.adsT * 0.7);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * bob - bob * 0.5;
    const bobX = Math.cos(this.bobPhase) * bob * 0.6;
    const land = this.landSpring.update(0, dt);
    // recoil
    const rp = this.recoilPitch.update(0, dt);
    const ry = this.recoilYaw.update(0, dt);
    // permanent recoil slowly recovers into aim
    if (this.recoilAccum > 0) {
      const rec = Math.min(this.recoilAccum, this.recoilAccum * 6 * dt + 0.0005);
      this.recoilAccum -= rec;
      this.pitch = clamp(this.pitch + rec * 0.35, -1.52, 1.52);
    }
    // shake
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake * 0.05;
    const cam = this.camera;
    const eyeY = this.renderPos.y + this.eyeHeight + bobY + land;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    cam.position.set(this.renderPos.x, eyeY, this.renderPos.z).addScaledVector(right, bobX);
    cam.rotation.set(0, 0, 0);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch + rp + rand(-sh, sh), this.yaw + ry + rand(-sh, sh), bobX * 0.4 + rand(-sh, sh) * 0.5, 'YXZ'));
    // fov
    this.fovBoost = damp(this.fovBoost, this.sprinting ? PLAYER.sprintFovBoost : 0, 6, dt);
    const fov = (settings.fov + this.fovBoost) * this.adsFovMul;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    // flashlight rig lags behind the camera slightly
    this.flashRig.position.copy(cam.position);
    this.flashQ.slerp(cam.quaternion, 1 - Math.exp(-16 * dt));
    this.flashRig.quaternion.copy(this.flashQ);
    this.updateFlashlight(dt);
    // health fx
    this.invuln = Math.max(0, this.invuln - dt);
    this.damageFx = Math.max(0, this.damageFx - dt * 1.6);
    const low = clamp(1 - this.health / 45, 0, 1);
    ctx.renderer.fx.damage = this.damageFx;
    ctx.renderer.fx.lowHealth = this.dead ? 1 : low;
    if (low > 0 && !this.dead) {
      this.heartCd -= dt;
      if (this.heartCd <= 0) {
        ctx.audio.play('heartbeat', { vol: 0.35 + low * 0.5, bus: 'sfx', reverb: 0 });
        this.heartCd = lerp(1.1, 0.55, low);
      }
    }
    this.updateGrab(dt);
  }

  private updateFlashlight(dt: number) {
    const f = this.flash;
    const envMul = ctx.level?.env.flashlight ?? 1;
    if (this.flashOn && this.battery > 0) {
      this.battery = Math.max(0, this.battery - PLAYER.flashlightDrain * dt);
      let lv = 1;
      if (this.battery < 15) {
        this.flashFlicker -= dt;
        if (this.flashFlicker <= 0) this.flashFlicker = rand(0.05, 0.6);
        lv = this.flashFlicker < 0.08 ? 0.2 : 0.75;
        if (this.battery < 15 && ctx.inventory.count('battery') > 0) this.useBattery(true);
      }
      f.intensity = 55 * lv * envMul;
    } else f.intensity = 0;
    void dt;
  }

  useBattery(auto = false) {
    if (ctx.inventory.count('battery') <= 0) return false;
    if (!auto && this.battery > PLAYER.flashlightMax - 5) {
      ctx.ui.toast('手电电量充足');
      return false;
    }
    ctx.inventory.take('battery', 1);
    this.battery = Math.min(PLAYER.flashlightMax, this.battery + PLAYER.batteryCharge);
    ctx.audio.play('battery', { bus: 'ui' });
    ctx.ui.toast('更换了手电电池');
    return true;
  }

  toggleFlashlight() {
    this.flashOn = !this.flashOn;
    ctx.audio.play('flashlight', { bus: 'ui', vol: 0.8 });
    if (this.flashOn && this.battery <= 0) ctx.ui.toast('手电没电了');
  }

  footstep(vol: number) {
    const lvl = ctx.level;
    const kind = lvl ? lvl.footstepAt(this.pos) : 'concrete';
    ctx.audio.play('step_' + kind, { pos: this.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), vol: vol * 0.7, rateVar: 0.08, occlude: false, ref: 3 });
  }

  heal(n: number) {
    this.health = Math.min(PLAYER.maxHealth, this.health + n);
  }

  damage(amount: number, from?: THREE.Vector3) {
    if (this.dead || this.invuln > 0 || ctx.game.godMode) return;
    const dmg = amount * DIFFICULTY[ctx.difficulty].enemyDmg;
    this.health -= dmg;
    this.damageFx = Math.min(1, this.damageFx + 0.45 + dmg / 60);
    this.shake = Math.min(1.2, this.shake + 0.5 + dmg / 40);
    ctx.audio.play('hurt', { vol: 0.8, reverb: 0 });
    if (from) {
      const d = from.clone().sub(this.pos);
      this.recoilYaw.kick((Math.atan2(d.x, d.z) > 0 ? 1 : -1) * 1.5);
    }
    this.recoilPitch.kick(1.8);
    bus.emit('playerDamaged', { amount: dmg, from });
    if (this.health <= 0) {
      this.health = 0;
      this.die();
    }
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.stopBreath();
    this.grabbedBy = null;
    ctx.game.onPlayerDeath();
  }

  private startBreath() {
    if (!this.breath) this.breath = ctx.audio.loop('breath', { vol: 0.55, reverb: 0 });
  }
  private stopBreath() {
    this.breath?.stop(0.8);
    this.breath = null;
  }

  // ---------------- grab ----------------
  grab(e: Enemy) {
    if (this.grabbedBy || this.dead || this.invuln > 0) return false;
    this.grabbedBy = e;
    this.grabProgress = 0;
    this.grabTimer = 0;
    this.grabTick = 0.5;
    ctx.ui.grabPrompt(true);
    this.shake = 0.8;
    return true;
  }

  private updateGrab(dt: number) {
    const e = this.grabbedBy;
    if (!e) return;
    if (e.dead) {
      this.release(false);
      return;
    }
    this.grabTimer += dt;
    // face the attacker
    const d = e.headPos().sub(this.camera.position);
    const targetYaw = Math.atan2(-d.x, -d.z);
    let dy = targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * 10);
    this.pitch = damp(this.pitch, Math.atan2(d.y, Math.hypot(d.x, d.z)), 10, dt);
    if (input.wasPressed('interact') || input.wasPressed('fire')) {
      this.grabProgress += 1 / PLAYER.grabEscapePresses;
      this.shake = Math.min(1, this.shake + 0.15);
      ctx.audio.play('impactFlesh', { vol: 0.3 });
    }
    this.grabProgress = Math.max(0, this.grabProgress - dt * 0.12);
    this.grabTick -= dt;
    if (this.grabTick <= 0) {
      this.grabTick = 0.6;
      this.invuln = 0;
      this.damage(PLAYER.grabDamagePerSecond * 0.6, e.pos);
      ctx.audio.play('bite', { pos: e.headPos(), vol: 0.9 });
      ctx.particles.blood(this.camera.position.clone().add(this.forward.multiplyScalar(0.4)), new THREE.Vector3(0, 0.5, 0), 10);
    }
    ctx.ui.grabProgress(this.grabProgress);
    if (this.grabProgress >= 1) this.release(true);
    else if (this.grabTimer > 3.2) {
      this.damage(22, e.pos);
      this.release(false);
    }
  }

  release(escaped: boolean) {
    const e = this.grabbedBy;
    this.grabbedBy = null;
    ctx.ui.grabPrompt(false);
    this.invuln = 1.2;
    if (e && !e.dead) e.onGrabEnd(escaped);
  }

  /** Current eye-space up vector, used by weapons. */
  up() {
    return UP.clone().applyQuaternion(this.camera.quaternion);
  }
}
