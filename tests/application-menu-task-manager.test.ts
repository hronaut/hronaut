import { afterEach, describe, expect, it, vi } from 'vitest'
import { applicationMenuKey, isBrowserKey } from '../src/shared/browser-shortcuts.js'
type Item = { label?: string; type?: string; accelerator?: string; click?: (item: unknown, window: unknown, event: { triggeredByAccelerator?: boolean }) => void }
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Item[] }> }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// Hronaut had no Task manager: no process list, and no way to end a page that froze or ate the memory.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function viewMenu(on: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: on })
  const showWindow = vi.fn()
  const runShortcut = vi.fn()
  createApplicationMenu({
    text: (key) => key, showWindow, mainWindow: () => ({ id: 1, webContents: {} }) as never, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: vi.fn(), runShortcut, runPageNextPane: vi.fn(), tabs: () => null
  }).installApplicationMenu()
  const view = installed.template.find((menu) => menu.label === 'native.menu.view')!.submenu!
  return { runShortcut, showWindow, view, taskManager: view.find((item) => item.label === 'native.menu.taskManager')! }
}

describe('Task manager in the View menu', () => {
  it('has Chrome\'s Shift+Esc elsewhere than macOS, where Chrome gives it no key, after Downloads', () => {
    for (const [on, key] of [['linux', 'Shift+Escape'], ['win32', 'Shift+Escape'], ['darwin', undefined]] as const) {
      const { view, taskManager } = viewMenu(on)
      expect(taskManager.accelerator, on).toBe(key)
      expect(view[view.indexOf(taskManager) - 1]?.label).toBe('native.menu.downloads')
    }
  })

  // As a page's browser key, so a page in full screen leaves it rather than covering the dialog.
  it('shows the window and runs the Task manager key as a browser key, from the menu or its key', () => {
    const { runShortcut, showWindow, taskManager } = viewMenu('linux')
    taskManager.click!(taskManager, undefined, {})
    taskManager.click!(taskManager, { id: 1 }, { triggeredByAccelerator: true })
    expect(showWindow).toHaveBeenCalledTimes(2)
    expect(runShortcut.mock.calls).toEqual([['task-manager'], ['task-manager']])
  })

  // Under a dialog Hronaut's window keeps the menu's keys, so Shift+Esc cannot open the Task manager behind it.
  it('is a key Hronaut\'s window keeps under its dialogs elsewhere than macOS', () => {
    const shiftEscape = { key: 'Escape', code: 'Escape', control: false, meta: false, alt: false, shift: true }
    expect(applicationMenuKey(shiftEscape)).toBe(true)
    expect(isBrowserKey(shiftEscape)).toBe(true)
    expect(applicationMenuKey({ ...shiftEscape, mac: true })).toBe(false)
    expect(applicationMenuKey({ ...shiftEscape, control: true })).toBe(false)
    expect(applicationMenuKey({ ...shiftEscape, alt: true })).toBe(false)
    expect(applicationMenuKey({ ...shiftEscape, repeat: true })).toBe(false)
  })
})
