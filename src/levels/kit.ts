import * as THREE from 'three';
import { ctx } from '../core/ctx';
import type { Level, MapDef } from './level';
import type { EnemyKind, SpawnOpts, Enemy } from '../enemies/enemy';
import { P } from './props';
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
