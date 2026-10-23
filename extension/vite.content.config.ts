import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Content scripts cannot be ES modules, so they are bundled separately as a single IIFE. */
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'SpoolContent',
      fileName: () => 'content.js',
    },
  },
});
