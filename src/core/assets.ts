import { ctx } from './ctx';

/**
 * Optional external asset overrides. Everything in the game is procedural,
 * but if `public/assets/manifest.json` exists, the files it lists replace the
 * generated versions without any gameplay code changes:
 *
 *   {
 *     "audio": { "pistol": "audio/pistol.ogg", "loop_rain": "audio/rain.ogg" },
 *     "textures": { "concrete": "textures/concrete.png" }
 *   }
 *
 * Audio keys are the recipe names in src/audio/sfx.ts (loops are prefixed
 * with "loop_"). Texture keys are the TEX names in src/render/textures.ts.
 */

export interface AssetManifest {
  audio?: Record<string, string>;
  textures?: Record<string, string>;
}

export const textureOverrides = new Map<string, HTMLImageElement>();

export async function loadExternalAssets(): Promise<void> {
  let manifest: AssetManifest;
  try {
    const res = await fetch('assets/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return;
    manifest = (await res.json()) as AssetManifest;
  } catch {
    return; // no manifest: stay fully procedural
  }
  const jobs: Promise<void>[] = [];
  for (const [key, path] of Object.entries(manifest.audio ?? {})) {
    jobs.push(
      (async () => {
        try {
          const buf = await (await fetch('assets/' + path)).arrayBuffer();
          const audio = await ctx.audio.ctx.decodeAudioData(buf);
          ctx.audio.register(key, audio);
        } catch {
          /* keep the procedural sound */
        }
      })(),
    );
  }
  for (const [key, path] of Object.entries(manifest.textures ?? {})) {
    jobs.push(
      new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          textureOverrides.set(key, img);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = 'assets/' + path;
      }),
    );
  }
  await Promise.all(jobs);
}
