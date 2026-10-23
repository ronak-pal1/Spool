import { build } from 'vite';

// Watches both bundles: the module-based pages + service worker, and the IIFE content script.
await build({ configFile: 'vite.config.ts', mode: 'development', build: { watch: {}, emptyOutDir: false } });
await build({ configFile: 'vite.content.config.ts', mode: 'development', build: { watch: {} } });
