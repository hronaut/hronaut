import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const integrationDirectory = join(import.meta.dirname, 'integration')

describe('integration environment isolation', () => {
  it('sets launch environment inside hooks or tests, never when a file is imported', async () => {
    // Playwright imports every file in a worker before running any, so an import-time
    // assignment is cleared by an earlier file's afterAll before this file's tests launch.
    const files = (await readdir(integrationDirectory)).filter((name) => name.endsWith('.e2e.ts'))
    const offenders: string[] = []
    for (const name of files) {
      const lines = (await readFile(join(integrationDirectory, name), 'utf8')).split('\n')
      lines.forEach((line, index) => {
        if (/^process\.env\.\w+\s*(?:\?\?|\|\||&&)?=/.test(line)) offenders.push(`${name}:${index + 1}`)
      })
    }
    expect(files.length).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
