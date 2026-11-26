import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Lock and Unlock sometimes did nothing: a lock change waited for each page's native guard, which waits behind the
// page's queued debugger work and never ended on a page that stopped answering, or failed while the page's Developer
// Tools were open. Every later change queued behind it, and the buttons stayed disabled.

vi.mock('electron', () => ({}))
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({
  publishChange: () => undefined,
  browserState: (browser: { allHumanInteractionLocked: boolean }) => ({ allHumanInteractionLocked: browser.allHumanInteractionLocked })
}))
vi.mock('../src/main/browser/debugger-lease/debugger-lease.js', () => ({
  withDebugger: (browser: { withDebugger: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.withDebugger(...args)
}))

const { setAllHumanInteractionLocked, setTabHumanInteractionLocked, INPUT_GUARD_WAIT_MS } = await import(
  '../src/main/browser/interaction-lock/interaction-lock.js'
)
const { FRAME_GUARD_WAIT_MS } = await import('../src/main/browser/interaction-lock/human-input-guard.js')
const { LocalizedError } = await import('../src/main/localized-error.js')

type Send = (method: string, params?: unknown) => Promise<unknown>

function fakeBrowser(send: Send, devToolsOpen = false) {
  const webContents = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => devToolsOpen,
    closeDevTools: vi.fn(),
    debugger: { sendCommand: vi.fn(send) }
  })
  const tab = { id: 'tab', url: 'https://example.test/', webContents, humanInteractionLocked: false, nativeInputEnvironmentGeneration: 0 }
  const browser = {
    destroyed: false,
    tabs: new Map([[tab.id, tab]]),
    mcpTabGroups: new Map(),
    globallyUnlockedTabIds: new Set<string>(),
    allHumanInteractionLocked: false,
    globalInputLockChanges: 0,
    interactionLockTail: Promise.resolve(),
    screenshotAreaSessions: new Map(),
    elementPickerSessions: new Map(),
    layout: () => undefined,
    isHumanInteractionLocked(this: { allHumanInteractionLocked: boolean; globallyUnlockedTabIds: Set<string> }, candidate: typeof tab) {
      return !this.globallyUnlockedTabIds.has(candidate.id) && (this.allHumanInteractionLocked || candidate.humanInteractionLocked)
    },
    withDebugger: vi.fn(async (_webContents: unknown, operation: () => Promise<unknown>) => {
      if (devToolsOpen) {
        throw new LocalizedError('appErrors.pageTools.devToolsOpen', undefined, { message: 'Close Developer Tools for this tab before using this MCP action' })
      }
      return operation()
    }),
    setDevToolsOpen(open: boolean) { devToolsOpen = open }
  }
  return { browser, tab, webContents }
}

const answering: Send = async (method) => method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } }
  : method === 'Page.createIsolatedWorld' ? { executionContextId: 1 } : {}

afterEach(() => { vi.useRealTimers() })

describe('input lock queue', () => {
  it('locks and unlocks in the order asked while a page never answers', async () => {
    vi.useFakeTimers()
    // The page's main thread is busy: the isolated world is never created.
    const { browser, webContents } = fakeBrowser(async (method) => method === 'Runtime.evaluate' || method === 'Page.createIsolatedWorld'
      ? new Promise(() => undefined) : answering(method))
    const lock = setAllHumanInteractionLocked(browser as never, true)
    const unlock = setAllHumanInteractionLocked(browser as never, false)
    await vi.advanceTimersByTimeAsync(FRAME_GUARD_WAIT_MS)
    await expect(lock).resolves.toMatchObject({ allHumanInteractionLocked: true })
    await vi.advanceTimersByTimeAsync(FRAME_GUARD_WAIT_MS)
    await expect(unlock).resolves.toMatchObject({ allHumanInteractionLocked: false })
    // The native barrier, which the browser process applies, followed each change.
    const barriers = webContents.debugger.sendCommand.mock.calls.filter(([method]) => method === 'Input.setIgnoreInputEvents')
    expect(barriers.slice(0, 2).map(([, params]) => params)).toEqual([{ ignore: true }, { ignore: false }])
    // The guard the page did not answer is applied again later, from the lock as it is by then.
    expect(barriers.at(-1)?.[1]).toEqual({ ignore: false })
  })

  it('settles a change whose page debugger stays busy, and applies the guard once it frees', async () => {
    vi.useFakeTimers()
    const { browser, webContents } = fakeBrowser(answering)
    let free = (): void => undefined
    const busy = new Promise<void>((resolve) => { free = resolve })
    const run = browser.withDebugger.getMockImplementation()!
    browser.withDebugger.mockImplementationOnce(async (...args) => { await busy; return run(...args) })
    const lock = setTabHumanInteractionLocked(browser as never, 'tab', true)
    await vi.advanceTimersByTimeAsync(INPUT_GUARD_WAIT_MS)
    await expect(lock).resolves.toBeDefined()
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalled()
    // The next change does not wait for the busy page either.
    const unlock = setTabHumanInteractionLocked(browser as never, 'tab', false)
    await vi.advanceTimersByTimeAsync(0)
    await expect(unlock).resolves.toBeDefined()
    free()
    await vi.advanceTimersByTimeAsync(0)
    expect(webContents.debugger.sendCommand).toHaveBeenCalledWith('Input.setIgnoreInputEvents', { ignore: false })
  })

  it('locks and unlocks every tab while one has Developer Tools open, and guards it once they close', async () => {
    const { browser, tab, webContents } = fakeBrowser(answering, true)
    browser.globallyUnlockedTabIds.add(tab.id)
    await expect(setAllHumanInteractionLocked(browser as never, true)).resolves.toMatchObject({ allHumanInteractionLocked: true })
    expect(webContents.closeDevTools).toHaveBeenCalled()
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalled()
    browser.setDevToolsOpen(false)
    webContents.emit('devtools-closed')
    await vi.waitFor(() => expect(webContents.debugger.sendCommand).toHaveBeenCalledWith('Input.setIgnoreInputEvents', { ignore: true }))
    browser.setDevToolsOpen(true)
    await expect(setAllHumanInteractionLocked(browser as never, false)).resolves.toMatchObject({ allHumanInteractionLocked: false })
  })
})
