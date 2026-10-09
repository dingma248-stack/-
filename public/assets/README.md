# public/assets

Reserved for external CC0 assets (models, textures, audio).

The game currently generates every model, texture and sound procedurally at
runtime. `src/core/assets.ts` exposes a small loader: if a file with a known
key exists here (see `ASSET_MANIFEST`), it replaces the procedural version
without touching gameplay code.
