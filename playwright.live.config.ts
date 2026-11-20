import { defineConfig } from '@playwright/test'
import integration from './playwright.config.ts'

// Checks against live third-party wallet sites (tests/integration/*.live.ts). The sites change without notice and the
// checks need the internet, so they run on their own schedule (.github/workflows/live-sites.yml), never in CI or the
// release gate. One retry absorbs a slow page load; a failure that repeats is a change on the site or in Hronaut.
export default defineConfig({
  ...integration,
  testMatch: '**/*.live.ts',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  failOnFlakyTests: false,
  timeout: 180_000,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report/live' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/live' }]],
  outputDir: 'test-results/live'
})
