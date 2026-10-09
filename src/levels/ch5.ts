import * as THREE from 'three';
import { Level } from './level';
import { P, bx, fleshMaterial } from './props';
import { ctx } from '../core/ctx';
import {
  V, enemy, loot, say, wait, until, objective, radio, flag, setFlag, compose, ensureLoadout, breakableWall,
  type BuildOpts, type ChapterRun,
} from './kit';
import { NPC } from '../story/npc';
import { HeartBoss } from '../boss/heart';
import { stdMat, M } from '../render/materials';
import { TEX } from '../render/textures';
import { DIFFICULTY } from '../config';
import { PURGE_CLOCK } from './meta';
import { rand } from '../core/math';

/**
 * 第五章 · 长夜 — B5 core, then the rooftop helipad. 02:00 → 05:00.
 * Self-destruct countdown, the final form, the escape and the endings.
 */
export function buildCh5(cp: string, o: BuildOpts): ChapterRun {
  const L = new Level('ch5', {
    fog: 0x120406,
    fogDensity: 0.06,
    ambient: 0x4a1a1a,
    ambientI: 0.28,
    hemiSky: 0x6a2a2a,
    hemiGround: 0x1a0606,
    hemiI: 0.34,
    grade: { lift: new THREE.Color(0.03, 0.006, 0.008), gain: new THREE.Color(1.1, 0.9, 0.86), sat: 0.85, contrast: 1.14, bloom: 0.9 },
    reverb: 'hall',
    root: 38,
  });
  L.taken = o.taken;
  L.mapTitle = 'B5 · 核心区';
  const ops: Parameters<typeof compose>[3] = [
    // the B5 complex is a solid block floating in the void; the roof is a separate island
    ['#', 3, 0, 47, 38],
    ['e', 4, 22, 8, 26],
    ['f', 9, 23, 20, 25],
    ['s', 12, 17, 18, 21],
    ['D', 15, 22],
    ['Y', 20, 11, 46, 37],
    ['C', 21, 12, 45, 36],
    ['O', 20, 23, 20, 25],
    ['X', 32, 11, 34, 11],
    ['n', 32, 4, 34, 10],
    ['E', 30, 1, 36, 3],
    // rooftop
    ['p', 48, 27, 58, 48],
    ['R', 49, 28, 57, 47],
  ];
  L.buildMap({
    rows: compose(60, 50, ' ', ops),
    legend: {
      '#': { t: 'wall', wall: 'steel' },
      Y: { t: 'wall', wall: 'flesh' },
      e: { t: 'floor', floor: 'metal', ceil: 'steel', cy: 3.2 },
      f: { t: 'floor', floor: 'flesh', ceil: 'flesh', cy: 3.4 },
      s: { t: 'floor', floor: 'steel', ceil: 'steel', cy: 3 },
      D: { t: 'floor', floor: 'steel', ceil: 'steel', cy: 2.3 },
      C: { t: 'floor', floor: 'grate', ceil: 'flesh', cy: 9 },
      O: { t: 'floor', floor: 'flesh', ceil: 'flesh', cy: 3.4 },
      X: { t: 'floor', floor: 'steel', ceil: 'steel', cy: 2.6 },
      n: { t: 'floor', floor: 'steel', ceil: 'steel', cy: 2.8 },
      E: { t: 'floor', floor: 'metal', ceil: 'steel', cy: 3.2 },
      p: { t: 'floor', floor: 'concrete', ceil: null, cy: null, fy: 1.1, side: 'concreteDark', nav: false },
      R: { t: 'floor', floor: 'concrete', ceil: null, cy: null },
      '.': { t: 'floor', floor: 'steel' },
    },
    wallHeight: 10,
  });
  const diff = DIFFICULTY[ctx.difficulty];
  let timer = ctx.difficulty === 'easy' ? 660 : ctx.difficulty === 'nightmare' ? 420 : 540;
  if (cp === 'core') timer = Math.max(timer - 90, 300);
  if (cp === 'roof') timer = 150;
  let timerOn = false;

  // ---------------- arrival + organic corridor ----------------
  L.tube(6, 24, { kind: 'flicker', color: 0xffd0c0, intensity: 6 });
  L.light(V(6, 2.6, 24), 0xff2010, 6, 8, 'beacon', { speed: 0.5 });
  for (let x = 10; x < 20; x += 3) {
    L.place(P.fleshGrowth(0.9, x), V(x, 0, x % 2 ? 23.2 : 25.6), rand(0, 6), { collide: false });
    L.light(V(x, 2.6, 24), 0xff5030, 5, 7, 'pulse', { speed: 0.4, phase: x * 0.1 });
  }
  L.ambient('pulse', V(15, 1.5, 24), 0.5, 3);
  // the corridor ambush is only for the way in: the 'core' respawn point is right under the
  // ceiling crawler, which would drop on a low-health player on every retry
  if (cp === 'start') {
    enemy('infected', V(13, 0, 24.5), { id: 'ch5:c1', state: 'idle', doctor: true, yaw: -Math.PI / 2 });
    enemy('crawler', V(18, 0, 24), { id: 'ch5:c2', state: 'ceiling' });
    enemy('runner', V(19.5, 0, 23.5), { id: 'ch5:c3', state: 'dormant', wakeDist: 3 });
  }
  // supply room
  L.door(15, 22, { kind: 'slide' });
  L.tube(15, 19, { kind: 'buzz', color: 0xe8f4ff, intensity: 6 });
  for (const x of [13, 17]) L.place(P.shelf(1.8, 2, 0.5, x * 3), V(x, 0, 17.6), 0);
  loot(L, 'grenade', 3, V(13, 1.1, 17.6), 'ch5:gr1');
  loot(L, 'ammo357', 6, V(17, 0.65, 17.6), 'ch5:mag');
  loot(L, 'shells', 8, V(16.5, 0.05, 20.5), 'ch5:sh');
  loot(L, 'medkit', 1, V(13.5, 0.05, 20.6), 'ch5:med');
  loot(L, 'ammo9', 15, V(17.5, 1.1, 17.6), 'ch5:a9');

  // ---------------- core chamber ----------------
  const boss = new HeartBoss(V(33, 0, 24));
  boss.yaw = -Math.PI / 2;
  for (const [x, z] of [[22.5, 13.5], [44, 13.5], [22.5, 35], [44, 35], [33, 35.2], [24, 24]] as [number, number][]) {
    L.place(P.fleshGrowth(1.4, x * z), V(x, 0, z), rand(0, 6), { collide: false });
  }
  const pillars = [
    breakableWall(L, 26, 17, 27, 18, 'concreteDark', 9),
    breakableWall(L, 39, 17, 40, 18, 'concreteDark', 9),
    breakableWall(L, 26, 30, 27, 31, 'concreteDark', 9),
    breakableWall(L, 39, 30, 40, 31, 'concreteDark', 9),
  ];
  const tank = (x: number, z: number, id: string) => {
    if (flag(id)) return;
    L.place(P.gasTank(), V(x, 0, z), rand(0, 6), {
      dynamic: { mass: 80, surface: 'metal', breakable: { hp: 25, kind: 'tank', onBreak: () => setFlag(id) } },
    });
  };
  tank(29, 20.6, 'ch5:t1');
  tank(37.2, 20.8, 'ch5:t2');
  tank(28.8, 27.6, 'ch5:t3');
  tank(37.4, 27.4, 'ch5:t4');
  tank(33, 19.2, 'ch5:t5');
  for (const [x, z] of [[22, 31], [44.2, 18], [22, 17]] as [number, number][]) L.place(P.crate(0.9), V(x, 0, z), rand(0, 1));
  loot(L, 'grenade', 2, V(44, 0.05, 31.5), 'ch5:gr2');
  loot(L, 'shells', 6, V(22.4, 0.05, 32.2), 'ch5:sh2');
  loot(L, 'ammo357', 4, V(44.3, 0.05, 16.8), 'ch5:mag2');
  for (const [x, z] of [[24, 15], [42, 15], [24, 33], [42, 33]] as [number, number][]) L.light(V(x, 6, z), 0xff4020, 12, 14, 'pulse', { speed: 0.3, phase: x * z });
  L.light(V(33, 8, 24), 0xffa070, 10, 16, 'flicker');
  L.ambient('drone', V(33, 4, 24), 0.4, 10);
  const exitDoor = L.door(32, 11, { kind: 'slide', width: 3, locked: 'core', msg: '紧急出口 · 核心封锁中' });
  L.place(P.sign('紧急出口 · 天台', 2, 0.35, '#1a3b26', '#d8e8d0', 1), V(33.5, 3, 12.02), 0, { collide: false, keep: true });
  L.tube(33, 7, { kind: 'buzz', color: 0xe8f4ff, intensity: 6 });
  L.tube(33, 2, { kind: 'flicker', color: 0xe8f4ff, intensity: 6 });

  // ---------------- rooftop ----------------
  const heli = P.helicopter();
  L.place(heli, V(53, 0.005, 34), Math.PI / 2 + 0.3, { keep: true });
  // pad and marking lie flat on the roof: depth offsets keep them from flickering through it and each other
  const padMat = stdMat({ color: 0x3a3a3a, roughness: 0.4 });
  padMat.polygonOffset = true;
  padMat.polygonOffsetFactor = -2;
  padMat.polygonOffsetUnits = -2;
  const pad = new THREE.Mesh(new THREE.CircleGeometry(4.5, 24), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(53, 0.003, 34);
  L.group.add(pad);
  const hMark = P.sign('H', 2.2, 2.2, '#3a3a3a', '#d8c040', 0.4);
  const hMat = (hMark.g.children[0] as THREE.Mesh).material as THREE.Material;
  hMat.polygonOffset = true;
  hMat.polygonOffsetFactor = -4;
  hMat.polygonOffsetUnits = -4;
  hMark.g.rotation.x = -Math.PI / 2;
  L.place(hMark, V(53, 0.005, 34), 0, { collide: false, keep: true });
  hMark.g.rotation.set(-Math.PI / 2, 0, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    L.light(V(53 + Math.cos(a) * 4.8, 0.3, 34 + Math.sin(a) * 4.8), 0x40ff60, 2.5, 3.5, 'pulse', { speed: 0.5, phase: i / 8 });
  }
  L.light(V(53, 4, 34), 0xff2020, 8, 10, 'beacon', { speed: 1.2 });
  L.light(V(53, 6, 42), 0xdfe8ff, 20, 18, 'steady');
  L.onUpdate((dt) => {
    heli.rotor.rotation.y += dt * 22;
    heli.tailRotor.rotation.z += dt * 30;
  });
  cityscape(L);

  // ---------------- characters ----------------
  if (o.fresh && flag('linSaved') === undefined) setFlag('linSaved', true);
  const linSaved = flag('linSaved') === true;
  const lin = new NPC(cp === 'roof' ? V(52, 0, 45) : V(6.5, 0, 23.5), Math.PI / 2, 'lin');
  if (!linSaved) lin.pose = 'hurt';
  lin.following = cp !== 'core';
  if (cp === 'core') lin.teleport(V(19, 0, 24));
  const pilot = new NPC(V(50.6, 0, 35.5), Math.PI / 2, 'pilot');
  pilot.pose = 'idle';

  // ---------------- script ----------------
  L.trigger(L.box(20, 22, 23, 26), () => {
    if (flag('ch5:boss')) return;
    setFlag('ch5:boss');
    void bossIntro();
  });
  async function bossIntro() {
    ctx.game.checkpoint('core');
    lin.following = false;
    lin.goTo(V(19, 0, 24)).then(() => (lin.pose = 'crouch'));
    ctx.director.musicEnabled = false;
    ctx.music.only({ tension: 0.5 }, 0.5);
    await ctx.story.cutscene(async () => {
      const s = ctx.story;
      await s.camTo(V(23, 2.2, 24), V(33, 3.5, 24), 1.2);
      await wait(0.8);
      ctx.audio.play('pulse', { pos: V(33, 3, 24), vol: 1 });
      await s.camTo(V(26, 3.5, 22), V(33, 4.5, 24), 2.2);
      boss.wake();
      ctx.audio.play('bossRoar', { pos: V(33, 4, 24), vol: 1, rate: 0.75 });
      ctx.player.shake = 1.2;
      ctx.music.only({ nightwatch: 1, combat: 0.4 }, 0.3);
      await wait(1.2);
      await say('林薇', '它把整个核心的培养液都吞了……');
      await say('林薇', '胸口！它的心脏在胸口！等肋骨张开的时候打！');
      await say('林薇', '旁边的储气罐——引爆它们会逼它张开！');
      s.camRelease();
    });
    ctx.director.musicEnabled = false;
    objective('击败「忘川」：攻击胸口的心脏', V(33, 0, 24));
    ctx.ui.toast('心脏只有在肋骨张开时才会受到完整伤害');
  }
  boss.onPhase = (ph) => {
    void (async () => {
      await wait(0.6);
      if (ph === 2) {
        pillars[0].smash(V(-1, 0, -1).normalize());
        pillars[3].smash(V(1, 0, 1).normalize());
        await say('林薇', '它在召唤触手——别站着不动！');
      } else {
        pillars[1].smash(V(1, 0, -1).normalize());
        pillars[2].smash(V(-1, 0, 1).normalize());
        ctx.director.scare('low');
        await say('林薇', '天花板要塌了！');
      }
    })();
  };
  let debrisT = 4;
  L.onUpdate((dt) => {
    if (boss.phase < 3 || boss.dead || boss.state === 'dormant') return;
    debrisT -= dt;
    if (debrisT <= 0) {
      debrisT = rand(2.5, 4.5);
      const at = ctx.player.pos.clone().add(V(rand(-2.5, 2.5), 0, rand(-2.5, 2.5)));
      void fallingDebris(at);
    }
  });
  async function fallingDebris(at: THREE.Vector3) {
    for (let i = 0; i < 8; i++) ctx.particles.dust(at.clone().setY(8.5), V(0, -1, 0), 0x6a4a40);
    ctx.audio.play('impactConcrete', { pos: at.clone().setY(8), vol: 0.8, rate: 0.6 });
    await wait(1.1);
    const s = rand(0.4, 0.9);
    ctx.props.spawnDebris(new THREE.BoxGeometry(s, s * 0.7, s), stdMat({ map: TEX.concreteDark(), roughness: 1 }), at.clone().setY(7.5), V(0, -12, 0), 6, 'impactConcrete');
    await wait(0.45);
    ctx.audio.play('bossImpact', { pos: at, vol: 0.6, rate: 1.5 });
    if (ctx.player.pos.distanceTo(at) < 1.6) ctx.player.damage(18, at);
  }
  boss.onDeath = () => void bossDeath();
  async function bossDeath() {
    setFlag('ch5:bossDead');
    ctx.music.only({ tension: 0.4 }, 1);
    await wait(1.5);
    await radio('广播', '核心收容彻底失效。自毁程序加速。');
    timer = Math.min(timer, ctx.difficulty === 'nightmare' ? 75 : 100);
    exitDoor.unlock();
    exitDoor.open(V(33, 0, 14));
    ctx.director.musicEnabled = true;
    lin.following = true;
    lin.pose = linSaved ? 'idle' : 'hurt';
    objective('去天台！（北侧紧急出口 → 货运电梯）', V(33, 0, 2));
    ctx.game.checkpoint('escape');
  }
  // freight elevator to the roof
  L.interact(V(33, 1.2, 2.2), () => (flag('ch5:bossDead') && !flag('ch5:roof') ? '[E] 启动货运电梯' : null), () => void toRoof(), 2.4);
  async function toRoof() {
    setFlag('ch5:roof');
    ctx.audio.play('pneumatic', { vol: 1 });
    ctx.renderer.fx.fade = 0;
    await wait(0.1);
    ctx.player.control = false;
    const t0 = ctx.time;
    await until(() => {
      const f = Math.min(1, (ctx.time - t0) / 0.7);
      ctx.renderer.fx.fade = f;
      return f >= 1;
    });
    ctx.player.teleport(V(53, 0, 45.5), 0);
    lin.teleport(V(51.6, 0, 46.2), 0);
    goOutside();
    ctx.player.control = true;
    await wait(0.6);
    void roofScene();
  }
  function goOutside() {
    L.env.fog = 0x1a0c08;
    L.env.fogDensity = 0.0085;
    L.env.reverb = 'outdoor';
    L.applyEnv(ctx.scene);
    ctx.renderer.setGrade({ lift: new THREE.Color(0.02, 0.012, 0.012), gain: new THREE.Color(1.08, 0.94, 0.86), sat: 0.85, bloom: 0.9 });
    ctx.game.setupRain(true);
    ctx.audio.loop('rain', { vol: 0.5 });
    ctx.audio.loop('wind', { vol: 0.4 });
    ctx.audio.loop('heli', { pos: V(53, 2, 34), vol: 1, ref: 6 });
    L.mapTitle = '天台停机坪';
    ctx.ui.setLocation('天台停机坪');
  }
  async function roofScene() {
    ctx.director.ambientPool = [
      { name: 'distantBoom', vol: 0.8, dist: [60, 90] },
      { name: 'thunder', vol: 0.5, dist: [60, 90] },
    ];
    objective('登上直升机', V(53, 0, 34));
    pilot.face(ctx.player.pos);
    await say('驾驶员', '站住！只接授权人员——');
    await say('陈屿', '现在授权了。起飞。');
  }
  L.trigger(L.box(49, 30, 57, 38), () => {
    if (!flag('ch5:roof') || flag('ch5:final')) return;
    setFlag('ch5:final');
    void finale();
  }, false);

  async function finale() {
    timerOn = false;
    ctx.ui.countdown(null);
    const s = ctx.story;
    await s.cutscene(async () => {
      await s.camTo(V(56, 2.2, 40), V(53, 1.2, 35), 1);
      if (linSaved) {
        lin.walkTo(V(52, 0, 36));
        await wait(1.2);
        // one last grasp from below
        const tpos = V(54.5, 0, 38.5);
        ctx.audio.play('bossImpact', { pos: tpos, vol: 1 });
        ctx.particles.gore(tpos.clone().setY(0.3), V(0, 1, 0), 0);
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 3, 7), fleshMaterial());
        t.position.copy(tpos).setY(1.5);
        L.group.add(t);
        await s.camTo(V(57.5, 1.6, 41.5), V(54.5, 1.5, 38), 0.4);
        await say('林薇', '陈屿——！');
        for (let i = 0; i < 3; i++) {
          ctx.audio.play('magnum', { vol: 1 });
          ctx.particles.blood(t.position.clone().add(V(0, rand(-0.5, 1), 0)), V(0, 0, -1), 14, 0);
          await wait(0.35);
        }
        t.removeFromParent();
        ctx.particles.gore(tpos.clone().setY(1), V(0, 1, 0), 0);
        await say('陈屿', '上飞机。');
      } else {
        lin.walkTo(V(51.5, 0, 39));
        await wait(1.5);
        lin.pose = 'sit';
        await s.camTo(V(50, 1.3, 41.5), V(51.5, 1, 39), 1);
        await say('林薇', '……我走不动了。别过来。');
        await say('林薇', '我能感觉到它在我身体里……在忘记。');
        await say('林薇', '数据在我口袋里的硬盘里。连同那管疫苗，一起带出去。');
        await say('林薇', '让他们知道，这不是事故。');
        await say('陈屿', '……');
        await say('林薇', '走吧。我想自己看一次日出——如果它还会来的话。');
      }
      await wait(0.5);
    });
    void epilogue();
  }

  async function epilogue() {
    ctx.player.control = false;
    ctx.ui.showHud(false);
    const s = ctx.story;
    s.inCutscene = true;
    ctx.ui.letterbox(true);
    ctx.music.only({ theme: 0.9 }, 2);
    ctx.director.musicEnabled = false;
    // rise with the helicopter and look over the burning city
    const base = V(53, 2.2, 34);
    await s.camTo(base.clone().add(V(1.5, 0, 0)), V(90, 4, 30), 0.01);
    heli.g.visible = false;
    const t0 = ctx.time;
    const cam = s.cutCam;
    await until(() => {
      const t = ctx.time - t0;
      const k = Math.min(1, t / 7);
      const e = k * k * (3 - 2 * k);
      cam.position.set(54.5 + e * 8, 2.2 + e * 16, 34 - e * 4);
      cam.lookAt(140, 4 - e * 14, 28 + Math.sin(t * 0.3) * 4);
      return t > 7 || s.skipping;
    });
    ctx.game.clock = PURGE_CLOCK;
    await say('05:00', '净化开始。', 1.4);
    // the purge
    for (let i = 0; i < 9; i++) {
      const at = V(rand(95, 170), -20, rand(-20, 75));
      firebomb(at);
      ctx.audio.play('distantBoom', { vol: 0.9, delay: 0.4 });
      ctx.renderer.fx.flash = 0.18;
      await wait(rand(0.4, 1.1));
    }
    await wait(1.5);
    if (linSaved) {
      await say('林薇', '……你看。天要亮了。');
      await say('陈屿', '嗯。');
    } else {
      await say('陈屿', '（舱门边放着一只沾血的硬盘，和一管淡蓝色的液体。）');
      await say('陈屿', '（城市在下面燃烧。我没有回头。）');
    }
    await wait(2);
    const tf = ctx.time;
    await until(() => {
      const f = Math.min(1, (ctx.time - tf) / 2.5);
      ctx.renderer.fx.fade = f;
      return f >= 1;
    });
    ctx.ui.letterbox(false);
    s.inCutscene = false;
    ctx.game.finish(linSaved ? 'dawn' : 'alone', linSaved
      ? { title: '黎明', en: 'Dawn', body: '05:00，燃烧弹落在雾港市中心。直升机向北飞去，舱里坐着两个幸存者。<br>三个月后，一份署名为「林薇」的报告被送到了国际卫生组织的桌上。<br>赫利生物否认一切。但这一次，有人活着作证。' }
      : { title: '独行', en: 'Alone', body: '05:00，燃烧弹落在雾港市中心。直升机向北飞去，舱里只有一个人。<br>那只硬盘里有七千页实验记录，和一段录音：「让他们知道，这不是事故。」<br>陈屿把它交了出去。他再也没有回过雾港。' });
  }

  function firebomb(at: THREE.Vector3) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 1, fog: false }));
    m.position.copy(at);
    L.group.add(m);
    let k = 0;
    const tick = () => {
      k += 1 / 60;
      m.scale.setScalar(2 + k * 30);
      (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k / 1.4);
      (m.material as THREE.MeshBasicMaterial).color.setHSL(0.08 - k * 0.04, 1, 0.6 - k * 0.3);
      if (k < 1.4) requestAnimationFrame(tick);
      else m.removeFromParent();
    };
    requestAnimationFrame(tick);
    ctx.particles.explosion(at.clone().setY(at.y + 4));
  }

  const spawns: Record<string, { pos: THREE.Vector3; yaw: number }> = {
    start: { pos: V(5.5, 0, 24), yaw: -Math.PI / 2 },
    core: { pos: V(18, 0, 24), yaw: -Math.PI / 2 },
    escape: { pos: V(33, 0, 14), yaw: 0 },
    roof: { pos: V(53, 0, 45.5), yaw: 0 },
  };
  return {
    level: L,
    spawn: spawns[cp] ?? spawns.start,
    start() {
      if (o.fresh) {
        ensureLoadout(['knife', 'pistol', 'shotgun', 'magnum', 'launcher'], { ammo9: 24, shells: 10, ammo357: 6, grenade: 2, bandage: 1 }, 4);
      }
      ctx.director.ambientPool = [
        { name: 'pulse', vol: 0.4, dist: [6, 12] },
        { name: 'distantBoom', vol: 0.5, dist: [20, 40] },
        { name: 'squelch', vol: 0.4, dist: [5, 10] },
      ];
      L.startAmbience();
      void diff;
      if (cp === 'roof' || flag('ch5:roof')) {
        goOutside();
        void roofScene();
      } else if (flag('ch5:bossDead')) {
        boss.dead = true;
        boss.root.visible = false;
        ctx.enemies.removeBoss(boss);
        for (const p of pillars) p.smash(V(0, 0, 1));
        exitDoor.unlock();
        objective('去天台！（北侧紧急出口 → 货运电梯）', V(33, 0, 2));
        timer = Math.min(timer, 100);
      } else if (cp === 'start') {
        objective('穿过 B5，找到核心区');
        void (async () => {
          await wait(0.8);
          ctx.director.scare('low', 0.6);
          await radio('广播', '警告：B5 收容失败。自毁程序已启动。所有人员立即撤离。');
          await say('林薇', '天台的直升机……核心区后面有通往天台的电梯。');
        })();
        ctx.game.checkpoint('start');
      } else if (cp === 'core') {
        setFlag('ch5:boss', false);
        objective('进入核心区');
      }
      timerOn = true;
    },
    update(dt: number) {
      if (!timerOn || ctx.game.state !== 'play' || ctx.story.inCutscene) {
        if (timerOn) ctx.ui.countdown(timer);
        return;
      }
      timer -= dt;
      ctx.ui.countdown(timer);
      if (timer <= 0 && !ctx.player.dead) {
        timerOn = false;
        ctx.audio.play('explosion', { vol: 1 });
        ctx.renderer.fx.flash = 1;
        ctx.player.invuln = 0;
        ctx.game.godMode = false;
        ctx.player.damage(999);
      }
    },
  };
}

/** Distant skyline beyond the roof: dark towers with lit windows and fires. */
function cityscape(L: Level) {
  const facade = stdMat({ map: TEX.facade(), emissiveMap: TEX.facadeEmissive(), emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.9 });
  const fireMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, fog: true });
  const g = new THREE.Group();
  for (let i = 0; i < 70; i++) {
    const w = rand(6, 16), h = rand(14, 42), d = rand(6, 16);
    const x = rand(80, 190), z = rand(-50, 100);
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w / 8), uv.getY(k) * (h / 8));
    const m = new THREE.Mesh(geo, facade);
    m.position.set(x, h / 2 - 34, z);
    g.add(m);
    if (Math.random() < 0.35) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, rand(1, 3), d * 0.5), fireMat);
      f.position.set(x, h - 34 + 0.6, z);
      g.add(f);
    }
  }
  // the bay, a dull mirror
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), stdMat({ color: 0x0a0c10, roughness: 0.1, metalness: 0.6 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(120, -34, 30);
  g.add(sea);
  L.group.add(g);
  void bx;
  void M;
}
