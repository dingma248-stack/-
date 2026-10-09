import * as THREE from 'three';
import { ctx } from './core/ctx';
import { input } from './core/input';
import { settings, onSettingsChange } from './core/settings';
import { bus } from './core/events';
import { Physics, GROUPS } from './physics/world';
import { Props } from './physics/props';
import { RetroRenderer } from './render/renderer';
import { LightPool } from './render/lights';
import { Particles } from './render/particles';
import { Decals, Rain } from './render/decals';
import { AudioEngine } from './audio/engine';
import { Music } from './audio/music';
import { Player } from './player/player';
import { Inventory, type ItemId } from './player/inventory';
import { Weapons } from './weapons/weapons';
import { EnemyManager } from './enemies/manager';
import { Director } from './enemies/director';
import { Story } from './story/story';
import { UI, fmtTime } from './ui/ui';
import { Level, type Interactable } from './levels/level';
import { CHAPTERS, PURGE_CLOCK, chapterIndex } from './levels/meta';
import { buildChapter, type ChapterRun } from './levels/chapters';
import { buildTitle, type TitleRun } from './levels/title';
import { QUALITY, PLAYER, type Difficulty } from './config';
import { readSave, writeSave, readProgress, writeProgress, unlockChapter, emptyStats, type SaveData, type Stats } from './save/save';
import { clamp, damp, rand } from './core/math';
import { fleshUniforms } from './levels/props';
import { retroUniforms } from './render/materials';
import { loadExternalAssets } from './core/assets';

type State = 'boot' | 'title' | 'loading' | 'play' | 'paused' | 'dead' | 'ending';

export class Game {
  state: State = 'boot';
  readonly canvas: HTMLCanvasElement;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  renderer!: RetroRenderer;
  chapterId = 'prologue';
  checkpointId = 'start';
  clock = 1360;
  private clockRate = 0;
  private clockCap = 1740;
  stats: Stats = emptyStats();
  godMode = false;
  private debugOn = new URLSearchParams(location.search).has('debug');
  private run: ChapterRun | null = null;
  private title: TitleRun | null = null;
  private rain: Rain | null = null;
  private last = performance.now();
  private overlayPause = false;
  private focusInteract: Interactable | null = null;
  private exploreT = 0;
  private occT = 0;
  private healCd = 0;
  objectivePos: THREE.Vector3 | null = null;
  killed = new Set<string>();
  private fps = 60;
  private loadSeq = 0;
  private deathT = 0;
  private flashT = 0;

