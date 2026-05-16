import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pick up both .test.js (ESM via Vitest transform) and .test.mjs files
    include: ['src/**/*.test.js', 'src/**/*.test.mjs', 'test/**/*.test.js'],
  },
});
