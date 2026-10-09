// Every gameplay tuning value lives here so feel can be tuned in one place.

export const PLAYER = {
  radius: 0.32,
  height: 1.75,
  crouchHeight: 1.05,
  eyeOffset: 0.13, // eye distance below the capsule top
  walkSpeed: 3.3,
  sprintSpeed: 5.7,
  crouchSpeed: 1.7,
  adsSpeedMul: 0.62,
  exhaustedSpeedMul: 0.72,
  accelTime: 0.08, // seconds to reach target speed on ground
  airAccelTime: 0.35,
  jumpVelocity: 4.6,
  gravity: 13.5,
  coyoteTime: 0.1,
  jumpBuffer: 0.1,
  staminaMax: 100,
  staminaDrain: 19, // per second while sprinting
  staminaRegen: 16,
  staminaRegenDelay: 0.9,
  exhaustedRecover: 35, // stamina needed before sprint is allowed after exhaustion
  maxHealth: 100,
  sprintFovBoost: 5,
  bobAmount: 0.045,
  stepLength: 1.85, // metres between footsteps at walk
  flashlightMax: 100,
  flashlightDrain: 0.55, // per second (≈3 minutes per full battery)
  batteryCharge: 60,
  medkitHeal: 60,
  grabEscapePresses: 9,
  grabDamagePerSecond: 9,
};

export interface WeaponDef {
  id: WeaponId;
  slot: number;
  name: string;
  nameEn: string;
  damage: number;
  pellets: number;
  fireInterval: number;
  auto: boolean;
  mag: number;
  ammo: AmmoType | null;
  spreadHip: number; // radians
  spreadAds: number;
  spreadMove: number;
  recoilPitch: number; // radians of camera kick
  recoilYaw: number;
  recoilRecover: number; // 1/s
  kick: number; // viewmodel kick distance
  reloadTactical: number;
  reloadEmpty: number;
  perShell?: number; // shotgun-style per round load time
  range: number;
  impulse: number; // physics push per hit
  knockback: number; // enemy stagger power
  adsFov: number;
  noise: number; // radius in metres for AI hearing
  equipTime: number;
}

export type WeaponId = 'knife' | 'pistol' | 'shotgun' | 'magnum' | 'launcher';
export type AmmoType = 'ammo9' | 'shells' | 'ammo357' | 'grenade';

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  knife: {
    id: 'knife', slot: 0, name: '战术刀', nameEn: 'KNIFE', damage: 34, pellets: 1, fireInterval: 0.42, auto: true,
    mag: 0, ammo: null, spreadHip: 0, spreadAds: 0, spreadMove: 0, recoilPitch: 0.004, recoilYaw: 0.01, recoilRecover: 10,
    kick: 0, reloadTactical: 0, reloadEmpty: 0, range: 1.75, impulse: 2, knockback: 0.35, adsFov: 0, noise: 2, equipTime: 0.22,
  },
  pistol: {
    id: 'pistol', slot: 1, name: 'M19 手枪', nameEn: 'M19 PISTOL', damage: 30, pellets: 1, fireInterval: 0.16, auto: false,
    mag: 12, ammo: 'ammo9', spreadHip: 0.022, spreadAds: 0.004, spreadMove: 0.018, recoilPitch: 0.032, recoilYaw: 0.012,
    recoilRecover: 9, kick: 0.055, reloadTactical: 1.45, reloadEmpty: 1.85, range: 60, impulse: 3.5, knockback: 0.25,
    adsFov: 0.78, noise: 22, equipTime: 0.3,
  },
  shotgun: {
    id: 'shotgun', slot: 2, name: '雷明 870 霰弹枪', nameEn: 'R-870 SHOTGUN', damage: 17, pellets: 9, fireInterval: 0.82, auto: false,
    mag: 6, ammo: 'shells', spreadHip: 0.075, spreadAds: 0.055, spreadMove: 0.02, recoilPitch: 0.11, recoilYaw: 0.03,
    recoilRecover: 6, kick: 0.16, reloadTactical: 0.3, reloadEmpty: 0.7, perShell: 0.52, range: 30, impulse: 3.2,
    knockback: 1.2, adsFov: 0.86, noise: 30, equipTime: 0.34,
  },
  magnum: {
    id: 'magnum', slot: 3, name: '.357 左轮马格南', nameEn: '.357 MAGNUM', damage: 140, pellets: 1, fireInterval: 0.6, auto: false,
    mag: 6, ammo: 'ammo357', spreadHip: 0.014, spreadAds: 0.002, spreadMove: 0.02, recoilPitch: 0.16, recoilYaw: 0.04,
    recoilRecover: 5, kick: 0.17, reloadTactical: 2.6, reloadEmpty: 2.6, range: 90, impulse: 14, knockback: 1.6,
    adsFov: 0.72, noise: 34, equipTime: 0.36,
  },
  launcher: {
    id: 'launcher', slot: 4, name: 'GL-6 榴弹发射器', nameEn: 'GL-6 LAUNCHER', damage: 260, pellets: 1, fireInterval: 1.0,
    auto: false, mag: 1, ammo: 'grenade', spreadHip: 0.008, spreadAds: 0.004, spreadMove: 0.01, recoilPitch: 0.13, recoilYaw: 0.02,
    recoilRecover: 4, kick: 0.2, reloadTactical: 1.9, reloadEmpty: 1.9, range: 60, impulse: 0, knockback: 2, adsFov: 0.8,
    noise: 40, equipTime: 0.4,
  },
};