  constructor() {
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    this.camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.05, 140);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      ctx.story?.cutCam && ((ctx.story.cutCam.aspect = this.camera.aspect), ctx.story.cutCam.updateProjectionMatrix());
    });
  }

  async boot() {
    ctx.game = this;
    ctx.scene = this.scene;
    ctx.camera = this.camera;
    const ui = new UI();
    ctx.ui = ui;
    input.init(this.canvas);
    this.renderer = new RetroRenderer(this.canvas);
    ctx.renderer = this.renderer;
    const audio = new AudioEngine();
    ctx.audio = audio;
    // fonts first so nothing flashes
    const fontsReady = Promise.race([
      Promise.all([
        document.fonts.load('700 64px "Noto Serif SC"', '雾港长夜你没能看到黎明'),
        document.fonts.load('400 20px "Noto Serif SC"', '新游戏继续章节选择设置制作人员'),
        document.fonts.load('italic 500 20px "Cormorant Garamond"', 'Press any key'),
        document.fonts.load('400 14px "JetBrains Mono"', '0123456789'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    await Physics.init();
    const physics = new Physics();
    physics.create();
    ctx.physics = physics;
    ctx.music = new Music(audio);
    ctx.particles = new Particles();
    ctx.particles.attach(this.scene);
    ctx.decals = new Decals();
    this.scene.add(ctx.decals.group);
    ctx.props = new Props();
    this.scene.add(ctx.props.group);
    ctx.lights = new LightPool(this.scene, QUALITY[settings.quality].lights);
    ctx.inventory = new Inventory();
    ctx.player = new Player(this.scene, this.camera);
    ctx.weapons = new Weapons(this.scene);
    ctx.enemies = new EnemyManager();
    this.scene.add(ctx.enemies.group);
    ctx.director = new Director();
    ctx.story = new Story();
    audio.occluder = (a, b) => !physics.lineOfSight(a, b, GROUPS.sight);
    this.applyParticleQuality();
    bus.on('enemyKilled', (e) => {
      this.stats.kills++;
      if (e.headshot) this.stats.headshots++;
    });
    onSettingsChange(() => this.applyParticleQuality());
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    this.canvas.addEventListener('click', () => {
      if (this.state === 'play' && !input.locked && !this.overlayPause) input.requestLock();
    });
    await fontsReady;
    await audio.bake((p) => ui.bootProgress(p));
    await loadExternalAssets();
    this.loop();
    ui.bootReady(() => this.enterTitle(true));
  }

  private applyParticleQuality() {
    ctx.particles.mul = QUALITY[settings.quality].particles;
  }

  applyQuality() {
    // light pool size and shadows only take full effect on the next level load
    ctx.player.applyQuality();
    this.applyParticleQuality();
  }

  // ------------------------------------------------------------ title
  private async enterTitle(first = false) {
    await ctx.audio.resume();
    ctx.music.start();
    this.state = 'title';
    this.unloadLevel();
    const L = new Level('title', {
      fog: 0x0b0e13,
      fogDensity: 0.045,
      ambient: 0x2a3444,
      ambientI: 0.35,
      hemiSky: 0x30405a,
      hemiGround: 0x120c08,
      hemiI: 0.4,
      grade: { lift: new THREE.Color(0.012, 0.016, 0.03), gain: new THREE.Color(1.0, 0.96, 0.92), sat: 0.85, contrast: 1.08, bloom: 0.75 },
      reverb: 'outdoor',
      root: 45,
      rain: true,
    });
    ctx.level = L;
    this.title = buildTitle(L);
    this.scene.add(L.group);
    L.applyEnv(this.scene);
    L.finalize();
    this.setupRain(true);
    L.startAmbience();
    ctx.music.only({ theme: 0.75, ambient: 0.35 }, first ? 3 : 1.5);
    ctx.renderer.fx.fade = 1;
    ctx.ui.showHud(false);
    ctx.ui.showTitle();
    input.exitLock();
  }

  // ------------------------------------------------------------ chapters
  newGame(diff: Difficulty) {
    this.stats = emptyStats();
    this.killed.clear();
    ctx.difficulty = diff;
    ctx.inventory.reset();
    ctx.weapons.reset();
    ctx.story.flags = {};
    ctx.player.health = PLAYER.maxHealth;
    ctx.player.battery = PLAYER.flashlightMax;
    this.startChapter('prologue', diff, 'start', true);
  }

  continueGame() {
    const s = readSave();
    if (!s) return;
    this.loadSave(s);
  }

  private loadSave(s: SaveData) {
    ctx.difficulty = s.difficulty;
    this.stats = { ...s.stats };
    ctx.inventory.restore(s.inv);
    ctx.weapons.reset();
    for (const w of s.inv.weapons) if (w !== 'knife') ctx.weapons.owned.push(w);
    Object.assign(ctx.weapons.mags, s.inv.mags);
    // come back holding the best everyday weapon rather than the knife
    ctx.weapons.current = [...ctx.weapons.owned].reverse().find((w) => w !== 'launcher' && w !== 'knife') ?? 'knife';
    ctx.story.flags = { ...s.flags };
    this.killed = new Set((s.flags.__killed as string[]) ?? []);
    ctx.player.health = s.health;
    ctx.player.battery = s.battery;
    this.clock = s.clock;
    this.startChapter(s.chapter, s.difficulty, s.checkpoint, false, s);
  }

  /** Chapter-select entry: fresh state, chapter supplies a fair loadout. */
  selectChapter(id: string, diff: Difficulty = 'normal') {
    this.stats = emptyStats();
    this.killed.clear();
    ctx.inventory.reset();
    ctx.weapons.reset();
    ctx.story.flags = {};
    ctx.player.health = PLAYER.maxHealth;
    ctx.player.battery = PLAYER.flashlightMax;
    this.startChapter(id, diff, 'start', true);
  }

  /** Story progression: carry everything over. */
  nextChapter(id: string) {
    if (ctx.player.dead || this.state !== 'play') return;
    this.killed.clear();
    this.startChapter(id, ctx.difficulty, 'start', false);
  }

  /** Chapter select / new chapter. Fresh loadout is given by the chapter itself when starting from scratch. */
  async startChapter(id: string, diff: Difficulty, checkpoint = 'start', fresh = true, save?: SaveData) {
    const seq = ++this.loadSeq;
    ctx.audio.resume();
    ctx.audio.setDuck(1, 0.1);
    this.overlayPause = false;
    ctx.difficulty = diff;
    this.state = 'loading';
    ctx.ui.hideTitle();
    ctx.ui.hideAllOverlays();
    ctx.ui.hideEnding();
    ctx.ui.showHud(false);
    ctx.ui.showLoading(true);
    this.canvas.classList.remove('blurred', 'dim');
    ctx.music.only({}, 0.6);
    ctx.audio.stopAll(0.5);
    input.requestLock();
    await new Promise((r) => setTimeout(r, 650));
    if (seq !== this.loadSeq) return;
    try {
      this.unloadLevel();
      const meta = CHAPTERS[chapterIndex(id)];
      this.chapterId = id;
      this.checkpointId = checkpoint;
      if (!save) this.clock = meta.clock;
      // physics + level
      const L = this.buildLevel(id, checkpoint, save, fresh && !save);
      if (!save) this.checkpointId = 'start';
      const next = CHAPTERS[chapterIndex(id) + 1];
      this.clockCap = next ? next.clock - 1 : PURGE_CLOCK - 120;
      this.clockRate = ((this.clockCap - meta.clock) / meta.expected) * 0.9;
      void L;
      unlockChapter(id);
      await new Promise((r) => setTimeout(r, 400));
      if (seq !== this.loadSeq) return;
      ctx.ui.showLoading(false);
      if (checkpoint === 'start' && !save) {
        await ctx.ui.chapterCard(meta);
        if (seq !== this.loadSeq) return;
      }
    } catch (err) {
      if (seq !== this.loadSeq) return;
      console.error(err);
      input.exitLock();
      ctx.ui.loadFailed(String((err as Error)?.message ?? err), () => void this.startChapter(id, diff, checkpoint, fresh, save));
      return;
    }
    this.beginPlay();
  }

  private buildLevel(id: string, checkpoint: string, save: SaveData | undefined, fresh: boolean) {
    ctx.physics.destroy();
    ctx.physics.create();
    ctx.lights.dispose();
    ctx.lights = new LightPool(this.scene, QUALITY[settings.quality].lights);
    ctx.enemies.init();
    ctx.director.reset();
    ctx.story.reset();
    ctx.weapons.clearProjectiles();
    const run = buildChapter(id, checkpoint, { fresh, taken: new Set(save?.taken ?? []) });
    this.run = run;
    const L = run.level;
    ctx.level = L;
    this.scene.add(L.group);
    L.applyEnv(this.scene);
    L.finalize();
    this.setupRain(!!L.env.rain);
    ctx.player.spawn(run.spawn.pos, run.spawn.yaw);
    ctx.physics.refresh();
    this.objectivePos = null;
    ctx.particles.setScale(this.renderer.lowH, settings.fov);
    return L;
  }

  setupRain(on: boolean) {
    if (on && !this.rain) {
      this.rain = new Rain();
      this.scene.add(this.rain.mesh);
    } else if (!on && this.rain) {
      this.scene.remove(this.rain.mesh);
      this.rain = null;
    }
  }

  private beginPlay() {
    this.state = 'play';
    ctx.ui.showHud(true);
    ctx.ui.setLocation(CHAPTERS[chapterIndex(this.chapterId)].place2);
    ctx.ui.objective(ctx.level?.objective ?? '');
    ctx.level!.startAmbience();
    ctx.renderer.fx.fade = 1;
    this.flashT = 0;
    this.last = performance.now();
    if (!input.locked) input.requestLock();
    this.run?.start();
  }

  private unloadLevel() {
    ctx.story.reset();
    ctx.enemies.clear();
    ctx.props.clear();
    ctx.decals.clear();
    ctx.particles.clear();
    ctx.weapons.clearProjectiles();
    if (ctx.level) {
      ctx.level.dispose();
      ctx.level = null;
    }
    this.title = null;
    this.run = null;
    ctx.lights.clear();
    ctx.player.grabbedBy = null;
  }

  // ------------------------------------------------------------ checkpoints
  checkpoint(id: string, manual = false) {
    this.checkpointId = id;
    const p = ctx.player;
    const data: SaveData = {
      version: 1,
      chapter: this.chapterId,
      checkpoint: id,
      difficulty: ctx.difficulty,
      health: Math.max(p.health, manual ? p.health : 35),
      battery: p.battery,
      inv: ctx.inventory.snapshot(ctx.weapons.owned, ctx.weapons.mags, p.battery),
      flags: { ...ctx.story.flags, __killed: [...this.killed] },
      taken: [...(ctx.level?.taken ?? [])],
      stats: { ...this.stats },
      clock: this.clock,
      savedAt: Date.now(),
    };
    if (manual) this.stats.saves++;
    writeSave(data);
    ctx.ui.savePulse();
  }

  restartCheckpoint() {
    const s = readSave();
    ctx.ui.showDeath(false);
    ctx.ui.showPause(false);
    if (s && s.chapter === this.chapterId) this.loadSave(s);
    else if (s) this.loadSave(s);
    else this.newGame(ctx.difficulty);
  }

  quitToTitle() {
    this.loadSeq++;
    this.overlayPause = false;
    ctx.ui.hideAllOverlays();
    ctx.ui.hideEnding();
    this.canvas.classList.remove('blurred', 'dim');
    ctx.audio.stopAll(0.4);
    ctx.audio.setDuck(1);
    this.renderer.fx.damage = 0;
    this.renderer.fx.lowHealth = 0;
    this.enterTitle();
  }

  // ------------------------------------------------------------ pause
  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.canvas.classList.add('blurred');
    ctx.audio.setDuck(0.25, 0.15);
    ctx.ui.showPause(true, this.stats);
    ctx.ui.showInventory(false);
    input.exitLock();
  }

  resume() {
    if (this.state !== 'paused') return;
    ctx.ui.showPause(false);
    this.canvas.classList.remove('blurred');
    ctx.audio.setDuck(1, 0.2);
    this.state = 'play';
    this.last = performance.now();
    input.requestLock();
  }

  setOverlayPause(on: boolean) {
    this.overlayPause = on;
    if (on) {
      this.canvas.classList.add('dim');
      input.exitLock();
      ctx.audio.setDuck(0.4, 0.2);
    } else {
      this.canvas.classList.remove('dim');
      ctx.audio.setDuck(1, 0.2);
      input.requestLock();
      setTimeout(() => {
        if (this.state === 'play' && !input.locked && !this.overlayPause) this.pause();
      }, 400);
    }
  }

  private onLockChange() {
    if (!input.locked && this.state === 'play' && !this.overlayPause && !ctx.ui.inventoryOpen) this.pause();
  }

  // ------------------------------------------------------------ death / ending
  onPlayerDeath() {
    this.stats.deaths++;
    this.state = 'dead';
    this.deathT = 0;
    ctx.audio.play('stingerLow', { vol: 0.9, bus: 'music' });
    ctx.music.only({ tension: 0.3 }, 0.5);
    ctx.ui.showInventory(false);
    ctx.ui.prompt(null);
    input.exitLock();
    setTimeout(() => {
      if (this.state === 'dead') {
        ctx.ui.showHud(false);
        ctx.ui.showDeath(true);
      }
    }, 2200);
  }

  finish(endingId: 'dawn' | 'alone', text: { title: string; en: string; body: string }) {
    if (ctx.player.dead) return;
    this.state = 'ending';
    input.exitLock();
    ctx.ui.showHud(false);
    const s = this.stats;
    const acc = s.shots ? s.hits / s.shots : 0;
    const mins = s.time / 60;
    let score = 0;
    score += mins < 30 ? 3 : mins < 40 ? 2 : mins < 55 ? 1 : 0;
    score += s.deaths === 0 ? 3 : s.deaths < 3 ? 2 : s.deaths < 6 ? 1 : 0;
    score += acc > 0.6 ? 2 : acc > 0.4 ? 1 : 0;
    score += s.saves <= 3 ? 1 : 0;
    if (ctx.difficulty === 'nightmare') score += 2;
    if (ctx.difficulty === 'easy') score -= 2;
    const rank = score >= 8 ? 'S' : score >= 6 ? 'A' : score >= 3 ? 'B' : 'C';
    const prog = readProgress();
    const unlock: string[] = [];
    if (!prog.cleared) unlock.push('章节选择（全部）', '结局画廊', '噩梦难度');
    if (!prog.endings.includes(endingId)) prog.endings.push(endingId);
    prog.cleared = true;
    for (const c of CHAPTERS) if (!prog.chapters.includes(c.id)) prog.chapters.push(c.id);
    if (!prog.bestTime || s.time < prog.bestTime) prog.bestTime = s.time;
    const order = ['C', 'B', 'A', 'S'];
    if (!prog.bestRank || order.indexOf(rank) > order.indexOf(prog.bestRank)) prog.bestRank = rank;
    writeProgress(prog);
    ctx.music.only({ theme: 0.8 }, 3);
    ctx.ui.showEnding({ id: endingId, title: text.title, en: text.en, text: text.body, stats: s, rank, unlock });
    void fmtTime;
  }

  // ------------------------------------------------------------ gameplay helpers
  useHeal(pref?: ItemId) {
    const p = ctx.player;
    if (this.healCd > 0 || p.dead) return;
    if (p.health >= PLAYER.maxHealth) {
      ctx.ui.toast('生命值已满');
      return;
    }
    const inv = ctx.inventory;
    const missing = PLAYER.maxHealth - p.health;
    let item: ItemId | null = pref ?? null;
    if (!item) item = missing <= 40 && inv.count('bandage') > 0 ? 'bandage' : inv.count('medkit') > 0 ? 'medkit' : inv.count('bandage') > 0 ? 'bandage' : null;
    if (!item || inv.count(item) <= 0) {
      ctx.ui.toast('没有医疗物品');
      return;
    }
    inv.take(item, 1);
    p.heal(item === 'medkit' ? 80 : 30);
    ctx.audio.play('heal', { bus: 'ui' });
    ctx.ui.toast(item === 'medkit' ? '使用了急救包' : '使用了止血绷带');
    this.healCd = 1;
  }

  /** Explosion: damage, physics, effects. */
  explode(pos: THREE.Vector3, radius: number, damage: number, kind: 'grenade' | 'tank' = 'grenade') {
    ctx.particles.explosion(pos);
    ctx.audio.play('explosion', { pos, vol: 1, ref: 6, rolloff: 0.6, occlude: false });
    const light = ctx.lights.add({ pos: pos.clone().add(new THREE.Vector3(0, 0.5, 0)), color: 0xffa050, intensity: 80, distance: radius * 3, kind: 'steady' });
    let t = 0;
    const fade = () => {
      t += 1 / 60;
      light.intensity = 80 * Math.max(0, 1 - t / 0.5);
      if (t < 0.5) requestAnimationFrame(fade);
      else ctx.lights.remove(light);
    };
    requestAnimationFrame(fade);
    ctx.enemies.blast(pos, radius, damage);
    ctx.props.blast(pos, radius, 26);
    const hit = ctx.physics.raycast(pos, new THREE.Vector3(0, -1, 0), 2, GROUPS.sight);
    if (hit) ctx.decals.add('scorch', hit.point, hit.normal, radius * 0.6, 200);
    const p = ctx.player;
    const d = p.camera.position.distanceTo(pos);
    p.shake = Math.min(1.5, p.shake + clamp(1.6 - d / 10, 0.1, 1.5));
    this.renderer.fx.flash = Math.max(this.renderer.fx.flash, clamp(0.5 - d / 30, 0, 0.5));
    if (d < radius && ctx.physics.lineOfSight(pos, p.camera.position)) p.damage((kind === 'tank' ? 0.6 : 0.5) * damage * (1 - d / radius) * 0.5, pos);
    bus_noise(pos, 45);
  }

  // ------------------------------------------------------------ main loop
  private loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const rawDt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fps = damp(this.fps, 1 / Math.max(rawDt, 1e-4), 3, rawDt);
    try {
      this.frame(rawDt);
    } catch (err) {
      console.error(err);
    }
    input.endFrame();
  };

  private frame(dt: number) {
    const R = this.renderer;
    const p = ctx.player;
    // global keys
    if (this.debugOn || input.codePressed('Backquote')) {
      if (input.codePressed('Backquote')) this.debugOn = !this.debugOn;
    }
    if (this.state === 'title') {
      ctx.time += dt;
      this.updateShared(dt);
      R.fx.fade = damp(R.fx.fade, 0, 0.8, dt);
      if (this.title) this.title.update(dt, ctx.time, this.camera);
      ctx.level?.update(dt, ctx.time);
      this.rain?.update(ctx.time, this.camera.position);
      ctx.lights.update(ctx.time, this.camera.position);
      ctx.audio.setListener(this.camera);
      R.render(this.scene, this.camera, ctx.time);
      return;
    }
    if (this.state === 'boot' || this.state === 'loading' || !ctx.level) {
      R.fx.fade = 1;
      R.render(this.scene, this.camera, ctx.time);
      return;
    }
    // the backpack freezes the world (like reading a document); Tab / Esc closes it
    if (this.state === 'play' && ctx.ui.inventoryOpen && (input.wasPressed('inventory') || input.wasPressed('pause'))) this.toggleInventory();
    const playing = this.state === 'play' && !this.overlayPause;
    const dying = this.state === 'dead';
    if (playing || dying) {
      const gdt = dying ? dt * 0.35 : dt;
      ctx.time += gdt;
      this.stats.time += dt;
      this.clock = Math.min(this.clockCap, this.clock + (this.clockRate * gdt) / 60);
      if (playing) this.handleInput();
      // physics
      ctx.physics.step(gdt, (h) => p.fixedUpdate(h));
      p.look(gdt);
      p.update(gdt, 1);
      ctx.weapons.update(gdt);
      ctx.enemies.update(gdt);
      ctx.props.update(gdt);
      if (!dying) {
        // scripts, triggers and timers stop the moment the player dies
        ctx.level.update(gdt, ctx.time);
        ctx.story.update(gdt);
        this.run?.update?.(gdt);
      }
      ctx.director.update(gdt);
      this.updateShared(gdt);
      this.healCd -= gdt;
      // exploration
      this.exploreT -= gdt;
      if (this.exploreT <= 0) {
        this.exploreT = 0.25;
        ctx.level.explore(p.pos);
      }
      this.occT -= gdt;
      if (this.occT <= 0) {
        this.occT = 0.25;
        ctx.audio.updateOcclusion();
      }
      if (playing) this.updateInteraction();
      else ctx.ui.prompt(null);
      ctx.ui.update(gdt);
      // fades
      this.flashT += gdt;
      if (dying) {
        this.deathT += dt;
        R.fx.fade = clamp((this.deathT - 0.8) / 1.6, 0, 1);
        R.post.uniforms.uFadeColor.value.setRGB(0.12 * (1 - clamp(this.deathT / 2.5, 0, 1)), 0, 0);
      } else {
        R.fx.fade = damp(R.fx.fade, 0, 1.6, dt);
        R.post.uniforms.uFadeColor.value.setRGB(0, 0, 0);
      }
    }
    R.fx.flash = damp(R.fx.flash, 0, 8, dt);
    // camera choice
    let cam: THREE.Camera = this.camera;
    if (ctx.story.usingCutCam) {
      cam = ctx.story.cutCam;
      ctx.story.cutCam.aspect = this.camera.aspect;
      ctx.story.cutCam.updateProjectionMatrix();
    }
    this.rain?.update(ctx.time, (cam as THREE.PerspectiveCamera).position);
    ctx.lights.update(ctx.time, (cam as THREE.PerspectiveCamera).position);
    ctx.audio.setListener(cam);
    const showView = cam === this.camera && !p.dead && p.control !== false;
    R.render(this.scene, cam, ctx.time, showView ? { scene: ctx.weapons.viewScene, camera: ctx.weapons.viewCam } : undefined);
    this.updateViewLighting();
    if (this.debugOn) this.updateDebug();
    else ctx.ui.debug(null);
  }

  private updateShared(dt: number) {
    ctx.particles.update(dt);
    ctx.decals.update(dt);
    fleshUniforms.uTime.value = ctx.time;
    retroUniforms.uTime.value = ctx.time;
  }

  private handleInput() {
    const p = ctx.player;
    if (input.wasPressed('pause')) {
      if (ctx.ui.docOpen) ctx.ui.closeDoc();
      else this.pause();
      return;
    }
    if (ctx.ui.docOpen) {
      if (input.wasPressed('interact')) ctx.ui.closeDoc();
      return;
    }
    if (input.wasPressed('inventory') && !ctx.story.inCutscene) this.toggleInventory();
    if (ctx.ui.inventoryOpen || !p.control) return;
    if (input.wasPressed('flashlight')) p.toggleFlashlight();
    if (input.wasPressed('heal')) this.useHeal();
    if (input.wasPressed('interact') && this.focusInteract && !p.grabbedBy) {
      const it = this.focusInteract;
      it.use();
    }
  }

  private toggleInventory() {
    const open = !ctx.ui.inventoryOpen;
    ctx.ui.showInventory(open);
    if (open) {
      input.exitLock();
      this.canvas.classList.add('dim');
      this.overlayPause = true;
      ctx.audio.setDuck(0.4, 0.2);
    } else {
      this.canvas.classList.remove('dim');
      this.overlayPause = false;
      ctx.audio.setDuck(1, 0.2);
      this.last = performance.now();
      input.requestLock();
      setTimeout(() => {
        if (this.state === 'play' && !input.locked && !ctx.ui.inventoryOpen && !this.overlayPause) this.pause();
      }, 400);
    }
  }

  private updateInteraction() {
    const p = ctx.player;
    const lvl = ctx.level!;
    if (!p.control || p.grabbedBy) {
      this.focusInteract = null;
      ctx.ui.prompt(null);
      return;
    }
    const eye = p.camera.position;
    const fwd = p.forward;
    let best: Interactable | null = null;
    let bestScore = Infinity;
    for (const it of lvl.interactables) {
      if (!it.enabled) continue;
      const to = it.pos.clone().sub(eye);
      const d = to.length();
      if (d > it.radius) continue;
      const ang = to.normalize().angleTo(fwd);
      if (ang > 0.55 && d > 0.9) continue;
      const score = ang * 2 + d * 0.3;
      if (score < bestScore && it.label()) {
        if (!ctx.physics.lineOfSight(eye, it.pos.clone().lerp(eye, 0.12))) continue;
        bestScore = score;
        best = it;
      }
    }
    this.focusInteract = best;
    ctx.ui.prompt(best ? best.label() : null, best?.pos.clone().add(new THREE.Vector3(0, 0.25, 0)));
  }

  private updateViewLighting() {
    // tint the first-person arms with nearby light so they sit in the scene
    const pos = ctx.player.camera.position;
    const env = ctx.level?.env;
    const c = new THREE.Color(env?.ambient ?? 0x202020).multiplyScalar((env?.ambientI ?? 0.3) * 1.2);
    for (const s of ctx.lights.sources) {
      const d = s.pos.distanceTo(pos);
      if (d > s.distance) continue;
      const k = (s.intensity * s.level * Math.pow(1 - d / s.distance, 2)) / 12;
      c.add(s.color.clone().multiplyScalar(k));
    }
    const hemi = ctx.weapons.viewHemi;
    hemi.color.lerp(c.clone().multiplyScalar(1.6).addScalar(0.07), 0.2);
    hemi.groundColor.copy(hemi.color).multiplyScalar(0.3);
    hemi.intensity = 0.9;
  }

  // ------------------------------------------------------------ debug
  private updateDebug() {
    const p = ctx.player;
    const e = ctx.enemies.nearest(30);
    ctx.ui.debug(
      `FPS ${this.fps.toFixed(0)}  ${this.chapterId}/${this.checkpointId}\n` +
        `pos ${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.pos.z.toFixed(1)} yaw ${p.yaw.toFixed(2)}\n` +
        `hp ${p.health.toFixed(0)} st ${p.stamina.toFixed(0)} bat ${p.battery.toFixed(0)}\n` +
        `enemies ${ctx.enemies.alive.length} near ${e ? e.kind + ':' + e.state : '-'}\n` +
        `tension ${ctx.director.tension.toFixed(2)} god ${this.godMode} inf ${ctx.weapons.infiniteAmmo}`,
      [
        ['无敌', () => (this.godMode = !this.godMode)],
        ['无限弹药', () => (ctx.weapons.infiniteAmmo = !ctx.weapons.infiniteAmmo)],
        ['全武器', () => {
          for (const w of ['pistol', 'shotgun', 'magnum', 'launcher'] as const) ctx.weapons.give(w, 99);
          ctx.inventory.add('ammo9', 60);
          ctx.inventory.add('shells', 20);
        }],
        ['清敌', () => {
          for (const en of ctx.enemies.alive) en.damage(9999, 'torso', en.pos, new THREE.Vector3(0, 0, 1), 1, 'blast');
        }],
        ['下一章', () => {
          const i = chapterIndex(this.chapterId);
          const n = CHAPTERS[i + 1];
          if (n) this.startChapter(n.id, ctx.difficulty);
        }],
        ['回血', () => (ctx.player.health = 100)],
      ],
    );
    void rand;
  }
}

function bus_noise(pos: THREE.Vector3, radius: number) {
  bus.emit('noise', { pos: pos.clone(), radius, source: 'player' });
}
