import { defineConfig } from 'vitest/config';

/*
 * Two projects. `unit` is the suite as it always was (plain Vite, Node env).
 * `render` compiles `.astro` components so they can be rendered with Astro's
 * Container API; it needs Astro's Vite plugins, which live in its own config
 * (vitest.render.config.ts) because loading them for every file changes how
 * the other suites resolve modules and breaks several of them.
 */
const RENDER_TESTS = 'src/**/*.render.test.ts';

export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: [RENDER_TESTS, '**/node_modules/**'],
        },
      },
      './vitest.render.config.ts',
    ],
  },
});
