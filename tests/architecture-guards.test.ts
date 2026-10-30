import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declaredIpcChannels, importCycles, lineCount, literalIpcChannels, pageFunctionModuleUses, resolveImport, ROOT, runtimeImports, runtimeNamesFrom, runtimeSpecifiers, sourceFiles, untypedIpcUses, writtenIpcChannels } from './architecture/source-files.js'

const MAX_LINES = 800
const BUDGETS_FILE = 'tests/architecture/budgets.json'

/**
 * What the code may still carry from before the architecture rules: the files over the line limit, each with the most
 * lines it may have, and the access object files. Both only shrink.
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

  it('writes no IPC channel name out as text in main or the preloads, which use the typed channels of src/shared/ipc', () => {
    const declared = new Set(files.filter(file => file.startsWith('src/shared/ipc/'))
      .flatMap(file => declaredIpcChannels(readFileSync(join(ROOT, file), 'utf8'), file)))
    const literals = files.filter(file => file.startsWith('src/main/') || file.startsWith('src/preload/')).flatMap(file => {
      const code = readFileSync(join(ROOT, file), 'utf8')
      return [...new Set([...literalIpcChannels(code, file), ...writtenIpcChannels(code, declared, file)])].map(channel => `${file}: ${channel}`)
    })
    expect(literals, 'IPC channel names written as text: declare the channels in src/shared/ipc and use those').toEqual([])
  })

  it('finds a declared channel name written out anywhere: in a cast, a constant, a comparison or a template literal', () => {
    const declared = new Set(declaredIpcChannels([
      "export const HOME_IPC = {",
      "  changed: 'hronaut-home:changed' as EventChannel<[]>,",
      "  confirm: 'hronaut-home:confirm' as InvokeChannel<[question: Confirmation], boolean>",
      "} as const"
    ].join('\n')))
    expect([...declared]).toEqual(['hronaut-home:changed', 'hronaut-home:confirm'])
    const code = [
      "webContents.send('hronaut-home:changed' as EventChannel<[]>)",
      "const channel = 'hronaut-home:confirm'",
      "if (name !== `hronaut-home:changed`) return",
      "ipcRenderer.invoke(HOME_IPC.confirm, question)",
      "logger.info('hronaut-home:other')"
    ].join('\n')
    expect(writtenIpcChannels(code, declared)).toEqual(['hronaut-home:changed', 'hronaut-home:confirm', 'hronaut-home:changed'])
  })

  it('checks what main answers and sends against the channels: listeners register on TypedIpcMain and events go through sendTo', () => {
    const uses = files.filter(file => file.startsWith('src/main/')).flatMap(file => (
      untypedIpcUses(readFileSync(join(ROOT, file), 'utf8'), file).map(use => `${file}: ${use}`)
    ))
    expect(uses, 'untyped IPC in main: take TypedIpcMain and use sendTo from src/main/typed-ipc.ts').toEqual([])
  })

  it('finds a channel sent with a renderer\'s own send, a listener on Electron\'s ipcMain and the IpcMain type, and leaves out sendTo and other sends', () => {
    const code = [
      "import type { IpcMain } from 'electron'",
      "import { app, ipcMain as electronIpcMain } from 'electron'",
      "electronIpcMain.handle(HOME_IPC.confirm, () => true)",
      "registerHomeIpc(withTranslatedIpcErrors(electronIpcMain, host))",
      "typedIpcMain.handle(HOME_IPC.confirm, () => true)",
      "function register(ipcMain: Pick<IpcMain, 'handle'>, other: Electron.IpcMain) {}",
      "window.webContents.send(HOME_IPC.changed, state)",
      "host.mainWindow()?.webContents.send(SHELL_IPC.helpRequested, action)",
      "sendTo(window.webContents, HOME_IPC.changed, state)",
      "surface.send({ id: request.id })",
      "cdp.send('Runtime.evaluate', { expression })",
      "function typed(ipcMain: Pick<TypedIpcMain, 'handle'>) {}"
    ].join('\n')
    expect(untypedIpcUses(code)).toEqual(['ipcMain.handle', 'IpcMain', 'IpcMain', 'send(HOME_IPC.changed)', 'send(SHELL_IPC.helpRequested)'])
  })

  it('keeps each page function to its parameters and the page\'s globals, since only its own source reaches the page', () => {
    const problems = files.filter(file => file.endsWith('.page.ts')).flatMap(file => {
      const code = readFileSync(join(ROOT, file), 'utf8')
      return [
        ...runtimeSpecifiers(code, file).map(specifier => `${file} imports ${specifier} at runtime`),
        ...pageFunctionModuleUses(code, file).map(use => `${file}: ${use}`)
      ]
    })
    expect(problems, 'page code that would be missing in the page: pass it to the page function as a parameter').toEqual([])
  })

  it('finds a page function using its module, and leaves out its own names, properties, types and the page\'s globals', () => {
    const code = [
      "import type { Limits } from './limits.js'",
      'const MAX = 5',
      'const LIMIT = 3',
      'function helper(value: string) { return value.trim() }',
      'export function readInPage(limits: Limits, clean: (value: string) => string): string[] {',
      '  const { MAX: renamed = MAX } = { MAX: 1 }',
      '  const helperResult = helper(document.title)',
      '  const local = (MAX: number) => MAX + limits.max',
      '  const options = { LIMIT, clean }',
      '  function inner() { return readInPage }',
      '  outer: for (const node of document.querySelectorAll<HTMLElement>("p")) { if (node.helper) break outer }',
      '  return [clean(String(renamed)), helperResult, String(local(1)), String(inner) as string, String(options.LIMIT)]',
      '}'
    ].join('\n')
    expect(pageFunctionModuleUses(code)).toEqual([
      'top level: const MAX = 5', 'top level: const LIMIT = 3', 'readInPage: MAX', 'readInPage: helper', 'readInPage: LIMIT'
    ])
  })

  it('finds a base class, an instantiated function, a default value, Node\'s globals and imports, and code outside functions', () => {
    const code = [
      'const LIMIT = 3',
      'class Base {}',
      'interface Shape { size: number }',
      'function helper<T>(value: T): T { return value }',
      'export const readLater = () => LIMIT',
      'export function overloaded(value: string): string',
      'export function overloaded(value: string): string { return value ? overloaded("") : value }',
      'export function readInPage(): unknown[] {',
      '  const Local = class extends Base implements Shape { size = 1 }',
      '  const typed = helper<string>',
      '  let a = 0',
      '  ;({ a = LIMIT } = {})',
      '  return [Local, typed, a, process.env, import.meta, import("./other.js")]',
      '}'
    ].join('\n')
    expect(pageFunctionModuleUses(code)).toEqual([
      'top level: const LIMIT = 3', 'top level: class Base {}', 'top level: export const readLater = () => LIMIT',
      'readInPage: Base', 'readInPage: helper', 'readInPage: LIMIT', 'readInPage: process', 'readInPage: import.meta',
      'readInPage: import()'
    ])
  })

  it('counts the IPC channel names a module writes out, and leaves out typed channels, URLs and page events', () => {
    const code = [
      "ipcMain.handle('license:activate', activate)",
      "host.handleBrowserIpc(`browser:tab-groups:update`, update)",
      "ipcRenderer.invoke(LICENSE_IPC.activate, key)",
      "ipcRenderer.removeListener('license:changed', handler)",
      "tab.webContents.loadURL('about:blank')",
      "globalThis.addEventListener('eip6963:requestProvider', announce)",
      "logger.info('license activated: ok')",
      "const name = 'license:refresh'"
    ].join('\n')
    expect(literalIpcChannels(code)).toEqual(['license:activate', 'browser:tab-groups:update', 'license:changed'])
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
    const problems: string[] = []
    // A Map visits the entries added while it is walked, so this follows every import the tests reach. Each file is
    // parsed once, and again only when it imports Electron, so the walk stays quick beside the rest of the suite.
    for (const [file] of importedBy) {
      const code = readFileSync(join(ROOT, file), 'utf8')
      const specifiers = runtimeSpecifiers(code, file)
      for (const specifier of specifiers) {
        const target = specifier.startsWith('.') ? resolveImport(file, specifier) : undefined
        if (target && !importedBy.has(target)) importedBy.set(target, file)
      }
      const names = specifiers.includes('electron') ? runtimeNamesFrom(code, 'electron', file) : []
      const subpaths = specifiers.filter(specifier => specifier.startsWith('electron/'))
      if (names.length === 0 && subpaths.length === 0) continue
      const chain = [file]
      while (importedBy.get(chain[0]!)) chain.unshift(importedBy.get(chain[0]!)!)
      if (names.length > 0) problems.push(`${chain.join(' -> ')} imports { ${names.join(', ')} } from 'electron'`)
      for (const subpath of subpaths) problems.push(`${chain.join(' -> ')} imports from '${subpath}'`)
    }
    expect(importedBy.has('src/main/mcp/tool-catalog.ts')).toBe(true)
    expect(problems).toEqual([])
  }, 30_000)

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
