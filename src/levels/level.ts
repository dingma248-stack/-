import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ctx } from '../core/ctx';
import { surface, M, stdMat, applyRetro, type Footstep } from '../render/materials';
import { TEX } from '../render/textures';
import { GROUPS, RAPIER, type ColliderTag } from '../physics/world';
import { NavGrid } from '../enemies/nav';
import type { LightKind, LightSource } from '../render/lights';
import type { ReverbKind, Voice } from '../audio/engine';
import type { Grade } from '../render/renderer';
import { P, type PropBuild, bx } from './props';
import { itemModel, glintSprite } from './items';
import { ITEMS, type ItemId, type KeyItem, type Doc } from '../player/inventory';
import type { WeaponId } from '../config';
import { WEAPONS } from '../config';
import { bus } from '../core/events';
import { clamp } from '../core/math';
import type { BreakKind, DynProp } from '../physics/props';

export interface CellDef {
  t: 'floor' | 'wall' | 'void';
  floor?: string;
  wall?: string;
  ceil?: string | null;
  fy?: number;
  cy?: number | null;
  side?: string;
  nav?: boolean;
}

export interface MapDef {
  rows: string[];
  legend: Record<string, CellDef>;
  /** marker chars inherit this legend entry (default '.') */
  base?: Record<string, string>;
  wallHeight?: number;
}

export interface LevelEnv {
  fog: number;
  fogDensity: number;
  ambient: number;
  ambientI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  grade: Partial<Grade>;
  reverb: ReverbKind;
  root: number;
  rain?: boolean;
  flashlight?: number;
}

export interface Interactable {
  pos: THREE.Vector3;
  radius: number;
  label: () => string | null;
  use: () => void;
  enabled: boolean;
}

export interface Trigger {
  box: THREE.Box3;
  once: boolean;
  fired: boolean;
  enabled: boolean;
  inside: boolean;
  onEnter: () => void;
  onExit?: () => void;
}

type ResolvedCell = Required<Pick<CellDef, 't'>> & { floor: string; wall: string; ceil: string | null; fy: number; cy: number | null; side: string; nav: boolean };

/** A prop as placed, with its meshes as built: finalize() merges static ones away, these stay valid. */
export interface Placed {
  build: PropBuild;
  pos: THREE.Vector3;
  rotY: number;
  meshes: THREE.Mesh[];
  dynamic: boolean;
  collide: boolean;
  /** world bounds, filled in on first use */
  box?: THREE.Box3;
}

const _ray = new THREE.Raycaster();
const _v = new THREE.Vector3();
const _box = new THREE.Box3();
const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);

/** World bounds from the stored matrix: Box3.expandByObject would recompute it, wrongly for meshes finalize() detached. */
function worldBox(m: THREE.Mesh, out: THREE.Box3) {
  if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
  return out.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
}

// ------------------------------------------------------------------ Door
export type DoorKind = 'wood' | 'metal' | 'slide' | 'glass' | 'cell';

export class Door {
  /** swing doors stop square against the wall (they used to overshoot to ~1.7 rad, into it) */
  static readonly OPEN = Math.PI / 2;
  /** how far the hinge sits in from the jamb: the open leaf then clears the wall it lies against */
  static readonly INSET = 0.04;
  pivot = new THREE.Group();
  leaf: THREE.Mesh | THREE.Group;
  body: RAPIER.RigidBody;
  angle = 0;
  vel = 0;
  target = 0;
  dir = 1;
  locked: string | null;
  lockedMsg: string;
  broken = false;
  private wasOpen = false;
  readonly center: THREE.Vector3;
  readonly cells: [number, number][];
  interact: Interactable;
  onOpen?: () => void;

  constructor(
    private level: Level,
    public kind: DoorKind,
    readonly hinge: THREE.Vector3,
    readonly baseYaw: number,
    readonly width: number,
    readonly height: number,
    readonly alongX: boolean,
    cells: [number, number][],
    locked: string | null,
    lockedMsg: string,
  ) {
    this.locked = locked;
    this.lockedMsg = lockedMsg;
    this.cells = cells;
    this.pivot.position.copy(hinge);
    this.pivot.rotation.y = baseYaw;
    const t = kind === 'slide' ? 0.12 : 0.06;
    const mat =
      kind === 'wood'
        ? stdMat({ map: TEX.woodPanel(), roughness: 0.7 })
        : kind === 'glass'
          ? M.glass()
          : kind === 'cell'
            ? M.gunmetal()
            : kind === 'slide'
              ? stdMat({ map: TEX.steel(), color: 0xb0b8ba, roughness: 0.35, metalness: 0.7 })
              : stdMat({ map: TEX.metal(), color: 0x7a8288, roughness: 0.5, metalness: 0.6 });
    const g = new THREE.Group();
    if (kind === 'cell') {
      for (let i = 0; i < 6; i++) bx(g, 0.03, height, 0.03, mat, 0.08 + i * (width / 6), height / 2, 0);
      bx(g, width, 0.05, 0.05, mat, width / 2, height - 0.05, 0);
      bx(g, width, 0.05, 0.05, mat, width / 2, 0.1, 0);
    } else {
      bx(g, width, height, t, mat, width / 2, height / 2, 0);
      if (kind === 'wood' || kind === 'metal') {
        bx(g, 0.04, 0.04, 0.16, M.steel(), width - 0.1, 1.0, 0);
        if (kind === 'metal') bx(g, width * 0.5, 0.3, t + 0.01, M.glass(), width / 2, 1.55, 0);
      }
      if (kind === 'slide') {
        bx(g, width, 0.08, t + 0.01, M.yellow(), width / 2, 1.0, 0);
        bx(g, 0.04, height, t + 0.01, M.dark(), 0.02, height / 2, 0);
      }
      if (kind === 'glass') {
        bx(g, width, 0.06, 0.06, M.gunmetal(), width / 2, 0.03, 0);
        bx(g, width, 0.06, 0.06, M.gunmetal(), width / 2, height - 0.03, 0);
        bx(g, 0.06, height, 0.06, M.gunmetal(), 0.03, height / 2, 0);
        bx(g, 0.06, height, 0.06, M.gunmetal(), width - 0.03, height / 2, 0);
      }
    }
    this.leaf = g;
    this.pivot.add(g);
    level.group.add(this.pivot);
    this.center = this.leafCenter();
    const tag: ColliderTag = { kind: 'door', surface: kind === 'wood' ? 'woodPanel' : 'metal', owner: this };
    this.body = ctx.physics.addKinematicBox(this.center, new THREE.Vector3(width / 2, height / 2, 0.05), tag, GROUPS.static).body;
    this.syncBody();
    this.interact = {
      pos: this.center.clone().setY(hinge.y + 1.1),
      radius: 1.9,
      enabled: true,
      label: () => {
        if (this.broken) return null;
        if (this.locked) return ctx.inventory.hasKey(this.locked) ? '[E] 解锁' : '[E] 检查门';
        return this.target > 0 ? null : '[E] 开门';
      },
      use: () => this.use(),
    };
    level.interactables.push(this.interact);
    this.updateNav();
  }

