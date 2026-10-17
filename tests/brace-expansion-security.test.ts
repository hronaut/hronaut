import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
// Every installed copy, read from the lockfile so a dependency update that moves or adds one is still checked.
const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) as { packages: Record<string, unknown> }
const packagePaths = Object.keys(lockfile.packages).filter(path => path === 'node_modules/brace-expansion' || path.endsWith('/node_modules/brace-expansion'))

it('finds the installed copies of brace-expansion', () => {
  expect(packagePaths).toContain('node_modules/brace-expansion')
  expect(packagePaths.length).toBeGreaterThan(1)
})

it.each(packagePaths)('bounds deep nesting and preserves ordinary expansion in %s', packagePath => {
  const loaded = require(`../${packagePath}`) as ((pattern: string) => string[]) | { expand: (pattern: string) => string[] }
  const expand = typeof loaded === 'function' ? loaded : loaded.expand
  const nested = '{'.repeat(4000) + 'a,b' + '}'.repeat(4000)
  expect(expand(nested)).toEqual([nested])
  expect(expand('file-{a,b}-{1..2}.txt')).toEqual([
    'file-a-1.txt', 'file-a-2.txt', 'file-b-1.txt', 'file-b-2.txt'
  ])
})
