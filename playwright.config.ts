import { defineConfig } from '@playwright/test'

const artifactShard = process.env.HRONAUT_TEST_SHARD?.replace(/[^a-zA-Z0-9_-]/g, '')

export default defineConfig({
  testDir: './tests/integration',
  testMatch: '**/*.e2e.ts',
  // Each Docker shard still owns one worker, but individual-test sharding keeps
  // large suites such as browser-shell from dominating a single shard.
  fullyParallel: true,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: artifactShard ? `playwright-report/${artifactShard}` : 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: artifactShard ? `playwright-report/${artifactShard}` : 'playwright-report' }]],
  outputDir: artifactShard ? `test-results/integration/${artifactShard}` : 'test-results/integration',
  use: { trace: process.env.CI ? 'on-first-retry' : 'off' },
  projects: [{ name: 'electron' }]
})
