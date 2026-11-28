import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    host: '0.0.0.0',
    open: false,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
