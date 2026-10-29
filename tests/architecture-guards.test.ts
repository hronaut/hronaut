import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importCycles, lineCount, ROOT, runtimeImports, runtimeNamesFrom, runtimeSpecifiers, sourceFiles } from './architecture/source-files.js'

const MAX_LINES = 800
const BUDGETS_FILE = 'tests/architecture/budgets.json'

/**
 * What the code may still carry from before the architecture rules: the files over the line limit, each with the most
 * lines it may have, and the access object files. Both lists only shrink.
 */
const budgets = JSON.parse(readFileSync(join(ROOT, BUDGETS_FILE), 'utf8')) as { oversizedFiles: Record<string, number>, accessFiles: string[] }

const files = sourceFiles()
// Locale files hold one translated string per line and grow with every string, in every language.
const sizedFiles = files.filter(file => !file.startsWith('src/shared/locales/'))

describe('the architecture rules in AGENTS.md', () => {
  it(`keeps every source file within ${MAX_LINES} lines, and lets the larger ones only shrink`, () => {
    const problems: string[] = []
    for (const file of sizedFiles) {
      const lines = lineCount(file)
      const budget = budgets.oversizedFiles[file]
      if (budget === undefined && lines > MAX_LINES) problems.push(`${file} has ${lines} lines; split it by feature to keep it within ${MAX_LINES}`)
      else if (budget !== undefined && lines > budget) problems.push(`${file} grew to ${lines} lines, over its ${budget}; move code out to a feature module instead`)
      else if (budget !== undefined && lines < budget) problems.push(`${file} shrank to ${lines} lines: lower its budget in ${BUDGETS_FILE} to ${lines > MAX_LINES ? lines : 'nothing, removing it'}`)
    }
    for (const file of Object.keys(budgets.oversizedFiles)) {
      if (!sizedFiles.includes(file)) problems.push(`${file} is gone: remove it from ${BUDGETS_FILE}`)
    }
    expect(problems).toEqual([])
  })

  it('adds no access object files, and lets the existing ones only go away', () => {
    const accessFiles = files.filter(file => file.endsWith('-access.ts'))
    expect(accessFiles.filter(file => !budgets.accessFiles.includes(file)), 'new access object files: let features import each other directly').toEqual([])
    expect(budgets.accessFiles.filter(file => !accessFiles.includes(file)), `access object files that are gone: remove them from ${BUDGETS_FILE}`).toEqual([])
  })

  it('has no import cycles in the code Hronaut runs, so imports only go down the layers', () => {
    const graph = runtimeImports(files)
    expect(graph.get('src/shared/i18n.ts')).toContain('src/shared/locales/en-US.ts')
    expect(graph.get('src/renderer/src/main.ts')).toContain('src/renderer/src/App.vue')
    expect([...graph.values()].flat().length).toBeGreaterThan(2_000)
    expect(importCycles(graph)).toEqual([])
  })

  it('counts the imports and re-exports that the built code keeps, and leaves out those of types only', () => {
    const code = [
      "import './side-effect.js'",
      "import value, { type Shape } from './default.js'",
      "import * as everything from './namespace.js'",
      'import {',
      "  run, // the caller's entry",
      "  type Options",
      "} from './multi-line.js'",
      "import type { Only } from './type-import.js'",
      "import { type A, type B } from './inline-types.js'",
      'export type { Foo }',
      "export * from './star.js'",
      'export type Handler = () => void',
      "export { start } from './named.js'",
      "export { type C } from './type-export.js'",
      "export type * from './type-star.js'",
      "export * as grouped from './grouped.js'",
      "const later = import('./dynamic.js')"
    ].join('\n')
    expect(runtimeSpecifiers(code)).toEqual([
      './side-effect.js', './default.js', './namespace.js', './multi-line.js', './star.js', './named.js', './grouped.js'
    ])
  })

  it('finds import cycles of any length, a file importing itself included, and none where imports only go down', () => {
    const layered = new Map([['workflow', ['feature', 'primitive']], ['feature', ['primitive']], ['primitive', []]])
    expect(importCycles(layered)).toEqual([])
    const circular = new Map([
      ['workflow', ['feature']], ['feature', ['primitive']], ['primitive', ['workflow']],
      ['other', ['other']], ['leaf', []]
    ])
    expect(importCycles(circular)).toEqual([['feature', 'primitive', 'workflow'], ['other']])
  })
})

describe('the code the e2e tests load', () => {
  // Playwright lists the e2e tests by loading them in plain Node, where the electron package is only the path of its
  // binary and has no subpaths. One `import { BrowserWindow } from 'electron'` that a test's imports reach stopped
  // every e2e shard of the 3.14.0 release rehearsal before a test ran.
  it('reaches no named import from Electron, so Playwright can list the tests', () => {
    const starts = ['playwright.config.ts', ...readdirSync(join(ROOT, 'tests/integration')).filter(name => name.endsWith('.ts')).sort().map(name => `tests/integration/${name}`)]
    const importedBy = new Map(starts.map(file => [file, '']))
    // A Map visits the entries added while it is walked, so this follows every import the tests reach.
    for (const [file] of importedBy) {
      for (const target of runtimeImports([file]).get(file)!) if (!importedBy.has(target)) importedBy.set(target, file)
    }
    expect(importedBy.has('src/main/mcp/server.ts')).toBe(true)
    const problems: string[] = []
    for (const file of importedBy.keys()) {
      const code = readFileSync(join(ROOT, file), 'utf8')
      const names = runtimeNamesFrom(code, 'electron', file)
      const subpaths = runtimeSpecifiers(code, file).filter(specifier => specifier.startsWith('electron/'))
      if (names.length === 0 && subpaths.length === 0) continue
      const chain = [file]
      while (importedBy.get(chain[0]!)) chain.unshift(importedBy.get(chain[0]!)!)
      if (names.length > 0) problems.push(`${chain.join(' -> ')} imports { ${names.join(', ')} } from 'electron'`)
      for (const subpath of subpaths) problems.push(`${chain.join(' -> ')} imports from '${subpath}'`)
    }
    expect(problems).toEqual([])
  })

  it('counts the names a module takes from a package for its code, and leaves out types, its default and other packages', () => {
    const code = [
      "import { app, type App, BrowserWindow as Window } from 'electron'",
      "import type { WebContents } from 'electron'",
      "import electron, { default as binary } from 'electron'",
      "import { dialog } from 'electron/main'",
      "export { shell, type Session } from 'electron'",
      "export * from 'electron'",
      "import { z } from 'zod'"
    ].join('\n')
    expect(runtimeNamesFrom(code, 'electron')).toEqual(['app', 'BrowserWindow', 'shell'])
  })
})
