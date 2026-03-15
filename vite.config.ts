import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [solidPlugin(), wasm(), topLevelAwait()],
  server: {
    port: 5180,
    open: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
