import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig({
  test: {
    projects: [
      /* the API, inside the Workers runtime with a fresh local D1 */
      {
        plugins: [cloudflareTest(async () => ({
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: { bindings: { INVITE_CODE: 'test-invite', TEST_MIGRATIONS: await readD1Migrations('./migrations') } }
        }))],
        test: { name: 'worker', include: ['test/worker/**/*.test.js'], setupFiles: ['./test/worker/apply-migrations.js'] }
      },
      /* the app in jsdom, against the real Worker served locally */
      { test: { name: 'client', include: ['test/client/**/*.test.js'], environment: 'node', testTimeout: 30000, hookTimeout: 60000 } }
    ]
  }
});
