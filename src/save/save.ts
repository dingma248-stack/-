import type { InventoryState } from '../player/inventory';
import type { Difficulty } from '../config';

export interface Stats {
  time: number; // seconds played
  kills: number;
  headshots: number;
  shots: number;
  hits: number;
  deaths: number;
  saves: number;
}

export interface SaveData {
  version: 1;
  chapter: string;
  checkpoint: string;
  difficulty: Difficulty;
  health: number;
  battery: number;
  inv: InventoryState;
  flags: Record<string, unknown>;
  taken: string[];
  stats: Stats;
  clock: number;
  savedAt: number;
}

export interface Progress {
  chapters: string[];
  endings: string[];
  cleared: boolean;
  bestTime: number | null;
  bestRank: string | null;
}

const SAVE_KEY = 'mistport.save.v1';
const PROG_KEY = 'mistport.progress.v1';

export function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.version !== 1 || !d.chapter) return null;
    return d;
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignored */
  }
}

export function readProgress(): Progress {
  const empty: Progress = { chapters: ['prologue'], endings: [], cleared: false, bestTime: null, bestRank: null };
  try {
    const raw = localStorage.getItem(PROG_KEY);
    if (!raw) return empty;
    return { ...empty, ...(JSON.parse(raw) as Partial<Progress>) };
  } catch {
    return empty;
  }
}

export function writeProgress(p: Progress) {
  try {
    localStorage.setItem(PROG_KEY, JSON.stringify(p));
  } catch {
    /* ignored */
  }
}

export function unlockChapter(id: string) {
  const p = readProgress();
  if (!p.chapters.includes(id)) {
    p.chapters.push(id);
    writeProgress(p);
  }
}

export const emptyStats = (): Stats => ({ time: 0, kills: 0, headshots: 0, shots: 0, hits: 0, deaths: 0, saves: 0 });
