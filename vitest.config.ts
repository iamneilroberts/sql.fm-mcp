import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The domain core is where a bug becomes a wrong factual answer, so the
      // floor is set there rather than as a flat repo-wide number.
      thresholds: {
        'src/domain/**': { statements: 85, branches: 75, functions: 90, lines: 85 },
        'src/search/**': { statements: 85, branches: 75, functions: 90, lines: 85 },
      },
    },
  },
});
