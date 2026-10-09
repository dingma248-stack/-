import type * as THREE from 'three';
import type { Physics } from '../physics/world';
import type { AudioEngine } from '../audio/engine';
import type { Music } from '../audio/music';
import type { Particles } from '../render/particles';
import type { Decals } from '../render/decals';
import type { LightPool } from '../render/lights';
import type { RetroRenderer } from '../render/renderer';
import type { Player } from '../player/player';
import type { Weapons } from '../weapons/weapons';
import type { EnemyManager } from '../enemies/manager';
import type { Level } from '../levels/level';
import type { UI } from '../ui/ui';
import type { Story } from '../story/story';
import type { Game } from '../game';
import type { Inventory } from '../player/inventory';
import type { Director } from '../enemies/director';
import type { Props } from '../physics/props';
import type { Difficulty } from '../config';

/** Global service registry. Populated once at boot by Game. */
export interface Ctx {
  game: Game;
  physics: Physics;
  audio: AudioEngine;
  music: Music;
  particles: Particles;
  decals: Decals;
  lights: LightPool;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: RetroRenderer;
  player: Player;
  weapons: Weapons;
  enemies: EnemyManager;
  level: Level | null;
  ui: UI;
  story: Story;
  inventory: Inventory;
  director: Director;
  props: Props;
  difficulty: Difficulty;
  time: number; // seconds since boot (game time, pauses)
}

export const ctx = { level: null, time: 0, difficulty: 'normal' } as unknown as Ctx;
