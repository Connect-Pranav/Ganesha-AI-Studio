import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works on GitHub Pages (/<repo>/) and locally.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 700 }, // three.js chunk is lazy-loaded on the 3D view only
  plugins: [react()],
});
