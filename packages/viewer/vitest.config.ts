import { defineConfig } from 'vitest/config';

/** Separate from vite.config.ts, whose `root: client` is for the browser bundle only. */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
