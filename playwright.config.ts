import { defineConfig } from '@playwright/test'

const artifactShard = process.env.HRONAUT_TEST_SHARD?.replace(/[^a-zA-Z0-9_-]/g, '')

export default defineConfig({
  testDir: './tests/integration',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: artifactShard ? `playwright-report/${artifactShard}` : 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: artifactShard ? `playwright-report/${artifactShard}` : 'playwright-report' }]],
  outputDir: artifactShard ? `test-results/integration/${artifactShard}` : 'test-results/integration',
  use: { trace: process.env.CI ? 'retain-on-first-failure' : 'off' },
  projects: [{ name: 'electron' }]
})
