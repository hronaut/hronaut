import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TabInputLockState } from '../src/main/browser/interaction-lock/input-lock-state.js'

// The right-click environment follows the display; these pages stay on one at scale 1.
vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  return { screen: Object.assign(new Emitter(), { getDisplayMatching: () => ({ scaleFactor: 1 }) }) }
})
// Each publication records what the tabs show, so a case can tell whether the interface had the lock before its page did.
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({
  publishChange: (browser: { publish: () => void }) => { browser.publish() },
  browserState: () => ({})
}))

const { setAllHumanInteractionLocked, setTabHumanInteractionLocked } = await import('../src/main/browser/interaction-lock/interaction-lock.js')
const { syncHumanInteractionInputGuard } = await import('../src/main/browser/interaction-lock/human-input-guard.js')
const { sendAuthorizedAgentInputCommand } = await import('../src/main/browser/agent-input-authorization/agent-input-authorization.js')
const { rightClickEnvironment } = await import('../src/main/browser/native-click/right-click-environment.js')
const { BrowserDebuggerQueue } = await import('../src/main/browser/debugger-queue.js')
const { DEFAULT_EMULATION } = await import('../src/main/browser/emulation-state.js')

type Command = { method: string; params?: Record<string, unknown> }

/** A website tab whose debugger records each command and answers the input guard's frame calls. */
function pageTab(id: string, webContentsId: number, humanInteractionLocked = false) {
  const commands: Command[] = []
  const pageDebugger = Object.assign(new EventEmitter(), {
    isAttached: () => true,
    sendCommand: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      commands.push({ method, params })
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: `${id}-main` } } }
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 }
      return {}
    })
  })
  const webContents = Object.assign(new EventEmitter(), {
    id: webContentsId,
    debugger: pageDebugger,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    closeDevTools: vi.fn(),
    getZoomFactor: () => 1,
    mainFrame: { framesInSubtree: [{}] }
  })
  const view = Object.assign(new EventEmitter(), { getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }), getVisible: () => true })
  const tab = {
    id, url: `https://${id}.example/`, webContents, view, humanInteractionLocked, nativeInputEnvironmentGeneration: 0,
    sleeping: false, pageLifecycleState: 'active', emulation: DEFAULT_EMULATION, emulationApplication: 'confirmed',
    inputLock: undefined as TabInputLockState | undefined
  }
  /** The barrier values the page was given, in order. */
  const barriers = () => commands.filter(command => command.method === 'Input.setIgnoreInputEvents').map(command => command.params?.ignore)
  return { tab, webContents, commands, barriers }
}

/**
 * A browser of two shown website tabs, with the real debugger queue, and with the person's lock as the browser
 * computes it. `holdPage` holds a page's queue, as a long agent command does, until its release.
 */
function twoTabs(options: { firstLocked?: boolean } = {}) {
  const first = pageTab('first', 1, options.firstLocked)
  const second = pageTab('second', 2)
  const window = Object.assign(new EventEmitter(), {
    isVisible: () => true, isMinimized: () => false, getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    contentView: { children: [first.tab.view, second.tab.view] }
  })
  const published: Array<Record<string, boolean>> = []
  const browser = {
    destroyed: false, window, activeTabId: first.tab.id, splitView: null, browserContentOccluded: false,
    tabSelectionGeneration: 0, splitViewGeneration: 0,
    tabs: new Map([[first.tab.id, first.tab], [second.tab.id, second.tab]]),
    webContentsToTab: new Map([[first.webContents.id, first.tab.id], [second.webContents.id, second.tab.id]]),
    mcpTabGroups: new Map(), allHumanInteractionLocked: false, globallyUnlockedTabIds: new Set<string>(),
    interactionLockTail: Promise.resolve(), globalInputLockChanges: 0,
    debuggerQueue: new BrowserDebuggerQueue(), dialogMonitorAttachPromises: new Map(), devToolsOpening: new Set(),
    screenshotAreaSessions: new Map(), elementPickerSessions: new Map(),
    authorizedAgentMouseInput: new Map(), authorizedAgentKeyboardInput: new Map(),
    layout: vi.fn(),
    isHumanInteractionLocked(tab: { id: string; humanInteractionLocked: boolean }) {
      return !this.globallyUnlockedTabIds.has(tab.id) && (this.allHumanInteractionLocked || tab.humanInteractionLocked)
    },
    publish() {
      published.push(Object.fromEntries([...this.tabs.values()].map(tab => [tab.id, this.isHumanInteractionLocked(tab)])))
    }
  }
  const holdPage = (page: { webContents: { id: number } }, work: () => Promise<void> = async () => undefined) => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const done = browser.debuggerQueue.run(page.webContents.id, async () => { await gate; await work() })
    return { release: async () => { release(); await done } }
  }
  return { browser: browser as never, state: browser, first, second, published, holdPage }
}

/** Whether a promise has settled, after the turns already queued have run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false
  void promise.then(() => { done = true }, () => { done = true })
  await vi.advanceTimersByTimeAsync(0)
  return done
}

/** Lets the turns already queued run, with real timers. */
const turns = (): Promise<void> => new Promise(resolve => { setImmediate(resolve) })

afterEach(() => {
  vi.useRealTimers()
})

