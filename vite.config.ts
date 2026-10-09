import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works on GitHub Pages project sites (/<repo>/).
  base: './',
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
});
