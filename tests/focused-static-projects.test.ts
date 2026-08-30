import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  npmChildProcessInvocation,
  typecheckScriptsForFiles
} from '../scripts/run-focused-static-gates.js'

describe('focused static project selection', () => {
  it('checks only the owning renderer, main, and website projects', () => {
    expect(typecheckScriptsForFiles(['src/renderer/src/App.vue'])).toEqual(['typecheck:web'])
    expect(typecheckScriptsForFiles(['src/main/browser/tabs-manager.ts'])).toEqual(['typecheck:node'])
    expect(typecheckScriptsForFiles(['website/index.ts'])).toEqual(['typecheck:website'])
  })

  it('checks every consumer of shared contracts without duplicate work', () => {
    expect(typecheckScriptsForFiles([
      'src/shared/contracts.ts',
      'src/renderer/src/App.vue',
      'src/main/index.ts'
    ])).toEqual(['typecheck:node', 'typecheck:web'])
    expect(typecheckScriptsForFiles(['src/shared/release-assets.ts'])).toEqual([
      'typecheck:node',
      'typecheck:web',
      'typecheck:website'
    ])
  })

  it('fails safe to the complete graph for project and package configuration', () => {
    expect(typecheckScriptsForFiles(['package.json'])).toEqual([
      'typecheck:node',
      'typecheck:web',
      'typecheck:website'
    ])
    expect(typecheckScriptsForFiles(['tsconfig.web.json'])).toEqual(['typecheck:web'])
  })

  it('starts under Node native TypeScript execution before validating arguments', () => {
    const result = spawnSync(process.execPath, ['scripts/run-focused-static-gates.ts'], {
      encoding: 'utf8'
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Usage: npm run validate:focused')
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
  })

  it('keeps website TypeScript inside focused and full ESLint coverage', async () => {
    const eslintConfig = await readFile('eslint.config.mjs', 'utf8')

    expect(eslintConfig).toContain("'website/**/*.ts'")
    expect(eslintConfig).toContain("files: ['src/renderer/**/*.{ts,vue}', 'website/**/*.ts']")
  })

  it('ignores transient config bundles created during concurrent application builds', async () => {
    const eslintConfig = await readFile('eslint.config.mjs', 'utf8')

    expect(eslintConfig).toContain("'*.config.*.mjs'")
  })

  it('launches npm through Node without relying on Windows cmd execution', () => {
    expect(npmChildProcessInvocation(
      String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`,
      ['run', 'typecheck:web']
    )).toEqual({
      command: process.execPath,
      arguments: [
        String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`,
        'run',
        'typecheck:web'
      ]
    })
  })
})
