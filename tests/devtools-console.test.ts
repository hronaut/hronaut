import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

vi.mock('electron', () => ({}))

const { showDevToolsConsole } = await import('../src/main/browser/devtools/devtools.js')

// Ctrl+Shift+J went to the website, where Chrome opens Developer Tools on its Console.

afterEach(() => { vi.useRealTimers() })

function page(options: { open?: boolean, focused?: boolean, run?: () => Promise<unknown>, gone?: boolean } = {}) {
  let opened = options.open === true
  let destroyed = false
  const devTools = Object.assign(new EventEmitter(), {
    focused: options.focused === true,
    isDestroyed: () => destroyed,
    isFocused: () => devTools.focused,
    executeJavaScript: vi.fn(options.run ?? (async () => undefined)),
    focus: vi.fn(),
    destroy: () => {
      destroyed = true
      devTools.emit('destroyed')
    }
  })
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => opened,
    get devToolsWebContents() { return opened && options.gone !== true ? devTools : null },
    debugger: { isAttached: () => false, detach: () => undefined },
    once: () => undefined,
    removeListener: () => undefined,
    // Opening reports open at once, so a regression fails its assertion instead of waiting for devtools-opened. Like
    // Electron's, the window it opens has the keyboard.
    openDevTools: vi.fn(() => {
      opened = true
      devTools.focused = true
    })
  }
  return { webContents: webContents as unknown as WebContents & { openDevTools: ReturnType<typeof vi.fn> }, devTools }
}

/** A browser showing a page at this address in its one tab, whose input is locked or not. */
function access(url: string, webContents: WebContents, locked = false): never {
  const tab = { id: 'tab', title: 'Page', url, webContents, networkDebuggerEpoch: 0, networkConditionApplication: 'confirmed', networkRoutes: [] }
  return {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    wakeTab: async () => undefined,
    destroyed: false,
    isHumanInteractionLocked: () => locked,
    devToolsOpening: new Set<number>(),
    dialogMonitorAttachPromises: new Map(),
    debuggerQueue: { pending: () => undefined },
    text: (key: string) => key
  } as never
}

const shop = 'https://shop.example/'

describe('Developer Tools on the Console', () => {
  it('opens them for a website and turns them to the Console, leaving them the keyboard they open with', async () => {
    const { webContents, devTools } = page()
    await expect(showDevToolsConsole(access(shop, webContents))).resolves.toBe(true)
    expect(webContents.openDevTools).toHaveBeenCalledOnce()
    expect(devTools.executeJavaScript).toHaveBeenCalledWith("DevToolsAPI.showPanel('console')")
    // Focusing them would bring Hronaut's window forward first, which took the keyboard back from them.
    expect(devTools.focus).not.toHaveBeenCalled()
    expect(devTools.listenerCount('destroyed')).toBe(0)
  })

  it('turns open ones to the Console rather than closing them, as the toggle does, and gives them the keyboard', async () => {
    const { webContents, devTools } = page({ open: true })
    await expect(showDevToolsConsole(access(shop, webContents))).resolves.toBe(true)
    expect(webContents.openDevTools).not.toHaveBeenCalled()
    expect(devTools.executeJavaScript).toHaveBeenCalledWith("DevToolsAPI.showPanel('console')")
    expect(devTools.focus).toHaveBeenCalledOnce()
    const focused = page({ open: true, focused: true })
    await expect(showDevToolsConsole(access(shop, focused.webContents))).resolves.toBe(true)
    expect(focused.devTools.focus).not.toHaveBeenCalled()
  })

  it('opens none for Home or a tab whose page input is locked', async () => {
    const home = page()
    await expect(showDevToolsConsole(access('hronaut://home/', home.webContents))).resolves.toBe(false)
    const locked = page()
    await expect(showDevToolsConsole(access(shop, locked.webContents, true))).resolves.toBe(false)
    expect(home.webContents.openDevTools).not.toHaveBeenCalled()
    expect(locked.webContents.openDevTools).not.toHaveBeenCalled()
  })

  it('reports none when they are gone once open, or their front end refuses the Console', async () => {
    const gone = page({ gone: true })
    await expect(showDevToolsConsole(access(shop, gone.webContents))).resolves.toBe(false)
    expect(gone.devTools.executeJavaScript).not.toHaveBeenCalled()
    const refused = page({ open: true, run: async () => { throw new Error('DevToolsAPI is not defined') } })
    await expect(showDevToolsConsole(access(shop, refused.webContents))).resolves.toBe(false)
    expect(refused.devTools.focus).not.toHaveBeenCalled()
  })

  it('ends when they close, or after a while, if Electron leaves the call waiting', async () => {
    // A call left waiting held the shell's queue for Developer Tools and the page input lock until the shell reloaded.
    const closed = page({ open: true, run: () => new Promise(() => undefined) })
    const closing = showDevToolsConsole(access(shop, closed.webContents))
    await vi.waitFor(() => expect(closed.devTools.executeJavaScript).toHaveBeenCalled())
    closed.devTools.destroy()
    await expect(closing).resolves.toBe(false)
    expect(closed.devTools.focus).not.toHaveBeenCalled()
    expect(closed.devTools.listenerCount('destroyed')).toBe(0)

    vi.useFakeTimers()
    const stuck = page({ open: true, run: () => new Promise(() => undefined) })
    const waiting = showDevToolsConsole(access(shop, stuck.webContents))
    await vi.advanceTimersByTimeAsync(0)
    expect(stuck.devTools.executeJavaScript).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(stuck.devTools.listenerCount('destroyed')).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(waiting).resolves.toBe(false)
    expect(stuck.devTools.listenerCount('destroyed')).toBe(0)
    expect(stuck.devTools.focus).not.toHaveBeenCalled()
  })
})
