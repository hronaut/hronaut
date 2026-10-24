import { afterEach, describe, expect, it, vi } from 'vitest'
type Item = { label?: string; accelerator?: string; visible?: boolean; click?: (item: unknown, window: unknown, event: { triggeredByAccelerator?: boolean }) => void }
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Item[] }> }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// F5, Shift+F5, Ctrl+F5 and Alt+D did nothing, where Chrome reloads or goes to the address bar once the website in
// focus leaves the key alone.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function menu(on: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: on })
  const runShortcut = vi.fn()
  const runPageNextPane = vi.fn()
  // A page in the main window has the keyboard, rather than Hronaut's own window.
  const shellFocused = { value: false }
  const mainWindow = { id: 1, webContents: { isFocused: () => shellFocused.value } }
  createApplicationMenu({
    text: (key) => key, showWindow: vi.fn(), mainWindow: () => mainWindow as never, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: vi.fn(), runShortcut, runPageNextPane, tabs: () => null
  }).installApplicationMenu()
  const view = installed.template.find((candidate) => candidate.label === 'native.menu.view')!.submenu!
  const key = (accelerator: string) => view.find((item) => item.accelerator === accelerator)
  return { runShortcut, runPageNextPane, shellFocused, mainWindow, view, key }
}

describe('Chrome\'s keys a website may keep', () => {
  it('are hidden keys of the View menu elsewhere than macOS, running the browser\'s shortcut', () => {
    const { runShortcut, mainWindow, key } = menu('linux')
    for (const [accelerator, action] of [
      ['F5', 'reload'], ['Shift+F5', 'reload-ignoring-cache'], ['Ctrl+F5', 'reload-ignoring-cache'], ['Alt+D', 'focus-address'],
      ['F3', 'find-next'], ['Shift+F3', 'find-previous'],
      ['Ctrl+Shift+PageDown', 'move-tab-next'], ['Ctrl+Shift+PageUp', 'move-tab-previous']
    ] as const) {
      const item = key(accelerator)!
      expect(item.visible, accelerator).toBe(false)
      item.click!(item, mainWindow, { triggeredByAccelerator: true })
      expect(runShortcut).toHaveBeenLastCalledWith(action)
    }
    expect(menu('win32').key('F5')).toBeDefined()
    expect(menu('darwin').key('F5')).toBeUndefined()
    expect(menu('darwin').key('Alt+D')).toBeUndefined()
    expect(menu('darwin').key('F3')).toBeUndefined()
    expect(menu('darwin').key('Ctrl+Shift+PageDown')).toBeUndefined()
    expect(menu('darwin').key('F6')).toBeUndefined()
  })

  it('go to the pane after the page with F6 and Shift+F6', () => {
    const { runShortcut, runPageNextPane, mainWindow, key } = menu('linux')
    for (const accelerator of ['F6', 'Shift+F6']) {
      const item = key(accelerator)!
      expect(item.visible, accelerator).toBe(false)
      item.click!(item, mainWindow, { triggeredByAccelerator: true })
    }
    expect(runPageNextPane).toHaveBeenCalledTimes(2)
    expect(runShortcut).not.toHaveBeenCalled()
  })

  it('do nothing for a key Hronaut\'s own window left alone, as under one of its dialogs', () => {
    // Hronaut's window runs these keys itself; F6 under its dialog moved the keyboard out of the dialog to the address bar.
    const { runShortcut, runPageNextPane, shellFocused, mainWindow, key } = menu('linux')
    shellFocused.value = true
    for (const accelerator of ['F5', 'Alt+D', 'F6', 'F3', 'Ctrl+Shift+PageDown']) {
      const item = key(accelerator)!
      item.click!(item, mainWindow, { triggeredByAccelerator: true })
    }
    expect(runShortcut).not.toHaveBeenCalled()
    expect(runPageNextPane).not.toHaveBeenCalled()
  })

  it('act only as keys of the main window', () => {
    const { runShortcut, key } = menu('linux')
    const item = key('F5')!
    // Typed in a panel in its own window, the key would reload a page out of view.
    item.click!(item, { id: 2, webContents: {} }, { triggeredByAccelerator: true })
    item.click!(item, undefined, { triggeredByAccelerator: true })
    item.click!(item, { id: 1, webContents: {} }, { triggeredByAccelerator: false })
    expect(runShortcut).not.toHaveBeenCalled()
  })

  it('leave the menu as it shows', () => {
    const { view } = menu('linux')
    const shown = view.filter((item) => item.visible !== false).map((item) => item.label)
    expect(shown).not.toContain('runtime.shortcuts.address')
    expect(shown.filter((label) => label === 'native.menu.reload')).toHaveLength(1)
  })
})
