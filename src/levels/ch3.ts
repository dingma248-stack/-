import * as THREE from 'three';
import { Level } from './level';
import { P, bx } from './props';
import { ctx } from '../core/ctx';
import {
  V, enemy, loot, say, wait, until, objective, flag, setFlag, compose, corpse, savePoint, ensureLoadout, bloodTrail,
  type BuildOpts, type ChapterRun,
} from './kit';
import { NPC } from '../story/npc';
import { Nightwatch } from '../boss/nightwatch';
import { stdMat, M } from '../render/materials';
import { rand } from '../core/math';

/**
 * 第三章 · 白瓷 — Municipal Hospital No.2, then Metro Line 3 港湾站. 00:30.
 * Lin Wei, the magnum, dogs and a ceiling crawler; the stalker's second form.
 */
export function buildCh3(cp: string, o: BuildOpts): ChapterRun {
  const L = new Level('ch3', {
    fog: 0x08100e,
    fogDensity: 0.068,
    ambient: 0x2a4a40,
    ambientI: 0.28,
    hemiSky: 0x48706a,
    hemiGround: 0x0c1410,
    hemiI: 0.34,
    grade: { lift: new THREE.Color(0.006, 0.024, 0.018), gain: new THREE.Color(0.9, 1.04, 0.98), sat: 0.72, contrast: 1.14, bloom: 0.75 },
    reverb: 'corridor',
    root: 44,
  });
  L.taken = o.taken;
  L.mapTitle = '市二院 · 急诊楼';
  const ops: Parameters<typeof compose>[3] = [
    ['e', 20, 40, 31, 48],
    ['c', 24, 22, 26, 39],
    ['w', 17, 33, 22, 38],
    ['D', 23, 35],
    ['w', 17, 26, 22, 31],
    ['D', 23, 28],
    ['f', 28, 33, 33, 38],
    ['D', 27, 35],
    ['s', 28, 26, 33, 31],
    ['D', 27, 28],
    ['c', 8, 19, 41, 21],
    ['i', 34, 12, 40, 17],
    ['I', 37, 18],
    ['m', 13, 12, 19, 17],
    ['M', 16, 18],
    // fire door + stairwell down to the basement passage
    ['F', 8, 22, 9, 22],
    // subway
    ['b', 6, 37, 11, 38],
    ['u', 2, 39, 17, 43],
    ['P', 2, 44, 53, 47],
    ['T', 2, 48, 53, 50],
    ['k', 30, 40, 34, 42],
    ['K', 32, 43],
    ['1', 27, 48, 28, 48],
    ['2', 27, 49, 28, 49],
  ];
  const stepChars = 'ABCDEFGHIJKLMN';
  for (let i = 0; i < 14; i++) ops.push([stepChars[i], 8, 23 + i, 9, 23 + i]);
  const legend: Parameters<Level['buildMap']>[0]['legend'] = {
    '#': { t: 'wall', wall: 'tileGreen' },
    e: { t: 'floor', floor: 'linoleum', ceil: 'ceilingTile', cy: 3.4 },
    c: { t: 'floor', floor: 'linoleum', ceil: 'ceilingTile', cy: 2.9 },
    w: { t: 'floor', floor: 'tileFloor', ceil: 'ceilingTile', cy: 2.9 },
    f: { t: 'floor', floor: 'tileWhite', ceil: 'ceilingTile', cy: 2.9 },
    s: { t: 'floor', floor: 'carpet', ceil: 'ceilingTile', cy: 2.9 },
    i: { t: 'floor', floor: 'tileWhite', ceil: 'ceilingTile', cy: 2.9 },
    m: { t: 'floor', floor: 'tileWhite', ceil: 'concreteDark', cy: 2.9 },
    D: { t: 'floor', floor: 'linoleum', ceil: 'concrete', cy: 2.2 },
    I: { t: 'floor', floor: 'linoleum', ceil: 'concrete', cy: 2.2 },
    M: { t: 'floor', floor: 'linoleum', ceil: 'concrete', cy: 2.2 },
    F: { t: 'floor', floor: 'concrete', ceil: 'concrete', cy: 2.2 },
    b: { t: 'floor', floor: 'concreteDark', ceil: 'concreteDark', fy: -4.2, cy: -1.4 },
    u: { t: 'floor', floor: 'tileFloor', ceil: 'ceilingTile', fy: -4.2, cy: -0.6 },
    P: { t: 'floor', floor: 'tileWhite', ceil: 'concreteDark', fy: -4.2, cy: -0.4, side: 'tileWhite' },
    T: { t: 'floor', floor: 'grate', ceil: 'concreteDark', fy: -5.4, cy: -0.4, side: 'concreteDark' },
    k: { t: 'floor', floor: 'concrete', ceil: 'ceilingTile', fy: -4.2, cy: -1.4 },
    K: { t: 'floor', floor: 'concrete', ceil: 'concrete', fy: -4.2, cy: -2 },
    '1': { t: 'floor', floor: 'metal', ceil: 'concreteDark', fy: -4.6, cy: -0.4, side: 'metal' },
    '2': { t: 'floor', floor: 'metal', ceil: 'concreteDark', fy: -5.0, cy: -0.4, side: 'metal' },
    '.': { t: 'floor', floor: 'linoleum' },
  };
  for (let i = 0; i < 14; i++) {
    const fy = -0.3 * (i + 1);
    legend[stepChars[i]] = { t: 'floor', floor: 'concrete', ceil: 'concreteDark', fy, cy: fy + 3.1, side: 'concrete' };
  }
  L.buildMap({ rows: compose(56, 52, '#', ops), legend });
  const T = (x: number, z: number, kind: 'buzz' | 'flicker' | 'dying' = 'buzz', i = 6) => L.tube(x, z, { kind, color: 0xd0fff0, intensity: i });

  // ---------------- ER lobby ----------------
  const crash = P.car(0x8a8a82);
  L.place(crash, V(25.5, 0, 47.4), Math.PI / 2 + 0.35);
  L.light(V(24, 0.8, 46), 0xfff0c8, 10, 8, 'flicker');
  L.light(V(27.5, 1, 48.4), 0xff3020, 6, 6, 'beacon');
  L.place(P.debris(81, 14, 2), V(25, 0, 45));
  for (let i = 0; i < 10; i++) L.place(P.debris(90 + i, 2, 0.3), V(rand(21, 30), 0, rand(43, 48)));
  L.place(P.counter(4), V(28.5, 0, 41.2), 0);
  L.place(P.sign('急 诊', 1.6, 0.5, '#0a3a2a', '#d0ffe8', 1), V(25.5, 2.9, 39.98 + 0.04), Math.PI, { collide: false, keep: true });
  for (const [x, z, r] of [[21.5, 42, 0.3], [21, 45.5, -0.2], [30.5, 46, 0.4]] as [number, number, number][]) L.place(P.gurney(), V(x, 0, z), r);
  for (const x of [22, 23, 24]) L.place(P.chair(), V(x, 0, 40.6), 0, { dynamic: { mass: 8, surface: 'metal' } });
  T(23, 42, 'flicker');
  T(28.5, 44, 'buzz');
  L.decal('blood', V(23, 0.01, 44), V(0, 1, 0), 2);
  bloodTrail(L, V(21.5, 0, 43), V(25, 0, 39.5));
  L.decal('hand', V(20.02, 1.3, 41.5), V(1, 0, 0), 0.5);
  enemy('infected', V(29, 0, 43.5), { id: 'ch3:l1', state: 'idle', doctor: true, yaw: Math.PI });
  enemy('infected', V(21.2, 0.9, 45.5), { id: 'ch3:l2', state: 'dormant', wakeDist: 2.4, doctor: true });
  enemy('infected', V(22.5, 0, 47.5), { id: 'ch3:l3', state: 'feed', yaw: 0.5 });
  corpse(L, V(22.8, 0, 47.9), 1.4, 0x9aa8a0);

  // ---------------- main corridor (crawler) ----------------
  T(25, 37, 'buzz');
  T(25, 33, 'dying', 5);
  T(25, 29, 'flicker');
  T(25, 25, 'dying', 5);
  L.light(V(25, 2.3, 31), 0xff2a18, 2.5, 6, 'pulse');
  L.place(P.cart(), V(24.4, 0, 36.2), 0.2, { dynamic: { mass: 20, surface: 'metal' } });
  L.place(P.gurney(), V(26, 0, 30.5), Math.PI / 2 + 0.1);
  L.place(P.bin(), V(26.4, 0, 24), 0, { dynamic: { mass: 8, surface: 'metal' } });
  L.place(P.sign('病 区 →', 1.2, 0.3, '#1a3b26', '#d8e8d0', 0.8), V(24.02, 2.3, 34), Math.PI / 2, { collide: false, keep: true });
  enemy('crawler', V(25, 0, 30.5), { id: 'ch3:crawl1', state: 'ceiling', yaw: Math.PI });
  enemy('infected', V(25.5, 0, 23), { id: 'ch3:c1', state: 'wander', doctor: true });

  // wards
  L.doorsAt('D', { kind: 'wood' });
  for (const z of [34.5, 37]) L.place(P.bed(), V(19.2, 0, z), 0);
  for (const z of [27.5, 30]) L.place(P.bed(), V(19.2, 0, z), 0);
  T(19.5, 35.5, 'dying', 4);
  T(19.5, 28.5, 'flicker', 4);
  enemy('infected', V(19.4, 0.62, 37.2), { id: 'ch3:w1', state: 'dormant', wakeDist: 2.2 });
  enemy('infected', V(21.2, 0, 29), { id: 'ch3:w2', state: 'feed', yaw: -1.5 });
  corpse(L, V(21.6, 0, 29.6), 0.2, 0x7a8a84);
  loot(L, 'ammo9', 8, V(18, 0.7, 26.6), 'ch3:a1');
  let beepT = 0;
  L.onUpdate((dt) => {
    beepT -= dt;
    if (beepT <= 0) {
      beepT = 1.1;
      ctx.audio.play('beep', { pos: V(18, 1.2, 35), vol: 0.25, rate: 0.8 });
    }
  });
  // pharmacy
  L.place(P.shelf(4, 2, 0.45, 13), V(30.5, 0, 33.4), 0);
  L.place(P.shelf(4, 2, 0.45, 14), V(30.5, 0, 37.6), Math.PI);
  T(30.5, 35.5, 'buzz', 5);
  loot(L, 'medkit', 1, V(29.5, 1.2, 33.4), 'ch3:med');
  loot(L, 'bandage', 2, V(31.8, 0.8, 37.6), 'ch3:band');
  loot(L, 'shells', 4, V(32.5, 0.05, 35.5), 'ch3:sh1');
  // security office: keycard for the basement fire door
  L.place(P.monitorDesk(2), V(30.5, 0, 26.6), 0, { keep: true });
  L.place(P.locker(3), V(32.8, 0, 29.6), -Math.PI / 2);
  T(30.5, 28.5, 'flicker', 5);
  enemy('infected', V(29, 0, 30.5), { id: 'ch3:s1', state: 'idle', police: true, yaw: -1 });
  L.pickup({ type: 'key', key: { id: 'b1card', name: '地下通道门禁卡', desc: '市二院保安部。可打开通往地下通道的防火门。' }, color: 0x3a8aff }, V(31.2, 0.82, 26.8), 'ch3:card');
  loot(L, 'ammo9', 10, V(32.6, 1.3, 30.3), 'ch3:a2');
  L.pickup(
    {
      type: 'doc',
      doc: {
        id: 'doc_nurse',
        title: '护士站交接表',
        body: '00:05  12 床 高热 41.2℃，抽搐。已通知值班医生。\n00:12  12 床 心跳停止。抢救 18 分钟，宣布死亡。\n00:31  12 床 ……床上是空的。\n\n赫利生物的两个人在 23:30 来过，\n把四楼隔离病房整层封了，说是「特殊样本」。\n其中一个年轻的女研究员一直在哭。\n\n地下通道直通地铁港湾站，门禁卡在保安部。',
      },
    },
    V(29.5, 0.82, 26.4),
    'ch3:docNurse',
  );

  // ---------------- cross corridor, morgue, isolation ward ----------------
  T(13, 20, 'dying', 5);
  T(20, 20, 'buzz');
  T(30, 20, 'flicker');
  T(38, 20, 'buzz');
  L.place(P.gurney(), V(33, 0, 20.6), 0.05);
  L.place(P.cart(), V(12, 0, 19.6), 1, { dynamic: { mass: 20, surface: 'metal' } });
  L.door(16, 18, { kind: 'metal' });
  L.place(P.sign('太平间', 1, 0.3, '#1a1a1a', '#b0b0a0', 0.4), V(16, 2.4, 18.98), 0, { collide: false, keep: true });
  for (let i = 0; i < 3; i++) L.place(P.gurney(), V(14.5 + i * 2.2, 0, 14.5), Math.PI / 2);
  L.light(V(16, 2.5, 15), 0x9ad0ff, 4, 7, 'dying');
  enemy('crawler', V(12, 0, 20), { id: 'ch3:crawl2', state: 'ceiling', yaw: 0 });
  const isoDoor = L.door(37, 18, { kind: 'slide', locked: 'iso', msg: '隔离病房 · 从里面锁住了。里面好像有人。' });
  L.place(P.sign('隔离病房  ISOLATION', 2, 0.32, '#3a0a0a', '#ffd0c0', 0.8), V(37.5, 2.45, 18.98), 0, { collide: false, keep: true });
  L.light(V(37.5, 2.4, 19.6), 0xff3020, 3, 5, 'pulse');
  // inside the isolation ward
  L.place(P.bed(), V(39, 0, 13.5), Math.PI);
  L.place(P.desk(1.4, 0.7), V(35.2, 0, 13), Math.PI / 2);
  L.place(P.cart(), V(36.5, 0, 16.6), 0.4);
  T(37, 14.5, 'buzz', 6);
  savePoint(L, V(39.4, 0, 16.8), -Math.PI / 2, 'iso');
  L.safe(L.box(34, 12, 41, 18));
  L.pickup(
    {
      type: 'doc',
      doc: {
        id: 'doc_lin1',
        title: '林薇的研究笔记 · 其一',
        body: 'LETHE 第 11 代株。\n\n它不是让死者复活。它让细胞「忘记」自己已经死亡——\n凋亡信号被整段删除，代谢以一种极度饥饿的方式重启。\n\n宿主保留运动皮层与最原始的觅食回路。\n前额叶……什么都没有剩下。\n\n我们本来想用它治疗阿尔茨海默症。\n\n——林',
      },
    },
    V(35.2, 0.79, 12.7),
    'ch3:docLin1',
  );

  // ---------------- basement passage & subway ----------------
  const fire = L.doorsAt('F', { kind: 'metal', locked: 'b1card', msg: '防火门 · 需要门禁卡' })[0];
  L.light(V(8.5, 2.2, 21.4), 0x40ff60, 2, 4, 'steady');
  L.light(V(8.5, -2.5, 32), 0xffd090, 4, 7, 'flicker');
  L.light(V(8.5, -2.4, 37.5), 0xffd090, 4, 7, 'dying');
  enemy('infected', V(9, -4.2, 37.5), { id: 'ch3:b1', state: 'idle', yaw: Math.PI });
  // concourse
  for (let x = 4; x < 17; x += 2.2) {
    const gate = new THREE.Group();
    bx(gate, 0.3, 1, 0.9, M.steel(), 0, 0.5, 0);
    bx(gate, 0.02, 0.02, 0.6, M.glow(0x40ff60), 0.16, 0.9, 0);
    L.place({ g: gate, cols: [{ c: V(0, 0.5, 0), h: V(0.15, 0.5, 0.45) }] }, V(x, -4.2, 41.5), 0, { keep: true });
  }
  L.place(P.sign('港湾站  HARBOUR', 3, 0.5, '#0a2a4a', '#e0f0ff', 1.1), V(10, -1.6, 38.98 + 0.04), 0, { collide: false, keep: true });
  L.place(P.vending(0x1a5a3a), V(16.6, -4.2, 39.8), -Math.PI / 2);
  L.light(V(10, -1.2, 40.5), 0xd8f0ff, 8, 10, 'flicker');
  enemy('infected', V(6, -4.2, 40), { id: 'ch3:u1', state: 'wander' });
  enemy('infected', V(14, -4.2, 42.5), { id: 'ch3:u2', state: 'idle', yaw: 2 });
  enemy('runner', V(3.5, -4.2, 43), { id: 'ch3:u3', state: 'idle', yaw: 1 });
  loot(L, 'ammo9', 10, V(16.2, -4.15, 42.8), 'ch3:a3');
  loot(L, 'shells', 4, V(3, -4.15, 39.5), 'ch3:sh2');
  // platform
  const platLights: ReturnType<Level['light']>[] = [];
  for (let x = 5; x < 53; x += 6) platLights.push(T(x, 45.5, x % 4 ? 'flicker' : 'buzz', 7));
  for (let x = 8; x < 52; x += 12) L.place({ g: pillar(), cols: [{ c: V(0, 1.8, 0), h: V(0.35, 1.8, 0.35) }], foot: [0.35, 0.35] }, V(x, -4.2, 45.5), 0);
  for (let x = 12; x < 50; x += 12) L.place(P.bench(), V(x, -4.2, 44.5), Math.PI);
  L.place(P.sign('3号线  往 港北', 2.6, 0.4, '#0a2a4a', '#e0f0ff', 1), V(20, -1.4, 43.98 + 0.04), Math.PI, { collide: false, keep: true });
  L.place(P.trainCar(12), V(8.5, -5.4, 49.1), 0);
  L.light(V(9, -3.2, 49), 0x9ad0ff, 4, 8, 'dying');
  // rails
  const railMat = stdMat({ color: 0x8a8a8a, roughness: 0.3, metalness: 0.9 });
  for (const z of [48.6, 49.6]) L.place({ g: (() => { const g = new THREE.Group(); bx(g, 52, 0.12, 0.1, railMat, 0, 0.06, 0); return g; })(), cols: [] }, V(28, -5.4, z), 0, { collide: false });
  const third = new THREE.Group();
  const thirdMat = stdMat({ color: 0x6a5a30, roughness: 0.5, metalness: 0.6, emissive: 0x2050ff, emissiveIntensity: 0 });
  bx(third, 52, 0.15, 0.14, thirdMat, 0, 0.3, 0);
  L.place({ g: third, cols: [] }, V(28, -5.4, 50.5), 0, { collide: false, keep: true });
  L.place(P.sign('⚡ 高压危险  请勿进入轨道', 2.8, 0.35, '#c8a020', '#1a1a1a', 0.3), V(36, -3.2, 43.98 + 0.04), Math.PI, { collide: false, keep: true });
  // control room
  L.door(32, 43, { kind: 'metal' });
  L.place(P.monitorDesk(2), V(32, -4.2, 40.6), 0, { keep: true });
  T(32, 41.3, 'buzz', 4);
  // power lever
  const lever = new THREE.Group();
  bx(lever, 0.6, 0.8, 0.12, stdMat({ color: 0x5a5a4a, roughness: 0.6, metalness: 0.5 }), 0, 0, 0);
  const handle = new THREE.Group();
  bx(handle, 0.06, 0.4, 0.06, M.red(), 0, 0.2, 0);
  handle.position.set(0, -0.05, 0.1);
  lever.add(handle);
  L.place({ g: lever, cols: [] }, V(38, -2.9, 43.95 + 0.06), Math.PI, { collide: false, keep: true });
  const leverLight = L.light(V(38, -2.4, 44.4), 0xffb020, 2.5, 3.5, 'pulse');
  const railLight = L.light(V(28, -5, 49.5), 0x6aa8ff, 0, 30, 'strobe', { speed: 6 });
  let powerT = 0, powerCd = 0;
  L.interact(V(38, -3, 44.3), () => (powerCd > 0 ? null : '[E] 接通轨道供电'), () => {
    if (powerCd > 0) return;
    powerT = 2.6;
    powerCd = 7;
    handle.rotation.x = -1.2;
    ctx.audio.play('lever', { pos: V(38, -3, 44), vol: 1 });
    ctx.audio.play('zap', { pos: V(30, -5, 49.5), vol: 1 });
  });
  L.onUpdate((dt) => {
    powerCd = Math.max(0, powerCd - dt);
    if (powerCd === 0) handle.rotation.x = 0;
    leverLight.on = powerCd === 0;
    if (powerT > 0) {
      powerT -= dt;
      thirdMat.emissiveIntensity = Math.random() < 0.5 ? 2 : 0.4;
      railLight.intensity = 30;
      if (Math.random() < 0.6) ctx.particles.electric(V(rand(4, 52), -5.1, 50.5), 3);
      if (nw && !nw.dead && nw.inPit() && nw.state !== 'shocked' && nw.state !== 'defeated') {
        nw.shock();
        shocks++;
      }
      const pc = L.cellAt(ctx.player.pos);
      if (pc && pc.fy < -5) {
        ctx.player.invuln = 0;
        ctx.player.damage(30, ctx.player.pos.clone().setY(ctx.player.pos.y + 0.2));
        ctx.particles.electric(ctx.player.pos.clone().setY(ctx.player.pos.y + 0.5), 6);
      }
    } else {
      thirdMat.emissiveIntensity = 0;
      railLight.intensity = 0;
    }
  });

  // ---------------- story ----------------
  let lin: NPC | null = null;
  let nw: Nightwatch | null = null;
  let shocks = 0;
  if (flag('ch3:lin')) {
    lin = new NPC(cp === 'iso' ? V(37, 0, 15) : V(37, 0, 15), 0, 'lin');
    lin.following = true;
    isoDoor.unlock();
  } else {
    lin = new NPC(V(36.4, 0, 14), Math.PI, 'lin');
    lin.pose = 'crouch';
  }
  const iso = L.interact(V(37.5, 1.3, 18.6), () => (flag('ch3:lin') ? null : '[E] 敲门'), () => void meetLin());

  async function meetLin() {
    if (flag('ch3:lin')) return;
    setFlag('ch3:lin');
    iso.enabled = false;
    ctx.audio.play('doorLocked', { pos: V(37.5, 1, 18), vol: 1 });
    await say('？？？', '……别进来！你被咬过吗？！');
    await say('陈屿', '没有。我是警察——以前是。');
    await wait(0.5);
    isoDoor.unlock();
    isoDoor.open(ctx.player.pos);
    lin!.pose = 'idle';
    await ctx.story.cutscene(async () => {
      const s = ctx.story;
      await s.camTo(V(37.4, 1.65, 17.5), V(36.4, 1.4, 14), 1);
      await say('林薇', '我叫林薇，赫利生物的研究员。外面那些……是「忘川」。');
      await say('林薇', '一种再生病毒。它让死去的细胞忘记自己已经死了。');
      await say('陈屿', '那个穿风衣的大家伙呢？');
      await say('林薇', '「守夜人」。公司的生物兵器。它的任务是清除所有知道真相的人——包括我。');
      await say('林薇', '军方五点整会对整座城市「净化」。燃烧弹。我们必须在那之前离开。');
      await say('林薇', '研究所里还有一管疫苗原液……如果能带出去，这一切至少还有证据。');
      await say('林薇', '这个给你。保安的枪，我……我不会用。');
      s.camRelease();
    });
    ctx.weapons.give('magnum', 6);
    ctx.ui.weaponGet('magnum');
    ctx.audio.play('pickup', { bus: 'ui' });
    loot(L, 'ammo357', 4, V(36.2, 0.79, 13.4), 'ch3:mag');
    lin!.following = true;
    enableIntrusion();
    objective(ctx.inventory.hasKey('b1card') ? '经地下通道前往地铁港湾站' : '在保安部找到地下通道门禁卡', ctx.inventory.hasKey('b1card') ? V(8.5, 0, 22) : V(30.5, 0, 28));
    ctx.game.checkpoint('iso');
  }
  L.onUpdate(() => {
    if (flag('ch3:lin') && ctx.inventory.hasKey('b1card') && !flag('ch3:cardObj')) {
      setFlag('ch3:cardObj');
      objective('经地下通道前往地铁港湾站', V(8.5, 0, 22));
    }
  });
  function enableIntrusion() {
    // the stalker may come back for her while you search the hospital
    ctx.director.intrusion = { form: 1, points: [V(9, 0, 20), V(40.5, 0, 20.5), V(25.5, 0, 38.5), V(21, 0, 45)], max: 1, count: 0, cd: 50 };
  }
  // dogs burst out of the morgue
  L.trigger(L.box(14, 19, 19, 22), () => {
    if (flag('ch3:dogs')) return;
    setFlag('ch3:dogs');
    void (async () => {
      ctx.audio.play('bark', { pos: V(16, 1, 15), vol: 1 });
      await wait(0.4);
      ctx.audio.play('metalDoor', { pos: V(16, 1, 18), vol: 1 });
      const d = L.doors.find((x) => x.cells.some(([cx, cz]) => cx === 16 && cz === 18));
      d?.open(V(16, 0, 15), true);
      ctx.director.scare('high', 0.8);
      for (let i = 0; i < 3; i++) {
        enemy('dog', V(15 + i, 0, 15.5), { id: 'ch3:dog' + i, state: 'chase' });
        await wait(0.25);
      }
      await wait(1.2);
      ctx.ui.toast('感染犬：体型小、速度快——背靠墙，等它们扑上来');
    })();
  });
  L.trigger(L.box(23, 28, 27, 33), () => {
    if (flag('ch3:crawlHint')) return;
    setFlag('ch3:crawlHint');
    void (async () => {
      ctx.audio.play('skitter', { pos: V(25, 2.6, 30), vol: 1 });
      await wait(2.5);
      ctx.ui.toast('壁行者怕光——用手电照它');
    })();
  });
  // fire door opened → into the subway
  L.trigger(L.box(5, 36, 12, 39, -6, -2), () => {
    if (flag('ch3:sub')) return;
    setFlag('ch3:sub');
    ctx.director.intrusion = null;
    ctx.director.dismissIntruder();
    L.env.reverb = 'hall';
    ctx.audio.setReverb('hall');
    L.mapTitle = '地铁三号线 · 港湾站';
    ctx.ui.setLocation('地铁三号线 · 港湾站');
    objective('穿过地铁站台，沿隧道离开');
  });
  // the stalker, form two
  L.trigger(L.box(18, 43.5, 26, 48, -6, -2), () => {
    if (flag('ch3:boss')) return;
    setFlag('ch3:boss');
    void bossIntro();
  });
  async function bossIntro() {
    ctx.game.checkpoint('platform');
    ctx.director.musicEnabled = false;
    ctx.music.only({ tension: 0.6 }, 0.4);
    nw = new Nightwatch(V(44, -5.4, 49.2), -Math.PI / 2, 2);
    nw.pitBelow = -5;
    nw.setState('scripted');
    nw.active = false;
    if (lin) {
      lin.following = false;
      lin.teleport(ctx.player.pos.clone().add(V(-1.5, 0, -0.6)));
    }
    for (let i = 0; i < 4; i++) {
      ctx.audio.play('bossStep', { pos: V(48 - i * 1.2, -5, 49), vol: 0.7 + i * 0.1, ref: 6 });
      await wait(0.6);
    }
    for (const l of platLights.slice(5)) l.kind = 'dying';
    await ctx.story.cutscene(async () => {
      const s = ctx.story;
      await s.camTo(V(30, -2.6, 45), V(42, -4.2, 48.5), 1.2);
      nw!.leapFromTo(V(42, -5.4, 49.2), V(36, -4.2, 46));
      await wait(1.3);
      ctx.audio.play('bossRoar', { pos: V(36, -2.5, 46), vol: 1 });
      ctx.music.only({ nightwatch: 0.9 }, 0.3);
      await s.camTo(V(31, -2.8, 45), V(36, -2.6, 46), 0.8);
      await wait(0.6);
      await say('林薇', '就是它——它换了样子……');
      await say('林薇', '轨道还有电！把它引到轨道上，然后拉下墙上的供电闸！');
      s.camRelease();
    });
    ctx.director.musicEnabled = true;
    if (lin) {
      lin.goTo(V(32, -4.2, 41.2), true).then(() => {
        lin!.pose = 'crouch';
      });
    }
    nw.hunt();
    objective('诱使守夜人冲进轨道，再拉下供电闸', V(38, -4.2, 44));
    ctx.ui.toast('它冲锋前会怒吼——站在站台边缘，侧身躲开');
    nw.onDamaged = (hp) => {
      if (hp <= 0) void bossDown();
    };
  }
  let downDone = false;
  async function bossDown() {
    if (downDone || !nw) return;
    downDone = true;
    nw.setState('defeated');
    await wait(1.4);
    ctx.director.musicEnabled = false;
    ctx.music.only({ tension: 0.4 }, 1);
    await ctx.story.cutscene(async () => {
      const s = ctx.story;
      const bp = nw!.pos.clone();
      await s.camTo(bp.clone().add(V(-4, 2, -3)), bp.clone().add(V(0, 1, 0)), 1);
      ctx.audio.play('bossRoar', { pos: bp, vol: 1, rate: 0.8 });
      ctx.audio.play('zap', { pos: bp, vol: 1 });
      ctx.particles.electric(bp.clone().add(V(0, 1, 0)), 40);
      ctx.renderer.fx.flash = 0.4;
      await wait(1);
      // it drags itself into the dark tunnel
      nw!.warp(V(52, -5.4, 49.5), Math.PI / 2);
      nw!.setState('scripted');
      await wait(0.6);
      await say('林薇', '它……还会回来的。它不会停。');
      await say('陈屿', '那就别让它追上。走隧道。');
      s.camRelease();
    });
    nw?.remove();
    ctx.director.musicEnabled = true;
    ctx.game.checkpoint('after');
    objective('沿轨道进入隧道（站台东端）', V(53, -5.4, 49));
    if (lin) lin.following = true;
  }
  L.trigger(L.box(50.5, 47.5, 54, 51, -6, -4), () => {
    if (!flag('ch3:boss') || !downDone || flag('ch3:end')) return;
    setFlag('ch3:end');
    void (async () => {
      ctx.renderer.fx.fade = 0;
      await say('林薇', '前面连着城南的排水系统……研究所就在下面。');
      ctx.game.nextChapter('ch4');
    })();
  }, false);
  void until;
  void fire;

  const spawns: Record<string, { pos: THREE.Vector3; yaw: number }> = {
    start: { pos: V(25.5, 0, 45), yaw: 0 },
    iso: { pos: V(37.5, 0, 16), yaw: 0 },
    platform: { pos: V(14, -4.2, 44.6), yaw: -Math.PI / 2 },
    after: { pos: V(40, -4.2, 45), yaw: -Math.PI / 2 },
  };
  return {
    level: L,
    spawn: spawns[cp] ?? spawns.start,
    start() {
      if (o.fresh) ensureLoadout(['knife', 'pistol', 'shotgun'], { ammo9: 20, shells: 8, bandage: 1 }, 4);
      ctx.director.ambientPool = [
        { name: 'groan', vol: 0.3, dist: [10, 22] },
        { name: 'skitter', vol: 0.3, dist: [6, 12] },
        { name: 'drip', vol: 0.4, dist: [3, 8] },
      ];
      L.ambient('hum', V(25, 2.5, 30), 0.14, 3);
      L.ambient('drone', V(28, -3, 47), 0.2, 8);
      L.startAmbience();
      if (flag('ch3:lin') && !flag('ch3:sub')) enableIntrusion();
      if (cp === 'start') {
        objective('寻找求救的人（四楼隔离病房 · 北侧）', V(37.5, 0, 19));
        void (async () => {
          await wait(1.5);
          await say('陈屿', '（车废了。电台里那个女人说她在这家医院……隔离病房。）');
        })();
        ctx.game.checkpoint('start');
      } else if (cp === 'platform' || (flag('ch3:boss') && !downDone)) {
        setFlag('ch3:boss', false);
        if (lin) lin.teleport(V(14, -4.2, 43.5));
        objective('穿过地铁站台，沿隧道离开');
      } else if (cp === 'after') {
        downDone = true;
        objective('沿轨道进入隧道（站台东端）', V(53, -5.4, 49));
        if (lin) lin.teleport(V(38, -4.2, 44.5));
      }
    },
  };

  function pillar() {
    const g = new THREE.Group();
    bx(g, 0.7, 3.6, 0.7, stdMat({ map: undefined, color: 0xc8ccc4, roughness: 0.4 }), 0, 1.8, 0);
    bx(g, 0.72, 0.4, 0.72, stdMat({ color: 0x1a5a3a, roughness: 0.5 }), 0, 1.2, 0);
    return g;
  }
}
