import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@central-tracking/plugin-client': path.resolve(__dirname, 'plugins/_shared/src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Pin a non-UTC, DST-observing zone. Day boundaries are local calendar
    // days (see src/shared/dateRange.ts), and under TZ=UTC — which is what CI
    // would otherwise run — local and UTC days coincide, so every test of that
    // behavior would pass without exercising it.
    env: { TZ: 'America/New_York' },
    setupFiles: ['src/test/setup.ts'],
    include: [
      'src/**/__tests__/**/*.test.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      'plugins/*/src/**/__tests__/**/*.test.{ts,tsx}',
      'plugins/*/src/**/*.test.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**',
        'src/**/__tests__/**',
        'src/renderer/index.tsx',
        'src/renderer/global.d.ts',
      ],
    },
  },
});
