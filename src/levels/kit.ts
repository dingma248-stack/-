import * as THREE from 'three';
import { ctx } from '../core/ctx';
import type { Level, MapDef } from './level';
import type { EnemyKind, SpawnOpts, Enemy } from '../enemies/enemy';
import { P, bx } from './props';
import { stdMat, M } from '../render/materials';
import { TEX } from '../render/textures';
import type { WeaponId } from '../config';
import { WEAPONS } from '../config';
import type { ItemId } from '../player/inventory';
import { DIFFICULTY } from '../config';

export interface BuildOpts {
  fresh: boolean;
  taken: Set<string>;
}

export interface ChapterRun {
  level: Level;
  spawn: { pos: THREE.Vector3; yaw: number };
  start(): void;
  update?(dt: number): void;
}

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Yaw that faces from a towards b (model forward = -Z for the camera). */
export function yawTo(from: THREE.Vector3, to: THREE.Vector3) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/** Spawn helper that skips enemies already killed before the last checkpoint. */
export function enemy(kind: EnemyKind, pos: THREE.Vector3, opts: SpawnOpts & { id?: string } = {}): Enemy | null {
  if (opts.id && ctx.game.killed.has(opts.id)) return null;
  const onDeath = opts.onDeath;
  return ctx.enemies.spawn(kind, pos, {
    ...opts,
    onDeath: (e) => {
      if (opts.id) ctx.game.killed.add(opts.id);
      onDeath?.(e);
    },
  });
}

/** Items scale with difficulty. */
export function loot(L: Level, item: ItemId, count: number, pos: THREE.Vector3, id?: string) {
  const n = Math.max(1, Math.round(count * DIFFICULTY[ctx.difficulty].loot));
  return L.item(item, n, pos, id);
}

/** When a chapter is started from chapter-select, make sure the player has a fair loadout. */
export function ensureLoadout(weapons: WeaponId[], ammo: Partial<Record<ItemId, number>>, rows = 3) {
  const w = ctx.weapons;
  for (const id of weapons) {
    if (!w.owned.includes(id)) {
      w.owned.push(id);
      w.mags[id] = WEAPONS[id].mag;
    }
  }
  w.owned.sort((a, b) => WEAPONS[a].slot - WEAPONS[b].slot);
  ctx.inventory.expand(rows);
  for (const [k, v] of Object.entries(ammo)) {
    const have = ctx.inventory.count(k as ItemId);
    if (have < (v as number)) ctx.inventory.add(k as ItemId, (v as number) - have);
  }
  const best = [...weapons].reverse().find((x) => x !== 'launcher' && x !== 'knife') ?? 'knife';
  w.current = best;
}

export const flag = (k: string) => ctx.story.flags[k];
export const setFlag = (k: string, v: unknown = true) => {
  ctx.story.flags[k] = v;
};

/** Standard door legend entry etc. */
export const LEG = {
  wall: (wall: string) => ({ t: 'wall' as const, wall }),
  floor: (floor: string, ceil: string | null = 'ceilingTile', cy: number | null = 3, fy = 0) => ({ t: 'floor' as const, floor, ceil, cy, fy }),
};

export function mapDef(rows: string[], legend: MapDef['legend'], base?: Record<string, string>, wallHeight?: number): MapDef {
  return { rows, legend, base, wallHeight };
}

/** Save point: a radio on a small table. */
export function savePoint(L: Level, pos: THREE.Vector3, rot: number, id: string) {
  L.place(P.radio(), pos, rot);
  const glow = L.light(pos.clone().add(V(0, 1.2, 0)), 0xffb060, 3, 4, 'pulse', { speed: 0.4 });
  void glow;
  L.ambient('radio', pos.clone().add(V(0, 1, 0)), 0.08, 1);
  L.interact(pos.clone().add(V(0, 1, 0)), '[E] 收音机 · 存档', () => {
    ctx.game.checkpoint(id, true);
    ctx.audio.play('save', { bus: 'ui' });
    ctx.ui.toast('进度已保存');
  });
}

/** Wall-mounted blood trail / handprint helpers. */
export function bloodTrail(L: Level, from: THREE.Vector3, to: THREE.Vector3, y = 0.01) {
  const d = to.clone().sub(from);
  const len = d.length();
  const n = Math.max(1, Math.round(len / 1));
  for (let i = 0; i < n; i++) {
    const p = from.clone().addScaledVector(d, (i + 0.5) / n).setY(y);
    const m = L.decal('drag', p, V(0, 1, 0), 1.05, 0);
    m.rotation.set(-Math.PI / 2, 0, Math.atan2(d.x, d.z));
  }
}

/** Plays a radio/broadcast line with static. */
export async function radio(who: string, text: string, hold?: number) {
  ctx.audio.play('radio', { bus: 'voice', vol: 0.4 });
  await ctx.story.say(who, text, { radio: true, hold });
}

export const say = (who: string, text: string, hold?: number) => ctx.story.say(who, text, { hold });
export const wait = (s: number) => ctx.story.wait(s);
export const until = (fn: () => boolean) => ctx.story.until(fn);
export const objective = (t: string, pos?: THREE.Vector3) => {
  ctx.story.objective(t);
  ctx.game.objectivePos = pos ?? null;
};

/**
 * Compose an ASCII map by carving rectangles: [char, x0, z0, x1, z1] (inclusive).
 * Single cells can be given as [char, x, z].
 */
export function compose(w: number, h: number, fill: string, ops: ([string, number, number] | [string, number, number, number, number])[]): string[] {
  const g: string[][] = [];
  for (let z = 0; z < h; z++) g.push(new Array(w).fill(fill));
  for (const op of ops) {
    const [ch, x0, z0] = op;
    const x1 = op.length === 5 ? op[3] : x0;
    const z1 = op.length === 5 ? op[4] : z0;
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) if (z >= 0 && z < h && x >= 0 && x < w) g[z][x] = ch;
  }
  return g.map((r) => r.join(''));
}

/** A static dead body lying on the floor. */
export function corpse(L: Level, pos: THREE.Vector3, rot: number, tint = 0x2a3040, blood = true) {
  const g = new THREE.Group();
  const cloth = stdMat({ map: TEX.cloth(), color: tint, roughness: 1 });
  const pants = stdMat({ map: TEX.cloth(), color: 0x1e2228, roughness: 1 });
  bx(g, 0.4, 0.2, 0.7, cloth, 0, 0.1, 0);
  bx(g, 0.2, 0.18, 0.22, M.skin(), 0.03, 0.09, 0.48, 0.4);
  bx(g, 0.14, 0.14, 0.8, pants, -0.1, 0.07, -0.72, 0.1);
  bx(g, 0.14, 0.14, 0.8, pants, 0.12, 0.07, -0.74, -0.15);
  bx(g, 0.1, 0.1, 0.55, cloth, 0.32, 0.06, 0.2, -0.9);
  bx(g, 0.1, 0.1, 0.55, cloth, -0.3, 0.06, 0.3, 0.6);
  L.place({ g, cols: [] }, pos.clone().setY(pos.y), rot, { collide: false });
  if (blood) L.decal('blood', pos.clone().setY(pos.y + 0.01), V(0, 1, 0), 1.8 + Math.random());
  return g;
}
