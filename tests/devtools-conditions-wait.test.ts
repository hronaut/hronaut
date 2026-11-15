import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

vi.mock('electron', () => ({}))

const { openDevTools } = await import('../src/main/browser/devtools/devtools.js')
type DevToolsBrowser = Parameters<typeof openDevTools>[0]
type DevToolsTab = Parameters<typeof openDevTools>[1]

/** A page whose Developer Tools report open as soon as they are asked to open. */
function pageWebContents(): WebContents & { openDevTools: ReturnType<typeof vi.fn> } {
  let opened = false
  return {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => opened,
    debugger: { isAttached: () => false, detach: () => undefined },
    once: () => undefined,
    removeListener: () => undefined,
    openDevTools: vi.fn(() => { opened = true })
  } as unknown as WebContents & { openDevTools: ReturnType<typeof vi.fn> }
}

/** A tab whose request conditions are still being applied, and a browser whose page queue `queued` reports. */
function pendingPage(queued: () => Promise<void> | undefined = () => undefined) {
  const webContents = pageWebContents()
  const tab = { id: 'tab', title: 'Page', url: 'https://example.com/', webContents, networkDebuggerEpoch: 0, networkConditionApplication: 'pending', networkRoutes: [], locked: false }
  const browser = {
    isHumanInteractionLocked: (locked: { locked: boolean }) => locked.locked,
    tabs: new Map([[tab.id, tab]]),
    destroyed: false,
    devToolsOpening: new Set<number>(),
    dialogMonitorAttachPromises: { get: () => undefined },
    debuggerQueue: { pending: queued },
    text: (key: string) => key
  }
  return { tab, webContents, browser: browser as unknown as DevToolsBrowser, devToolsTab: tab as unknown as DevToolsTab }
}

describe('opening Developer Tools while request conditions apply', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('waits for the conditions queued on the page to apply, then opens, instead of refusing', async () => {
    let apply!: () => void
    const application = new Promise<void>(resolve => { apply = resolve })
    const page = pendingPage(() => (page.tab.networkConditionApplication === 'pending' ? application : undefined))
    let opened = false
    const opening = openDevTools(page.browser, page.devToolsTab).then(() => { opened = true })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(opened).toBe(false)
    expect(page.webContents.openDevTools).not.toHaveBeenCalled()
    page.tab.networkConditionApplication = 'confirmed'
    apply()
    await opening
    expect(page.webContents.openDevTools).toHaveBeenCalledOnce()
  })

  it('waits for a used-up rule refresh that runs once no command of the page is queued', async () => {
    vi.useFakeTimers()
    const page = pendingPage()
    const opening = openDevTools(page.browser, page.devToolsTab)
    await vi.advanceTimersByTimeAsync(400)
    expect(page.webContents.openDevTools).not.toHaveBeenCalled()
    page.tab.networkConditionApplication = 'confirmed'
    await vi.advanceTimersByTimeAsync(60)
    await opening
    expect(page.webContents.openDevTools).toHaveBeenCalledOnce()
  })

  it('refuses when the conditions stay pending for fifteen seconds', async () => {
    vi.useFakeTimers()
    const page = pendingPage()
    const opening = openDevTools(page.browser, page.devToolsTab)
    const refused = expect(opening).rejects.toThrow('Request-condition application is pending')
    await vi.advanceTimersByTimeAsync(15_100)
    await refused
    expect(page.webContents.openDevTools).not.toHaveBeenCalled()
  })

  it('refuses after fifteen seconds also while a command queued on the page runs on', async () => {
    vi.useFakeTimers()
    // An agent's long command holds the page's queue, and the conditions stay pending behind it.
    const page = pendingPage(() => new Promise<void>(() => undefined))
    const opening = openDevTools(page.browser, page.devToolsTab)
    const refused = expect(opening).rejects.toThrow('Request-condition application is pending')
    await vi.advanceTimersByTimeAsync(15_100)
    await refused
    expect(page.webContents.openDevTools).not.toHaveBeenCalled()
  })

  it('stops waiting and leaves them closed when the tab is locked meanwhile', async () => {
    vi.useFakeTimers()
    const page = pendingPage()
    const opening = openDevTools(page.browser, page.devToolsTab)
    await vi.advanceTimersByTimeAsync(200)
    page.tab.locked = true
    await vi.advanceTimersByTimeAsync(60)
    await opening
    page.tab.networkConditionApplication = 'confirmed'
    await vi.advanceTimersByTimeAsync(60)
    expect(page.webContents.openDevTools).not.toHaveBeenCalled()
  })

  it('refuses at once when the conditions are unknown, as before', async () => {
    const page = pendingPage()
    page.tab.networkConditionApplication = 'unknown'
    await expect(openDevTools(page.browser, page.devToolsTab)).rejects.toThrow()
    expect(page.webContents.openDevTools).not.toHaveBeenCalled()
  })
})
