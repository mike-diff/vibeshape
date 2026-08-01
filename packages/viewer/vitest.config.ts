import { defineConfig } from 'vitest/config';

/** Server-side tests only; the client is plain JS checked by tsconfig.client.json. */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
