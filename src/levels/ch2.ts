import * as THREE from 'three';
import { Level, type Door } from './level';
import { P, bx } from './props';
import { ctx } from '../core/ctx';
import {
  V, enemy, loot, say, wait, until, objective, radio, flag, setFlag, compose, corpse, savePoint, ensureLoadout, breakableWall,
  type BuildOpts, type ChapterRun,
} from './kit';
import { NPC } from '../story/npc';
import { Nightwatch } from '../boss/nightwatch';
import { stdMat, M } from '../render/materials';
import { TEX } from '../render/textures';

/**
 * 第二章 · 值夜 — West Harbour police station, 23:40.
 * Zhou, the chief's code, the shotgun — and the first sighting of the Nightwatch.
 */
export function buildCh2(cp: string, o: BuildOpts): ChapterRun {
  const L = new Level('ch2', {
    fog: 0x0e0c08,
    fogDensity: 0.07,
    ambient: 0x3a3024,
    ambientI: 0.3,
    hemiSky: 0x50483a,
    hemiGround: 0x1a120a,
    hemiI: 0.4,
    grade: { lift: new THREE.Color(0.022, 0.016, 0.008), gain: new THREE.Color(1.06, 0.98, 0.84), sat: 0.78, contrast: 1.12, bloom: 0.7 },
    reverb: 'room',
    root: 41,
  });
  L.taken = o.taken;
  L.mapTitle = '西港分局 · 一层';
  const ops: Parameters<typeof compose>[3] = [
    // lobby
    ['l', 17, 26, 30, 35],
    // duty room (safe room)
    ['o', 21, 20, 26, 24],
    ['D', 23, 25],
    // west wing
    ['c', 3, 29, 15, 30],
    ['D', 16, 29, 16, 30],
    ['f', 3, 22, 8, 27],
    ['D', 6, 28],
    ['f', 10, 22, 15, 27],
    ['D', 12, 28],
    ['x', 3, 32, 9, 37],
    ['D', 6, 31],
    ['v', 11, 32, 15, 37],
    ['D', 13, 31],
    // east wing
    ['c', 32, 29, 44, 30],
    ['D', 31, 29, 31, 30],
    ['r', 33, 20, 44, 27],
    ['D', 36, 28],
    ['D', 40, 19],
    ['m', 39, 32, 44, 37],
    ['K', 41, 31],
    ['h', 32, 32, 37, 37],
    ['D', 34, 31],
    // north corridor + breakable wall slot behind the duty room
    ['n', 13, 17, 45, 18],
    ['W', 23, 19, 24, 19],
    // stairwell down to the garage
    ['S', 44, 16, 45, 16],
  ];
  // stairs: 10 steps of 0.3 m going north (z 15 → 6)
  const steps = 'ABCDEFGHIJ';
  for (let i = 0; i < 10; i++) ops.push([steps[i], 44, 15 - i, 45, 15 - i]);
  ops.push(['g', 2, 1, 46, 5]);
  ops.push(['g', 40, 6, 46, 6]);
  const legend: Parameters<Level['buildMap']>[0]['legend'] = {
    '#': { t: 'wall', wall: 'plasterYellow' },
    w: { t: 'wall', wall: 'woodPanel' },
    l: { t: 'floor', floor: 'tileFloor', ceil: 'ceilingTile', cy: 4.2 },
    o: { t: 'floor', floor: 'woodFloor', ceil: 'ceilingTile', cy: 2.8 },
    c: { t: 'floor', floor: 'linoleum', ceil: 'ceilingTile', cy: 2.8 },
    f: { t: 'floor', floor: 'carpet', ceil: 'ceilingTile', cy: 2.8 },
    x: { t: 'floor', floor: 'woodFloor', ceil: 'ceilingTile', cy: 2.9 },
    v: { t: 'floor', floor: 'tileWhite', ceil: 'ceilingTile', cy: 2.8 },
    r: { t: 'floor', floor: 'linoleum', ceil: 'concreteDark', cy: 3.2 },
    m: { t: 'floor', floor: 'concrete', ceil: 'concrete', cy: 2.8 },
    h: { t: 'floor', floor: 'concreteDark', ceil: 'concreteDark', cy: 2.8 },
    n: { t: 'floor', floor: 'linoleum', ceil: 'ceilingTile', cy: 2.8 },
    W: { t: 'floor', floor: 'linoleum', ceil: 'ceilingTile', cy: 2.8 },
    D: { t: 'floor', floor: 'linoleum', ceil: 'concrete', cy: 2.2 },
    K: { t: 'floor', floor: 'concrete', ceil: 'concrete', cy: 2.2 },
    S: { t: 'floor', floor: 'concrete', ceil: 'concrete', cy: 2.2 },
    g: { t: 'floor', floor: 'concreteDark', ceil: 'concreteDark', fy: -3, cy: -0.1 },
    '.': { t: 'floor', floor: 'linoleum' },
  };
  for (let i = 0; i < 10; i++) {
    const fy = -0.3 * (i + 1);
    legend[steps[i]] = { t: 'floor', floor: 'concrete', ceil: 'concreteDark', fy, cy: Math.max(fy + 3, 2.2 - i * 0.3), side: 'concrete' };
  }
  L.buildMap({ rows: compose(48, 40, '#', ops), legend });

  // ---------------- lobby ----------------
  const counter = P.counter(5);
  L.place(counter, V(23.5, 0, 27.6), 0);
  L.place(P.monitorDesk(1), V(22, 0, 26.8), Math.PI, { keep: true, collide: false });
  for (const x of [19, 28]) L.place(P.bench(), V(x, 0, 33.5), Math.PI / 2);
  L.place(P.sign('雾港市公安局 西港分局', 4.4, 0.55, '#1a1408', '#d8c890', 0.35), V(23.5, 3.2, 26.03), 0, { collide: false, keep: true });
  L.place(P.sign('为人民服务', 2.4, 0.5, '#5a0a0a', '#f0d890', 0.3), V(23.5, 3.6, 35.97), Math.PI, { collide: false, keep: true });
  // front entrance (barricaded)
  for (const x of [21.5, 25.5]) L.place(P.barricade(3), V(x, 0, 35.2), 0);
  L.place(P.cabinet(1.3), V(20.5, 0, 35.5), Math.PI);
  L.place(P.desk(1.6, 0.8), V(26.5, 0, 35.4), 0.1);
  const lobbyLamps = [L.tube(20, 29, { intensity: 9, distance: 10, kind: 'buzz', y: 4.1 }), L.tube(27, 29, { intensity: 9, distance: 10, kind: 'flicker', y: 4.1 }), L.tube(23.5, 33, { intensity: 9, distance: 10, kind: 'buzz', y: 4.1 })];
  L.place(P.papers(41, 18, 2.5), V(23.5, 0.01, 31), 0, { collide: false });
  L.decal('blood', V(18.2, 0.01, 31), V(0, 1, 0), 1.6);
  L.decal('hand', V(17.02, 1.4, 33), V(1, 0, 0), 0.5);
  L.decal('hand', V(17.02, 1.1, 33.6), V(1, 0, 0), 0.45);
  L.ambient('hum', V(23.5, 4, 30), 0.12, 3);

  // ---------------- duty room (safe room) ----------------
  L.place(P.desk(1.6, 0.8), V(25.4, 0, 20.8), Math.PI);
  L.place(P.chair(), V(25.2, 0, 21.8), 0.3, { dynamic: { mass: 8, surface: 'metal' } });
  L.place(P.sofa(), V(22.4, 0, 21), Math.PI / 2 + Math.PI);
  L.place(P.locker(2), V(21.6, 0, 23.6), Math.PI / 2);
  savePoint(L, V(25.6, 0, 23.4), -Math.PI / 2, 'duty');
  L.tube(23.5, 22, { kind: 'buzz', intensity: 5, color: 0xffe6b0 });
  loot(L, 'bandage', 1, V(25.4, 0.82, 20.6), 'ch2:band0');
  L.safe(L.box(21, 20, 27, 25));

  // ---------------- west wing ----------------
  L.tube(9, 29.5, { kind: 'flicker' });
  L.tube(4, 29.5, { kind: 'dying' });
  L.doorsAt('D', { kind: 'wood' });
  for (const [x, z, r] of [[4.5, 23, 0], [7, 25.5, Math.PI], [11.5, 23.5, 0.2], [14, 26, Math.PI]] as [number, number, number][]) L.place(P.desk(1.4, 0.75), V(x, 0, z), r);
  for (const [x, z] of [[3.6, 26.8], [8.4, 22.4], [15.4, 22.4]] as [number, number][]) L.place(P.cabinet(), V(x, 0, z), Math.PI);
  L.place(P.chair(), V(5, 0, 24), 2, { dynamic: { mass: 8, surface: 'metal' } });
  L.place(P.chair(), V(12, 0, 24.6), -2.6, { dynamic: { mass: 8, surface: 'metal' } });
  L.tube(5.5, 24.5, { kind: 'dying', intensity: 5 });
  L.tube(12.5, 24.5, { kind: 'flicker', intensity: 5 });
  L.place(P.papers(51, 12, 1.5), V(12, 0.01, 25), 0, { collide: false });
  loot(L, 'ammo9', 8, V(14, 0.8, 26), 'ch2:ammo1');
  // chief's office
  L.place(P.desk(1.8, 0.9), V(6, 0, 35.8), 0);
  L.place(P.sofa(), V(8.6, 0, 33.6), -Math.PI / 2);
  L.place(P.shelf(1.8, 2.2, 0.4, 61), V(3.4, 0, 34.5), Math.PI / 2);
  L.tube(6, 34.5, { kind: 'flicker', intensity: 5, color: 0xffd8a0 });
  const flag1 = P.sign('局', 0.5, 0.7, '#6a0a0a', '#f0d070', 0.3);
  L.place(flag1, V(6, 1.9, 37.97), Math.PI, { collide: false, keep: true });
  // calendar + note: the armory code puzzle
  const cal = new THREE.Group();
  bx(cal, 0.5, 0.7, 0.02, stdMat({ map: TEX.sign('四月', '#e8e0d0', '#7a1010', 64, 90, 'bold 22px "Noto Serif SC"') }), 0, 0, 0);
  L.place({ g: cal, cols: [] }, V(9.97, 1.6, 34), -Math.PI / 2, { collide: false });
  L.interact(V(9.8, 1.6, 34), '[E] 查看挂历', () => {
    ctx.ui.showDoc({ id: 'cal', title: '挂历 · 四月', body: '一本停在四月的挂历。\n\n17 日被红笔重重圈了起来，旁边写着：\n\n　　「小雨生日 ♥」\n\n后面几个月一页都没翻过。' });
  });
  L.pickup(
    {
      type: 'doc',
      doc: {
        id: 'doc_chief',
        title: '局长的便签',
        body: '致后勤科：\n\n装备室门禁密码已更换。\n新密码为我女儿生日的月日（四位数）。\n别再打电话来问了。\n\n——郑\n\n（背面，字迹明显更潦草）\n赫利生物的人今晚来过。他们要我们「不要介入」。\n他们带走了三号拘留室里那个人。\n我咬伤了手。很痒。',
      },
    },
    V(6.4, 0.82, 35.7),
    'ch2:docChief',
  );
  // locker room: pouch + supplies
  L.place(P.locker(4), V(13, 0, 37.4), Math.PI);
  L.place(P.bench(), V(13, 0, 34.5), 0);
  L.tube(13, 34, { kind: 'buzz', intensity: 5 });
  L.pickup({ type: 'pouch' }, V(11.6, 0.05, 33), 'ch2:pouch');
  loot(L, 'medkit', 1, V(14.6, 0.05, 32.6), 'ch2:medkit');
  loot(L, 'battery', 1, V(12, 0.5, 37.3), 'ch2:bat');

  // ---------------- east wing ----------------
  L.tube(36, 29.5, { kind: 'buzz' });
  L.tube(42, 29.5, { kind: 'flicker' });
  // archive: dark rows of shelves
  for (let i = 0; i < 4; i++) L.place(P.shelf(4.4, 2.6, 0.6, 30 + i), V(39.5, 0, 21.5 + i * 1.7), 0);
  for (const z of [21, 23, 25, 27]) L.place(P.cabinet(1.6), V(33.4, 0, z), Math.PI / 2);
  L.tube(36, 24, { kind: 'dying', intensity: 5 });
  L.tube(42, 26, { kind: 'flicker', intensity: 4 });
  L.place(P.papers(71, 20, 2), V(38, 0.01, 26.5), 0, { collide: false });
  loot(L, 'shells', 4, V(43.5, 1.45, 21.5), 'ch2:shells1');
  // holding cells: bars + prisoners
  const bars = (x0: number, z: number, len: number) => {
    const g = new THREE.Group();
    for (let i = 0; i <= len * 6; i++) bx(g, 0.04, 2.8, 0.04, M.gunmetal(), i / 6, 1.4, 0);
    bx(g, len, 0.08, 0.08, M.gunmetal(), len / 2, 2.6, 0);
    bx(g, len, 0.08, 0.08, M.gunmetal(), len / 2, 0.1, 0);
    L.place({ g, cols: [{ c: V(len / 2, 1.4, 0), h: V(len / 2, 1.4, 0.06) }] }, V(x0, 0, z), 0, { keep: true });
    for (let x = Math.floor(x0); x < x0 + len; x++) L.nav.setBlocked(x, Math.floor(z), true);
  };
  bars(32, 35, 4);
  L.tube(34.5, 33, { kind: 'dying', intensity: 5 });
  enemy('infected', V(33.2, 0, 36.5), { id: 'ch2:cell1', state: 'idle', yaw: Math.PI });
  enemy('infected', V(35.4, 0, 36.6), { id: 'ch2:cell2', state: 'idle', yaw: Math.PI });
  L.place(P.bed(), V(36.8, 0, 36.2), Math.PI / 2);
  corpse(L, V(36, 0, 33), 1.2, 0x8a7a5a);
  loot(L, 'ammo9', 6, V(32.6, 0.05, 32.6), 'ch2:ammo2');
  // armory
  const armDoor = L.door(41, 31, { kind: 'metal', locked: 'armory_code', msg: '装备室 · 门禁密码锁' });
  const keypad = new THREE.Group();
  bx(keypad, 0.16, 0.24, 0.04, M.dark(), 0, 0, 0);
  bx(keypad, 0.12, 0.05, 0.01, stdMat({ color: 0x0a120c, emissive: 0x40ff80, emissiveIntensity: 0.6 }), 0, 0.07, 0.025);
  L.place({ g: keypad, cols: [] }, V(42.5, 1.3, 30.02), Math.PI, { collide: false, keep: true });
  const kpLight = L.light(V(42.5, 1.4, 29.6), 0x40ff80, 1.2, 2, 'pulse');
  const pad = L.interact(V(42.5, 1.3, 30.2), () => (armDoor.locked ? '[E] 输入门禁密码' : null), () => {
    ctx.ui.keypad('装备室 · 门禁', '0417', () => {
      armDoor.unlock();
      armDoor.open(ctx.player.pos);
      kpLight.color.set(0x40ff80);
      setFlag('ch2:armory');
    });
  });
  void pad;
  for (const [x, z, r] of [[39.4, 34, Math.PI / 2], [44.6, 34, -Math.PI / 2]] as [number, number, number][]) L.place(P.shelf(2.6, 2, 0.5, Math.floor(x)), V(x, 0, z), r);
  L.place(P.table(1.4, 0.7), V(41.5, 0, 36.8), 0);
  L.tube(41.5, 34.5, { kind: 'buzz', intensity: 6, color: 0xe8f0ff });
  const shotgunPick = L.pickup({ type: 'weapon', weapon: 'shotgun', ammo: 6 }, V(41.5, 0.79, 36.8), 'ch2:shotgun');
  loot(L, 'shells', 6, V(39.6, 1.2, 34.5), 'ch2:shells2');
  loot(L, 'ammo9', 10, V(44.4, 0.75, 33.4), 'ch2:ammo3');

  // ---------------- north corridor & stairwell ----------------
  L.tube(20, 17.5, { kind: 'flicker' });
  L.tube(30, 17.5, { kind: 'buzz' });
  L.tube(40, 17.5, { kind: 'dying' });
  const vend = P.vending();
  L.place(vend, V(13.6, 0, 17.5), Math.PI / 2, { keep: true });
  L.light(V(14.2, 1.2, 17.5), 0xffc0c0, 2, 3, 'buzz', { emissive: [vend.screen.material as THREE.Material] });
  const wall = breakableWall(L, 23, 19, 24, 19, 'plasterYellow', 2.8);
  const stairDoor = L.doorsAt('S', { kind: 'metal', locked: 'garageKey', msg: '通往地下停车场的门 · 上锁' })[0];
  L.place(P.sign('B1 停车场 ↓', 1.2, 0.3, '#1a3b26', '#d8e8d0', 0.8), V(44.98, 2.4, 18.5), -Math.PI / 2, { collide: false, keep: true });
  L.light(V(44.5, 1.5, 11), 0x40ff60, 3, 5, 'steady');
  L.light(V(44.5, -1.5, 7), 0xff3020, 3, 6, 'pulse');
  // garage
  for (let x = 6; x < 44; x += 6) {
    L.place({ g: pillar(), cols: [{ c: V(0, 1.4, 0), h: V(0.3, 1.4, 0.3) }], foot: [0.3, 0.3] }, V(x, -3, 3), 0);
  }
  const carCols = [0x2a2a2a, 0x4a3a30, 0x2a3a4a, 0x5a5a52, 0x1b1e24];
  for (let i = 0; i < 6; i++) L.place(P.car(carCols[i % carCols.length]), V(9 + i * 6, -3, i % 2 ? 1.6 : 4.6), Math.PI / 2 + (i % 2 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.1);
  const escape = P.policeCar();
  L.place(escape, V(4, -3, 3), Math.PI / 2, { keep: true });
  L.light(V(4, -1.2, 3), 0xff2020, 10, 9, 'beacon');
  L.light(V(4.5, -1.2, 3), 0x2050ff, 10, 9, 'beacon', { phase: 0.5 });
  for (let x = 10; x < 46; x += 9) L.tube(x, 3, { kind: x % 2 ? 'dying' : 'flicker', y: -0.15, intensity: 5 });
  enemy('infected', V(20, -3, 3), { id: 'ch2:g1', state: 'wander' });
  enemy('infected', V(30, -3, 2.5), { id: 'ch2:g2', state: 'idle', yaw: 1.4 });
  enemy('infected', V(14, -3, 4.5), { id: 'ch2:g3', state: 'dormant', wakeDist: 2.6 });

  // ---------------- other enemies ----------------
  enemy('infected', V(5.5, 0, 25), { id: 'ch2:w1', state: 'dormant', police: true, wakeDist: 2.6 });
  enemy('infected', V(13.5, 0, 23.5), { id: 'ch2:w2', state: 'idle', yaw: 2, police: true });
  enemy('infected', V(9, 0, 29.8), { id: 'ch2:w3', state: 'wander' });
  enemy('infected', V(4.2, 0, 33.5), { id: 'ch2:chief', state: 'idle', police: true, yaw: Math.PI / 2, hpMul: 1.3 });
  enemy('infected', V(42, 0, 23.2), { id: 'ch2:a1', state: 'dormant', wakeDist: 2.4 });
  enemy('infected', V(35, 0, 25.8), { id: 'ch2:a2', state: 'idle', yaw: -1 });

  // ---------------- story ----------------
  const zhou = flag('ch2:zhouDead') ? null : new NPC(V(24.6, 0, 29.2), Math.PI, 'zhou');
  let nw: Nightwatch | null = null;

  async function intro() {
    if (!zhou) return;
    zhou.face(ctx.player.pos);
    await wait(1);
    await say('老周', '整个分局就剩我一个了。其他人……要么跑了，要么变成外面那样。');
    await say('老周', '地下停车场还有一辆巡逻车。钥匙你拿着。');
    ctx.inventory.addKey({ id: 'garageKey', name: '停车场钥匙', desc: '老周给的。通往 B1 停车场。' });
    ctx.audio.play('pickup', { bus: 'ui' });
    ctx.ui.toast('获得 停车场钥匙');
    await say('老周', '光靠那把手枪出不去。东边装备室有霰弹枪，门禁密码只有郑局知道。');
    await say('陈屿', '郑局呢？');
    await say('老周', '……在他办公室里。西边走廊尽头。小心点。');
    objective('在局长办公室寻找装备室的密码', V(6, 0, 34.5));
    zhou.pose = 'idle';
    zhou.walkTo(V(22.2, 0, 31.5));
  }

  // shotgun → stalker arrives
  L.onUpdate(() => {
    if (shotgunPick?.taken && !flag('ch2:gotShotgun')) {
      setFlag('ch2:gotShotgun');
      void (async () => {
        await wait(1.5);
        ctx.ui.toast('霰弹枪：近距离可以把敌人打飞');
        await wait(1.5);
        ctx.game.checkpoint('armory');
        await radio('老周（对讲机）', '陈屿……回大厅。外面有动静……很重的脚步声。');
        objective('回到大厅', V(29, 0, 30));
        for (let i = 0; i < 4; i++) {
          ctx.audio.play('bossStep', { pos: V(23.5, 1, 40), vol: 0.5 + i * 0.12, ref: 6 });
          ctx.player.shake = 0.15 + i * 0.05;
          await wait(1.1);
        }
      })();
    }
  });
  L.trigger(L.box(30, 28, 33, 31.5), () => {
    if (!flag('ch2:gotShotgun') || flag('ch2:stalker')) return;
    setFlag('ch2:stalker');
    void stalkerEntrance();
  }, false);

  async function stalkerEntrance() {
    ctx.director.musicEnabled = false;
    ctx.music.only({ tension: 0.5 }, 0.5);
    nw = new Nightwatch(V(23.5, 0, 38.5), Math.PI, 1);
    nw.active = false;
    nw.setState('scripted');
    await ctx.story.cutscene(async () => {
      const s = ctx.story;
      await s.camTo(V(29.6, 1.75, 29.6), V(23.5, 1.4, 33), 0.8);
      if (zhou) {
        zhou.teleport(V(23.5, 0, 30), Math.PI);
        zhou.pose = 'aim';
      }
      await wait(0.6);
      ctx.audio.play('bossImpact', { pos: V(23.5, 1, 36), vol: 1 });
      ctx.player.shake = 1;
      await wait(0.8);
      ctx.audio.play('bossImpact', { pos: V(23.5, 1, 36), vol: 1 });
      ctx.director.scare('low');
      ctx.music.only({ nightwatch: 0.9 }, 0.3);
      // the barricade gives way
      ctx.props.blast(V(23.5, 1, 36), 4, 20);
      L.light(V(23.5, 2.8, 33.5), 0xff3020, 14, 9, 'pulse', { speed: 0.8 });
      ctx.particles.explosion(V(23.5, 1.2, 35.6));
      for (const l of lobbyLamps.slice(2)) l.kind = 'dying';
      nw!.warp(V(23.5, 0, 35), Math.PI);
      await s.camTo(V(27.5, 1.6, 30.5), V(23.5, 2, 35), 1.2);
      ctx.audio.play('bossRoar', { pos: V(23.5, 2.5, 35), vol: 1 });
      await say('老周', '什么鬼东西——！');
      for (let i = 0; i < 4; i++) {
        ctx.audio.play('pistol', { pos: V(23.5, 1.4, 30), vol: 1 });
        ctx.particles.muzzle(V(23.5, 1.45, 30.4), V(0, 0, 1));
        nw!.damage(10, 'torso', nw!.partPos('torso'), V(0, 0, -1), 0.2, 'pistol');
        await wait(0.35);
      }
      // it walks through the bullets
      let t = 0;
      await until(() => {
        t += 1 / 60;
        return nw!.walkToward(V(23.5, 0, 31.1), 2.2, 1 / 60) || t > 3 || s.skipping;
      });
      nw!.vel.set(0, 0, 0);
      await s.camTo(V(26.5, 1.4, 29), V(23.5, 1.8, 30.6), 0.6);
      nw!.setState('punch');
      await wait(0.7);
      ctx.audio.play('bossImpact', { pos: V(23.5, 1, 30), vol: 1 });
      zhou?.die(V(0.6, 0.3, -1).normalize(), 60);
      setFlag('ch2:zhouDead');
      ctx.player.shake = 1.2;
      await wait(1.2);
      await say('老周', '（咳）……跑……去停车场……');
      await wait(0.4);
      nw!.yaw = Math.atan2(29.6 - 23.5, 29.6 - 31);
      await s.camTo(V(29.6, 1.75, 29.6), V(23.5, 2.2, 31), 0.5);
      s.camRelease();
    });
    ctx.director.musicEnabled = true;
    objective('逃往地下停车场（东侧档案室 → 北走廊）', V(44.5, 0, 17.5));
    ctx.ui.toast('它杀不死。逃！');
    nw!.hunt();
    nw!.pace = 0.95;
  }

  // the stalker bursts through the wall behind you in the north corridor
  L.trigger(L.box(28, 16.5, 34, 19), () => {
    if (!nw || flag('ch2:wall')) return;
    setFlag('ch2:wall');
    void (async () => {
      nw!.warp(V(23.5, 0, 21.5), Math.PI);
      nw!.setState('scripted');
      ctx.audio.play('bossImpact', { pos: V(23.5, 1.5, 19.5), vol: 1 });
      ctx.player.shake = 0.8;
      await wait(0.9);
      wall.smash(V(0, 0, -1));
      ctx.director.scare('low');
      nw!.hunt();
    })();
  });
  // reaching the car
  L.trigger(L.box(2, -4, 8, 6, -4, 0), () => {
    if (flag('ch2:end')) return;
    setFlag('ch2:end');
    void (async () => {
      await ctx.story.cutscene(async () => {
        const s = ctx.story;
        await s.camTo(V(6.5, -1.4, 5), V(4, -2, 3), 0.6);
        ctx.audio.play('metalDoor', { pos: V(4, -2, 3), vol: 0.7 });
        await wait(0.6);
        ctx.audio.play('distantBoom', { vol: 0.8 });
        if (nw && !nw.dead) {
          nw.warp(V(16, -3, 3), -Math.PI / 2);
          nw.setState('scripted');
          await s.camTo(V(6, -1.6, 4.4), V(16, -1.5, 3), 0.8);
          ctx.audio.play('bossRoar', { pos: V(16, -1, 3), vol: 1 });
          await wait(1.1);
        }
        ctx.renderer.fx.fade = 0;
        await say('陈屿', '（发动机，快点……！）');
        ctx.audio.play('explosion', { vol: 0.5 });
      });
      ctx.game.nextChapter('ch3');
    })();
  });
  void stairDoor;
  void counter;

  const spawns: Record<string, { pos: THREE.Vector3; yaw: number }> = {
    start: { pos: V(23.5, 0, 33.5), yaw: 0 },
    duty: { pos: V(24, 0, 22.5), yaw: Math.PI },
    armory: { pos: V(41.5, 0, 35.2), yaw: 0 },
  };
  return {
    level: L,
    spawn: spawns[cp] ?? spawns.start,
    start() {
      if (o.fresh) ensureLoadout(['knife', 'pistol'], { ammo9: 24, bandage: 1 });
      ctx.director.ambientPool = [
        { name: 'distantBoom', vol: 0.4, dist: [40, 60] },
        { name: 'groan', vol: 0.25, dist: [10, 20] },
        { name: 'radio', vol: 0.2, dist: [8, 14] },
      ];
      L.startAmbience();
      if (!ctx.inventory.hasKey('garageKey') && (cp !== 'start' || flag('ch2:intro'))) ctx.inventory.addKey({ id: 'garageKey', name: '停车场钥匙', desc: '老周给的。通往 B1 停车场。' });
      if (cp === 'start' && !flag('ch2:intro')) {
        setFlag('ch2:intro');
        void intro();
        ctx.game.checkpoint('start');
      } else if (flag('ch2:gotShotgun')) {
        objective('回到大厅', V(29, 0, 30));
        zhou?.teleport(V(22.2, 0, 31.5));
      } else {
        objective(flag('ch2:armory') ? '取得装备室里的霰弹枪' : '在局长办公室寻找装备室的密码', V(6, 0, 34.5));
        zhou?.teleport(V(22.2, 0, 31.5));
      }
      if (flag('ch2:stalker')) {
        // restarting during the chase: the stalker is already hunting
        nw = new Nightwatch(V(23.5, 0, 31), 0, 1);
        nw.hunt();
        setFlag('ch2:wall', false);
        objective('逃往地下停车场（东侧档案室 → 北走廊）', V(44.5, 0, 17.5));
      }
    },
  };

  function pillar() {
    const g = new THREE.Group();
    bx(g, 0.6, 2.8, 0.6, stdMat({ map: TEX.concrete(), roughness: 0.9 }), 0, 1.4, 0);
    bx(g, 0.62, 0.3, 0.62, M.yellow(), 0, 0.5, 0);
    return g;
  }
}

export type { Door };
