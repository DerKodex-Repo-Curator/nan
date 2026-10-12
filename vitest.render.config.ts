import { getViteConfig } from 'astro/config';

/*
 * Renders `.astro` components under vitest (Astro Container API).
 *
 * `configFile: false` on purpose: astro.config.mjs brings the Cloudflare
 * adapter, whose Vite plugin refuses the SSR environment vitest sets up. The
 * components rendered here need nothing from that config.
 */
export default getViteConfig(
  {
    test: {
      name: 'render',
      globals: true,
      environment: 'node',
      include: ['src/**/*.render.test.ts'],
    },
  },
  { configFile: false },
);
