import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const barrelFile = 'src/main/browser/page-scripts.ts'
const modulesDirectory = 'src/main/browser/page-scripts'
const files = readdirSync(modulesDirectory).filter(file => file.endsWith('.ts')).sort()
// A feature module's page code lives beside it in `<feature>.page.ts`. Other modules import a page function from there
// only to pass it to their own page function as a helper argument.
const moduleFiles = files.filter(file => !file.endsWith('.page.ts'))
const ownPageFile = (file: string): string => `./${file.replace(/-scripts?\.ts$/u, '')}.page.js`
const lineCount = (text: string): number => text.split('\n').length - (text.endsWith('\n') ? 1 : 0)

describe('page script modules', () => {
  it('keeps src/main/browser/page-scripts.ts a barrel of re-export statements only', () => {
    const lines = readFileSync(barrelFile, 'utf8').split('\n').filter(line => line.trim() !== '')
    expect(lines.filter(line => !/^export \* from '\.\/page-scripts\/[\w-]+\.js'$/u.test(line))).toEqual([])
  })

  it('re-exports every feature module in src/main/browser/page-scripts/', () => {
    const barrel = readFileSync(barrelFile, 'utf8')
    const reexported = [...new Set([...barrel.matchAll(/ from '\.\/page-scripts\/([\w-]+)\.js'$/gmu)].map(match => `${match[1]}.ts`))]
    expect(moduleFiles.length).toBeGreaterThan(0)
    expect(reexported.sort()).toEqual(moduleFiles)
  })

  it('keeps each feature module self-contained, importing no other page script module or the barrel', () => {
    const pageScriptImports = files.flatMap(file => [...readFileSync(`${modulesDirectory}/${file}`, 'utf8')
      .matchAll(/(?:\bfrom|\bimport\s*\(?)\s*['"]((?:\.\/|\.\.\/page-scripts)[^'"]*)['"]/gu)]
      .map(match => match[1])
      .filter(path => path !== ownPageFile(file))
      .map(path => `${file}: ${path}`))
    expect(pageScriptImports).toEqual([])
  })

  it('keeps every feature module under 800 lines', () => {
    const oversized = files
      .map(file => [file, lineCount(readFileSync(`${modulesDirectory}/${file}`, 'utf8'))] as const)
      .filter(([, lines]) => lines >= 800)
    expect(oversized).toEqual([])
  })
})
