import * as THREE from 'three';
import { Level } from './level';
import { P, bx } from './props';
import { ctx } from '../core/ctx';
import { V, enemy, loot, say, wait, until, objective, radio, flag, setFlag, bloodTrail, type BuildOpts, type ChapterRun } from './kit';
import { Feed } from './feed';
import { M, stdMat } from '../render/materials';
import { TEX } from '../render/textures';

/**
 * 序章 · 异常 — Bay Mall, B1 security office. 22:40.
 * Teaches movement, interaction and the flashlight; first encounter.
 */
export function buildPrologue(cp: string, o: BuildOpts): ChapterRun {
  const L = new Level('prologue', {
    fog: 0x07090b,
    fogDensity: 0.085,
    ambient: 0x283038,
    ambientI: 0.18,
    hemiSky: 0x3a4450,
    hemiGround: 0x15110c,
    hemiI: 0.22,
    grade: { lift: new THREE.Color(0.01, 0.014, 0.02), gain: new THREE.Color(1.0, 0.97, 0.92), sat: 0.78, contrast: 1.1, bloom: 0.7 },
    reverb: 'corridor',
    root: 45,
  });
  L.taken = o.taken;
  L.mapTitle = 'B1 · 后勤区';
  // x →            1111111111222222222233333
  //      0123456789012345678901234567890123456
  const rows = [
    '####################################',
    '#oooooo###############ddddddddddddd#',
    '#oooooo###############ddddddddddddd#',
    '#oooooo###############ddddddddddddd#',
    '#oooooo###############ddddddddddddd#',
    '#oooooo###############ddddddddddddd#',
    '#oooooo###############ddddddddddddd#',
    '##D###################ddddddddddddd#',
    '#,,,,,,,,,,,,,,,,,,,,Dddddddddddddd#',
    '#,,,,,,,,,,,,,,,,,,,,Dddddddddddddd#',
    '#########D############ddddddddddddd#',
    '#####rrrrrrrrr########ddddddddddddd#',
    '#####rrrrrrrrr########ddddddddddddd#',
    '#####rrrrrrrrr########ddddddddddddd#',
    '#####rrrrrrrrr######################',
    '####################################',
  ];
  L.buildMap({
    rows,
    legend: {
      '#': { t: 'wall', wall: 'plasterGreen' },
      o: { t: 'floor', floor: 'carpet', ceil: 'ceilingTile', cy: 2.7 },
      ',': { t: 'floor', floor: 'linoleum', ceil: 'ceilingTile', cy: 2.8 },
      r: { t: 'floor', floor: 'concrete', ceil: 'concreteDark', cy: 2.8 },
      d: { t: 'floor', floor: 'concreteDark', ceil: 'concreteDark', cy: 5.2 },
      D: { t: 'floor', floor: 'linoleum', ceil: 'concreteDark', cy: 2.2 },
      '.': { t: 'floor', floor: 'linoleum' },
    },
  });

  // ---------------- security office ----------------
  const desk = P.monitorDesk(3);
  L.place(desk, V(3.5, 0, 1.6), 0, { keep: true });
  L.place(P.chair(), V(3.6, 0, 2.6), Math.PI + 0.3, { dynamic: { mass: 8, surface: 'metal' } });
  L.place(P.locker(2), V(6.4, 0, 4.2), -Math.PI / 2);
  L.place(P.cabinet(), V(1.35, 0, 5.6), Math.PI / 2);
  L.place(P.table(1, 0.6), V(1.6, 0, 3.6), Math.PI / 2);
  L.place(P.papers(2, 6, 0.6), V(4.5, 0.01, 4.2), 0, { collide: false });
  const mug = new THREE.Group();
  bx(mug, 0.08, 0.1, 0.08, M.white(), 0, 0.05, 0);
  L.place({ g: mug, cols: [] }, V(4.6, 0.79, 1.5), 0, { collide: false });
  const officeLight = L.tube(3.5, 3.5, { kind: 'buzz', intensity: 6, distance: 8 });
  const monitorGlow = L.light(V(3.5, 1.2, 2.2), 0x80d0a0, 2.5, 3.5, 'buzz');
  // calendar / poster
  const poster = P.sign('海湾购物中心 · 安全第一', 1.4, 0.5, '#2a2620', '#c8b890', 0.15);
  L.place(poster, V(1.02, 1.6, 3), Math.PI / 2, { collide: false, keep: true });

  // ---------------- corridor ----------------
  const corridorLights = [
    L.tube(4.5, 8.5, { kind: 'buzz', rot: 0 }),
    L.tube(9.5, 8.5, { kind: 'flicker' }),
    L.tube(14.5, 8.5, { kind: 'buzz' }),
    L.tube(19, 8.5, { kind: 'dying' }),
  ];
  L.place(P.cart(), V(7, 0, 9.2), 0.3, { dynamic: { mass: 25, surface: 'metal' } });
  L.place(P.bin(), V(16.5, 0, 8.4), 0, { dynamic: { mass: 10, surface: 'metal' } });
  const wet = P.sign('小心地滑', 0.4, 0.5, '#c8a020', '#1a1a1a', 0.05);
  L.place(wet, V(12, 0.3, 8.3), 0.6, { collide: false, keep: true });
  bloodTrail(L, V(12, 0, 9.3), V(20.5, 0, 8.8));
  L.decal('hand', V(20.98, 1.3, 9.4), V(-1, 0, 0), 0.5);
  L.decal('blood', V(11.5, 0.01, 9.2), V(0, 1, 0), 1.6);
  L.ambient('hum', V(10, 2.5, 8.5), 0.15, 2);

  // ---------------- storage ----------------
  L.place(P.shelf(2.2, 2.2, 0.5, 4), V(9, 0, 11.4), 0);
  L.place(P.shelf(1.8, 2.2, 0.5, 9), V(13.1, 0, 12.6), -Math.PI / 2);
  for (const [x, z] of [[6, 12.2], [6.2, 13.3], [7.1, 13.4]] as [number, number][]) L.place(P.crate(0.7), V(x, 0, z), Math.random(), { dynamic: { mass: 20, breakable: { hp: 40, kind: 'wood' } } });
  L.tube(9, 12.5, { kind: 'flicker', intensity: 4 });
  loot(L, 'bandage', 1, V(9.3, 1.2, 11.4), 'pro:bandage');
  loot(L, 'battery', 1, V(11.6, 0.02, 13.5), 'pro:battery');
  L.pickup(
    {
      type: 'doc',
      doc: {
        id: 'doc_handover',
        title: '值班交接记录',
        body: '10月9日 夜班交接\n\n1. 卸货区卷帘门遥控失灵，需手动拉起。\n2. 21:50 老马说去卸货区抽根烟。\n3. 广播通知：市区多处出现「狂犬病样」伤人事件，\n   商场提前闭店，请值班人员锁好各出入口。\n4. 监控 CAM 03 画面偶尔雪花，已报修。\n\n——小郑\n\n（字迹潦草的补充）\n老马被咬了一口，说没事。他一直在出汗。',
      },
    },
    V(10.5, 0.82, 11.6),
    'pro:doc1',
  );

  // ---------------- loading dock ----------------
  L.place(P.crate(1), V(24, 0, 2), 0.2, { dynamic: { mass: 30, breakable: { hp: 50, kind: 'wood' } } });
  L.place(P.crate(1), V(24.2, 0, 3.1), -0.1);
  L.place(P.crate(0.8), V(24.1, 1, 2.5), 0.4, { dynamic: { mass: 20, breakable: { hp: 40, kind: 'wood' } } });
  L.place(P.barrel(), V(33.5, 0, 12.2), 0, { dynamic: { mass: 40, surface: 'metal' } });
  L.place(P.barrel(), V(32.8, 0, 12.6), 0, { dynamic: { mass: 40, surface: 'metal' } });
  L.place(P.shelf(3, 3, 0.8, 11), V(29, 0, 12.4), Math.PI);
  L.place(P.cart(), V(30, 0, 6), 1.2, { dynamic: { mass: 25, surface: 'metal' } });
  for (let i = 0; i < 4; i++) L.place(P.bottle(), V(26.5 + i * 0.25, 0, 10.8), 0, { dynamic: { mass: 0.5, surface: 'glass', breakable: { hp: 1, kind: 'bottle' } } });
  // roll-up door on the east wall
  const shutter = new THREE.Group();
  const sm = stdMat({ map: TEX.metal(), color: 0x8a8f92, roughness: 0.5, metalness: 0.6 });
  for (let i = 0; i < 12; i++) bx(shutter, 0.06, 0.28, 3.2, sm, 0, 0.14 + i * 0.3, 0);
  shutter.position.set(34.95, 0, 4.5);
  L.group.add(shutter);
  const dockLight = L.light(V(28, 4.6, 5), 0xff5040, 9, 14, 'beacon', { speed: 0.7 });
  const dockLamp = L.tube(28, 9, { kind: 'dying', intensity: 6, distance: 11 });
  L.light(V(34.3, 3, 4.5), 0xd06a40, 3, 6, 'pulse', { speed: 0.3 });
  const victim = V(25.4, 0, 4.4);
  // victim body: a fallen guard (static ragdoll-like pose)
  const corpse = new THREE.Group();
  const uni = stdMat({ map: TEX.cloth(), color: 0x2a3040, roughness: 1 });
  bx(corpse, 0.4, 0.2, 0.7, uni, 0, 0.1, 0);
  bx(corpse, 0.2, 0.18, 0.22, M.skin(), 0, 0.09, 0.48, 0.3);
  bx(corpse, 0.14, 0.14, 0.8, stdMat({ map: TEX.cloth(), color: 0x1e2228, roughness: 1 }), -0.1, 0.07, -0.72, 0.1);
  bx(corpse, 0.14, 0.14, 0.8, stdMat({ map: TEX.cloth(), color: 0x1e2228, roughness: 1 }), 0.12, 0.07, -0.74, -0.15);
  bx(corpse, 0.1, 0.1, 0.55, uni, 0.32, 0.06, 0.2, -0.9);
  L.place({ g: corpse, cols: [] }, victim, 0.9, { collide: false });
  L.decal('blood', victim.clone().setY(0.01), V(0, 1, 0), 2.4);
  L.decal('blood', V(26.2, 0.01, 5.2), V(0, 1, 0), 1.3);

  // ---------------- doors ----------------
  L.door(2, 7, { kind: 'wood' });
  L.door(9, 10, { kind: 'wood' });
  L.door(21, 8, { kind: 'metal', width: 2 });

  // ---------------- CCTV feed ----------------
  const feed = new Feed(V(23, 4.4, 9.5), V(26, 0.5, 4.2), V(3.5, 1, 2), 'CAM 03 卸货区');
  for (const s of desk.screens.slice(1, 2)) s.material = feed.mat;
  L.onUpdate((_dt, t) => feed.update(t));
  const feedScreen = desk.screens[1];
  void feedScreen;

  // ---------------- enemies ----------------
  const dockZ = enemy('infected', V(26.2, 0, 4.2), { id: 'pro:dock', state: 'feed', yaw: -2.2 });
  const corridorZ = enemy('infected', V(13, 0, 9.3), { id: 'pro:corr', state: 'dormant', yaw: Math.PI / 2, wakeDist: 2.2, scripted: true });
  void dockZ;

  // ---------------- interactions & script ----------------
  let monitorChecked = !!flag('pro:monitor');
  const monitor = L.interact(V(3.5, 1.15, 1.7), () => (monitorChecked ? null : '[E] 查看监控'), () => {
    monitorChecked = true;
    setFlag('pro:monitor');
    monitor.enabled = false;
    void monitorScene();
  }, 1.8);

  const exit = L.interact(V(34.4, 1.2, 4.5), () => (flag('pro:exit') ? null : '[E] 拉起卷帘门'), () => {
    setFlag('pro:exit');
    exit.enabled = false;
    void exitScene();
  }, 2.2);

  // power cut when the player leaves the office
  L.trigger(L.box(1, 7.6, 3, 8.6), () => {
    if (flag('pro:power')) return;
    setFlag('pro:power');
    void powerCut();
  });
  // corpse in the corridor rises once the player is next to it
  L.trigger(L.box(11, 7.8, 13.5, 10), async () => {
    if (!corridorZ || corridorZ.dead) return;
    ctx.director.scare('high');
    corridorZ.wake();
    await wait(1.4);
    ctx.ui.toast('左键挥刀 · V 快速近战 · 也可以绕开它');
  });
  // dock reveal
  L.trigger(L.box(21, 7.5, 23, 10.5), () => {
    objective('拉起卸货区卷帘门，离开商场', V(34.5, 0, 4.5));
  });
  L.safe(L.box(1, 1, 7, 7));

  async function monitorScene() {
    await ctx.story.cutscene(async () => {
      const s = ctx.story;
      const screenPos = V(3.5, 1.02, 1.6);
      await s.camTo(V(3.5, 1.15, 2.35), screenPos, 1.4);
      ctx.audio.play('radio', { bus: 'voice', vol: 0.5 });
      await wait(1.2);
      feed.glitch();
      await radio('对讲机', '……保安室……卸货区……他、他咬我——');
      await radio('对讲机', '啊——（杂音）');
      feed.glitch();
      await wait(0.6);
      await say('陈屿', '老马？');
      s.camRelease();
    });
    objective('前往卸货区', V(28, 0, 6));
    ctx.director.musicEnabled = true;
  }

  async function powerCut() {
    await wait(0.4);
    ctx.audio.play('bulb', { pos: V(9.5, 2.6, 8.5), vol: 1 });
    ctx.audio.play('distantBoom', { vol: 0.7 });
    ctx.player.shake = 0.5;
    for (const l of corridorLights) l.on = false;
    officeLight.on = false;
    monitorGlow.on = false;
    feed.active = false;
    for (const s of desk.screens) (s.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    const emergency = L.light(V(20.5, 2.6, 8.5), 0xff2a18, 4, 9, 'pulse', { speed: 0.6 });
    const emergency2 = L.light(V(1.5, 2.6, 8.5), 0xff2a18, 3, 7, 'pulse', { speed: 0.6, phase: 0.5 });
    void emergency;
    void emergency2;
    ctx.director.scare('low', 0.7);
    await wait(1.2);
    if (!ctx.player.flashOn) ctx.ui.toast('按 F 打开手电筒');
    await say('陈屿', '（停电了。备用电源也……）');
  }

  async function exitScene() {
    ctx.audio.play('metalDoor', { pos: V(34.5, 1.5, 4.5), vol: 1 });
    await ctx.story.cutscene(async () => {
      const s = ctx.story;
      await s.camTo(V(31.5, 1.65, 4.5), V(36, 1.4, 4.5), 1.2);
      let t = 0;
      await until(() => {
        t += 1 / 60;
        shutter.position.y = Math.min(3, shutter.position.y + 0.035);
        return shutter.position.y >= 2.9 || s.skipping;
      });
      shutter.position.y = 3;
      ctx.audio.play('distantBoom', { vol: 1 });
      ctx.audio.loop('rain', { vol: 0.5 });
      ctx.renderer.fx.flash = 0.2;
      await say('陈屿', '……整座城都在烧。');
      await wait(1);
      void t;
    });
    ctx.renderer.fx.fade = 0;
    ctx.game.nextChapter('ch1');
  }

  // ---------------- run ----------------
  const spawn = { pos: V(3.6, 0, 3.4), yaw: 0 };
  return {
    level: L,
    spawn,
    start() {
      ctx.player.flashOn = false;
      ctx.director.ambientPool = [
        { name: 'distantBoom', vol: 0.4, dist: [40, 60] },
        { name: 'groan', vol: 0.25, dist: [10, 18] },
      ];
      if (cp === 'start' && !monitorChecked) {
        objective('检查监控画面', V(3.5, 0, 1.5));
        void (async () => {
          await wait(1.2);
          ctx.ui.toast('WASD 移动 · 鼠标环顾 · E 交互');
          await wait(0.8);
          await say('陈屿', '（22:40。又是一个安静的夜班。）');
        })();
      } else objective('前往卸货区', V(28, 0, 6));
      if (o.fresh && cp === 'start') ctx.game.checkpoint('start');
      void dockLight;
      void dockLamp;
    },
  };
}
