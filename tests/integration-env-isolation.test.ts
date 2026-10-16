import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const integrationDirectory = join(import.meta.dirname, 'integration')

describe('integration environment isolation', () => {
  it('sets launch environment inside hooks or tests, never when a file is imported', async () => {
    // With fullyParallel, a file's afterAll runs after each group of its tests, and a later group in the
    // same worker does not import the file again, so an import-time assignment is gone by then.
    const files = (await readdir(integrationDirectory)).filter((name) => name.endsWith('.e2e.ts'))
    const offenders: string[] = []
    for (const name of files) {
      const lines = (await readFile(join(integrationDirectory, name), 'utf8')).split('\n')
      lines.forEach((line, index) => {
        if (/^process\.env(?:\.\w+|\[[^\]]+\])\s*(?:\?\?|\|\||&&)?=(?!=)/u.test(line)) offenders.push(`${name}:${index + 1}`)
      })
    }
    expect(files.length).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
