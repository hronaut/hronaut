import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: ['trace-cases.ts', 'trace-disabled.ts'],
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['json']],
  use: { trace: 'retain-on-failure' }
})
