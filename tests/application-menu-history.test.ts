import { afterEach, describe, expect, it, vi } from 'vitest'
type Item = { label?: string; accelerator?: string; click?: (item: unknown, window: unknown, event: { triggeredByAccelerator?: boolean }) => void }
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Item[] }> }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// Hronaut had no keys for Back and Forward: Alt+Left and Alt+Right, or Cmd+[ and Cmd+] on macOS, did nothing.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function viewItems(on: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: on })
  const tabs = { back: vi.fn(), forward: vi.fn(), historyGesture: vi.fn() }
  const actions: string[] = []
  const mainWindow = { id: 1, webContents: {} }
  createApplicationMenu({
    text: (key) => key, showWindow: vi.fn(), mainWindow: () => mainWindow as never, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: (action, callback) => { actions.push(action); callback() },
    runShortcut: vi.fn(),
    tabs: () => tabs as never
  }).installApplicationMenu()
  const view = installed.template.find((menu) => menu.label === 'native.menu.view')!.submenu!
  const item = (label: string) => view.find((candidate) => candidate.label === label)!
  return { tabs, actions, mainWindow, back: item('native.menu.back'), forward: item('native.menu.forward') }
}

describe('Back and Forward in the View menu', () => {
  it('have Chrome\'s keys on each platform', () => {
    for (const on of ['linux', 'win32'] as const) {
      const { back, forward } = viewItems(on)
      expect([back.accelerator, forward.accelerator]).toEqual(['Alt+Left', 'Alt+Right'])
    }
    const { back, forward } = viewItems('darwin')
    expect([back.accelerator, forward.accelerator]).toEqual(['Cmd+[', 'Cmd+]'])
  })

  it('go back and forward in the shown tab like the toolbar\'s arrows when chosen', () => {
    const { tabs, actions, mainWindow, back, forward } = viewItems('linux')
    back.click!(back, mainWindow, {})
    expect(tabs.back).toHaveBeenCalledWith()
    forward.click!(forward, undefined, { triggeredByAccelerator: false })
    expect(tabs.forward).toHaveBeenCalledWith()
    expect(tabs.historyGesture).not.toHaveBeenCalled()
    expect(actions).toEqual(['go back', 'go forward'])
  })

  it('go by the rules of the person\'s own input from their keys, and only in the main window', () => {
    const { tabs, actions, mainWindow, back, forward } = viewItems('linux')
    back.click!(back, mainWindow, { triggeredByAccelerator: true })
    forward.click!(forward, mainWindow, { triggeredByAccelerator: true })
    expect(tabs.historyGesture.mock.calls).toEqual([['back'], ['forward']])
    // Typed in a panel in its own window, the key would change a page out of view.
    back.click!(back, { id: 2, webContents: {} }, { triggeredByAccelerator: true })
    back.click!(back, undefined, { triggeredByAccelerator: true })
    expect(tabs.historyGesture).toHaveBeenCalledTimes(2)
    expect(tabs.back).not.toHaveBeenCalled()
    expect(actions).toEqual(['go back', 'go forward'])
  })
})
