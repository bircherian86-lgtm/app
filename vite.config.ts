import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Crucial for Electron
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
});
