import * as THREE from 'three';
import { Level, type Door } from './level';
import { P, bx } from './props';
import { ctx } from '../core/ctx';
import {
  V, enemy, loot, say, wait, objective, flag, setFlag, compose, corpse, savePoint, ensureLoadout, radio,
  type BuildOpts, type ChapterRun,
} from './kit';
import { NPC } from '../story/npc';
import { stdMat, M } from '../render/materials';
import type { LightSource } from '../render/lights';
import { rand } from '../core/math';
import { bus } from '../core/events';

/**
 * 第四章 · 忘川 — the southern storm drains, then Helix Bio's underground
 * research facility. 01:20. Keycard, breaker order, vault code; the vaccine.
 */
export function buildCh4(cp: string, o: BuildOpts): ChapterRun {
  const L = new Level('ch4', {
    fog: 0x0a0d0c,
    fogDensity: 0.07,
    ambient: 0x2a3a34,
    ambientI: 0.22,
    hemiSky: 0x3a4a48,
    hemiGround: 0x10120c,
    hemiI: 0.28,
    grade: { lift: new THREE.Color(0.01, 0.016, 0.014), gain: new THREE.Color(0.95, 1.0, 1.02), sat: 0.7, contrast: 1.12, bloom: 0.8 },
    reverb: 'sewer',
    root: 40,
  });
  L.taken = o.taken;
  L.mapTitle = '城南排水系统';
  const ops: Parameters<typeof compose>[3] = [
    // sewer (walkways at -1.0, channel at -1.4)
    ['w', 1, 16, 29, 17],
    ['r', 1, 18, 29, 21],
    ['w', 1, 22, 29, 23],
    ['w', 15, 18, 16, 21],
    ['w', 8, 24, 14, 29],
    ['w', 18, 9, 22, 15],
    ['1', 30, 22, 30, 23],
    ['2', 31, 22, 31, 23],
    // lab shell is brushed steel
    ['Z', 32, 2, 57, 37],
    ['m', 32, 17, 35, 24],
    ['S', 36, 20],
    ['h', 37, 13, 48, 27],
    ['G', 49, 24],
    ['g', 50, 21, 56, 27],
    ['a', 37, 4, 42, 11],
    ['L', 39, 12],
    ['o', 44, 4, 48, 11],
    ['O', 46, 12],
    ['q', 50, 13, 56, 19],
    ['Q', 49, 16],
    ['v', 37, 29, 48, 35],
    ['X', 42, 28],
    ['e', 50, 30, 54, 34],
    ['E', 49, 32],
  ];
  L.buildMap({
    rows: compose(58, 38, '#', ops),
    legend: {
      '#': { t: 'wall', wall: 'sewer' },
      Z: { t: 'wall', wall: 'steel' },
      w: { t: 'floor', floor: 'concreteDark', ceil: 'sewer', fy: -1, cy: 2.4, side: 'sewer' },
      r: { t: 'floor', floor: 'water', ceil: 'sewer', fy: -1.4, cy: 2.4, side: 'sewer' },
      '1': { t: 'floor', floor: 'grate', ceil: 'concreteDark', fy: -0.67, cy: 2.2, side: 'metal' },
      '2': { t: 'floor', floor: 'grate', ceil: 'concreteDark', fy: -0.33, cy: 2.4, side: 'metal' },
      m: { t: 'floor', floor: 'grate', ceil: 'concreteDark', cy: 2.6 },
      S: { t: 'floor', floor: 'steel', ceil: 'steel', cy: 2.3 },
      h: { t: 'floor', floor: 'steel', ceil: 'steel', cy: 5 },
      G: { t: 'floor', floor: 'steel', ceil: 'steel', cy: 2.3 },
      g: { t: 'floor', floor: 'metal', ceil: 'concreteDark', cy: 3.2 },
      a: { t: 'floor', floor: 'tileWhite', ceil: 'ceilingTile', cy: 3 },
      o: { t: 'floor', floor: 'carpet', ceil: 'ceilingTile', cy: 3 },
      q: { t: 'floor', floor: 'metal', ceil: 'steel', cy: 3 },
      v: { t: 'floor', floor: 'steel', ceil: 'steel', cy: 3.4 },
      e: { t: 'floor', floor: 'metal', ceil: 'steel', cy: 3.2 },
      L: { t: 'floor', floor: 'steel', ceil: 'steel', cy: 2.4 },
      O: { t: 'floor', floor: 'steel', ceil: 'steel', cy: 2.4 },
      Q: { t: 'floor', floor: 'steel', ceil: 'steel', cy: 2.4 },
      X: { t: 'floor', floor: 'steel', ceil: 'steel', cy: 2.4 },
      E: { t: 'floor', floor: 'steel', ceil: 'steel', cy: 2.4 },
      '.': { t: 'floor', floor: 'concreteDark' },
    },
  });

  // ---------------- sewer ----------------
  const sewerLights: LightSource[] = [];
  for (let x = 4; x < 30; x += 7) sewerLights.push(L.light(V(x, 1.6, 16.3), 0xffc070, 7, 9, x % 2 ? 'flicker' : 'buzz'));
  L.light(V(11, 1.5, 27), 0xffc070, 5, 7, 'dying');
  L.light(V(20, 1.4, 11), 0x9ad0b0, 4, 7, 'flicker');
  L.ambient('water', V(10, -1.2, 20), 0.6, 4);
  L.ambient('water', V(24, -1.2, 20), 0.5, 4);
  // along the wall faces (they ran inside the walls, out of sight)
  L.place(P.pipe(29, 0.25, M.rust()), V(15.5, 1.6, 16.33), 0, { collide: false });
  L.place(P.pipe(28, 0.15, M.rust()), V(15, 2, 23.8), 0, { collide: false });
  L.place(P.barrel(), V(9.5, -1, 25), 0, { dynamic: { mass: 40, surface: 'metal' } });
  L.place(P.crate(0.8), V(13, -1, 28.5), 0.4, { dynamic: { mass: 20, breakable: { hp: 40, kind: 'wood', onBreak: () => loot(L, 'shells', 4, V(13, -0.95, 28.5)) } } });
  L.place(P.crate(0.8), V(21, -1, 10), 0.1, { dynamic: { mass: 20, breakable: { hp: 40, kind: 'wood', onBreak: () => loot(L, 'ammo9', 8, V(21, -0.95, 10)) } } });
  // dead Helix guard with the L1 keycard
  corpse(L, V(11.5, -1, 27.5), 2.2, 0x2a2e36);
  L.pickup({ type: 'key', key: { id: 'helixL1', name: '赫利生物 L1 门禁卡', desc: '卡面印着「HELIX · 维护通道」。主人已经用不上了。' }, color: 0xd0d0d0 }, V(12.1, -0.95, 27), 'ch4:l1');
  loot(L, 'ammo357', 3, V(10.35, -0.95, 28.65), 'ch4:mag1');
  L.pickup(
    {
      type: 'doc',
      doc: {
        id: 'doc_guard',
        title: '安保对讲记录（手写）',
        body: '21:40  B3 隔离区 3 号舱破裂。\n21:52  上面命令：封锁全部出入口，「任何人」不得离开。\n22:15  我们开始往排水系统里撤。\n22:30  老韩被咬了。\n23:05  上面说直升机只在天台等「授权人员」。\n　　　 我们不是授权人员。\n\n电台里有人说，公司放出了 NW-03。\n那东西是来清场的。',
      },
    },
    V(10.4, -0.95, 26.6),
    'ch4:docGuard',
  );
  enemy('infected', V(6, -1.4, 19.5), { id: 'ch4:s1', state: 'wander' });
  enemy('infected', V(22, -1.4, 20.5), { id: 'ch4:s2', state: 'idle', yaw: -1.5 });
  enemy('infected', V(26, -1, 22.5), { id: 'ch4:s3', state: 'dormant', wakeDist: 2.5 });
  enemy('crawler', V(20, -1, 12), { id: 'ch4:cr', state: 'ceiling' });
  enemy('infected', V(19.5, -1, 9.5), { id: 'ch4:s4', state: 'feed', yaw: 1 });

  // ---------------- lab ----------------
  const labLights: LightSource[] = [];
  const emergency: LightSource[] = [];
  const tube = (x: number, z: number, i = 7) => {
    const s = L.tube(x, z, { kind: 'buzz', color: 0xe8f4ff, intensity: i, distance: 10 });
    s.on = false;
    labLights.push(s);
  };
  // maintenance corridor + checkpoint (safe room)
  L.light(V(33.5, 2.2, 20), 0xff2a18, 4, 7, 'pulse');
  savePoint(L, V(34.6, 0, 23.6), -Math.PI / 2, 'maint');
  L.safe(L.box(32, 17, 36, 25, -1, 3));
  L.place(P.locker(2), V(32.4, 0, 18), Math.PI / 2);
  loot(L, 'battery', 1, V(32.6, 0.05, 23.5), 'ch4:bat');
  const secDoor = L.door(36, 20, { kind: 'slide', locked: 'helixL1', msg: '赫利生物 · 安保检查点（需要 L1 门禁卡）' });
  L.place(P.sign('HELIX · 维护通道', 2.2, 0.35, '#0a0a0a', '#d8e0e8', 0.6), V(35.98, 2, 19), -Math.PI / 2, { collide: false, keep: true });
  // hub
  L.place(P.sign('赫利生物  HELIX', 4.5, 0.8, '#0c0e10', '#e8eef4', 0.9), V(42.5, 3.6, 13.03), 0, { collide: false, keep: true });
  for (const [x, z] of [[40, 16], [45, 16], [40, 24], [45, 24], [42.5, 20]] as [number, number][]) tube(x, z, 9);
  for (const [x, z] of [[38.5, 15], [46.5, 15], [38.5, 25.5], [46.5, 25.5]] as [number, number][]) emergency.push(L.light(V(x, 4.4, z), 0xff2010, 6, 9, 'beacon', { speed: 0.6, phase: Math.random() }));
  const tanks: { g: THREE.Group; liquid: THREE.MeshStandardMaterial }[] = [];
  const tankPos: [number, number, boolean][] = [[39.5, 18, true], [45.5, 18, false], [39.5, 22, true], [45.5, 22, true]];
  for (const [x, z, intact] of tankPos) {
    const t = P.incubator(0x2aaa7a, intact);
    L.place(t, V(x, 0, z), 0, { keep: true });
    tanks.push({ g: t.g, liquid: t.liquidMat });
    if (!intact) {
      t.liquidMat.opacity = 0.05;
      L.decal('blood', V(x, 0, z + 1), V(0, 1, 0), 2);
      L.place(P.debris(Math.floor(x * 7), 8, 1), V(x, 0, z + 1.9), 0, { collide: false });
    }
    L.light(V(x, 1.2, z), 0x30ff9a, 3, 4, 'pulse', { speed: 0.3 });
  }
  L.place(P.desk(2, 0.9), V(42.5, 0, 26), Math.PI);
  L.place(P.monitorDesk(3), V(42.5, 0, 14), 0, { keep: true });
  L.ambient('hum', V(42.5, 2, 20), 0.15, 4);
  enemy('infected', V(41, 0, 19.5), { id: 'ch4:h1', state: 'dormant', wakeDist: 2.6, doctor: true });
  enemy('infected', V(47, 0, 26), { id: 'ch4:h2', state: 'idle', doctor: true, yaw: 2.4 });
  // generator room: breaker puzzle (B → C → A)
  L.door(49, 24, { kind: 'metal' });
  L.light(V(53, 2.8, 24), 0xff8040, 4, 8, 'dying');
  L.place({ g: generator(), cols: [{ c: V(0, 1, 0), h: V(1.2, 1, 0.8) }], foot: [1.2, 0.8] }, V(53, 0, 22.4), 0);
  const breakerOrder = ['B', 'C', 'A'];
  let entered: string[] = [];
  const breakerHandles: Record<string, THREE.Group> = {};
  ['A', 'B', 'C'].forEach((k, i) => {
    const b = new THREE.Group();
    bx(b, 0.45, 0.6, 0.12, stdMat({ color: 0x4a4e52, roughness: 0.5, metalness: 0.6 }), 0, 0, 0);
    const lbl = P.sign(k, 0.2, 0.2, '#e8e0c0', '#1a1a1a', 0.2);
    lbl.g.position.set(0, 0.42, 0.07);
    b.add(lbl.g);
    const hdl = new THREE.Group();
    bx(hdl, 0.05, 0.3, 0.05, M.red(), 0, 0.15, 0);
    hdl.position.set(0, -0.1, 0.09);
    hdl.rotation.x = 0.9;
    b.add(hdl);
    breakerHandles[k] = hdl;
    const pos = V(51.5 + i * 1.3, 1.4, 27.95);
    L.place({ g: b, cols: [] }, pos, Math.PI, { collide: false, keep: true });
    L.interact(pos.clone().add(V(0, 0, -0.3)), () => (flag('ch4:power') ? null : `[E] 拉下断路器 ${k}`), () => flipBreaker(k));
  });
  L.pickup(
    {
      type: 'doc',
      doc: {
        id: 'doc_gen',
        title: '应急电源重启规程（白板照片）',
        body: '停电后重启顺序（不要搞错，会跳闸！）\n\n① 主泵 —— 在中间\n② 照明 —— 在最右边\n③ 门禁 —— 剩下那个\n\n断路器从左到右：A · B · C\n\n（下面有人用红笔写：上次小李按错，整层的门锁了三个钟头）',
      },
    },
    V(50.6, 0.05, 25.8),
    'ch4:docGen',
  );
  function flipBreaker(k: string) {
    if (flag('ch4:power')) return;
    ctx.audio.play('lever', { pos: V(53, 1.4, 27.9), vol: 1 });
    breakerHandles[k].rotation.x = -0.6;
    entered.push(k);
    const i = entered.length - 1;
    if (entered[i] !== breakerOrder[i]) {
      ctx.audio.play('zap', { pos: V(53, 1.4, 27.9), vol: 1 });
      ctx.particles.electric(V(52.8, 1.6, 27.8), 20);
      ctx.ui.toast('断路器跳闸了。顺序不对。');
      bus.emit('noise', { pos: V(53, 1, 26), radius: 20, source: 'player' });
      entered = [];
      setTimeout(() => {
        for (const h of Object.values(breakerHandles)) h.rotation.x = 0.9;
      }, 600);
      return;
    }
    if (entered.length === 3) void powerOn();
  }
  async function powerOn(silent = false) {
    setFlag('ch4:power');
    if (!silent) {
      ctx.audio.play('pneumatic', { vol: 1 });
      ctx.audio.play('distantBoom', { vol: 0.6 });
    }
    for (const h of Object.values(breakerHandles)) h.rotation.x = -0.6;
    for (const l of labLights) l.on = true;
    for (const l of emergency) l.on = false;
    for (const d of L.doors) if (d.locked === 'power') d.unlock();
    if (!silent) {
      ctx.renderer.fx.flash = 0.15;
      await wait(0.6);
      for (const e of ctx.enemies.alive) if (e.pos.distanceTo(V(42.5, 0, 20)) < 12) e.alert(ctx.player.pos);
      await say('林薇', '电力恢复了。门禁应该解锁了——装备室、研究办公室、还有……保险库。');
      enableIntrusion();
      objective('寻找疫苗保险库的密码（研究办公室）', V(46, 0, 8));
      ctx.game.checkpoint('power');
    }
  }
  // armory (grenade launcher)
  const armory = L.door(49, 16, { kind: 'slide', locked: 'power', msg: '安保装备室 · 电力中断' });
  for (const z of [14, 18.5]) L.place(P.shelf(3, 2, 0.5, Math.floor(z * 3)), V(53, 0, z), z < 16 ? 0 : Math.PI);
  L.place(P.table(1.6, 0.8), V(55.4, 0, 16.2), Math.PI / 2);
  tube(53, 16, 6);
  const launcherPick = L.pickup({ type: 'weapon', weapon: 'launcher', ammo: 1 }, V(55.4, 0.79, 16.2), 'ch4:launcher');
  loot(L, 'grenade', 2, V(52, 1.15, 14), 'ch4:gr1');
  loot(L, 'ammo9', 12, V(54, 0.75, 18.5), 'ch4:a1');
  loot(L, 'shells', 6, V(52.6, 0.05, 15.4), 'ch4:sh1');
  // lab A + office
  L.door(39, 12, { kind: 'slide', locked: 'power', msg: '实验室 A · 电力中断' });
  L.door(46, 12, { kind: 'slide', locked: 'power', msg: '研究办公室 · 电力中断' });
  for (const [x, z] of [[38.5, 6], [41, 6]] as [number, number][]) {
    const t = P.incubator(0x8a2a2a, true);
    L.place(t, V(x, 0, z), 0, { keep: true });
    L.light(V(x, 1.2, z), 0xff4a4a, 2.5, 4, 'pulse', { speed: 0.4 });
  }
  L.place(P.table(2, 0.8), V(39.5, 0, 9.5), 0);
  tube(39.5, 8, 6);
  enemy('infected', V(41.5, 0, 10), { id: 'ch4:la1', state: 'idle', doctor: true, yaw: Math.PI });
  loot(L, 'medkit', 1, V(39.2, 0.79, 9.5), 'ch4:med');
  L.pickup(
    {
      type: 'doc',
      doc: {
        id: 'doc_log37',
        title: 'LETHE 实验日志 · 第 37 号',
        body: '11 月 04 日\n第一例人体实验。受试者 S-01，晚期胰腺癌，自愿签署。\n\n注射后 6 小时：疼痛评分从 9 降到 2。他哭了，说谢谢我们。\n注射后 31 小时：体温 42℃，心跳停止。\n注射后 33 小时：S-01 坐了起来。\n\n他已经不认识任何人了。\n\n项目没有停止。董事会说：「这是一个军用方向上的突破。」\n——沈',
      },
    },
    V(40.2, 0.79, 9.3),
    'ch4:docLog',
  );
  L.place(P.desk(1.6, 0.8), V(46, 0, 5.2), 0);
  L.place(P.desk(1.6, 0.8), V(46, 0, 9), Math.PI);
  L.place(P.shelf(2.4, 2.2, 0.45, 91), V(44.4, 0, 7.2), Math.PI / 2);
  tube(46, 7, 6);
  L.pickup(
    {
      type: 'doc',
      doc: {
        id: 'doc_mail',
        title: '内部邮件 · 机密',
        body: '发件人：董事会办公室\n收件人：B 区全体主管\n主题：关于今晚的「港湾站事件」\n\n1. 3 号舱破裂不是我们的责任，是承包商的焊缝。\n2. 已联系军方。「净化」将在 05:00 执行，届时一切物证将不复存在。\n3. NW-03 已投放。目标清单附后。\n4. 天台直升机仅接送授权人员。\n\n附：目标清单（节选）\n　· 沈某（B 区主管）\n　· 林薇（研究员，已尝试向媒体泄露数据）',
      },
    },
    V(46.4, 0.79, 5.1),
    'ch4:docMail',
  );
  const sticky = L.pickup(
    {
      type: 'doc',
      doc: {
        id: 'doc_sticky',
        title: '贴在显示器上的便签',
        body: '保险库新密码：\n「我们犯下大错的那一天」（月日，四位）\n\n每次输入的时候，我都会想起他坐起来的样子。\n——沈',
      },
    },
    V(45.7, 0.79, 9.2),
    'ch4:sticky',
  );
  // vault
  const vault = L.door(42, 28, { kind: 'slide', locked: 'vault', msg: '疫苗保险库 · 密码锁' });
  const kp = new THREE.Group();
  bx(kp, 0.16, 0.24, 0.04, M.dark(), 0, 0, 0);
  bx(kp, 0.12, 0.05, 0.01, stdMat({ color: 0x0a120c, emissive: 0x40ff80, emissiveIntensity: 0.6 }), 0, 0.07, 0.025);
  L.place({ g: kp, cols: [] }, V(43.3, 1.3, 27.97), Math.PI, { collide: false, keep: true });
  L.interact(V(43.3, 1.3, 27.6), () => (vault.locked && flag('ch4:power') ? '[E] 输入保险库密码' : null), () => {
    ctx.ui.keypad('疫苗保险库', '1104', () => {
      vault.unlock();
      vault.open(ctx.player.pos);
    });
  });
  for (let x = 38; x < 48; x += 2.5) L.place(P.cabinet(1.8), V(x, 0, 35.5), Math.PI);
  L.place({ g: pedestal(), cols: [{ c: V(0, 0.5, 0), h: V(0.4, 0.5, 0.4) }], foot: [0.4, 0.4] }, V(42.5, 0, 32), 0);
  const vacLight = L.light(V(42.5, 1.6, 32), 0x4ab0ff, 5, 5, 'pulse', { speed: 0.5 });
  void vacLight;
  for (const x of [39, 46]) tube(x, 31.5, 6);
  const vaccine = L.pickup({ type: 'special', name: '「忘川」疫苗原液', model: 'vaccine', onTake: () => void vaccineScene() }, V(42.5, 1.02, 32), 'ch4:vaccine');
  // elevator
  L.door(49, 32, { kind: 'slide', locked: 'power', msg: '货运电梯 · 电力中断' });
  tube(52, 32, 6);
  L.place(P.sign('B5 · 核心区 ↓', 1.4, 0.3, '#3a0a0a', '#ffd0c0', 0.8), V(48.98, 2.2, 30.5), -Math.PI / 2, { collide: false, keep: true });

  // ---------------- story ----------------
  const lin = new NPC(cp === 'start' ? V(3, -1, 22.6) : V(43, 0, 22), -Math.PI / 2, 'lin');
  lin.following = true;
  if (flag('ch4:bitten')) lin.pose = 'hurt';
  // ambush: Lin gets bitten
  L.trigger(L.box(13, 21.5, 18, 24.5, -2, 1), () => {
    if (flag('ch4:bitten')) return;
    setFlag('ch4:bitten');
    void (async () => {
      lin.following = false;
      lin.teleport(ctx.player.pos.clone().add(V(-2.2, 0, 0.3)));
      const e = enemy('infected', lin.pos.clone().add(V(-0.6, -0.4, -1.4)), { state: 'chase' });
      ctx.audio.play('growl', { pos: lin.pos, vol: 1 });
      ctx.director.scare('high', 0.7);
      await say('林薇', '啊——！');
      if (e) {
        e.yaw = Math.atan2(lin.pos.x - e.pos.x, lin.pos.z - e.pos.z);
        await wait(2.5);
      }
      lin.pose = 'hurt';
      await say('林薇', '没事……没事。只是擦了一下。继续走。');
      lin.following = true;
    })();
  });
  L.trigger(L.box(31, 16, 36, 25, -1, 3), () => {
    if (flag('ch4:lab')) return;
    setFlag('ch4:lab');
    L.mapTitle = '赫利生物 · 地下研究所 B3';
    ctx.ui.setLocation('赫利生物 · 地下研究所');
    L.env.reverb = 'hall';
    ctx.audio.setReverb('hall');
    void (async () => {
      await say('林薇', '这里是 B3。主电源被切断了……应急电源在东边的发电机房。');
      objective('恢复研究所电力（东侧发电机房）', V(53, 0, 24));
    })();
  });
  L.onUpdate(() => {
    if (launcherPick?.taken && !flag('ch4:gl')) {
      setFlag('ch4:gl');
      void launcherWave();
    }
    if (sticky?.taken && !flag('ch4:stickyObj')) {
      setFlag('ch4:stickyObj');
      objective('打开疫苗保险库（大厅南侧）', V(42.5, 0, 28));
    }
  });
  async function launcherWave() {
    await wait(1.5);
    ctx.ui.toast('榴弹发射器：范围伤害。留给真正需要的时候。');
    await wait(2);
    ctx.audio.play('metalDoor', { pos: V(36, 1, 20), vol: 1 });
    ctx.director.scare('low', 0.6);
    await radio('林薇', '陈屿！大厅……好多……！');
    for (let i = 0; i < 4; i++) {
      enemy(i === 3 ? 'runner' : 'infected', V(37.5 + rand(0, 1), 0, 19 + rand(-1.5, 1.5)), { state: 'chase', doctor: i % 2 === 0 });
      await wait(0.5);
    }
  }
  function enableIntrusion() {
    // it crawled out of the tunnel after you; with power back on, it can find you
    ctx.director.intrusion = { form: 2, points: [V(40, 0, 26.5), V(47.5, 0, 13.5), V(54, 0, 25), V(39.5, 0, 5)], max: 1, count: 0, cd: 40 };
  }
  async function vaccineScene() {
    setFlag('ch4:vaccineTaken');
    ctx.director.intrusion = null;
    ctx.director.dismissIntruder();
    await wait(0.4);
    lin.following = false;
    lin.teleport(V(42.5, 0, 29.6), Math.PI);
    lin.pose = 'hurt';
    await ctx.story.cutscene(async () => {
      const s = ctx.story;
      await s.camTo(V(43.6, 1.55, 31.4), V(42.5, 1.2, 29.6), 1);
      await say('林薇', '……陈屿。我骗了你。');
      lin.pose = 'sit';
      await say('林薇', '下水道里那一口，不是擦伤。我已经开始发烧了。');
      await say('林薇', '那是唯一的一管。注射了它，我也许能撑到出城。');
      await say('林薇', '可它也是唯一的证据——证明赫利生物早就知道会发生什么。');
      await say('林薇', '……你来决定吧。');
      s.camRelease();
    });
    const pick = await ctx.ui.choice('把唯一一管疫苗——', ['交给林薇', '留下作为证据']);
    if (pick === 0) {
      setFlag('linSaved', true);
      ctx.audio.play('heal', { bus: 'ui' });
      await say('林薇', '……谢谢。');
      await wait(1);
      lin.pose = 'idle';
      await say('林薇', '（深呼吸）好多了。我们走吧——电梯通往 B5，天台的直升机从那里上去。');
    } else {
      setFlag('linSaved', false);
      ctx.inventory.addKey({ id: 'vaccine', name: '「忘川」疫苗原液', desc: '唯一的一管。也是赫利生物罪行的证据。' });
      await say('林薇', '……嗯。这是对的。总得有人把真相带出去。');
      await say('林薇', '在我变成那样之前……帮我走到天台。');
    }
    lin.following = true;
    objective('乘货运电梯前往 B5 核心区', V(52, 0, 32));
    ctx.game.checkpoint('vault');
  }
  L.trigger(L.box(50, 30, 55, 35), () => {
    if (!flag('ch4:vaccineTaken') || flag('ch4:end')) return;
    setFlag('ch4:end');
    void (async () => {
      ctx.audio.play('pneumatic', { vol: 1 });
      await radio('广播', '警告。B5 收容失败。自毁程序将在 05:00 前……（杂音）');
      ctx.renderer.fx.fade = 0;
      ctx.game.nextChapter('ch5');
    })();
  }, false);
  void vaccine;
  void armory;
  void secDoor;

  const spawns: Record<string, { pos: THREE.Vector3; yaw: number }> = {
    start: { pos: V(2.5, -1, 23), yaw: -Math.PI / 2 },
    power: { pos: V(51, 0, 24.5), yaw: Math.PI / 2 },
    maint: { pos: V(33.5, 0, 22), yaw: -Math.PI / 2 },
    vault: { pos: V(42.5, 0, 30.5), yaw: 0 },
  };
  return {
    level: L,
    spawn: spawns[cp] ?? spawns.start,
    start() {
      if (o.fresh) ensureLoadout(['knife', 'pistol', 'shotgun', 'magnum'], { ammo9: 24, shells: 8, ammo357: 4, bandage: 1 }, 4);
      ctx.director.ambientPool = [
        { name: 'drip', vol: 0.5, dist: [3, 8] },
        { name: 'groan', vol: 0.3, dist: [10, 20] },
        { name: 'distantBoom', vol: 0.3, dist: [30, 50] },
      ];
      L.startAmbience();
      if (flag('ch4:power')) void powerOn(true);
      if (flag('ch4:power') && !flag('ch4:vaccineTaken')) enableIntrusion();
      if (cp === 'start') {
        objective('沿排水渠前进，寻找研究所入口');
        void (async () => {
          await wait(1.5);
          await say('林薇', '研究所的维护通道就在排水系统东头。小心水里。');
        })();
        ctx.game.checkpoint('start');
      } else if (cp === 'vault') {
        objective('乘货运电梯前往 B5 核心区', V(52, 0, 32));
        lin.teleport(V(42.5, 0, 29.6));
      } else {
        objective(flag('ch4:stickyObj') ? '打开疫苗保险库（大厅南侧）' : '寻找疫苗保险库的密码（研究办公室）', V(46, 0, 8));
      }
    },
  };

  function generator() {
    const g = new THREE.Group();
    bx(g, 2.4, 1.8, 1.6, stdMat({ color: 0x5a6a3a, roughness: 0.6, metalness: 0.4 }), 0, 0.9, 0);
    for (let i = 0; i < 5; i++) bx(g, 0.05, 1.4, 1.62, M.dark(), -1 + i * 0.5, 0.9, 0);
    bx(g, 0.3, 0.3, 0.02, stdMat({ color: 0x0a0a0a, emissive: 0xff8020, emissiveIntensity: 0.8 }), 0.6, 1.4, 0.81);
    return g;
  }
  function pedestal() {
    const g = new THREE.Group();
    bx(g, 0.8, 1, 0.8, M.steel(), 0, 0.5, 0);
    bx(g, 0.5, 0.02, 0.5, stdMat({ color: 0x0a1a2a, emissive: 0x4ab0ff, emissiveIntensity: 1 }), 0, 1.01, 0);
    return g;
  }
}

export type { Door };
