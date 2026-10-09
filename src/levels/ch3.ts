import type { BuildOpts, ChapterRun } from './kit';
import { buildPrologue } from './prologue';

export function buildCh3(cp: string, o: BuildOpts): ChapterRun {
  return buildPrologue(cp, o);
}
