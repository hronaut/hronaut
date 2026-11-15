import { defineConfig, type ReporterDescription } from '@playwright/test'

const artifactShard = process.env.HRONAUT_TEST_SHARD?.replace(/[^a-zA-Z0-9_-]/g, '')
const reportFolder = artifactShard ? `playwright-report/${artifactShard}` : 'playwright-report'
// A failed hosted shard reads which tests failed from this report to recheck them (scripts/recheck-flaky-tests.ts).
const shardReport: ReporterDescription[] = artifactShard ? [['json', { outputFile: `test-results/json/${artifactShard}.json` }]] : []

export default defineConfig({
  testDir: './tests/integration',
  testMatch: '**/*.e2e.ts',
  // Full Docker runs and hosted shards override workers, each with its own Xvfb.
  // Focused runs retain the single-worker default.
  fullyParallel: true,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: reportFolder }], ...shardReport]
    : [['list'], ['html', { open: 'never', outputFolder: reportFolder }]],
  outputDir: artifactShard ? `test-results/integration/${artifactShard}` : 'test-results/integration',
  // Keep the failing first attempt: a successful retry cannot explain its failure.
  use: { trace: process.env.CI ? 'retain-on-failure' : 'off' },
  projects: [{ name: 'electron' }]
})
