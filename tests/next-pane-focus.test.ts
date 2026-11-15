import { describe, expect, it, vi } from 'vitest'
import { focusActivePage } from '../src/main/browser/trusted-chrome-focus/trusted-chrome-focus.js'

// F6 and Shift+F6 go to the next pane, as in Chrome: from a page to the address bar, and from Hronaut's window back
// to the page. From Home, which has no address bar, the address bar's keys leave Home for a website tab, so F6 there
// goes to Hronaut's window instead; and F6 in a panel in its own window, which has no page beside it, does nothing.

vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined }, Menu: {} }))

const { Browser } = await import('../src/main/browser/browser.js')
const { createBrowserShortcutRouting } = await import('../src/main/browser-shortcut-routing.js')

function routing(home: boolean) {
  const shell = { isDestroyed: () => false, focus: vi.fn(), send: vi.fn() }
  const tabs = { activeTabId: 'shown', mcpTabGroups: new Map(), tabs: new Map([['shown', { url: home ? 'hronaut://home/' : 'https://site.example/' }]]) }
  const { runPageNextPane, runPageShortcut } = createBrowserShortcutRouting({
    takeOvers: { available: () => undefined, takeOverFromPage: vi.fn() },
    tabs: () => tabs as never,
    agentPresenceSnapshot: () => ({ workspaces: {} }) as never,
    mainWindowRefs: { window: { webContents: shell } as never }
  })
  return { shell, runPageNextPane, runPageShortcut }
}

describe('F6 from a page', () => {
  it('goes to the address bar from a website', () => {
    const { shell, runPageNextPane } = routing(false)
    runPageNextPane()
    expect(shell.focus).toHaveBeenCalledOnce()
    expect(shell.send).toHaveBeenCalledExactlyOnceWith('browser:shortcut-requested', 'focus-address')
  })

  it('goes to the address bar from a page the person cannot use, which never leaves the key to the menu', () => {
    // The shell runs the key from its own window, back to the page, which only focused Hronaut's window.
    const { shell, runPageShortcut } = routing(false)
    runPageShortcut('focus-next-pane', { tabId: 'shown', workspaceId: undefined })
    expect(shell.send).toHaveBeenCalledExactlyOnceWith('browser:shortcut-requested', 'focus-address')
  })

  it('goes to Hronaut\'s window from Home, without leaving Home', () => {
    const { shell, runPageNextPane } = routing(true)
    runPageNextPane()
    expect(shell.focus).toHaveBeenCalledOnce()
    expect(shell.send).not.toHaveBeenCalled()
  })
})

describe('Bookmark all tabs from the application menu', () => {
  it('moves the keyboard to Hronaut\'s window first, so the collection\'s name gets it from a page, as Find does', () => {
    const shell = { isDestroyed: () => false, focus: vi.fn(), send: vi.fn() }
    const tabs = { activeTabId: 'shown', mcpTabGroups: new Map(), tabs: new Map([['shown', { url: 'https://site.example/' }]]) }
    const { runPageShortcut } = createBrowserShortcutRouting({
      takeOvers: { available: () => undefined, takeOverFromPage: vi.fn() },
      tabs: () => tabs as never,
      agentPresenceSnapshot: () => ({ workspaces: {} }) as never,
      mainWindowRefs: { window: { webContents: shell } as never }
    })
    // Its View item and its key, which runs there once the page leaves it alone, run it as a page's shortcut.
    runPageShortcut('bookmark-all-tabs')
    expect(shell.focus).toHaveBeenCalledOnce()
    expect(shell.send).toHaveBeenCalledExactlyOnceWith('browser:shortcut-requested', 'bookmark-all-tabs')
    expect(shell.focus.mock.invocationCallOrder[0]).toBeLessThan(shell.send.mock.invocationCallOrder[0]!)
  })
})

describe('F6 from Hronaut\'s window', () => {
  function manager() {
    const shell = { id: 1 }
    const focus = vi.fn()
    const page = { id: 2, isDestroyed: () => false, focus }
    const tab = { id: 'site', url: 'https://site.example/', webContents: page }
    // The window has the focus, and nothing locks the person's input or covers the page.
    const instance = Object.assign(Object.create(Browser.prototype), {
      window: { webContents: shell, isDestroyed: () => false, isFocused: () => true },
      activeTabId: 'site',
      tabs: new Map([['site', tab]]),
      globallyUnlockedTabIds: new Set(),
      allHumanInteractionLocked: false,
      browserContentOccluded: false
    }) as InstanceType<typeof Browser>
    return { instance, shell, focus }
  }

  it('gives the keyboard to the page in view when the main window\'s shell asks', () => {
    const { instance, shell, focus } = manager()
    focusActivePage(instance, shell as never)
    expect(focus).toHaveBeenCalledOnce()
  })

  it('does nothing when a panel in its own window asks', () => {
    const { instance, focus } = manager()
    focusActivePage(instance, { id: 3 } as never)
    expect(focus).not.toHaveBeenCalled()
  })
})
