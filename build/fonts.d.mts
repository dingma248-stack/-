import type { Plugin } from 'vite';

export function fontSubset(opts: { faces: string[]; sources: string[] }): Plugin;