describe('an input lock change while the page is busy', () => {
  // The change waited two seconds for the page's queue to empty, then failed with "A page is busy" and changed nothing.
  it('waits for the page however long it is busy and applies once it frees, showing the lock at once', async () => {
    vi.useFakeTimers()
    const { browser, state, first, published, holdPage } = twoTabs()
    const busy = holdPage(first)

    const locking = setTabHumanInteractionLocked(browser, first.tab.id, true)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await settled(locking)).toBe(false)
    expect(published).toEqual([{ first: true, second: false }])
    expect(first.barriers()).toEqual([])
    expect(first.tab.inputLock).toMatchObject({ pendingChanges: 1 })

    await busy.release()
    await expect(locking).resolves.toEqual({})
    expect(first.barriers()).toEqual([true])
    expect(first.tab.inputLock).toEqual({ pendingChanges: 0, nativeBarrier: true })
    expect(state.isHumanInteractionLocked(first.tab)).toBe(true)
  })

  it('locks every tab at once, the idle page right away and the busy one in its turn', async () => {
    vi.useFakeTimers()
    const { browser, state, first, second, published, holdPage } = twoTabs()
    const busy = holdPage(first)

    const locking = setAllHumanInteractionLocked(browser, true)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await settled(locking)).toBe(false)
    expect(published).toEqual([{ first: true, second: true }])
    expect(second.barriers()).toEqual([true])
    expect(first.barriers()).toEqual([])
    expect(state.globalInputLockChanges).toBe(1)

    await busy.release()
    await expect(locking).resolves.toEqual({})
    expect(first.barriers()).toEqual([true])
    expect(state.globalInputLockChanges).toBe(0)
  })
})

describe("an agent's input while a lock change waits for the page", () => {
  const release = { type: 'mouseReleased', x: 10, y: 20, button: 'right', buttons: 0, clickCount: 1 }

  // The policy already reads unlocked, so lifting by it left the barrier on and Chromium dropped the agent's input.
  it('lifts the barrier the page still has during a pending unlock, and puts it back', async () => {
    const { browser, state, first, holdPage } = twoTabs({ firstLocked: true })
    await syncHumanInteractionInputGuard(browser, first.tab as never)
    expect(first.barriers()).toEqual([true])
    let agentCommands: Command[] = []
    let lockedForAgent: boolean | undefined
    const busy = holdPage(first, async () => {
      lockedForAgent = state.isHumanInteractionLocked(first.tab)
      const before = first.commands.length
      await sendAuthorizedAgentInputCommand(browser, first.webContents as never, 'Input.dispatchMouseEvent', release)
      agentCommands = first.commands.slice(before)
    })

    const unlocking = setTabHumanInteractionLocked(browser, first.tab.id, false)
    await turns()
    await busy.release()

    expect(lockedForAgent).toBe(false)
    expect(agentCommands).toEqual([
      { method: 'Input.setIgnoreInputEvents', params: { ignore: false } },
      { method: 'Input.dispatchMouseEvent', params: release },
      { method: 'Input.setIgnoreInputEvents', params: { ignore: true } }
    ])
    await unlocking
    expect(first.barriers()).toEqual([true, false, true, false])
    expect(first.tab.inputLock?.nativeBarrier).toBe(false)
  })

  it('leaves the barrier alone during a pending lock, which has not put it on yet', async () => {
    const { browser, first, holdPage } = twoTabs()
    await syncHumanInteractionInputGuard(browser, first.tab as never)
    let agentCommands: Command[] = []
    const busy = holdPage(first, async () => {
      const before = first.commands.length
      await sendAuthorizedAgentInputCommand(browser, first.webContents as never, 'Input.dispatchMouseEvent', release)
      agentCommands = first.commands.slice(before)
    })

    const locking = setTabHumanInteractionLocked(browser, first.tab.id, true)
    await turns()
    await busy.release()
    await locking

    expect(agentCommands).toEqual([{ method: 'Input.dispatchMouseEvent', params: release }])
    expect(first.barriers()).toEqual([false, true])
  })
})

describe('agent tools on another tab while a lock change waits', () => {
  // One counter for every change refused native input on every page while any one page kept a change waiting.
  it('admits a right-click on a tab whose own lock is settled, and refuses it on the tab whose change waits', async () => {
    const { browser, state, first, second, holdPage } = twoTabs({ firstLocked: true })
    await syncHumanInteractionInputGuard(browser, first.tab as never)
    const busy = holdPage(second)
    const lockingOther = setTabHumanInteractionLocked(browser, second.tab.id, true)
    await turns()

    const admission = rightClickEnvironment(browser, first.tab as never)
    try {
      expect(() => admission.validate()).not.toThrow()
    } finally { admission.dispose() }

    state.activeTabId = second.tab.id
    const waitingTab = rightClickEnvironment(browser, second.tab as never)
    try {
      expect(() => waitingTab.validate()).toThrow('Right-click environment changed')
    } finally { waitingTab.dispose() }

    await busy.release()
    await lockingOther
  })

  it('refuses it on every tab while a change for every tab waits', async () => {
    const { browser, first, second, holdPage } = twoTabs({ firstLocked: true })
    await syncHumanInteractionInputGuard(browser, first.tab as never)
    const busy = holdPage(second)
    const locking = setAllHumanInteractionLocked(browser, true)
    await turns()

    const admission = rightClickEnvironment(browser, first.tab as never)
    try {
      expect(() => admission.validate()).toThrow('Right-click environment changed')
    } finally { admission.dispose() }

    await busy.release()
    await locking
  })
})
