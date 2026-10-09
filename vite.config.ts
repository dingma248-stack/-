import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works on GitHub Pages project sites (/<repo>/).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
    assetsInlineLimit: 0,
  },
  server: { host: true },
});
