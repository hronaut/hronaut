import { afterEach, expect, it, vi } from 'vitest'
type Item = { label?: string; type?: string; role?: string; submenu?: Item[] }
const installed = vi.hoisted(() => ({ template: [] as Item[] }))
vi.mock('electron', () => ({
  app: { on: () => undefined },
  Menu: {
    buildFromTemplate: (template: Item[]) => template,
    setApplicationMenu: (menu: Item[]) => { installed.template = menu }
  }
}))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// The Edit menu's Undo, Cut, Copy, Paste and Select All, and View's Toggle Full Screen, stayed in English in every
// language, as Electron names a role's item only in English; macOS's Edit menu also lacked Paste and Match Style and
// Delete, which Chrome's has.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function menu(on: NodeJS.Platform): Item[] {
  Object.defineProperty(process, 'platform', { value: on })
  createApplicationMenu({
    text: (key) => key, showWindow: vi.fn(), mainWindow: () => null, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: vi.fn(), runShortcut: vi.fn(), runPageNextPane: vi.fn(), tabs: () => null
  }).installApplicationMenu()
  return installed.template
}

function items(entries: Item[]): Item[] {
  return entries.flatMap((entry) => [entry, ...items(entry.submenu ?? [])])
}

it.each(['linux', 'win32', 'darwin'] as const)('names every item in the person\'s language on %s', (on) => {
  const unnamed = items(menu(on)).filter((entry) => entry.type !== 'separator' && !entry.label)
  expect(unnamed.map((entry) => entry.role)).toEqual([])
})

it.each(['linux', 'win32', 'darwin'] as const)('labels the Edit menu\'s roles with the page menu\'s words on %s', (on) => {
  const edit = menu(on).find((entry) => entry.label === 'native.menu.edit')!.submenu!
  const roles = edit.filter((entry) => entry.role).map((entry) => [entry.role, entry.label])
  expect(roles).toEqual([
    ['undo', 'native.context.undo'],
    ['redo', 'native.context.redo'],
    ['cut', 'native.context.cut'],
    ['copy', 'native.context.copy'],
    ['paste', 'native.context.paste'],
    ...(on === 'darwin' ? [['pasteAndMatchStyle', 'native.context.pasteMatchStyle'], ['delete', 'native.context.delete']] : []),
    ['selectAll', 'native.context.selectAll']
  ])
  const view = menu(on).find((entry) => entry.label === 'native.menu.view')!.submenu!
  expect(view.find((entry) => entry.role === 'togglefullscreen')?.label).toBe('native.menu.toggleFullScreen')
})
