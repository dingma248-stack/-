import * as THREE from 'three';
import { Level } from './level';
import { P } from './props';
import { ctx } from '../core/ctx';
import { V, enemy, loot, say, wait, objective, radio, flag, setFlag, compose, corpse, savePoint, ensureLoadout, type BuildOpts, type ChapterRun } from './kit';
import { NPC } from '../story/npc';
import { stdMat } from '../render/materials';
import { rand } from '../core/math';

/**
 * 第一章 · 雾中街 — the old town around 潮音路, 23:00.
 * Rain, sodium lamps, a burning wreck. Pistol + shooting tutorial.
 */
export function buildCh1(cp: string, o: BuildOpts): ChapterRun {
  const L = new Level('ch1', {
    fog: 0x0d1218,
    fogDensity: 0.05,
    ambient: 0x22324a,
    ambientI: 0.32,
    hemiSky: 0x34465e,
    hemiGround: 0x140e0a,
    hemiI: 0.38,
    grade: { lift: new THREE.Color(0.012, 0.018, 0.034), gain: new THREE.Color(1.02, 0.95, 0.88), sat: 0.82, contrast: 1.1, bloom: 0.8 },
    reverb: 'outdoor',
    root: 43,
    rain: true,
  });
  L.taken = o.taken;
  L.mapTitle = '潮音路';
  const ops: Parameters<typeof compose>[3] = [
    ['s', 1, 18, 58, 19],
    ['=', 1, 20, 58, 27],
    ['s', 1, 28, 58, 29],
    ['a', 4, 30, 6, 41],
    ['a', 2, 38, 8, 42],
    // convenience store
    ['r', 29, 9, 42, 17],
    ['c', 30, 10, 41, 16],
    ['r', 37, 10, 37, 12],
    ['r', 38, 13, 41, 13],
    ['k', 38, 10, 41, 12],
    ['D', 37, 11],
    ['D', 33, 9],
    ['G', 35, 17, 36, 17],
    ['h', 31, 17, 33, 17],
    ['h', 38, 17, 40, 17],
    // back alley, side street, station plaza
    ['a', 30, 5, 50, 8],
    ['=', 50, 2, 53, 17],
    ['p', 42, 1, 58, 4],
  ];
  for (let x = 2; x < 57; x += 6) ops.push(['-', x, 24, x + 2, 24]);
  L.buildMap({
    rows: compose(60, 44, 'B', ops),
    legend: {
      B: { t: 'wall', wall: 'facade' },
      r: { t: 'wall', wall: 'brick' },
      s: { t: 'floor', floor: 'sidewalk', ceil: null, cy: null, fy: 0.12 },
      '=': { t: 'floor', floor: 'asphalt', ceil: null, cy: null },
      '-': { t: 'floor', floor: 'roadLine', ceil: null, cy: null },
      a: { t: 'floor', floor: 'concreteDark', ceil: null, cy: null },
      p: { t: 'floor', floor: 'sidewalk', ceil: null, cy: null, fy: 0.12 },
      c: { t: 'floor', floor: 'tileFloor', ceil: 'ceilingTile', cy: 3.2 },
      k: { t: 'floor', floor: 'woodFloor', ceil: 'ceilingTile', cy: 3 },
      D: { t: 'floor', floor: 'tileFloor', ceil: 'concrete', cy: 2.2 },
      G: { t: 'floor', floor: 'tileFloor', ceil: 'concrete', cy: 2.4 },
      h: { t: 'floor', floor: 'concrete', ceil: 'concrete', fy: 0.9, cy: 2.7, side: 'brick', nav: false },
      '.': { t: 'floor', floor: 'asphalt', ceil: null, cy: null },
    },
    wallHeight: 14,
  });

  // ---------------- street lighting ----------------
  const lamp = (x: number, z: number, north: boolean, kind: 'steady' | 'flicker' | 'dying' = 'steady') => {
    const l = P.streetLamp(5.4);
    L.place(l, V(x, 0, z), north ? 0 : Math.PI, { collide: true, keep: true });
    const head = V(x, 5.2, z + (north ? 1.05 : -1.05));
    L.light(head, 0xff9a48, 40, 15, kind, { emissive: [l.head.material as THREE.Material] });
  };
  lamp(8, 18.5, true);
  lamp(17, 18.5, true, 'flicker');
  lamp(26, 18.5, true);
  lamp(44, 18.5, true, 'dying');
  lamp(13, 29.4, false);
  lamp(22, 29.4, false);
  lamp(31, 29.4, false, 'flicker');
  lamp(40, 29.4, false);
  lamp(49, 29.4, false);
  lamp(51.2, 6.5, true, 'flicker');

  // ---------------- alley ----------------
  L.place(P.dumpster(), V(6.45, 0, 34), Math.PI / 2);
  L.place(P.bin(), V(4.3, 0, 36.5), 0, { dynamic: { mass: 10, surface: 'metal' } });
  L.place(P.crate(0.8), V(2.8, 0, 41.3), 0.3, { dynamic: { mass: 20, breakable: { hp: 40, kind: 'wood' } } });
  L.place(P.debris(11, 8, 1), V(5, 0, 38));
  L.light(V(5, 3.2, 39.5), 0xffc890, 6, 7, 'flicker');
  L.place(P.sign('海湾购物中心 · 卸货区', 1.8, 0.4, '#1a1a1a', '#b0a890', 0.2), V(5, 2.8, 42.97), Math.PI, { collide: false, keep: true });

  // ---------------- crashed police car & dead officer ----------------
  const pc = P.policeCar();
  L.place(pc, V(10, 0, 23.5), 0.55, { keep: true });
  L.light(V(9.8, 2, 23.2), 0xff2020, 22, 12, 'beacon', { phase: 0 });
  L.light(V(10.3, 2, 23.9), 0x2050ff, 22, 12, 'beacon', { phase: 0.45 });
  L.ambient('radio', V(10, 1.2, 23.5), 0.22, 1.5);
  corpse(L, V(8.2, 0, 26.2), 2.4, 0x1e2a3e);
  const pistolPick = L.pickup({ type: 'weapon', weapon: 'pistol', ammo: 12 }, V(8.9, 0.04, 26.6), 'ch1:pistol');
  loot(L, 'ammo9', 10, V(7.6, 0.04, 25.8), 'ch1:ammo1');
  L.pickup(
    {
      type: 'doc',
      doc: {
        id: 'doc_patrol',
        title: '巡逻记录本（残页）',
        body: '22:31 潮音路 14 号报案：有人咬人。\n22:38 抵达。嫌疑人对警告无反应，连开两枪，不倒。\n      ——两枪都打在躯干上。\n22:44 小吴被咬。\n22:47 呼叫分局，无应答。\n\n如果有人看到这个：打头。\n别靠近被咬过的人。',
      },
    },
    V(11.4, 0.05, 25.6),
    'ch1:doc1',
  );
  L.decal('blood', V(9, 0, 26), V(0, 1, 0), 2.2);

  // ---------------- street dressing ----------------
  // parked along the curbs: nosed in, they sank into the raised sidewalk
  L.place(P.car(0x3a4a52), V(17, 0, 26.8), 0.08);
  const wreck = P.car(0x333333, true);
  L.place(wreck, V(25, 0, 22.4), 2.3);
  const fire1 = V(25, 1, 22.4);
  L.light(fire1.clone().setY(1.6), 0xff6a20, 40, 16, 'fire');
  L.ambient('fire', fire1, 0.7, 3);
  L.decal('scorch', V(25, 0, 22.4), V(0, 1, 0), 5);
  L.place(P.car(0x6a5a40), V(38, 0, 21.4), Math.PI + 0.2);
  L.place(P.car(0x2a2a2a), V(47, 0, 26.6), Math.PI + 0.15);
  L.place(P.bench(), V(13.5, 0.12, 18.6), 0);
  L.place(P.phoneBooth(), V(21, 0.12, 18.7), 0);
  // roadblock: barricades behind the police car, not through it
  L.place(P.barricade(3), V(57.2, 0, 22), Math.PI / 2);
  L.place(P.barricade(3), V(57.2, 0, 25.5), Math.PI / 2);
  L.place(P.policeCar(), V(54.6, 0, 24), Math.PI / 2 + 0.1);
  L.light(V(54.6, 2, 24), 0x2050ff, 18, 12, 'beacon', { phase: 0.2 });
  L.place(P.debris(21, 12, 2), V(30, 0, 25));
  L.place(P.papers(22, 16, 3), V(19, 0, 23), 0, { collide: false });
  for (let i = 0; i < 6; i++) L.place(P.bottle(), V(rand(14, 40), 0.12, 28.4 + rand(0, 1)), 0, { dynamic: { mass: 0.5, surface: 'glass', breakable: { hp: 1, kind: 'bottle' } } });
  for (const [x, z, s] of [[12, 22, 1.5], [33, 25, 2], [44, 21, 1.2]] as [number, number, number][]) L.decal('blood', V(x, 0, z), V(0, 1, 0), s);
  // neon shop signs on facades
  const neon: [string, number, number, string, string][] = [
    // just in front of the facades (they sat 2 cm inside them, hidden)
    ['潮音药房', 9, 18.02, '#0a2a1a', '#7affb0'],
    ['老周面馆', 24, 18.02, '#2a0a0a', '#ff7060'],
    ['旅社', 18, 29.98, '#1a0a2a', '#d0a0ff'],
    ['典当行', 44, 29.98, '#2a1a0a', '#ffc070'],
  ];
  for (const [txt, x, z, bg, fg] of neon) {
    const north = z < 20;
    L.place(P.sign(txt, 2, 0.55, bg, fg, 1.3), V(x, 3.4, z), north ? 0 : Math.PI, { collide: false, keep: true });
    L.light(V(x, 3.2, north ? z + 0.7 : z - 0.7), new THREE.Color(fg).getHex(), 6, 6, Math.random() < 0.5 ? 'buzz' : 'flicker');
  }
  // loudspeaker pole
  const pole = P.streetLamp(4.5);
  L.place(pole, V(20, 0.12, 29.3), Math.PI, { keep: true });
  (pole.head.material as THREE.MeshBasicMaterial).color.set(0x222222);

  // ---------------- convenience store ----------------
  L.place(P.sign('24h 便利', 2.6, 0.6, '#0a1a2a', '#8ad0ff', 1.4), V(35.5, 2.9, 18.02), 0, { collide: false, keep: true });
  L.light(V(35.5, 2.7, 18.8), 0x8ad0ff, 8, 7, 'flicker');
  for (const x of [32.5, 39.5]) ctx.props.addPane(V(x, 1.8, 17.5), 2.95, 1.78, 'x');
  L.doorsAt('G', { kind: 'glass' });
  L.door(33, 9, { kind: 'metal' });
  L.door(37, 11, { kind: 'wood' });
  for (const [x, z] of [[32.5, 12], [32.5, 14.5]] as [number, number][]) L.place(P.shelf(3, 1.8, 0.6, Math.floor(x * z)), V(x, 0, z), 0);
  L.place(P.shelf(2.2, 1.8, 0.6, 77), V(35.5, 0, 12.6), Math.PI / 2);
  L.place(P.counter(2.6), V(39.6, 0, 15.2), Math.PI);
  const vend = P.vending(0x1a3a7a);
  L.place(vend, V(30.5, 0, 10.6), Math.PI / 2, { keep: true });
  L.light(V(31.1, 1.2, 10.6), 0xa0c8ff, 3, 4, 'buzz', { emissive: [vend.screen.material as THREE.Material] });
  L.tube(33, 13.3, { kind: 'buzz', intensity: 6 });
  L.tube(38, 15, { kind: 'dying', intensity: 6 });
  L.tube(39.5, 11.2, { kind: 'flicker', intensity: 4, len: 1 });
  loot(L, 'ammo9', 12, V(32.5, 1.25, 14.3), 'ch1:ammo2');
  // at the edge facing the west aisle: mid-shelf it sat inside the shelf's collision box (x 35.2-35.8),
  // which blocks the [E] sight check
  loot(L, 'bandage', 1, V(35.22, 0.95, 12.2), 'ch1:band1');
  loot(L, 'battery', 1, V(39.2, 1.1, 15.2), 'ch1:bat1');
  L.place(P.desk(1.4, 0.7), V(40.4, 0, 10.6), Math.PI);
  savePoint(L, V(38.6, 0, 12.3), Math.PI / 2, 'store');
  loot(L, 'ammo9', 8, V(40.4, 0.81, 10.7), 'ch1:ammo3');
  L.pickup(
    {
      type: 'doc',
      doc: {
        id: 'doc_clerk',
        title: '店员留给老板的字条',
        body: '老板：\n\n今晚好多人来买水和电池，有个穿白大褂的女的\n把货架上的退烧药全买了，付钱的时候手一直在抖。\n她说「快离开这座城」。我以为她喝多了。\n\n刚才街上有人在尖叫。我把前门锁了，从后门走。\n钥匙放在收银台下面。\n\n——阿凯　22:50',
      },
    },
    V(40.6, 0.82, 10.4),
    'ch1:doc2',
  );
  L.safe(L.box(38, 10, 42, 13));

  // ---------------- back alley ----------------
  L.place(P.dumpster(), V(41, 0, 5.6), 0);
  L.place(P.dumpster(), V(46.5, 0, 7.3), Math.PI);
  for (const [x, z] of [[31, 5.5], [44, 8.2], [48, 5.4]] as [number, number][]) L.place(P.bin(), V(x, 0, z), 0, { dynamic: { mass: 10, surface: 'metal' } });
  L.place(P.crate(0.8), V(36, 0, 5.5), 0.2, { dynamic: { mass: 20, breakable: { hp: 40, kind: 'wood', onBreak: () => loot(L, 'ammo9', 6, V(36, 0.05, 5.6)) } } });
  L.light(V(33, 2.6, 8.6), 0xffd090, 5, 6, 'flicker');
  // along the alley's south wall, which ends at x 42: past it the alley opens onto the plaza and the pipe hung in the air
  L.place(P.pipe(11.9, 0.12), V(35.95, 3.2, 5.14), 0, { collide: false });
  L.decal('hand', V(43.5, 1.4, 8.98), V(0, 0, -1), 0.5);

  // ---------------- side street & station plaza ----------------
  // the burning bus jams the side street lengthwise (crosswise, 10 m of it ran through both facades)
  L.place(P.bus(true), V(52, 0, 12.85), 0.12);
  const fire2 = V(52, 2.8, 12.85);
  L.light(fire2, 0xff6a20, 44, 18, 'fire');
  L.ambient('fire', fire2, 0.8, 3);
  L.place(P.barricade(3.5), V(52, 0, 18.75), 0);
  L.place(P.car(0x1b1e24), V(51, 0, 21.6), 0.3);
  corpse(L, V(51.2, 0, 3.4), 1.2, 0x1e2a3e);
  loot(L, 'ammo9', 8, V(52.3, 0.05, 5.6), 'ch1:ammo4');
  // police station gate + sign
  const gate = new THREE.Group();
  const iron = stdMat({ color: 0x1a1c1e, roughness: 0.5, metalness: 0.7 });
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.4, 0.05), iron);
    m.position.set(-2.6 + i * 0.4, 1.2, 0);
    gate.add(m);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.08, 0.06), iron);
  bar.position.y = 2.2;
  gate.add(bar);
  L.place({ g: gate, cols: [{ c: V(0, 1.2, 0), h: V(2.8, 1.2, 0.05) }] }, V(50.5, 0.12, 1.2), 0);
  L.place(P.sign('雾港市公安局 · 西港分局', 4.2, 0.6, '#0e1a2e', '#e6ecf4', 0.8), V(50.5, 3.6, 1.02), 0, { collide: false, keep: true });
  L.light(V(50.5, 4.5, 2.4), 0xdfe8ff, 30, 14, 'steady');
  L.light(V(45, 2, 3), 0xff2020, 14, 10, 'beacon');

  // ---------------- enemies ----------------
  corpse(L, V(14.6, 0, 22.8), 0.4, 0x5a3a30);
  enemy('infected', V(14, 0, 22.2), { id: 'ch1:e1', state: 'feed', yaw: 2.6 });
  enemy('infected', V(21, 0, 21), { id: 'ch1:e2', state: 'wander', yaw: -1.2 });
  enemy('infected', V(27.5, 0, 25.5), { id: 'ch1:e3', state: 'idle', yaw: 2 });
  enemy('infected', V(33, 0.12, 28.8), { id: 'ch1:e4', state: 'dormant', yaw: 1.4, wakeDist: 2.6 });
  enemy('infected', V(42, 0, 23), { id: 'ch1:e5', state: 'wander' });
  enemy('infected', V(48, 0, 21.5), { id: 'ch1:e6', state: 'idle', yaw: 3 });
  enemy('infected', V(33.2, 0, 13.3), { id: 'ch1:e7', state: 'idle', yaw: 0.6 });
  enemy('infected', V(40.5, 0, 16.3), { id: 'ch1:e8', state: 'dormant', yaw: -1.5, wakeDist: 2.4 });
  enemy('infected', V(51.5, 0, 6.6), { id: 'ch1:e9', state: 'idle', yaw: 0 });
  enemy('infected', V(51.6, 0.12, 2.7), { id: 'ch1:e10', state: 'feed', yaw: 1.8 });

  // ---------------- script ----------------
  const plaza = V(50.5, 0, 2.8);
  L.trigger(L.box(3, 29, 8, 31), () => {
    if (flag('ch1:street')) return;
    setFlag('ch1:street');
    void (async () => {
      await radio('警用电台', '……各单位注意，西港分局请求支援，重复，西港分局请求支援……');
      if (!pistolPick?.taken) objective('检查那辆警车', V(9, 0, 26));
    })();
  });
  L.onUpdate(() => {
    if (pistolPick && pistolPick.taken && !flag('ch1:gotPistol')) {
      setFlag('ch1:gotPistol');
      void (async () => {
        await wait(1.2);
        ctx.ui.toast('右键瞄准 · 左键射击 · R 换弹');
        await wait(3.4);
        ctx.ui.toast('打头。省子弹。');
        await say('陈屿', '（分局……老周今晚值班。）');
        objective('前往西港分局（街道东北方向）', plaza);
      })();
    }
  });
  // falling body
  L.trigger(L.box(17.5, 18, 20.5, 28), () => {
    if (flag('ch1:fall')) return;
    setFlag('ch1:fall');
    void (async () => {
      ctx.audio.play('scream', { pos: V(19, 9, 17), vol: 1 });
      await wait(0.7);
      const e = ctx.enemies.spawn('infected', V(19.2, 7.5, 18.9), { state: 'idle' });
      e.corpseDrop(V(0.3, -3, 2.2));
      ctx.audio.play('glass', { pos: V(19, 8, 17.5), vol: 1 });
      ctx.particles.glass(V(19, 8, 17.8), V(0, -0.3, 1), 0.12);
      await wait(0.6);
      ctx.director.scare('high');
      ctx.audio.play('bodyFall', { pos: V(19.5, 0.5, 20), vol: 1 });
    })();
  });
  // broadcast
  const broadcasts = [
    '雾港市应急广播。请市民留在室内，锁好门窗，不要外出。',
    '请勿接近任何受伤或行为异常的人员。重复，请勿接近……',
    '市政府已启动一级应急响应。北区撤离点：港北体育中心。',
  ];
  let bi = 0;
  L.onUpdate((dt) => {
    bcT -= dt;
    if (bcT <= 0 && ctx.player.pos.distanceTo(V(20, 0, 29)) < 28 && !ctx.story.busy) {
      bcT = 32;
      ctx.audio.play('radio', { pos: V(20, 4.5, 29), vol: 0.5 });
      void ctx.story.say('广播', broadcasts[bi++ % broadcasts.length], { radio: true });
    }
  });
  let bcT = 12;
  // blocked side street
  L.trigger(L.box(48, 17, 55, 20), () => {
    if (flag('ch1:blocked')) return;
    setFlag('ch1:blocked');
    void (async () => {
      await say('陈屿', '（路被烧着的公交堵死了。从便利店后门绕过去。）');
      objective('穿过便利店，绕到后巷', V(35.5, 0, 17));
    })();
  });
  L.trigger(L.box(30, 10, 42, 17), () => {
    if (flag('ch1:store')) return;
    setFlag('ch1:store');
    objective('从后门进入后巷', V(33.5, 0, 8.5));
  });
  // runner ambush in the back alley
  L.trigger(L.box(37, 5, 40, 9), () => {
    if (flag('ch1:runner')) return;
    setFlag('ch1:runner');
    void (async () => {
      ctx.audio.play('metalDoor', { pos: V(47, 1, 5), vol: 1 });
      await wait(0.3);
      const r = enemy('runner', V(47.5, 0, 6.5), { id: 'ch1:r1', state: 'chase', yaw: -Math.PI / 2 });
      if (r) {
        ctx.audio.play('scream', { pos: V(47, 1.6, 6.5), vol: 1 });
        ctx.director.scare('high', 0.8);
        await wait(1.5);
        ctx.ui.toast('奔跑者：打它的腿能让它摔倒');
      }
      objective('前往西港分局', plaza);
    })();
  });
  // ending at the gate
  L.trigger(L.box(46.5, 1, 55, 4), () => {
    if (flag('ch1:end')) return;
    setFlag('ch1:end');
    void endScene();
  });

  async function endScene() {
    const zhou = new NPC(V(50.5, 0.12, -0.4), 0, 'zhou');
    zhou.pose = 'aim';
    // a runner charges from the east as the gate opens
    const r = enemy('runner', V(57, 0.12, 2.5), { state: 'chase', yaw: -Math.PI / 2 });
    await ctx.story.cutscene(async () => {
      const s = ctx.story;
      await s.camTo(V(50.5, 1.7, 5.5), V(50.5, 1.4, 0), 1.2);
      await say('老周', '陈屿？！是你吗？别傻站着——快进来！');
      // Zhou covers the plaza
      for (const e of [r, ...ctx.enemies.alive.filter((x) => x.pos.distanceTo(V(50.5, 0, 3)) < 14)]) {
        if (!e || e.dead) continue;
        ctx.audio.play('pistol', { pos: V(50.5, 1.4, 0), vol: 1 });
        ctx.particles.muzzle(V(50.7, 1.4, 0.2), e.headPos().sub(V(50.7, 1.4, 0.2)).normalize());
        e.damage(999, 'head', e.headPos(), e.headPos().sub(V(50.5, 1.4, 0)).normalize(), 1, 'pistol');
        await wait(0.45);
      }
      await wait(0.8);
      await say('老周', '……一枪爆头。你小子还没忘本事。');
      await wait(0.6);
      s.camRelease();
    });
    ctx.renderer.fx.fade = 0;
    ctx.game.nextChapter('ch2');
  }

  // ---------------- run ----------------
  const spawns: Record<string, { pos: THREE.Vector3; yaw: number }> = {
    start: { pos: V(5.5, 0, 41), yaw: 0 },
    store: { pos: V(39.5, 0, 11.5), yaw: Math.PI / 2 },
  };
  const sp = spawns[cp] ?? spawns.start;
  return {
    level: L,
    spawn: sp,
    start() {
      ctx.player.flashOn = true;
      if (o.fresh) ensureLoadout([], { battery: 0 });
      L.ambient('rain', undefined, 0.55);
      L.ambient('wind', undefined, 0.3);
      ctx.director.ambientPool = [
        { name: 'distantBoom', vol: 0.5, dist: [40, 70] },
        { name: 'scream', vol: 0.25, dist: [30, 50] },
        { name: 'thunder', vol: 0.5, dist: [60, 80] },
        { name: 'groan', vol: 0.3, dist: [14, 24] },
      ];
      L.startAmbience();
      if (cp === 'start') {
        objective('离开小巷');
        void (async () => {
          await wait(1.5);
          await say('陈屿', '（雾……从来没这么浓过。）');
        })();
        if (o.fresh || true) ctx.game.checkpoint('start');
      } else {
        objective(pistolPick?.taken ? '从后门进入后巷' : '检查那辆警车', pistolPick?.taken ? V(33.5, 0, 8.5) : V(9, 0, 26));
      }
    },
  };
}