  private leafCenter(out = new THREE.Vector3()) {
    if (this.kind === 'slide') {
      const ax = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.baseYaw);
      return out.copy(this.hinge).addScaledVector(ax, this.width / 2 + this.angle * this.width * 0.95).setY(this.hinge.y + this.height / 2);
    }
    const yaw = this.baseYaw + this.angle * this.dir;
    const ax = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    return out.copy(this.hinge).addScaledVector(ax, this.width / 2).setY(this.hinge.y + this.height / 2);
  }

  private syncBody() {
    const c = this.leafCenter();
    const yaw = this.kind === 'slide' ? this.baseYaw : this.baseYaw + this.angle * this.dir;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body.setNextKinematicTranslation({ x: c.x, y: c.y, z: c.z });
    this.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }

  updateNav() {
    for (const [x, z] of this.cells) this.level.nav.setBlocked(x, z, !!this.locked);
  }

  use() {
    if (this.broken) return;
    if (this.locked) {
      if (ctx.inventory.hasKey(this.locked)) {
        const k = ctx.inventory.keys.find((k) => k.id === this.locked);
        this.locked = null;
        this.updateNav();
        ctx.audio.play('doorLocked', { pos: this.center });
        ctx.ui.toast(`使用了 ${k?.name ?? '钥匙'}`);
        this.open(ctx.player.pos);
      } else {
        ctx.audio.play('doorLocked', { pos: this.center });
        ctx.ui.toast(this.lockedMsg);
      }
      return;
    }
    if (this.target > 0) this.close();
    else this.open(ctx.player.pos);
  }

  /** Swing direction that opens the leaf away from `p`. */
  awayFrom(p: THREE.Vector3) {
    return this.alongX ? (p.z > this.hinge.z ? 1 : -1) : p.x > this.hinge.x ? -1 : 1;
  }

  /** True when the open leaf, swinging shut, moves away from `p` rather than sweeping into it. */
  closesAwayFrom(p: THREE.Vector3) {
    const yaw = this.baseYaw + this.angle * this.dir;
    return ((p.x - this.hinge.x) * Math.sin(yaw) + (p.z - this.hinge.z) * Math.cos(yaw)) * this.dir < 0;
  }

  open(from?: THREE.Vector3, fast = false) {
    if (this.locked || this.broken || this.target > 0) return;
    // the side is only picked from shut: flipping it while the leaf still stood open teleported
    // the leaf (and its collider) to the other side in one frame
    if (from && this.kind !== 'slide' && this.angle < 0.05) this.dir = this.awayFrom(from);
    this.target = this.kind === 'slide' ? 1 : Door.OPEN;
    if (fast) this.vel = this.dir * 8;
    ctx.audio.play(this.kind === 'slide' ? 'pneumatic' : this.kind === 'wood' ? 'doorOpen' : 'metalDoor', { pos: this.center, vol: this.kind === 'wood' ? 0.8 : 0.6 });
    bus.emit('noise', { pos: this.center.clone(), radius: 5, source: 'world' });
    this.onOpen?.();
  }

  close() {
    if (this.broken) return;
    this.target = 0;
  }

  lock(id: string, msg: string) {
    this.locked = id;
    this.lockedMsg = msg;
    this.close();
    this.updateNav();
  }

  unlock() {
    this.locked = null;
    this.updateNav();
  }

  /** The stalker smashes doors clean off their hinges. */
  blast(dir: THREE.Vector3) {
    if (this.broken) return;
    this.broken = true;
    this.locked = null;
    this.updateNav();
    const c = this.leafCenter();
    const q = new THREE.Quaternion();
    this.leaf.getWorldQuaternion(q);
    ctx.physics.removeBody(this.body);
    this.pivot.remove(this.leaf);
    this.level.group.remove(this.pivot);
    const build: PropBuild = { g: new THREE.Group(), cols: [{ c: new THREE.Vector3(0, 0, 0), h: new THREE.Vector3(this.width / 2, this.height / 2, 0.05) }] };
    this.leaf.position.set(-this.width / 2, -this.height / 2, 0);
    build.g.add(this.leaf);
    const p = ctx.props.add(build, c, 0, 40, 'metal');
    p.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    p.body.applyImpulse({ x: dir.x * 260, y: 60, z: dir.z * 260 }, true);
    p.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * 40, y: (Math.random() - 0.5) * 40, z: (Math.random() - 0.5) * 40 }, true);
    ctx.audio.play('bossImpact', { pos: c });
    ctx.audio.play('doorSlam', { pos: c });
    ctx.particles.splinters(c, this.hinge.y);
    this.interact.enabled = false;
  }

  update(dt: number) {
    if (this.broken) return;
    const k = this.kind === 'slide' ? 40 : 28;
    const f = (this.target - this.angle) * k - this.vel * (this.kind === 'slide' ? 12 : 7);
    this.vel += f * dt;
    this.angle += this.vel * dt;
    if (this.kind === 'slide') this.angle = clamp(this.angle, 0, 1);
    else if (this.angle > Door.OPEN) {
      // hits the wall: a dull bounce instead of swinging on through it
      this.angle = Door.OPEN;
      this.vel = -Math.abs(this.vel) * 0.25;
    } else this.angle = Math.max(0, this.angle);
    if (this.kind === 'slide') {
      const ax = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.baseYaw);
      this.pivot.position.copy(this.hinge).addScaledVector(ax, this.angle * this.width * 0.95);
    } else this.pivot.rotation.y = this.baseYaw + this.angle * this.dir;
    this.syncBody();
    const open = this.angle > 0.05;
    if (this.wasOpen && !open && this.target === 0) {
      ctx.audio.play(this.kind === 'wood' ? 'doorSlam' : 'metalDoor', { pos: this.center, vol: 0.5 });
    }
    this.wasOpen = open;
  }
}

