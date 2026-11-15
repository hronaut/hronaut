import { defineConfig } from '@playwright/test'
import integration from './playwright.config.ts'

// The release gate on responsiveness runs alone, after the Electron suite, so no other test shares its machine.
// A measurement that missed its limit is not retried: the run that missed it is the one to look into.
export default defineConfig({
  ...integration,
  testMatch: '**/*.perf.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  // A trace records every step of the test, which would be measured with it.
  use: { trace: 'off' },
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report/performance' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/performance' }]],
  outputDir: 'test-results/performance'
})
