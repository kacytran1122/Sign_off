import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    manifest: true,
    rolldownOptions: { input: fileURLToPath(new URL('main.tsx', import.meta.url)) },
  },
});