// ------------------------------------------------------------------ Pickup
export type PickupKind =
  | { type: 'item'; item: ItemId; count: number }
  | { type: 'weapon'; weapon: WeaponId; ammo?: number }
  | { type: 'key'; key: KeyItem; color?: number }
  | { type: 'doc'; doc: Doc }
  | { type: 'pouch' }
  | { type: 'special'; name: string; model: 'vaccine' | 'key' | 'tape'; onTake: () => void };

export class Pickup {
  g: THREE.Group;
  glint: THREE.Sprite;
  taken = false;
  interact: Interactable;
  constructor(private level: Level, readonly id: string, readonly kind: PickupKind, readonly pos: THREE.Vector3, rotY = Math.random() * 6) {
    const model =
      kind.type === 'item' ? itemModel(kind.item) : kind.type === 'weapon' ? itemModel(kind.weapon) : kind.type === 'key' ? itemModel('key', kind.color) : kind.type === 'doc' ? itemModel('doc') : kind.type === 'pouch' ? itemModel('pouch') : itemModel(kind.model);
    this.g = model;
    model.position.copy(pos);
    model.rotation.y = rotY;
    this.glint = glintSprite();
    this.glint.position.set(0, 0.12, 0);
    model.add(this.glint);
    level.group.add(model);
    this.interact = {
      pos: pos.clone().add(new THREE.Vector3(0, 0.1, 0)),
      radius: 1.6,
      enabled: true,
      label: () => (this.taken ? null : `[E] ${this.verb()} ${this.name()}`),
      use: () => this.take(),
    };
    level.interactables.push(this.interact);
  }

  name(): string {
    const k = this.kind;
    switch (k.type) {
      case 'item':
        return `${ITEMS[k.item].name}${k.count > 1 ? ' ×' + k.count : ''}`;
      case 'weapon':
        return WEAPONS[k.weapon].name;
      case 'key':
        return k.key.name;
      case 'doc':
        return `「${k.doc.title}」`;
      case 'pouch':
        return '战术腰包';
      case 'special':
        return k.name;
    }
  }
  verb() {
    return this.kind.type === 'doc' ? '阅读' : '拾取';
  }

  take() {
    if (this.taken) return;
    const k = this.kind;
    const inv = ctx.inventory;
    if (k.type === 'item') {
      const left = inv.add(k.item, k.count);
      if (left === k.count) {
        ctx.ui.toast('背包已满');
        ctx.audio.play('beepErr', { bus: 'ui', vol: 0.5 });
        return;
      }
      if (left > 0) {
        k.count = left;
        ctx.ui.toast(`拾取了部分 ${ITEMS[k.item].name}（背包已满）`);
        ctx.audio.play('pickup', { bus: 'ui' });
        return;
      }
      ctx.ui.toast(`获得 ${ITEMS[k.item].name} ×${k.count + 0}`);
    } else if (k.type === 'weapon') {
      ctx.weapons.give(k.weapon, k.ammo ?? 0);
      ctx.ui.weaponGet(k.weapon);
    } else if (k.type === 'key') {
      inv.addKey(k.key);
      ctx.ui.toast(`获得 ${k.key.name}`);
    } else if (k.type === 'doc') {
      inv.addDoc(k.doc);
      ctx.ui.showDoc(k.doc);
      ctx.audio.play('paper', { bus: 'ui' });
    } else if (k.type === 'pouch') {
      inv.expand(4);
      ctx.ui.toast('背包扩展：容量 +4');
    } else if (k.type === 'special') {
      k.onTake();
    }
    if (k.type !== 'doc') ctx.audio.play('pickup', { bus: 'ui' });
    bus.emit('pickup', { label: this.name() });
    this.taken = true;
    this.level.taken.add(this.id);
    this.level.group.remove(this.g);
    this.interact.enabled = false;
  }
}

// ------------------------------------------------------------------ Level
export class Level {
  readonly group = new THREE.Group();
  env: LevelEnv;
  w = 0;
  h = 0;
  cells: ResolvedCell[] = [];
  chars: string[] = [];
  markers = new Map<string, [number, number][]>();
  nav!: NavGrid;
  explored!: Uint8Array;
  doors: Door[] = [];
  pickups: Pickup[] = [];
  interactables: Interactable[] = [];
  triggers: Trigger[] = [];
  updaters: ((dt: number, t: number) => void)[] = [];
  lights: LightSource[] = [];
  ambience: { name: string; pos?: THREE.Vector3; vol: number; voice: Voice | null; ref?: number }[] = [];
  safeZones: THREE.Box3[] = [];
  /** every prop placed, kept so pickups can rest on them after the merge (and for layout audits) */
  placed: Placed[] = [];
  /** pickups taken / flags restored from checkpoint */
  taken = new Set<string>();
  private staticMeshes: THREE.Mesh[] = [];
  private finalized = false;
  private pickupSeq = 0;
  private hemi: THREE.HemisphereLight;
  private amb: THREE.AmbientLight;
  objective = '';
  /** pretty name for the map screen */
  mapTitle = '';

