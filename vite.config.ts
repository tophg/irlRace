import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import solidPlugin from 'vite-plugin-solid';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import type { Plugin } from 'vite';

/** Vite plugin: auto-inject a content-based cache version into sw.js.
 *  Hashes all output filenames (which include Vite's content hashes)
 *  and replaces __BUILD_HASH__ in the copied sw.js. */
function swCacheVersion(): Plugin {
  return {
    name: 'sw-cache-version',
    apply: 'build',
    writeBundle(_, bundle) {
      const names = Object.keys(bundle).sort().join('\n');
      const hash = createHash('md5').update(names).digest('hex').slice(0, 10);
      const swPath = resolve(dirname(fileURLToPath(import.meta.url)), 'dist/sw.js');
      try {
        let sw = readFileSync(swPath, 'utf-8');
        sw = sw.replace('__BUILD_HASH__', hash);
        writeFileSync(swPath, sw);
        console.log(`[sw-cache-version] Injected cache version: ${hash}`);
      } catch { /* sw.js may not exist in dev */ }
    },
  };
}

export default defineConfig({
  plugins: [solidPlugin(), wasm(), topLevelAwait(), swCacheVersion()],
  server: {
    port: 5180,
    open: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', 'three/webgpu', 'three/tsl'],
          peerjs: ['peerjs'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
