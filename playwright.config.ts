import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/integration',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results/integration',
  use: { trace: process.env.CI ? 'retain-on-first-failure' : 'off' },
  projects: [{ name: 'electron' }]
})
