import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: { include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 60000, hookTimeout: 60000,
    fileParallelism: false },
  define: { __RELEASE__: JSON.stringify('0.1.0-test') },
});
