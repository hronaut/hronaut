import { afterEach, describe, expect, it, vi } from 'vitest'
type Item = { label?: string; type?: string; role?: string; accelerator?: string; visible?: boolean; click?: (item: unknown, window: unknown, event: { triggeredByAccelerator?: boolean }) => void }
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Item[] }> }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// The View menu's Actual Size, Zoom In and Zoom Out zoomed the page in view straight in main, Hronaut Home and a page
// under Settings too, which their keys leave alone.

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
  it.each(['linux', 'win32', 'darwin'] as const)('zooms as its keys do in Hronaut\'s window when chosen, showing the main window first, on %s', (on) => {
    const { runShortcut, runNativeBrowserAction, showWindow, item } = menu(on)
    for (const [label, accelerator, action] of ZOOM_ITEMS) {
      expect(item(label).accelerator).toBe(accelerator)
      item(label).click!({}, { id: 2, webContents: {} }, { triggeredByAccelerator: false })
      expect(runShortcut).toHaveBeenLastCalledWith(action)
      expect(showWindow.mock.invocationCallOrder.at(-1)).toBeLessThan(runShortcut.mock.invocationCallOrder.at(-1)!)
    }
    expect(showWindow).toHaveBeenCalledTimes(3)
    // Not straight on the tab: Hronaut's window leaves Home and a page under Settings at their zoom.
    expect(runNativeBrowserAction).not.toHaveBeenCalled()
  })

  it('runs its keys as Hronaut\'s window does, such as the repeats of a held key, without raising the main window', () => {
    const { runShortcut, showWindow, mainWindow, item } = menu('linux')
    for (const [label, , action] of ZOOM_ITEMS) {
      const zoom = item(label)
      zoom.click!(zoom, mainWindow, { triggeredByAccelerator: true })
      expect(runShortcut).toHaveBeenLastCalledWith(action)
      // A panel in its own window zooms the page in view with the key's first press already.
      zoom.click!(zoom, { id: 2, webContents: {} }, { triggeredByAccelerator: true })
      expect(runShortcut).toHaveBeenLastCalledWith(action)
    }
    expect(runShortcut).toHaveBeenCalledTimes(6)
    expect(showWindow).not.toHaveBeenCalled()
  })

  // Held down, Chrome's Ctrl+Shift+Minus zooms out with each repeat elsewhere than macOS, as Zoom Out's key does here.
  it.each(['linux', 'win32'] as const)('zooms out with Chrome\'s other key, Ctrl+Shift+Minus, hidden, on %s', (on) => {
    const { runShortcut, mainWindow } = menu(on)
    const view = installed.template.find((candidate) => candidate.label === 'native.menu.view')!.submenu!
    const other = view.find((candidate) => candidate.accelerator === 'Ctrl+Shift+-')!
    expect(other).toMatchObject({ label: 'native.menu.zoomOut', visible: false })
    other.click!(other, mainWindow, { triggeredByAccelerator: true })
    expect(runShortcut).toHaveBeenCalledExactlyOnceWith('zoom-out')
  })

  it('has no other zoom out key on macOS, as Chrome there', () => {
    menu('darwin')
    const view = installed.template.find((candidate) => candidate.label === 'native.menu.view')!.submenu!
    expect(view.filter((candidate) => candidate.label === 'native.menu.zoomOut').map((item) => item.accelerator)).toEqual(['CmdOrCtrl+-'])
  })
})
