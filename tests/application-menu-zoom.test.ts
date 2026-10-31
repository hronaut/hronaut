import { afterEach, describe, expect, it, vi } from 'vitest'
type Item = { label?: string; type?: string; role?: string; accelerator?: string; click?: (item: unknown, window: unknown, event: { triggeredByAccelerator?: boolean }) => void }
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Item[] }> }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// The View menu's Actual Size, Zoom In and Zoom Out zoomed the page in view directly, Hronaut Home and a page under
// Settings too, which their keys leave alone. Home zoomed from the menu stayed zoomed, since its keys do nothing there.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function menu(on: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: on })
  const runShortcut = vi.fn()
  const runNativeBrowserAction = vi.fn()
  const showWindow = vi.fn()
  const mainWindow = { id: 1, webContents: {} }
  createApplicationMenu({
    text: (key) => key, showWindow, mainWindow: () => mainWindow as never, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction, runShortcut, runPageNextPane: vi.fn(), tabs: () => null
  }).installApplicationMenu()
  const view = installed.template.find((candidate) => candidate.label === 'native.menu.view')!.submenu!
  const item = (label: string) => view.find((candidate) => candidate.label === label)!
  return { runShortcut, runNativeBrowserAction, showWindow, mainWindow, item }
}

const ZOOM_ITEMS = [['native.menu.actualSize', 'CmdOrCtrl+0', 'zoom-reset'], ['native.menu.zoomIn', 'CmdOrCtrl+Plus', 'zoom-in'], ['native.menu.zoomOut', 'CmdOrCtrl+-', 'zoom-out']] as const

describe('the View menu\'s zoom', () => {
  it.each(['linux', 'win32', 'darwin'] as const)('zooms as its keys do in Hronaut\'s window when chosen, showing the main window, on %s', (on) => {
    const { runShortcut, runNativeBrowserAction, showWindow, item } = menu(on)
    for (const [label, accelerator, action] of ZOOM_ITEMS) {
      expect(item(label).accelerator).toBe(accelerator)
      item(label).click!({}, { id: 2, webContents: {} }, { triggeredByAccelerator: false })
      expect(runShortcut).toHaveBeenLastCalledWith(action)
    }
    expect(showWindow).toHaveBeenCalledTimes(3)
    // Not straight on the tab: Hronaut's window leaves Home and a page under Settings at their zoom.
    expect(runNativeBrowserAction).not.toHaveBeenCalled()
  })

  it('acts on its keys only from the main window', () => {
    const { runShortcut, showWindow, mainWindow, item } = menu('linux')
    for (const [label, , action] of ZOOM_ITEMS) {
      const zoom = item(label)
      // Typed in a panel in its own window, the key would zoom a page out of view.
      zoom.click!(zoom, { id: 2, webContents: {} }, { triggeredByAccelerator: true })
      zoom.click!(zoom, undefined, { triggeredByAccelerator: true })
      expect(runShortcut).not.toHaveBeenCalled()
      zoom.click!(zoom, mainWindow, { triggeredByAccelerator: true })
      expect(runShortcut).toHaveBeenCalledExactlyOnceWith(action)
      runShortcut.mockClear()
    }
    expect(showWindow).not.toHaveBeenCalled()
  })
})
