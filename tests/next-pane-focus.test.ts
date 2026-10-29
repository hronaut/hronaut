import { describe, expect, it, vi } from 'vitest'

// F6 and Shift+F6 go to the next pane, as in Chrome: from a page to the address bar, and from Hronaut's window back
// to the page. From Home, which has no address bar, the address bar's keys leave Home for a website tab, so F6 there
// goes to Hronaut's window instead; and F6 in a panel in its own window, which has no page beside it, does nothing.

vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, powerMonitor: { on: () => undefined }, Menu: {} }))

const { Browser } = await import('../src/main/browser/browser.js')
const { createBrowserShortcutRouting } = await import('../src/main/browser-shortcut-routing.js')

function routing(home: boolean) {
  const shell = { isDestroyed: () => false, focus: vi.fn(), send: vi.fn() }
  const tabs = { isHomeTab: () => home, shownTabIsHome: () => home, listMcpTabGroups: () => [], exitPageFullscreen: vi.fn() }
  const { runPageNextPane } = createBrowserShortcutRouting({
    takeOvers: { available: () => undefined, takeOverFromPage: vi.fn() },
    tabs: () => tabs,
    agentPresenceSnapshot: () => ({ workspaces: {} }) as never,
    mainWindowRefs: { window: { webContents: shell } as never }
  })
  return { shell, runPageNextPane }
}

describe('F6 from a page', () => {
  it('goes to the address bar from a website', () => {
    const { shell, runPageNextPane } = routing(false)
    runPageNextPane()
    expect(shell.focus).toHaveBeenCalledOnce()
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
    const tabs = { isHomeTab: () => false, shownTabIsHome: () => false, listMcpTabGroups: () => [], exitPageFullscreen: vi.fn() }
    const { runPageShortcut } = createBrowserShortcutRouting({
      takeOvers: { available: () => undefined, takeOverFromPage: vi.fn() },
      tabs: () => tabs,
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
    const page = { id: 2, isDestroyed: () => false }
    const tab = { id: 'site', webContents: page }
    const instance = Object.assign(Object.create(Browser.prototype), {
      window: { webContents: shell },
      activeTabId: 'site',
      tabs: new Map([['site', tab]])
    }) as InstanceType<typeof Browser>
    const focus = vi.fn()
    Object.assign(instance, { focusTabOrTrustedChrome: focus })
    return { instance, shell, tab, focus }
  }

  it('gives the keyboard to the page in view when the main window\'s shell asks', () => {
    const { instance, shell, tab, focus } = manager()
    instance.focusActivePage(shell as never)
    expect(focus).toHaveBeenCalledExactlyOnceWith(tab)
  })

  it('does nothing when a panel in its own window asks', () => {
    const { instance, focus } = manager()
    instance.focusActivePage({ id: 3 } as never)
    expect(focus).not.toHaveBeenCalled()
  })
})