export const WEAPON_ORDER: WeaponId[] = ['knife', 'pistol', 'shotgun', 'magnum', 'launcher'];

export const GRENADE = { speed: 26, gravity: 9.8, radius: 5.5, impulse: 22, fuseMin: 0.18 };

export interface EnemyDef {
  hp: number;
  walk: number;
  chase: number;
  turnRate: number;
  attackRange: number;
  attackDamage: number;
  attackCooldown: number;
  hearMul: number;
  sightRange: number;
  fov: number; // half-angle radians
  headMul: number;
  legMul: number;
  mass: number;
}

export const ENEMIES: Record<'infected' | 'runner' | 'dog' | 'crawler', EnemyDef> = {
  infected: { hp: 115, walk: 0.55, chase: 1.25, turnRate: 3, attackRange: 1.25, attackDamage: 16, attackCooldown: 1.7, hearMul: 1, sightRange: 14, fov: 1.05, headMul: 2.6, legMul: 0.7, mass: 70 },
  runner: { hp: 95, walk: 0.9, chase: 4.6, turnRate: 6, attackRange: 1.4, attackDamage: 18, attackCooldown: 1.4, hearMul: 1.3, sightRange: 18, fov: 1.2, headMul: 2.6, legMul: 0.8, mass: 65 },
  dog: { hp: 55, walk: 1.4, chase: 6.4, turnRate: 9, attackRange: 1.35, attackDamage: 11, attackCooldown: 1.0, hearMul: 1.5, sightRange: 20, fov: 1.6, headMul: 1.8, legMul: 1, mass: 30 },
  crawler: { hp: 150, walk: 1.6, chase: 4.2, turnRate: 7, attackRange: 1.7, attackDamage: 22, attackCooldown: 1.6, hearMul: 1.2, sightRange: 16, fov: 2.2, headMul: 2.2, legMul: 1, mass: 55 },
};

export const DIFFICULTY = {
  easy: { enemyHp: 0.75, enemyDmg: 0.6, loot: 1.5, label: '简单' },
  normal: { enemyHp: 1, enemyDmg: 1, loot: 1, label: '普通' },
  nightmare: { enemyHp: 1.35, enemyDmg: 1.6, loot: 0.65, label: '噩梦' },
} as const;
export type Difficulty = keyof typeof DIFFICULTY;

export const NOISE = { sprintStep: 7, walkStep: 2.5, crouchStep: 0.8, glass: 16, crate: 10, prop: 8, land: 5 };

export const QUALITY = {
  low: { lights: 3, shadows: false, particles: 0.5, maxDebris: 24, maxRagdolls: 3 },
  medium: { lights: 5, shadows: true, particles: 0.8, maxDebris: 40, maxRagdolls: 5 },
  high: { lights: 7, shadows: true, particles: 1, maxDebris: 64, maxRagdolls: 8 },
} as const;
export type Quality = keyof typeof QUALITY;
