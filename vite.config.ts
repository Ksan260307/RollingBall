import { defineConfig } from 'vitest/config';

/**
 * When the game is published to GitHub Pages it lives under a folder named
 * after the repository, so the build needs to know that folder up front.
 * The workflow sets BASE_PATH; a plain local build serves from the root.
 */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/core/**/*.ts'],
    },
  },
});
