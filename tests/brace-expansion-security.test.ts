import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const packagePaths = [
  'node_modules/@electron/asar/node_modules/brace-expansion',
  'node_modules/@electron/universal/node_modules/brace-expansion',
  'node_modules/@eslint/eslintrc/node_modules/brace-expansion',
  'node_modules/@intlify/eslint-plugin-vue-i18n/node_modules/brace-expansion',
  'node_modules/brace-expansion',
  'node_modules/dir-compare/node_modules/brace-expansion',
  'node_modules/filelist/node_modules/brace-expansion',
  'node_modules/glob/node_modules/brace-expansion'
]

it.each(packagePaths)('bounds deep nesting and preserves ordinary expansion in %s', packagePath => {
  const loaded = require(`../${packagePath}`) as ((pattern: string) => string[]) | { expand: (pattern: string) => string[] }
  const expand = typeof loaded === 'function' ? loaded : loaded.expand
  const nested = '{'.repeat(4000) + 'a,b' + '}'.repeat(4000)
  expect(expand(nested)).toEqual([nested])
  expect(expand('file-{a,b}-{1..2}.txt')).toEqual([
    'file-a-1.txt', 'file-a-2.txt', 'file-b-1.txt', 'file-b-2.txt'
  ])
})
