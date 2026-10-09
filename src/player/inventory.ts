import type { AmmoType, WeaponId } from '../config';
import { WEAPONS } from '../config';

/** Grid backpack: items have a footprint, stacks merge, space forces choices. */

export type ItemId = AmmoType | 'bandage' | 'medkit' | 'battery';

export interface ItemDef {
  id: ItemId;
  name: string;
  short: string;
  w: number;
  h: number;
  stack: number;
  desc: string;
  icon: string; // css class key
}

export const ITEMS: Record<ItemId, ItemDef> = {
  ammo9: { id: 'ammo9', name: '9mm 手枪弹', short: '9mm', w: 1, h: 1, stack: 30, desc: '标准 9×19mm 弹药。M19 手枪使用。', icon: 'ammo9' },
  shells: { id: 'shells', name: '12 号霰弹', short: '12G', w: 1, h: 1, stack: 10, desc: '12 号鹿弹。近距离能把人撕开。', icon: 'shells' },
  ammo357: { id: 'ammo357', name: '.357 马格南弹', short: '.357', w: 1, h: 1, stack: 6, desc: '大口径左轮子弹，极其稀少。', icon: 'ammo357' },
  grenade: { id: 'grenade', name: '40mm 榴弹', short: '40mm', w: 1, h: 1, stack: 3, desc: '高爆榴弹。留给真正需要的时候。', icon: 'grenade' },
  bandage: { id: 'bandage', name: '止血绷带', short: '绷带', w: 1, h: 1, stack: 2, desc: '恢复少量生命。按 {heal} 优先使用。', icon: 'bandage' },
  medkit: { id: 'medkit', name: '急救包', short: '急救', w: 1, h: 2, stack: 1, desc: '军用急救包，恢复大量生命。', icon: 'medkit' },
  battery: { id: 'battery', name: '手电电池', short: '电池', w: 1, h: 1, stack: 2, desc: '为手电筒充电。电量低时自动更换。', icon: 'battery' },
};

export interface Slot {
  item: ItemId;
  count: number;
  x: number;
  y: number;
}

export interface KeyItem {
  id: string;
  name: string;
  desc: string;
}

export interface Doc {
  id: string;
  title: string;
  body: string;
}

export interface InventoryState {
  cols: number;
  rows: number;
  slots: Slot[];
  keys: KeyItem[];
  docs: Doc[];
  weapons: WeaponId[];
  mags: Record<string, number>;
  flashBattery: number;
}

export class Inventory {
  cols = 4;
  rows = 3;
  slots: Slot[] = [];
  keys: KeyItem[] = [];
  docs: Doc[] = [];

  reset() {
    this.cols = 4;
    this.rows = 3;
    this.slots = [];
    this.keys = [];
    this.docs = [];
  }

  private occupied(x: number, y: number, ignore?: Slot) {
    for (const s of this.slots) {
      if (s === ignore) continue;
      const d = ITEMS[s.item];
      if (x >= s.x && x < s.x + d.w && y >= s.y && y < s.y + d.h) return true;
    }
    return false;
  }

  fits(item: ItemId, x: number, y: number, ignore?: Slot) {
    const d = ITEMS[item];
    if (x < 0 || y < 0 || x + d.w > this.cols || y + d.h > this.rows) return false;
    for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) if (this.occupied(x + i, y + j, ignore)) return false;
    return true;
  }

  /** Space that could absorb `count` of item (stacks + free cells). */
  capacityFor(item: ItemId) {
    const d = ITEMS[item];
    let cap = 0;
    for (const s of this.slots) if (s.item === item) cap += d.stack - s.count;
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) if (this.fits(item, x, y)) cap += d.stack;
    return cap;
  }

  /** Add items; returns how many could not fit. */
  add(item: ItemId, count: number): number {
    const d = ITEMS[item];
    for (const s of this.slots) {
      if (s.item !== item || count <= 0) continue;
      const take = Math.min(d.stack - s.count, count);
      s.count += take;
      count -= take;
    }
    while (count > 0) {
      let placed = false;
      outer: for (let y = 0; y < this.rows; y++)
        for (let x = 0; x < this.cols; x++) {
          if (this.fits(item, x, y)) {
            const take = Math.min(d.stack, count);
            this.slots.push({ item, count: take, x, y });
            count -= take;
            placed = true;
            break outer;
          }
        }
      if (!placed) break;
    }
    return count;
  }

  count(item: ItemId) {
    let n = 0;
    for (const s of this.slots) if (s.item === item) n += s.count;
    return n;
  }

  /** Remove up to n items, emptying smallest stacks first. Returns removed count. */
  take(item: ItemId, n: number) {
    let removed = 0;
    const stacks = this.slots.filter((s) => s.item === item).sort((a, b) => a.count - b.count);
    for (const s of stacks) {
      const t = Math.min(s.count, n - removed);
      s.count -= t;
      removed += t;
      if (removed >= n) break;
    }
    this.slots = this.slots.filter((s) => s.count > 0);
    return removed;
  }

  discard(slot: Slot) {
    this.slots = this.slots.filter((s) => s !== slot);
  }

  move(slot: Slot, x: number, y: number) {
    if (!this.fits(slot.item, x, y, slot)) return false;
    slot.x = x;
    slot.y = y;
    return true;
  }

  expand(rows: number) {
    this.rows = Math.max(this.rows, rows);
  }

  hasKey(id: string) {
    return this.keys.some((k) => k.id === id);
  }
  addKey(k: KeyItem) {
    if (!this.hasKey(k.id)) this.keys.push(k);
  }
  removeKey(id: string) {
    this.keys = this.keys.filter((k) => k.id !== id);
  }
  addDoc(d: Doc) {
    if (!this.docs.some((x) => x.id === d.id)) this.docs.push(d);
  }

  snapshot(weapons: WeaponId[], mags: Record<string, number>, flashBattery: number): InventoryState {
    return {
      cols: this.cols,
      rows: this.rows,
      slots: this.slots.map((s) => ({ ...s })),
      keys: this.keys.map((k) => ({ ...k })),
      docs: this.docs.map((d) => ({ ...d })),
      weapons: [...weapons],
      mags: { ...mags },
      flashBattery,
    };
  }

  restore(s: InventoryState) {
    this.cols = s.cols;
    this.rows = s.rows;
    this.slots = s.slots.map((x) => ({ ...x }));
    this.keys = s.keys.map((x) => ({ ...x }));
    this.docs = s.docs.map((x) => ({ ...x }));
  }
}

export const ammoFor = (w: WeaponId) => WEAPONS[w].ammo;
