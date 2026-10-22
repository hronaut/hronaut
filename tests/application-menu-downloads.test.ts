import { afterEach, describe, expect, it, vi } from 'vitest'
type Item = { label?: string; type?: string; accelerator?: string; click?: (item: unknown, window: unknown, event: { triggeredByAccelerator?: boolean }) => void }
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Item[] }> }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// Ctrl+J, and Cmd+Option+L on macOS, did nothing, and no menu offered the downloads.

const platform = process.platform
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

function viewMenu(on: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: on })
  const sent: unknown[][] = []
  const showWindow = vi.fn()
  const mainWindow = { id: 1, webContents: { send: (...args: unknown[]) => { sent.push(args) } } }
  createApplicationMenu({
    text: (key) => key, showWindow, mainWindow: () => mainWindow as never, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: vi.fn(), runShortcut: vi.fn(), tabs: () => null
  }).installApplicationMenu()
  const view = installed.template.find((menu) => menu.label === 'native.menu.view')!.submenu!
  return { sent, showWindow, view, downloads: view.find((item) => item.label === 'native.menu.downloads')! }
}

describe('Downloads in the View menu', () => {
  it('has Chrome\'s key on each platform, after Print', () => {
    for (const [on, key] of [['linux', 'Ctrl+J'], ['win32', 'Ctrl+J'], ['darwin', 'Cmd+Alt+L']] as const) {
      const { view, downloads } = viewMenu(on)
      expect(downloads.accelerator).toBe(key)
      expect(view[view.indexOf(downloads) - 1]?.label).toBe('native.menu.print')
    }
  })

  it('shows the window and asks it for its downloads panel, from the menu or its key', () => {
    const { sent, showWindow, downloads } = viewMenu('linux')
    downloads.click!(downloads, undefined, {})
    downloads.click!(downloads, { id: 1 }, { triggeredByAccelerator: true })
    expect(showWindow).toHaveBeenCalledTimes(2)
    expect(sent).toEqual([['browser:shortcut-requested', 'downloads'], ['browser:shortcut-requested', 'downloads']])
  })
})
