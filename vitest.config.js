import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'client', include: ['test/client/**/*.test.js'], environment: 'node', testTimeout: 30000 } }
    ]
  }
});
