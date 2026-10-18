import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The diagnostics and network controllers compose one module per feature from
// their own folder. Keep each piece readable and every module composed.
const composables = 'src/renderer/src/composables'
const controllers = [
  { file: `${composables}/useDiagnosticsController.ts`, modules: `${composables}/diagnostics` },
  { file: `${composables}/useNetworkController.ts`, modules: `${composables}/network` }
]
const moduleFiles = (directory: string): string[] => readdirSync(directory).filter(file => file.endsWith('.ts')).sort()
const lineCount = (text: string): number => text.split('\n').length - (text.endsWith('\n') ? 1 : 0)

describe('renderer controller modules', () => {
  it('keeps each controller and each of its feature modules under 800 lines', () => {
    const files = controllers.flatMap(({ file, modules }) => [file, ...moduleFiles(modules).map(name => `${modules}/${name}`)])
    const oversized = files
      .map(file => [file, lineCount(readFileSync(file, 'utf8'))] as const)
      .filter(([, lines]) => lines >= 800)
    expect(oversized).toEqual([])
  })

  it.each(controllers)('composes every feature composable of its folder in $file', ({ file, modules }) => {
    const source = readFileSync(file, 'utf8')
    const folder = modules.slice(modules.lastIndexOf('/') + 1)
    const composed = moduleFiles(modules).filter(name => name.startsWith('use'))
    expect(composed.length).toBeGreaterThan(0)
    const missing = composed.filter(name => !source.includes(`from './${folder}/${name.replace(/\.ts$/u, '.js')}'`))
    expect(missing).toEqual([])
  })
})
