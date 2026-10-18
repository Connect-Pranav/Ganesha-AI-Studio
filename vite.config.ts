import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BUILD_ID = new Date().toISOString();

// Relative base so the build works on GitHub Pages (/<repo>/) and locally.
// Identifiers stay readable in the build so a crash message names the real function/variable.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1200 }, // three.js chunk is lazy-loaded on the 3D view only
  esbuild: { minifyIdentifiers: false, keepNames: true },
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      // version.json lets an open/installed app notice a new deploy and update itself.
      name: 'build-id',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
      },
    },
  ],
});
