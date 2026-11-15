import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4317';

export default defineConfig({
  testDir: '.',
  reporter: 'line',
  use: { baseURL },
  webServer: {
    command: 'node build/backend/scripts/demo.js --ephemeral',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: {
      PORT: '4317',
      LOCAL_DATABASE_PORT: '55442',
      REPAIR_CONTEXT: 'false',
    },
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
