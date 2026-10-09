import type { Quality } from '../config';

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'crouch' | 'fire' | 'aim' | 'reload'
  | 'weapon1' | 'weapon2' | 'weapon3' | 'weapon4' | 'lastWeapon' | 'melee' | 'interact' | 'flashlight'
  | 'heal' | 'inventory' | 'pause';

export const ACTION_LABELS: Record<Action, string> = {
  forward: '前进', back: '后退', left: '左移', right: '右移', jump: '跳跃', sprint: '冲刺', crouch: '蹲下',
  fire: '射击', aim: '瞄准', reload: '换弹', weapon1: '武器 1', weapon2: '武器 2', weapon3: '武器 3', weapon4: '武器 4',
  lastWeapon: '上一把武器', melee: '近战（刀）', interact: '交互 / 拾取', flashlight: '手电筒', heal: '治疗',
  inventory: '背包 / 地图', pause: '暂停',
};

export const DEFAULT_BINDINGS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft',
  crouch: 'ControlLeft', fire: 'Mouse0', aim: 'Mouse2', reload: 'KeyR', weapon1: 'Digit1', weapon2: 'Digit2',
  weapon3: 'Digit3', weapon4: 'Digit4', lastWeapon: 'KeyQ', melee: 'KeyV', interact: 'KeyE', flashlight: 'KeyF',
  heal: 'KeyH', inventory: 'Tab', pause: 'Escape',
};

export interface Settings {
  sensitivity: number;
  invertY: boolean;
  fov: number;
  quality: Quality;
  resScale: number; // vertical resolution: 270 / 360 / 540
  vertexSnap: number; // 0..1
  crt: boolean;
  brightness: number;
  headBob: boolean;
  crouchToggle: boolean;
  master: number;
  music: number;
  sfx: number;
  voice: number;
  subtitles: boolean;
  bindings: Record<Action, string>;
}

const DEFAULTS: Settings = {
  sensitivity: 1,
  invertY: false,
  fov: 80,
  quality: 'medium',
  resScale: 270,
  vertexSnap: 0.6,
  crt: false,
  brightness: 1.1,
  headBob: true,
  crouchToggle: false,
  master: 0.85,
  music: 0.7,
  sfx: 0.9,
  voice: 0.8,
  subtitles: true,
  bindings: { ...DEFAULT_BINDINGS },
};

const KEY = 'mistport.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...structuredClone(DEFAULTS), ...parsed, bindings: { ...DEFAULT_BINDINGS, ...(parsed.bindings ?? {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const settings: Settings = load();
const listeners = new Set<(s: Settings) => void>();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings stay in memory */
  }
  for (const l of listeners) l(settings);
}

export function onSettingsChange(fn: (s: Settings) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetSettings() {
  Object.assign(settings, structuredClone(DEFAULTS));
  saveSettings();
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Mouse0: '鼠标左键', Mouse1: '鼠标中键', Mouse2: '鼠标右键', Mouse3: '鼠标侧键 4', Mouse4: '鼠标侧键 5',
    Space: '空格', ShiftLeft: '左 Shift', ShiftRight: '右 Shift', ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl',
    AltLeft: '左 Alt', AltRight: '右 Alt', Tab: 'Tab', Escape: 'Esc', Enter: 'Enter', Backspace: '退格',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', CapsLock: 'Caps',
  };
  return map[code] ?? code;
}
