import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const barrelFile = 'src/main/browser/page-scripts.ts'
const modulesDirectory = 'src/main/browser/page-scripts'
const moduleFiles = readdirSync(modulesDirectory).filter(file => file.endsWith('.ts')).sort()
const lineCount = (text: string): number => text.split('\n').length - (text.endsWith('\n') ? 1 : 0)

describe('page script modules', () => {
  it('keeps src/main/browser/page-scripts.ts a barrel of re-export statements only', () => {
    const lines = readFileSync(barrelFile, 'utf8').split('\n').filter(line => line.trim() !== '')
    expect(lines.filter(line => !/^export (?:\*|(?:type )?\{[^}]*\}) from '\.\/page-scripts\/[\w-]+\.js'$/u.test(line))).toEqual([])
  })

  it('re-exports every feature module in src/main/browser/page-scripts/', () => {
    const barrel = readFileSync(barrelFile, 'utf8')
    const reexported = [...new Set([...barrel.matchAll(/ from '\.\/page-scripts\/([\w-]+)\.js'$/gmu)].map(match => `${match[1]}.ts`))]
    expect(moduleFiles.length).toBeGreaterThan(0)
    expect(reexported.sort()).toEqual(moduleFiles)
  })

  it('keeps each feature module self-contained, importing no other page script module', () => {
    const siblingImports = moduleFiles.flatMap(file => readFileSync(`${modulesDirectory}/${file}`, 'utf8')
      .split('\n')
      .filter(line => /^(?:import|export)\s.*\sfrom '\.\//u.test(line))
      .map(line => `${file}: ${line}`))
    expect(siblingImports).toEqual([])
  })

  it('keeps every feature module under 800 lines', () => {
    const oversized = moduleFiles
      .map(file => [file, lineCount(readFileSync(`${modulesDirectory}/${file}`, 'utf8'))] as const)
      .filter(([, lines]) => lines >= 800)
    expect(oversized).toEqual([])
  })
})
