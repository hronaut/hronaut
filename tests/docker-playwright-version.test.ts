import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('pins Docker browser bundles to the locked Playwright driver version', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile.test', import.meta.url), 'utf8')
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) as {
    packages: Record<string, { version?: string }>
  }
  const driverVersion = lock.packages['node_modules/playwright']?.version
  expect(driverVersion).toMatch(/^\d+\.\d+\.\d+$/u)
  const images = [...dockerfile.matchAll(/^FROM\s+mcr\.microsoft\.com\/playwright:v([\d.]+)-noble\b/gmu)]
    .map(match => match[1])
  expect(images.length).toBeGreaterThan(0)
  expect(new Set(images)).toEqual(new Set([driverVersion]))
})
