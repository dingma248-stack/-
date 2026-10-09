import type { BuildOpts, ChapterRun } from './kit';
import { buildPrologue } from './prologue';
import { buildCh1 } from './ch1';
import { buildCh2 } from './ch2';
import { buildCh3 } from './ch3';
import { buildCh4 } from './ch4';
import { buildCh5 } from './ch5';

export type { ChapterRun };

const BUILDERS: Record<string, (cp: string, o: BuildOpts) => ChapterRun> = {
  prologue: buildPrologue,
  ch1: buildCh1,
  ch2: buildCh2,
  ch3: buildCh3,
  ch4: buildCh4,
  ch5: buildCh5,
};

export function buildChapter(id: string, cp: string, o: BuildOpts): ChapterRun {
  const b = BUILDERS[id] ?? buildPrologue;
  return b(cp, o);
}
