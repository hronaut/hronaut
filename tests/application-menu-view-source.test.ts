import { afterEach, describe, expect, it, vi } from 'vitest'
type Item = { label?: string; type?: string; accelerator?: string; click?: (item: unknown, window: unknown, event: { triggeredByAccelerator?: boolean }) => void }
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Item[] }> }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// Hronaut had no View Page Source: Ctrl+U and Cmd+Option+U did nothing and no menu offered it.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function viewMenu(on: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: on })
  const tabs = { viewShownPageSource: vi.fn(async () => true) }
  const actions: string[] = []
  const mainWindow = { id: 1, webContents: {} }
  const showWindow = vi.fn()
  createApplicationMenu({
    text: (key) => key, showWindow, mainWindow: () => mainWindow as never, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: (action, callback) => { actions.push(action); void callback() },
    runShortcut: vi.fn(),
    tabs: () => tabs as never
  }).installApplicationMenu()
  const view = installed.template.find((menu) => menu.label === 'native.menu.view')!.submenu!
  return { tabs, actions, mainWindow, showWindow, view, source: view.find((item) => item.label === 'native.menu.viewSource')! }
}

describe('View Page Source in the View menu', () => {
  it('has Chrome\'s key on each platform, after Developer Tools', () => {
    for (const [on, key] of [['linux', 'Ctrl+U'], ['win32', 'Ctrl+U'], ['darwin', 'Cmd+Alt+U']] as const) {
      const { view, source } = viewMenu(on)
      expect(source.accelerator).toBe(key)
      expect(view[view.indexOf(source) - 1]?.label).toBe('native.menu.developerTools')
    }
  })

  it('opens the shown page\'s source when chosen, from any window, showing the main window', () => {
    const { tabs, actions, showWindow, source } = viewMenu('linux')
    source.click!(source, { id: 2 }, {})
    source.click!(source, undefined, {})
    expect(tabs.viewShownPageSource).toHaveBeenCalledTimes(2)
    expect(actions).toEqual(['view page source', 'view page source'])
    expect(showWindow).toHaveBeenCalledTimes(2)
  })

  it('opens it for its key only from the main window', () => {
    const { tabs, mainWindow, showWindow, source } = viewMenu('darwin')
    source.click!(source, { id: 2 }, { triggeredByAccelerator: true })
    source.click!(source, undefined, { triggeredByAccelerator: true })
    expect(tabs.viewShownPageSource).not.toHaveBeenCalled()
    source.click!(source, mainWindow, { triggeredByAccelerator: true })
    expect(tabs.viewShownPageSource).toHaveBeenCalledOnce()
    // The key comes from the main window, which is already in view.
    expect(showWindow).not.toHaveBeenCalled()
  })
})
