import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * When the game is published to GitHub Pages it lives under a folder named
 * after the repository, so the build needs to know that folder up front.
 * The workflow sets BASE_PATH; a plain local build serves from the root.
 */
const base = process.env.BASE_PATH ?? '/';

/** Where the courses are kept, and where the editor writes them back. */
const COURSE_FILE = path.resolve(process.cwd(), 'src/game/courses.json');

/** Refuses anything far larger than a hand-made set of courses. */
const MOST_BYTES = 2_000_000;

/**
 * Lets the course editor save its work straight into the project.
 *
 * This is a workshop tool, not part of the game. `apply: 'serve'` means it
 * exists only while the development server is running: nothing of it reaches
 * a build, and the published game has no way to write anything.
 */
function courseSaving(): Plugin {
  return {
    name: 'rolling-ball-course-saving',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__courses', (request, response, next) => {
        if (request.method !== 'POST') {
          next();
          return;
        }
        let body = '';
        let tooBig = false;
        request.on('data', (chunk) => {
          body += chunk;
          if (body.length > MOST_BYTES) {
            tooBig = true;
            request.destroy();
          }
        });
        request.on('end', () => {
          void (async () => {
            response.setHeader('content-type', 'application/json');
            if (tooBig) {
              response.statusCode = 413;
              response.end(JSON.stringify({ error: 'too much data' }));
              return;
            }
            try {
              const parsed = JSON.parse(body) as { courses?: unknown };
              if (!Array.isArray(parsed.courses) || parsed.courses.length === 0) {
                throw new Error('expected a courses list');
              }
              await writeFile(COURSE_FILE, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
              response.statusCode = 200;
              response.end(JSON.stringify({ saved: parsed.courses.length }));
            } catch (error) {
              response.statusCode = 400;
              response.end(JSON.stringify({ error: String(error) }));
            }
          })();
        });
      });
    },
  };
}

export default defineConfig({
  base,
  plugins: [courseSaving()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    // Only the game itself is built. The workshop tools under tools/ are
    // served during development and never shipped.
    rollupOptions: {
      input: path.resolve(process.cwd(), 'index.html'),
    },
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
