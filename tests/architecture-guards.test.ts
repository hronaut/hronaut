import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importCycles, lineCount, ROOT, runtimeImports, sourceFiles } from './architecture/source-files.js'

const MAX_LINES = 800
const BUDGETS_FILE = 'tests/architecture/budgets.json'

/**
 * What the code may still carry from before the architecture rules: the files over the line limit, each with the most
 * lines it may have, and the access object files. Both lists only shrink.
 */
const budgets = JSON.parse(readFileSync(join(ROOT, BUDGETS_FILE), 'utf8')) as { oversizedFiles: Record<string, number>, accessFiles: string[] }

// Locale files hold one translated string per line and grow with every string, in every language.
const files = sourceFiles().filter(file => !file.startsWith('src/shared/locales/'))

describe('the architecture rules in AGENTS.md', () => {
  it(`keeps every source file within ${MAX_LINES} lines, and lets the larger ones only shrink`, () => {
    const problems: string[] = []
    for (const file of files) {
      const lines = lineCount(file)
      const budget = budgets.oversizedFiles[file]
      if (budget === undefined && lines > MAX_LINES) problems.push(`${file} has ${lines} lines; split it by feature to keep it within ${MAX_LINES}`)
      else if (budget !== undefined && lines > budget) problems.push(`${file} grew to ${lines} lines, over its ${budget}; move code out to a feature module instead`)
      else if (budget !== undefined && lines < budget) problems.push(`${file} shrank to ${lines} lines: lower its budget in ${BUDGETS_FILE} to ${lines > MAX_LINES ? lines : 'nothing, removing it'}`)
    }
    for (const file of Object.keys(budgets.oversizedFiles)) {
      if (!files.includes(file)) problems.push(`${file} is gone: remove it from ${BUDGETS_FILE}`)
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
    // The code's imports and re-exports count; imports of types only, which the build leaves out, do not.
    expect(graph.get('src/main/browser/tabs-manager.ts')).toContain('src/main/browser/page-navigation/page-navigation.ts')
    expect(graph.get('src/main/browser/tabs-manager.ts')).not.toContain('src/main/browser/screenshots/screenshots-access.ts')
    expect(graph.get('src/shared/types.ts')).toContain('src/shared/types/license.ts')
    expect(importCycles(graph)).toEqual([])
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
