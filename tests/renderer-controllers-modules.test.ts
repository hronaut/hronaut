import { readFileSync, readdirSync } from 'node:fs'
import { posix } from 'node:path'
import { describe, expect, it } from 'vitest'

// The diagnostics and network controllers compose one module per feature from
// their own folder. Keep each piece readable and every module composed.
const lineCount = (text: string): number => text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
const relativeImports = (file: string): Array<{ typeOnly: boolean; path: string }> => [...readFileSync(file, 'utf8')
  .matchAll(/(import\s+type\s+[^'"]*?\sfrom\s*|\bfrom\s*|\bimport\s*\(?\s*)['"](\.\.?\/[^'"]*)['"]/gu)]
  .map(([, prefix = '', path = '']) => ({ typeOnly: prefix.startsWith('import type'), path }))
/** The repository path an import names, without its .js, .ts or .vue extension. */
const importTarget = (file: string, path: string): string => posix.normalize(posix.join(posix.dirname(file), path))
  .replace(/\.(?:js|ts|vue)$/u, '')
const sourceFiles = (directory: string): string[] => readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && /\.(?:ts|vue)$/u.test(entry.name))
  .map(entry => `${entry.parentPath.replaceAll('\\', '/')}/${entry.name}`)
  .sort()

// The network controller composes the feature modules of features/network/modules.
const network = {
  file: 'src/renderer/src/features/network/useNetworkController.ts',
  modules: 'src/renderer/src/features/network/modules'
}
const networkModules = readdirSync(network.modules).filter(file => file.endsWith('.ts')).sort()
const networkController = network.file.replace(/\.ts$/u, '')

// Each diagnostics feature folder holds its panel, its composable and any
// component only that panel uses. The controller and the panel host beside the
// folders compose them; folders share only the type-only request contract.
const renderer = 'src/renderer/src'
const diagnostics = `${renderer}/features/diagnostics`
const diagnosticsController = `${diagnostics}/useDiagnosticsController`
const diagnosticsHost = `${diagnostics}/DiagnosticsPanels`
const diagnosticsRequest = `${diagnostics}/diagnostics-request`
const diagnosticsFeatures = readdirSync(diagnostics, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()
const featureFiles = (feature: string): string[] => readdirSync(`${diagnostics}/${feature}`)
  .filter(name => /\.(?:ts|vue)$/u.test(name) && !name.endsWith('.test.ts'))
  .sort()

describe('renderer controller modules', () => {
  it('keeps each controller and each of its feature modules under 800 lines', () => {
    const files = [
      network.file,
      ...networkModules.map(name => `${network.modules}/${name}`),
      ...sourceFiles(diagnostics).filter(file => !file.endsWith('.test.ts'))
    ]
    const oversized = files
      .map(file => [file, lineCount(readFileSync(file, 'utf8'))] as const)
      .filter(([, lines]) => lines >= 800)
    expect(oversized).toEqual([])
  })

  it('keeps every network feature module independent of the others and of both controllers', () => {
    const siblingImports = networkModules.flatMap(name => relativeImports(`${network.modules}/${name}`)
      .map(({ path }) => ({ path, target: importTarget(`${network.modules}/${name}`, path) }))
      .filter(({ path, target }) => path.startsWith('./') || target === networkController || target.startsWith(`${diagnostics}/`))
      .map(({ path }) => `${name}: ${path}`))
    expect(siblingImports).toEqual([])
  })

  it('composes every network feature composable in the network controller', () => {
    const source = readFileSync(network.file, 'utf8')
    const composed = networkModules.filter(name => name.startsWith('use'))
    expect(composed.length).toBeGreaterThan(0)
    const missing = composed.filter(name => !source.includes(`from './modules/${name.replace(/\.ts$/u, '.js')}'`))
    expect(missing).toEqual([])
  })

  it('keeps every diagnostics feature folder independent of the others', () => {
    // A feature may type its request ports with the shared request contract, and
    // its panel may type the controller it receives; nothing else crosses folders,
    // and no feature reaches into the network controller or its modules.
    const crossFolderImports = diagnosticsFeatures.flatMap(feature => sourceFiles(`${diagnostics}/${feature}`)
      .flatMap(file => relativeImports(file)
        .map(({ typeOnly, path }) => ({ typeOnly, path, target: importTarget(file, path) }))
        .filter(({ target }) => (target.startsWith(`${diagnostics}/`) && !target.startsWith(`${diagnostics}/${feature}/`))
          || target === networkController || target.startsWith(`${network.modules}/`))
        .filter(({ typeOnly, target }) => !(typeOnly && target === diagnosticsRequest))
        .filter(({ typeOnly, target }) => !(typeOnly && file.endsWith('.vue') && target === diagnosticsController))
        .map(({ path }) => `${file}: ${path}`)))
    expect(crossFolderImports).toEqual([])
  })

  it('gives every diagnostics feature folder a panel and a composable, composed by the controller and host', () => {
    expect(diagnosticsFeatures.length).toBeGreaterThan(0)
    const controller = readFileSync(`${diagnosticsController}.ts`, 'utf8')
    const host = readFileSync(`${diagnosticsHost}.vue`, 'utf8')
    const isComposable = (name: string): boolean => /^use[A-Z]\w*\.ts$/u.test(name)
    const incomplete = diagnosticsFeatures.filter(feature => {
      const files = featureFiles(feature)
      return !files.some(isComposable) || !files.some(name => name.endsWith('Panel.vue'))
    })
    expect(incomplete).toEqual([])
    const uncomposed = diagnosticsFeatures.flatMap(feature => featureFiles(feature)
      .filter(name => isComposable(name)
        ? !controller.includes(`from './${feature}/${name.replace(/\.ts$/u, '.js')}'`)
        : name.endsWith('Panel.vue') && !host.includes(`from './${feature}/${name}'`))
      .map(name => `${feature}/${name}`))
    expect(uncomposed).toEqual([])
  })

  it('reaches the diagnostics features from the rest of the renderer only through the controller and host', () => {
    const outside = sourceFiles(renderer).filter(file => !file.startsWith(`${diagnostics}/`))
    const reachedInside = outside.flatMap(file => relativeImports(file)
      .map(({ path }) => ({ path, target: importTarget(file, path) }))
      .filter(({ target }) => target.startsWith(`${diagnostics}/`))
      .filter(({ target }) => target !== diagnosticsController && target !== diagnosticsHost)
      .map(({ path }) => `${file}: ${path}`))
    expect(reachedInside).toEqual([])
  })
})
