import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const barrelFile = 'src/shared/types.ts'
const modulesDirectory = 'src/shared/types'
const moduleFiles = readdirSync(modulesDirectory).filter(file => file.endsWith('.ts')).sort()
const lineCount = (text: string): number => text.split('\n').length - (text.endsWith('\n') ? 1 : 0)

describe('shared type modules', () => {
  it('keeps src/shared/types.ts a barrel of re-export statements only', () => {
    const lines = readFileSync(barrelFile, 'utf8').split('\n').filter(line => line.trim() !== '')
    expect(lines.filter(line => !/^export (?:\*|(?:type )?\{[^}]*\}) from '\.\/[\w./-]+\.js'$/u.test(line))).toEqual([])
  })

  it('re-exports every domain module in src/shared/types/', () => {
    const barrel = readFileSync(barrelFile, 'utf8')
    const reexported = [...barrel.matchAll(/^export \* from '\.\/types\/([\w-]+)\.js'$/gmu)].map(match => `${match[1]}.ts`)
    expect(moduleFiles.length).toBeGreaterThan(0)
    expect(reexported.sort()).toEqual(moduleFiles)
  })

  it('keeps every domain module under 800 lines', () => {
    const oversized = moduleFiles
      .map(file => [file, lineCount(readFileSync(`${modulesDirectory}/${file}`, 'utf8'))] as const)
      .filter(([, lines]) => lines >= 800)
    expect(oversized).toEqual([])
  })
})
