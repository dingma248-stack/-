import { defineConfig } from 'vite';
import { fontSubset } from './build/fonts.mjs';
import { singleFile } from './build/single-file.mjs';

const fonts = fontSubset({
  faces: [
    'noto-serif-sc/400',
    'noto-serif-sc/700',
    'cormorant-garamond/500',
    'cormorant-garamond/500-italic',
    'jetbrains-mono/300',
    'jetbrains-mono/400',
  ],
  sources: ['src', 'index.html'],
});

export default defineConfig(({ mode }) => {
  // `vite build --mode single`: the whole game in one HTML file that runs from file://
  if (mode === 'single') {
    return {
      base: './',
      plugins: [fonts, singleFile({ fileName: 'mistport.html' })],
      publicDir: false, // public/assets only holds optional overrides, unreachable from file://
      build: {
        target: 'es2022',
        outDir: 'dist-single',
        chunkSizeWarningLimit: 8000,
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        cssCodeSplit: false,
        modulePreload: false,
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    };
  }
  return {
    // Relative base so the build works on GitHub Pages project sites (/<repo>/).
    base: './',
    plugins: [fonts],
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 4600, // rapier-compat inlines its wasm (~4.3 MB, 1.6 MB gzip)
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          // keep the engine libraries in their own long-lived cache chunks
          manualChunks: { three: ['three'], rapier: ['@dimforge/rapier3d-compat'] },
        },
      },
    },
    server: { host: true },
  };
});
