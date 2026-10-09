import type * as THREE from 'three';

/** Minimal typed event bus. */
export interface GameEvents {
  noise: { pos: THREE.Vector3; radius: number; source: 'player' | 'world' };
  playerDamaged: { amount: number; from?: THREE.Vector3 };
  enemyKilled: { kind: string; headshot: boolean };
  shotFired: { weapon: string };
  shotHit: { headshot: boolean; enemy: boolean };
  pickup: { label: string };
  objective: { text: string };
  flag: { key: string; value: unknown };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const bus = new EventBus();
