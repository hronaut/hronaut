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
  const showWindow = vi.fn()
  const runShortcut = vi.fn()
  createApplicationMenu({
    text: (key) => key, showWindow, mainWindow: () => ({ id: 1, webContents: {} }) as never, checkForUpdates: vi.fn(), requestQuit: vi.fn(),
    runNativeBrowserAction: vi.fn(), runShortcut, tabs: () => null
  }).installApplicationMenu()
  const view = installed.template.find((menu) => menu.label === 'native.menu.view')!.submenu!
  return { runShortcut, showWindow, view, downloads: view.find((item) => item.label === 'native.menu.downloads')! }
}

describe('Downloads in the View menu', () => {
  it('has Chrome\'s key on each platform, after Pick Element for Agent', () => {
    for (const [on, key] of [['linux', 'Ctrl+J'], ['win32', 'Ctrl+J'], ['darwin', 'Cmd+Alt+L']] as const) {
      const { view, downloads } = viewMenu(on)
      expect(downloads.accelerator).toBe(key)
      expect(view[view.indexOf(downloads) - 1]?.label).toBe('native.menu.pickElement')
    }
  })

  // As a page's browser key, so a page in full screen leaves it rather than covering the panel.
  it('shows the window and runs the downloads key as a browser key, from the menu or its key', () => {
    const { runShortcut, showWindow, downloads } = viewMenu('linux')
    downloads.click!(downloads, undefined, {})
    downloads.click!(downloads, { id: 1 }, { triggeredByAccelerator: true })
    expect(showWindow).toHaveBeenCalledTimes(2)
    expect(runShortcut.mock.calls).toEqual([['downloads'], ['downloads']])
  })
})
