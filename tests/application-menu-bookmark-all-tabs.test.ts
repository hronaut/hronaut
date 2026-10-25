import { afterEach, describe, expect, it, vi } from 'vitest'
import { applicationMenuKey, browserShortcutAction, isBrowserKey } from '../src/shared/browser-shortcuts.js'
type Item = { label?: string; type?: string; accelerator?: string; click?: (item: unknown, window: unknown, event: { triggeredByAccelerator?: boolean }) => void }
const installed = vi.hoisted(() => ({ template: [] as Array<{ label?: string; submenu?: Item[] }> }))
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: typeof installed.template) => template, setApplicationMenu: (menu: typeof installed.template) => { installed.template = menu } } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// Bookmark all tabs took Ctrl+Shift+D before the page, so a website that uses the key, as a web editor does to show
// its Run and Debug view, lost it. Chrome leaves it to the page, and runs Bookmark all tabs when the page leaves it.

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
  return { runShortcut, showWindow, view, bookmarkAllTabs: view.find((item) => item.label === 'native.menu.bookmarkAllTabs')! }
}

describe('Bookmark All Tabs in the View menu', () => {
  it('has Chrome\'s key on each platform, after Task manager', () => {
    for (const [on, key] of [['linux', 'Ctrl+Shift+D'], ['win32', 'Ctrl+Shift+D'], ['darwin', 'Cmd+Shift+D']] as const) {
      const { view, bookmarkAllTabs } = viewMenu(on)
      expect(bookmarkAllTabs.accelerator, on).toBe(key)
      expect(view[view.indexOf(bookmarkAllTabs) - 1]?.label).toBe('native.menu.taskManager')
    }
  })

  // As a page's browser key, so Hronaut's window takes the keyboard for the name and a page in full screen leaves it.
  it('shows the window and runs Bookmark all tabs as a browser key, from the menu or its key', () => {
    const { runShortcut, showWindow, bookmarkAllTabs } = viewMenu('linux')
    bookmarkAllTabs.click!(bookmarkAllTabs, undefined, {})
    bookmarkAllTabs.click!(bookmarkAllTabs, { id: 1 }, { triggeredByAccelerator: true })
    expect(showWindow).toHaveBeenCalledTimes(2)
    expect(runShortcut.mock.calls).toEqual([['bookmark-all-tabs'], ['bookmark-all-tabs']])
  })

  it('leaves its key to the page first, and to Hronaut\'s window under its dialogs', () => {
    for (const mac of [false, true]) {
      const key = { key: 'D', code: 'KeyD', control: !mac, meta: mac, alt: false, shift: true, mac }
      expect(browserShortcutAction(key)).toBeNull()
      expect(applicationMenuKey(key)).toBe(true)
      expect(isBrowserKey({ ...key, repeat: true })).toBe(true)
    }
  })
})
