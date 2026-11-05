import { afterEach, describe, expect, it, vi } from 'vitest'
type Item = { label?: string; type?: string; accelerator?: string; click?: (item: unknown, window: unknown, event: { triggeredByAccelerator?: boolean }) => void }
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Item[] }> }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// The menu prints with the browser; printing runs on the fake browser's stub.
vi.mock('../src/main/browser/page-print/page-print.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/page-print/page-print.js')>(),
  printShownPage: (browser: { printShownPage: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.printShownPage(...args)
}))

// Hronaut had no Print: Ctrl/Cmd+P did nothing and no menu offered it.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function viewMenu(on: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: on })
  const tabs = { printShownPage: vi.fn(async () => undefined) }
  const actions: string[] = []
  const mainWindow = { id: 1, webContents: {} }
  const showWindow = vi.fn()
  createApplicationMenu({
    text: (key) => key, showWindow, mainWindow: () => mainWindow as never, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: (action, callback) => { actions.push(action); void callback() },
    runShortcut: vi.fn(),
    runPageNextPane: vi.fn(),
    tabs: () => tabs as never
  }).installApplicationMenu()
  const view = installed.template.find((menu) => menu.label === 'native.menu.view')!.submenu!
  return { tabs, actions, showWindow, mainWindow, view, print: view.find((item) => item.label === 'native.menu.print')! }
}

describe('Print in the View menu', () => {
  it('has Chrome\'s key on each platform, in a group after Full-Page View, after Save Page As', () => {
    for (const on of ['linux', 'win32', 'darwin'] as const) {
      const { view, print } = viewMenu(on)
      expect(print.accelerator).toBe('CmdOrCtrl+P')
      const at = view.indexOf(print)
      expect([view[at - 3]?.label, view[at - 2]?.type, view[at - 1]?.label, view[at + 1]?.type]).toEqual(['native.menu.fullPageView', 'separator', 'native.menu.savePage', 'separator'])
    }
  })

  // Chosen from a panel in its own window, or with the main window in the tray, Print opened its dialog for a page out
  // of view; Save Page As already brought the main window forward.
  it('prints the shown page when chosen, from any window, bringing the main window forward', () => {
    const { tabs, actions, showWindow, print } = viewMenu('linux')
    print.click!(print, { id: 2 }, {})
    print.click!(print, undefined, {})
    expect(tabs.printShownPage).toHaveBeenCalledTimes(2)
    expect(actions).toEqual(['print the page', 'print the page'])
    expect(showWindow).toHaveBeenCalledTimes(2)
  })

  it('prints for its key only from the main window', () => {
    const { tabs, mainWindow, showWindow, print } = viewMenu('linux')
    print.click!(print, { id: 2 }, { triggeredByAccelerator: true })
    print.click!(print, undefined, { triggeredByAccelerator: true })
    expect(tabs.printShownPage).not.toHaveBeenCalled()
    print.click!(print, mainWindow, { triggeredByAccelerator: true })
    expect(tabs.printShownPage).toHaveBeenCalledOnce()
    // The key is pressed in the main window, which is in view.
    expect(showWindow).not.toHaveBeenCalled()
  })
})
