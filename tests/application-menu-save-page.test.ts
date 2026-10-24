import { afterEach, describe, expect, it, vi } from 'vitest'
type Item = { label?: string; type?: string; accelerator?: string; click?: (item: unknown, window: unknown, event: { triggeredByAccelerator?: boolean }) => void }
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Item[] }> }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// Hronaut could not save a page: Ctrl/Cmd+S did nothing and no menu offered it.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function viewMenu(on: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: on })
  const tabs = { saveShownPage: vi.fn(async () => true) }
  const actions: string[] = []
  const showWindow = vi.fn()
  const mainWindow = { id: 1, webContents: {} }
  createApplicationMenu({
    text: (key) => key, showWindow, mainWindow: () => mainWindow as never, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: (action, callback) => { actions.push(action); void callback() },
    runShortcut: vi.fn(),
    runPageNextPane: vi.fn(),
    tabs: () => tabs as never
  }).installApplicationMenu()
  const view = installed.template.find((menu) => menu.label === 'native.menu.view')!.submenu!
  return { tabs, actions, showWindow, mainWindow, view, save: view.find((item) => item.label === 'native.menu.savePage')! }
}

describe('Save Page As in the View menu', () => {
  it('has Chrome\'s key on each platform, just before Print', () => {
    for (const on of ['linux', 'win32', 'darwin'] as const) {
      const { view, save } = viewMenu(on)
      expect(save.accelerator).toBe('CmdOrCtrl+S')
      expect(view[view.indexOf(save) + 1]?.label).toBe('native.menu.print')
    }
  })

  it('saves the shown page when chosen, from any window, showing the main window for its dialog', () => {
    const { tabs, actions, showWindow, save } = viewMenu('linux')
    save.click!(save, { id: 2 }, {})
    save.click!(save, undefined, {})
    expect(showWindow).toHaveBeenCalledTimes(2)
    expect(tabs.saveShownPage).toHaveBeenCalledTimes(2)
    expect(actions).toEqual(['save the page', 'save the page'])
  })

  it('saves for its key only from the main window', () => {
    const { tabs, mainWindow, showWindow, save } = viewMenu('linux')
    save.click!(save, { id: 2 }, { triggeredByAccelerator: true })
    save.click!(save, undefined, { triggeredByAccelerator: true })
    expect(tabs.saveShownPage).not.toHaveBeenCalled()
    save.click!(save, mainWindow, { triggeredByAccelerator: true })
    expect(tabs.saveShownPage).toHaveBeenCalledOnce()
    expect(showWindow).not.toHaveBeenCalled()
  })
})