  constructor(readonly id: string, env: LevelEnv) {
    this.env = env;
    // the level under construction is the current one (NPCs, bosses etc. attach to it)
    ctx.level = this;
    // ground colour doubles as bounce light so ceilings never read as a black void
    const ground = new THREE.Color(env.hemiGround).lerp(new THREE.Color(env.hemiSky), 0.5);
    this.hemi = new THREE.HemisphereLight(env.hemiSky, ground, env.hemiI);
    this.amb = new THREE.AmbientLight(env.ambient, env.ambientI);
    this.group.add(this.hemi, this.amb);
  }

  // ---------------- map → geometry ----------------
  buildMap(def: MapDef) {
    const rows = def.rows;
    this.h = rows.length;
    this.w = Math.max(...rows.map((r) => r.length));
    const dflt = def.legend['.'] ?? { t: 'floor' };
    const resolve = (ch: string): ResolvedCell => {
      let d = def.legend[ch];
      if (!d) {
        const baseCh = def.base?.[ch] ?? '.';
        d = def.legend[baseCh] ?? dflt;
      }
      const t = d.t;
      return {
        t,
        floor: d.floor ?? dflt.floor ?? 'concrete',
        wall: d.wall ?? dflt.wall ?? 'concrete',
        ceil: d.ceil === undefined ? (dflt.ceil === undefined ? 'ceilingTile' : dflt.ceil) : d.ceil,
        fy: d.fy ?? dflt.fy ?? 0,
        cy: d.cy === undefined ? (dflt.cy === undefined ? 3 : dflt.cy) : d.cy,
        side: d.side ?? d.floor ?? dflt.floor ?? 'concrete',
        nav: d.nav ?? t === 'floor',
      };
    };
    for (let z = 0; z < this.h; z++)
      for (let x = 0; x < this.w; x++) {
        const ch = rows[z][x] ?? ' ';
        this.chars.push(ch);
        const cell = ch === ' ' ? ({ t: 'void', floor: '', wall: '', ceil: null, fy: 0, cy: null, side: '', nav: false } as ResolvedCell) : resolve(ch);
        this.cells.push(cell);
        // every non-wall char doubles as a marker so scripts can find cells by symbol
        if (cell.t === 'floor') {
          let l = this.markers.get(ch);
          if (!l) this.markers.set(ch, (l = []));
          l.push([x, z]);
        }
      }
    const wallH = def.wallHeight ?? 6;
    this.explored = new Uint8Array(this.w * this.h);
    // ---- geometry buckets ----
    type Bucket = { pos: number[]; nrm: number[]; uv: number[]; col: number[] };
    const buckets = new Map<string, Bucket>();
    const bucket = (name: string) => {
      let b = buckets.get(name);
      if (!b) buckets.set(name, (b = { pos: [], nrm: [], uv: [], col: [] }));
      return b;
    };
    const C = (x: number, z: number) => (x < 0 || z < 0 || x >= this.w || z >= this.h ? null : this.cells[z * this.w + x]);
    const solid = (x: number, z: number) => {
      const c = C(x, z);
      return !c || c.t !== 'floor';
    };
    // corner AO for floors: count solid cells around a grid corner
    const cornerAO = (vx: number, vz: number) => {
      let n = 0;
      if (solid(vx - 1, vz - 1)) n++;
      if (solid(vx, vz - 1)) n++;
      if (solid(vx - 1, vz)) n++;
      if (solid(vx, vz)) n++;
      return 1 - n * 0.16;
    };
    const quad = (b: Bucket, v: number[][], n: number[], uvs: number[][], cols: number[]) => {
      // ensure winding matches normal
      const [a, bb, c] = v;
      const e1 = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      let order = [0, 1, 2, 0, 2, 3];
      if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) order = [0, 2, 1, 0, 3, 2];
      for (const i of order) {
        b.pos.push(v[i][0], v[i][1], v[i][2]);
        b.nrm.push(n[0], n[1], n[2]);
        b.uv.push(uvs[i][0], uvs[i][1]);
        b.col.push(cols[i], cols[i], cols[i]);
      }
    };
    for (let z = 0; z < this.h; z++)
      for (let x = 0; x < this.w; x++) {
        const c = this.cells[z * this.w + x];
        if (c.t !== 'floor') continue;
        const fs = surface(c.floor).scale;
        const x0 = x, x1 = x + 1, z0 = z, z1 = z + 1;
        // floor
        quad(
          bucket(c.floor),
          [[x0, c.fy, z0], [x0, c.fy, z1], [x1, c.fy, z1], [x1, c.fy, z0]],
          [0, 1, 0],
          [[x0 / fs, -z0 / fs], [x0 / fs, -z1 / fs], [x1 / fs, -z1 / fs], [x1 / fs, -z0 / fs]],
          [cornerAO(x0, z0), cornerAO(x0, z1), cornerAO(x1, z1), cornerAO(x1, z0)],
        );
        // ceiling
        if (c.ceil && c.cy !== null) {
          const cs = surface(c.ceil).scale;
          const ao = (vx: number, vz: number) => 0.55 + 0.45 * cornerAO(vx, vz);
          quad(
            bucket(c.ceil),
            [[x0, c.cy, z0], [x1, c.cy, z0], [x1, c.cy, z1], [x0, c.cy, z1]],
            [0, -1, 0],
            [[x0 / cs, z0 / cs], [x1 / cs, z0 / cs], [x1 / cs, z1 / cs], [x0 / cs, z1 / cs]],
            [ao(x0, z0), ao(x1, z0), ao(x1, z1), ao(x0, z1)],
          );
        }
        // sides
        const dirs: [number, number, number[], number[][]][] = [
          [0, -1, [0, 0, 1], [[x0, z0], [x1, z0]]],
          [0, 1, [0, 0, -1], [[x1, z1], [x0, z1]]],
          [-1, 0, [1, 0, 0], [[x0, z1], [x0, z0]]],
          [1, 0, [-1, 0, 0], [[x1, z0], [x1, z1]]],
        ];
        for (const [dx, dz, n, [p0, p1]] of dirs) {
          const nb = C(x + dx, z + dz);
          const top = c.cy ?? c.fy + wallH;
          const uAxis = dx === 0 ? 0 : 1; // along x for N/S walls
          const addFace = (mat: string, y0: number, y1: number, shadeBottom = 0.62, shadeTop = 1, facing = n) => {
            if (y1 - y0 < 0.001) return;
            const s = surface(mat).scale;
            const u0 = (uAxis === 0 ? p0[0] : p0[1]) / s, u1 = (uAxis === 0 ? p1[0] : p1[1]) / s;
            quad(
              bucket(mat),
              [[p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]]],
              facing,
              [[u0, y0 / s], [u1, y0 / s], [u1, y1 / s], [u0, y1 / s]],
              [shadeBottom, shadeBottom, shadeTop, shadeTop],
            );
          };
          if (!nb || nb.t === 'void') {
            if (!nb) addFace(c.wall, c.fy, top);
            else addFace(c.side, c.fy - 8, c.fy, 0.4, 0.9);
            continue;
          }
          if (nb.t === 'wall') {
            // AO gradient grows over the first metre
            const h = top - c.fy;
            if (h > 1.2) {
              addFace(nb.wall, c.fy, c.fy + 1, 0.55, 0.9);
              addFace(nb.wall, c.fy + 1, top, 0.9, 1);
            } else addFace(nb.wall, c.fy, top, 0.6, 1);
            continue;
          }
          // neighbouring floor that is higher → riser face
          if (nb.fy > c.fy + 0.001) addFace(nb.side, c.fy, nb.fy, 0.6, 0.95);
          // neighbouring lower ceiling → soffit
          if (c.cy !== null && nb.cy !== null && nb.cy < c.cy - 0.001 && c.ceil) addFace(nb.ceil ?? c.ceil, nb.cy, c.cy, 0.8, 0.7);
          if (c.cy !== null && nb.cy === null && nb.fy + wallH > c.cy) {
            // a roofed opening onto open sky (a shop door, a display window): wall it over up to the
            // facade's height in the facade's own material, or the street sees through a slot above it
            let mat = 'concrete';
            for (let k = 1; k <= 4 && mat === 'concrete'; k++)
              for (const sgn of [-1, 1]) {
                const side = dx === 0 ? C(x + k * sgn, z) : C(x, z + k * sgn);
                if (side?.t === 'wall') {
                  mat = side.wall;
                  break;
                }
              }
            addFace(mat, c.cy, nb.fy + wallH, 0.9, 1, [-n[0], -n[1], -n[2]]);
          }
        }
      }
    for (const [name, b] of buckets) {
      if (!b.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mapMaterial(name));
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    // ---- colliders (greedy rectangles) ----
    const used = new Uint8Array(this.w * this.h);
    const greedy = (pred: (c: ResolvedCell) => boolean, same: (a: ResolvedCell, b: ResolvedCell) => boolean, emit: (x: number, z: number, w: number, h: number, c: ResolvedCell) => void) => {
      used.fill(0);
      for (let z = 0; z < this.h; z++)
        for (let x = 0; x < this.w; x++) {
          const i = z * this.w + x;
          const c = this.cells[i];
          if (used[i] || !pred(c)) continue;
          let w = 1;
          while (x + w < this.w) {
            const j = z * this.w + x + w;
            if (used[j] || !pred(this.cells[j]) || !same(c, this.cells[j])) break;
            w++;
          }
          let h = 1;
          outer: while (z + h < this.h) {
            for (let k = 0; k < w; k++) {
              const j = (z + h) * this.w + x + k;
              if (used[j] || !pred(this.cells[j]) || !same(c, this.cells[j])) break outer;
            }
            h++;
          }
          for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) used[(z + dz) * this.w + x + dx] = 1;
          emit(x, z, w, h, c);
        }
    };
    const ph = ctx.physics;
    greedy(
      (c) => c.t === 'wall',
      (a, b) => a.wall === b.wall,
      (x, z, w, h, c) => ph.addStaticBox(new THREE.Vector3(x + w / 2, 4, z + h / 2), new THREE.Vector3(w / 2, 9, h / 2), c.wall),
    );
    greedy(
      (c) => c.t === 'floor',
      (a, b) => a.fy === b.fy && a.floor === b.floor,
      (x, z, w, h, c) => ph.addStaticBox(new THREE.Vector3(x + w / 2, c.fy - 1, z + h / 2), new THREE.Vector3(w / 2, 1, h / 2), c.floor),
    );
    greedy(
      (c) => c.t === 'floor' && c.cy !== null,
      (a, b) => a.cy === b.cy,
      (x, z, w, h, c) => ph.addStaticBox(new THREE.Vector3(x + w / 2, c.cy! + 0.5, z + h / 2), new THREE.Vector3(w / 2, 0.5, h / 2), c.ceil ?? 'concrete'),
    );
    // world boundary
    const bw = this.w, bh = this.h;
    ph.addStaticBox(new THREE.Vector3(bw / 2, 4, -0.5), new THREE.Vector3(bw / 2 + 1, 9, 0.5));
    ph.addStaticBox(new THREE.Vector3(bw / 2, 4, bh + 0.5), new THREE.Vector3(bw / 2 + 1, 9, 0.5));
    ph.addStaticBox(new THREE.Vector3(-0.5, 4, bh / 2), new THREE.Vector3(0.5, 9, bh / 2 + 1));
    ph.addStaticBox(new THREE.Vector3(bw + 0.5, 4, bh / 2), new THREE.Vector3(0.5, 9, bh / 2 + 1));
    // ---- nav ----
    this.nav = new NavGrid(this.w, this.h, 1);
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      this.nav.walk[i] = c.t === 'floor' && c.nav ? 1 : 0;
      this.nav.height[i] = c.fy;
    }
  }

  // ---------------- queries ----------------
  cellAt(p: THREE.Vector3): ResolvedCell | null {
    const x = Math.floor(p.x), z = Math.floor(p.z);
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return null;
    return this.cells[z * this.w + x];
  }
  footstepAt(p: THREE.Vector3): Footstep {
    const c = this.cellAt(p);
    if (!c || c.t !== 'floor') return 'concrete';
    return surface(c.floor).step;
  }
  floorY(x: number, z: number) {
    const c = this.cells[Math.floor(z) * this.w + Math.floor(x)];
    return c ? c.fy : 0;
  }
  /** world position of a cell centre */
  cell(x: number, z: number, dy = 0) {
    return new THREE.Vector3(x + 0.5, this.floorY(x, z) + dy, z + 0.5);
  }
  at(ch: string, i = 0, dy = 0) {
    const m = this.markers.get(ch);
    if (!m || !m[i]) throw new Error(`marker '${ch}' #${i} not found in ${this.id}`);
    return this.cell(m[i][0], m[i][1], dy);
  }
  all(ch: string) {
    return (this.markers.get(ch) ?? []).map(([x, z]) => this.cell(x, z));
  }
  has(ch: string) {
    return this.markers.has(ch);
  }
  /** bounding box (world) of all cells marked with ch */
  zone(ch: string, y0 = -1, y1 = 4) {
    const box = new THREE.Box3();
    for (const [x, z] of this.markers.get(ch) ?? []) {
      box.expandByPoint(new THREE.Vector3(x, y0, z));
      box.expandByPoint(new THREE.Vector3(x + 1, y1, z + 1));
    }
    return box;
  }
  box(x0: number, z0: number, x1: number, z1: number, y0 = -2, y1 = 6) {
    return new THREE.Box3(new THREE.Vector3(Math.min(x0, x1), y0, Math.min(z0, z1)), new THREE.Vector3(Math.max(x0, x1), y1, Math.max(z0, z1)));
  }

  // ---------------- builders ----------------
  /**
   * Place a prop. Static props get merged later for fewer draw calls.
   * y = 0 means "on the floor": on a raised cell (a curb, a ledge) the prop sits on it instead of sinking in.
   */
  place(build: PropBuild, pos: THREE.Vector3, rotY = 0, opts: { dynamic?: { mass: number; surface?: string; breakable?: { hp: number; kind: BreakKind; onBreak?: (p: DynProp) => void } }; nav?: boolean; keep?: boolean; surface?: string; collide?: boolean } = {}) {
    if (pos.y === 0) pos = pos.clone().setY(this.floorY(pos.x, pos.z));
    if (build.scatter) this.scatter(build, pos, rotY);
    const meshes: THREE.Mesh[] = [];
    build.g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    this.placed.push({ build, pos: pos.clone(), rotY, meshes, dynamic: !!opts.dynamic, collide: opts.collide !== false });
    if (opts.dynamic) {
      return { build, prop: ctx.props.add(build, pos, rotY, opts.dynamic.mass, opts.dynamic.surface ?? 'wood', opts.dynamic.breakable) };
    }
    build.g.position.copy(pos);
    build.g.rotation.y = rotY;
    this.group.add(build.g);
    build.g.updateMatrixWorld(true);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    if (opts.collide !== false)
      for (const c of build.cols) {
        const center = c.c.clone().applyQuaternion(q).add(pos);
        ctx.physics.addStaticBox(center, c.h, opts.surface ?? 'metal', q);
      }
    if (opts.nav !== false && build.foot) {
      const [fx, fz] = build.foot;
      const corners = [new THREE.Vector3(-fx, 0, -fz), new THREE.Vector3(fx, 0, -fz), new THREE.Vector3(fx, 0, fz), new THREE.Vector3(-fx, 0, fz)].map((v) => v.applyQuaternion(q).add(pos));
      const minX = Math.min(...corners.map((c) => c.x)), maxX = Math.max(...corners.map((c) => c.x));
      const minZ = Math.min(...corners.map((c) => c.z)), maxZ = Math.max(...corners.map((c) => c.z));
      for (let z = Math.floor(minZ + 0.25); z <= Math.floor(maxZ - 0.25); z++)
        for (let x = Math.floor(minX + 0.25); x <= Math.floor(maxX - 0.25); x++) if (this.nav.inside(x, z)) this.nav.walk[this.nav.idx(x, z)] = 0;
    }
    if (!opts.keep)
      build.g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !(m.material as THREE.Material).transparent && !(m.material as THREE.MeshBasicMaterial).isMeshBasicMaterial) this.staticMeshes.push(m);
      });
    return { build, prop: null };
  }

  /**
   * Loose pieces (papers, rubble) follow the floor under each piece; any that land in a wall,
   * off an edge or inside solid furniture placed before them are dropped.
   */
  private scatter(build: PropBuild, pos: THREE.Vector3, rotY: number) {
    const base = this.floorY(pos.x, pos.z);
    const p = new THREE.Vector3();
    for (const o of [...build.g.children]) {
      p.copy(o.position).applyAxisAngle(_up, rotY).add(pos);
      const c = this.cellAt(p);
      if (!c || c.t !== 'floor' || this.inSolidProp(p.setY(c.fy + 0.05))) build.g.remove(o);
      else o.position.y += c.fy - base;
    }
  }

  /** Inside (or within a hand's width of) the collider of a static prop placed so far: wheels and trim stick out past it. */
  private inSolidProp(p: THREE.Vector3, margin = 0.15) {
    const l = new THREE.Vector3();
    for (const s of this.placed) {
      if (s.dynamic || !s.collide) continue;
      for (const c of s.build.cols) {
        l.copy(p).sub(s.pos).applyAxisAngle(_up, -s.rotY).sub(c.c);
        if (Math.abs(l.x) < c.h.x + margin && Math.abs(l.y) < c.h.y && Math.abs(l.z) < c.h.z + margin) return true;
      }
    }
    return false;
  }

  /** Opaque static prop meshes under or around `box`: what a pickup can come to rest on (or push aside). */
  private surfacesNear(box: THREE.Box3) {
    const out: THREE.Mesh[] = [];
    for (const p of this.placed) {
      if (p.dynamic) continue;
      if (!p.box) {
        p.box = new THREE.Box3();
        for (const m of p.meshes) p.box.union(worldBox(m, _box));
      }
      if (p.box.max.x < box.min.x || p.box.min.x > box.max.x || p.box.max.z < box.min.z || p.box.min.z > box.max.z || p.box.min.y > box.max.y) continue;
      for (const m of p.meshes) {
        const mat = m.material as THREE.Material;
        if (!mat.transparent && !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) out.push(m);
      }
    }
    return out;
  }

  /**
   * Settles a pickup onto whatever is under it. Hand-placed heights are only approximate
   * (0.8 on a 0.785 desk top, 0.05 above the floor, 1.2 next to a shelf board), which left
   * items hovering or half sunk into shelves.
   */
  private rest(p: Pickup) {
    const box = new THREE.Box3();
    p.g.updateMatrixWorld(true);
    p.g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) box.union(worldBox(o as THREE.Mesh, _box));
    });
    if (box.isEmpty()) return;
    const all = this.surfacesNear(box.clone().expandByScalar(0.05));
    // it rests on the shelf board, not on the knick-knacks, which then make room for it
    const near = all.filter((m) => !m.userData.clutter);
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const hx = (box.max.x - box.min.x) * 0.35, hz = (box.max.z - box.min.z) * 0.35;
    // lift a sunk item at most a few cm, and never up through the board or desk top above it
    _ray.set(_v.set(cx, box.min.y + 0.01, cz), _up);
    _ray.far = 0.2;
    const over = _ray.intersectObjects(near, false)[0];
    const top = box.min.y + Math.min(0.12, over ? over.distance - 0.005 : 0.12);
    let sup = -Infinity;
    for (const [dx, dz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      _v.set(cx + dx * hx, top, cz + dz * hz);
      const c = this.cellAt(_v);
      if (c?.t === 'floor' && c.fy <= top) sup = Math.max(sup, c.fy);
      _ray.set(_v, _down);
      _ray.far = 4;
      const hit = _ray.intersectObjects(near, false)[0];
      if (hit) sup = Math.max(sup, hit.point.y);
    }
    if (sup === -Infinity) return;
    const dy = sup + 0.001 - box.min.y;
    p.g.position.y += dy;
    p.pos.y += dy;
    p.interact.pos.y += dy;
    box.translate(_v.set(0, dy, 0)).expandByScalar(0.01);
    for (const m of all) {
      if (!m.userData.clutter || !worldBox(m, _box).intersectsBox(box)) continue;
      m.removeFromParent();
      for (const s of this.placed) s.meshes = s.meshes.filter((x) => x !== m);
    }
  }

  light(pos: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, distance: number, kind: LightKind = 'steady', extra: Omit<Partial<LightSource>, 'color' | 'pos'> = {}) {
    const s = ctx.lights.add({ pos, color, intensity, distance, kind, ...extra });
    this.lights.push(s);
    return s;
  }

  /** Ceiling fluorescent fixture with a linked light. */
  tube(x: number, z: number, opts: { y?: number; rot?: number; color?: number; kind?: LightKind; intensity?: number; distance?: number; len?: number; hum?: boolean } = {}) {
    const fy = this.floorY(x, z);
    const c = this.cells[Math.floor(z) * this.w + Math.floor(x)];
    const y = opts.y ?? (c?.cy ?? fy + 3) - 0.04;
    const t = P.tubeLight(opts.len ?? 1.3);
    t.mat.color.set(opts.color ?? 0xfff2d8);
    const pos = new THREE.Vector3(x, y, z);
    this.place(t, pos, opts.rot ?? 0, { keep: true, collide: false, nav: false });
    const s = this.light(pos.clone().add(new THREE.Vector3(0, -0.55, 0)), opts.color ?? 0xffeccc, opts.intensity ?? 7, opts.distance ?? 9, opts.kind ?? 'buzz', { emissive: [t.mat], emissiveBase: 1 });
    if (opts.hum !== false && (opts.kind === 'flicker' || opts.kind === 'dying')) this.ambient('hum', pos, 0.25, 1.5);
    return s;
  }

  ambient(name: string, pos: THREE.Vector3 | undefined, vol: number, ref = 2) {
    this.ambience.push({ name, pos: pos?.clone(), vol, voice: null, ref });
  }

  startAmbience() {
    for (const a of this.ambience) {
      if (!a.voice) a.voice = ctx.audio.loop(a.name, { pos: a.pos, vol: a.vol, ref: a.ref, rolloff: a.pos ? 1.4 : 1 });
    }
  }

  door(x: number, z: number, opts: { kind?: DoorKind; locked?: string | null; msg?: string; id?: string; width?: number } = {}) {
    // orientation from neighbouring walls
    const C = (cx: number, cz: number) => this.cells[cz * this.w + cx];
    const wallW = C(x - 1, z)?.t === 'wall', wallE = C(x + 1, z)?.t === 'wall';
    const alongX = wallW || wallE || !(C(x, z - 1)?.t === 'wall');
    const fy = this.floorY(x, z);
    const cell = this.cells[z * this.w + x];
    const height = Math.min(2.15, (cell.cy ?? 3) - fy - 0.03);
    const width = opts.width ?? 1;
    const kind = opts.kind ?? 'wood';
    const inset = kind === 'slide' ? 0 : Door.INSET;
    const hinge = alongX ? new THREE.Vector3(x + inset, fy, z + 0.5) : new THREE.Vector3(x + 0.5, fy, z + inset);
    const baseYaw = alongX ? 0 : -Math.PI / 2;
    const cells: [number, number][] = [];
    for (let i = 0; i < Math.round(width); i++) cells.push(alongX ? [x + i, z] : [x, z + i]);
    const d = new Door(this, kind, hinge, baseYaw, width - 0.02 - inset, height, alongX, cells, opts.locked ?? null, opts.msg ?? '门锁着。');
    this.doors.push(d);
    return d;
  }

  /** Doors on every marker cell (adjacent cells become one wider door). */
  doorsAt(ch: string, opts: Parameters<Level['door']>[2] = {}) {
    const out: Door[] = [];
    const cells = [...(this.markers.get(ch) ?? [])];
    const used = new Set<string>();
    for (const [x, z] of cells) {
      if (used.has(`${x},${z}`)) continue;
      // detect a run to the east or south
      let w = 1;
      const east = cells.some(([a, b]) => a === x + 1 && b === z);
      const south = cells.some(([a, b]) => a === x && b === z + 1);
      if (east) while (cells.some(([a, b]) => a === x + w && b === z)) w++;
      else if (south) while (cells.some(([a, b]) => a === x && b === z + w)) w++;
      for (let i = 0; i < w; i++) used.add(east ? `${x + i},${z}` : `${x},${z + i}`);
      out.push(this.door(x, z, { ...opts, width: w }));
    }
    return out;
  }

  pickup(kind: PickupKind, pos: THREE.Vector3, id?: string) {
    const pid = id ?? `${this.id}:p${this.pickupSeq++}`;
    if (this.taken.has(pid)) return null;
    const p = new Pickup(this, pid, kind, pos);
    this.pickups.push(p);
    // during the build the props it may lie on aren't all placed yet: finalize() settles those
    if (this.finalized) this.rest(p);
    return p;
  }

  item(item: ItemId, count: number, pos: THREE.Vector3, id?: string) {
    return this.pickup({ type: 'item', item, count: Math.max(1, Math.round(count)) }, pos, id);
  }

  interact(pos: THREE.Vector3, label: string | (() => string | null), use: () => void, radius = 1.7) {
    const it: Interactable = { pos: pos.clone(), radius, enabled: true, label: typeof label === 'string' ? () => label : label, use };
    this.interactables.push(it);
    return it;
  }

  trigger(box: THREE.Box3, onEnter: () => void, once = true, onExit?: () => void) {
    const t: Trigger = { box, once, fired: false, enabled: true, inside: false, onEnter, onExit };
    this.triggers.push(t);
    return t;
  }

  /** Persistent level decal (not recycled like bullet holes). A floor decal at y = 0 goes on that cell's floor. */
  decal(kind: 'blood' | 'hand' | 'drag' | 'scorch', pos: THREE.Vector3, normal: THREE.Vector3, size: number, rot = Math.random() * 6) {
    if (pos.y === 0 && normal.y > 0.9) pos = pos.clone().setY(this.floorY(pos.x, pos.z));
    const map = kind === 'blood' ? TEX.bloodDecal(Math.floor(Math.random() * 3)) : kind === 'hand' ? TEX.handprint() : kind === 'drag' ? TEX.drag() : TEX.scorch();
    const mat = applyRetro(new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.3 }));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.position.copy(pos).addScaledVector(normal, 0.01);
    m.lookAt(pos.clone().add(normal));
    m.rotateZ(rot);
    m.scale.setScalar(size);
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  safe(box: THREE.Box3) {
    this.safeZones.push(box);
  }

  inSafeZone(p: THREE.Vector3) {
    return this.safeZones.some((b) => b.containsPoint(p));
  }

  onUpdate(fn: (dt: number, t: number) => void) {
    this.updaters.push(fn);
  }

  /** Merge static prop meshes by material to cut draw calls. */
  finalize() {
    for (const p of this.pickups) this.rest(p);
    this.finalized = true;
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const m of this.staticMeshes) {
      if (!m.parent) continue;
      m.updateWorldMatrix(true, false);
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g = g.applyMatrix4(m.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      const mat = m.material as THREE.Material;
      let l = byMat.get(mat);
      if (!l) byMat.set(mat, (l = []));
      l.push(g);
      m.parent.remove(m);
    }
    for (const [mat, list] of byMat) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    this.staticMeshes = [];
  }

  update(dt: number, t: number) {
    for (const d of this.doors) d.update(dt);
    for (const p of this.pickups) {
      if (p.taken) continue;
      const k = (Math.sin(t * 2.2 + p.pos.x * 3) + 1) / 2;
      (p.glint.material as THREE.SpriteMaterial).opacity = Math.pow(k, 8) * 0.9;
      p.glint.scale.setScalar(0.06 + k * 0.08);
    }
    for (const u of this.updaters) u(dt, t);
    // triggers
    const pp = ctx.player.pos;
    for (const tr of this.triggers) {
      if (!tr.enabled || (tr.once && tr.fired)) continue;
      const inside = tr.box.containsPoint(pp);
      if (inside && !tr.inside) {
        tr.fired = true;
        tr.onEnter();
      } else if (!inside && tr.inside) tr.onExit?.();
      tr.inside = inside;
    }
  }

  /** Mark map cells around the player as explored. */
  explore(p: THREE.Vector3, r = 4) {
    const cx = Math.floor(p.x), cz = Math.floor(p.z);
    for (let z = cz - r; z <= cz + r; z++)
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || z < 0 || x >= this.w || z >= this.h) continue;
        if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) this.explored[z * this.w + x] = 1;
      }
  }

  applyEnv(scene: THREE.Scene) {
    const e = this.env;
    scene.fog = new THREE.FogExp2(e.fog, e.fogDensity);
    scene.background = new THREE.Color(e.fog);
    ctx.renderer.setGrade(e.grade);
    ctx.audio.setReverb(e.reverb);
    ctx.music.setRoot(e.root);
  }

  dispose() {
    for (const a of this.ambience) a.voice?.stop(0.4);
    this.ambience = [];
    for (const s of this.lights) ctx.lights.remove(s);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && !m.geometry.userData.shared) {
        // map + merged geometries are unique to this level
        if (m.geometry.attributes.color || m.matrixAutoUpdate === false) m.geometry.dispose();
      }
    });
    this.group.removeFromParent();
  }
}

const mapMatCache = new Map<string, THREE.MeshStandardMaterial>();
function mapMaterial(name: string) {
  let m = mapMatCache.get(name);
  if (!m) {
    m = surface(name).mat.clone();
    m.vertexColors = true;
    m.onBeforeCompile = surface(name).mat.onBeforeCompile;
    mapMatCache.set(name, m);
  }
  return m;
}
