import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeInputDispatchObserver, NativeKeyHoldProgress } from '../src/main/browser/native-key-hold.js'

type Command = Record<string, unknown>

const page = vi.hoisted(() => ({
  /** The raw key commands that reached the page, in order. */
  sent: [] as Command[],
  /** Runs before a command's raw attempt, as lifting a locked page's input barrier does. */
  beforeAttempt: async (_command: Command): Promise<void> => undefined,
  /** How the page answers each raw command; it acknowledges at once unless a test says otherwise. */
  answer: async (_command: Command): Promise<unknown> => ({})
}))

vi.mock('../src/main/browser/agent-input-scope/agent-input-scope.js', () => ({
  withAgentInput: (_browser: unknown, _page: unknown, operation: () => Promise<unknown>) => operation()
}))
vi.mock('../src/main/browser/debugger-lease/debugger-lease.js', () => ({
  withDebugger: (_browser: unknown, _page: unknown, operation: () => Promise<unknown>) => operation()
}))
vi.mock('../src/main/browser/native-input-authority/native-input-authority.js', () => ({
  nativeInputAuthority: () => ({ validate: () => undefined, dispose: () => undefined })
}))
// As the authorized input path does: checks the call, reports the raw attempt, waits for the page and reports its answer.
vi.mock('../src/main/browser/agent-input-authorization/agent-input-authorization.js', () => ({
  agentInputDebugger: () => undefined,
  sendAuthorizedAgentInputCommand: async (_browser: unknown, _page: unknown, _method: string, command: Command,
    validateInput?: () => void, observer?: NativeInputDispatchObserver) => {
    validateInput?.()
    await page.beforeAttempt(command)
    observer?.rawAttempted(command)
    page.sent.push(command)
    const result = await page.answer(command)
    observer?.rawAcknowledged(command)
    return result
  }
}))

const { playKeySequence } = await import('../src/main/browser/agent-keys/key-sequence.js')
const { holdKey } = await import('../src/main/browser/agent-keys/agent-keys.js')
const { NativeKeyHoldOutcomeUnknownError } = await import('../src/main/browser/native-key-hold.js')
const { guardPageCallsDuringWebsiteDialog } = await import('../src/main/browser/website-dialog-guard.js')

afterEach(() => {
  page.sent = []
  page.beforeAttempt = async () => undefined
  page.answer = async () => ({})
})

/** A browser showing one tab's page, as a sequence needs, with the website dialog guard on the page. */
function shownTab() {
  let destroyed = false
  const pageDebugger = Object.assign(new EventEmitter(), { sendCommand: async () => ({}) })
  const webContents = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => destroyed,
    isDevToolsOpened: () => false,
    mainFrame: { framesInSubtree: [{}] },
    executeJavaScript: async () => undefined,
    executeJavaScriptInIsolatedWorld: async () => undefined
  })
  // Electron throws on reading a destroyed page's debugger.
  Object.defineProperty(webContents, 'debugger', {
    get: () => {
      if (destroyed) throw new Error('Object has been destroyed')
      return pageDebugger
    }
  })
  guardPageCallsDuringWebsiteDialog(webContents as never, () => false)
  const view = Object.assign(new EventEmitter(), { getVisible: () => true })
  const tab = { id: 'tab', webContents, view, sleeping: false, pageLifecycleState: 'active', nativeInputEnvironmentGeneration: 0 }
  const window = Object.assign(new EventEmitter(), { isVisible: () => true, isMinimized: () => false, contentView: { children: [view] } })
  const browser = {
    tabs: new Map([[tab.id, tab]]), activeTabId: tab.id, destroyed: false, window,
    activeNativeKeyHolds: new Set<object>(), unconfirmedNativeKeyHolds: new WeakSet<object>(),
    tabSelectionGeneration: 0, splitViewGeneration: 0, nativeInputLockMutations: 0, splitView: false, browserContentOccluded: false,
    requireEmulationConfirmed: () => undefined,
    screenshotAreaSessions: new Set<number>(), elementPickerSessions: new Set<number>(), devToolsOpening: new Set<number>()
  }
  const progress: NativeKeyHoldProgress[] = []
  return {
    browser, webContents, view, window, progress,
    play: (events: Array<{ atMs: number; type: 'down' | 'up'; key: string }>) =>
      playKeySequence(browser as never, { tabId: tab.id, events }, () => undefined, next => progress.push(next)),
    unconfirmed: () => browser.unconfirmedNativeKeyHolds.has(webContents),
    /** The page's debugger reports an alert, and the guard holds the page from the next turn. */
    dialogReported: () => { pageDebugger.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'alert', message: 'Paused' }) },
    dialogCloses: () => { pageDebugger.emit('message', {}, 'Page.javascriptDialogClosed', { result: true }) },
    destroy: () => {
      destroyed = true
      webContents.emit('destroyed')
    }
  }
}

const keysSent = (): unknown[][] => page.sent.map(command => [command.type, command.code, command.modifiers])

describe('a key sequence on a page', () => {
  // The release was only recomputed on acknowledgements, so after a's release b's failed down left it ACKNOWLEDGED and
  // the page was not blocked for further holds and sequences.
  it('reports the release unconfirmed when a later key fails to go down after an earlier key was released', async () => {
    const tab = shownTab()
    // The page's debugger detaches as b goes down, so neither b's down nor its release are acknowledged.
    page.answer = async command => {
      if (command.code === 'KeyB') throw new Error('Debugger is not attached')
      return {}
    }
    const error = await tab.play([
      { atMs: 0, type: 'down', key: 'a' }, { atMs: 0, type: 'up', key: 'a' },
      { atMs: 0, type: 'down', key: 'b' }, { atMs: 0, type: 'up', key: 'b' }
    ]).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NativeKeyHoldOutcomeUnknownError)
    expect((error as InstanceType<typeof NativeKeyHoldOutcomeUnknownError>).progress)
      .toMatchObject({ downAcknowledged: false, releaseAcknowledged: false })
    expect(tab.progress.at(-1)).toMatchObject({ releaseAcknowledged: false })
    expect(keysSent()).toEqual([['rawKeyDown', 'KeyA', 0], ['keyUp', 'KeyA', 0], ['rawKeyDown', 'KeyB', 0], ['keyUp', 'KeyB', 0]])
    expect(tab.unconfirmed()).toBe(true)
  })

  // Chromium drops input while a dialog shows and acknowledges it at once, so the sequence played on and its key-ups were
  // lost though they counted as released.
  it('stops at a website dialog, sends no key-up while it shows and releases the keys once it closes', async () => {
    const tab = shownTab()
    page.answer = async command => {
      if (command.type === 'rawKeyDown' && command.code === 'ArrowRight') tab.dialogReported()
      return {}
    }
    const error = await tab.play([
      { atMs: 0, type: 'down', key: 'Shift' }, { atMs: 0, type: 'down', key: 'ArrowRight' },
      { atMs: 50, type: 'up', key: 'ArrowRight' }, { atMs: 60, type: 'up', key: 'Shift' }
    ]).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NativeKeyHoldOutcomeUnknownError)
    expect(tab.progress.at(-1)).toMatchObject({ releaseAcknowledged: false })
    expect(keysSent()).toEqual([['rawKeyDown', 'ShiftLeft', 8], ['rawKeyDown', 'ArrowRight', 8]])
    expect(tab.unconfirmed()).toBe(true)

    tab.dialogCloses()
    await vi.waitFor(() => expect(tab.unconfirmed()).toBe(false))
    expect(keysSent().slice(2)).toEqual([['keyUp', 'ArrowRight', 8], ['keyUp', 'ShiftLeft', 0]])
    // Only the dialog guard's own listener is left on the page.
    expect(tab.webContents.listenerCount('destroyed')).toBe(1)
  })

  it('keeps a key down whose key-up the page acknowledged as a dialog opened, and releases it once the dialog closes', async () => {
    const tab = shownTab()
    // A timer of the page's opens the alert as a's key-up arrives, which Chromium then drops and acknowledges.
    let dialogs = 0
    page.answer = async command => {
      if (command.type === 'keyUp' && command.code === 'KeyA' && dialogs++ === 0) tab.dialogReported()
      return {}
    }
    const error = await tab.play([
      { atMs: 0, type: 'down', key: 'a' }, { atMs: 0, type: 'up', key: 'a' },
      { atMs: 30, type: 'down', key: 'b' }, { atMs: 40, type: 'up', key: 'b' }
    ]).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NativeKeyHoldOutcomeUnknownError)
    expect(keysSent()).toEqual([['rawKeyDown', 'KeyA', 0], ['keyUp', 'KeyA', 0]])
    expect(tab.unconfirmed()).toBe(true)

    tab.dialogCloses()
    await vi.waitFor(() => expect(tab.unconfirmed()).toBe(false))
    expect(keysSent().slice(2)).toEqual([['keyUp', 'KeyA', 0]])
  })

  it('leaves the release unconfirmed when the page shows another dialog as its keys are released', async () => {
    const tab = shownTab()
    page.answer = async command => {
      if (command.code === 'KeyA') tab.dialogReported()
      return {}
    }
    await expect(tab.play([{ atMs: 0, type: 'down', key: 'a' }, { atMs: 50, type: 'up', key: 'a' }]))
      .rejects.toBeInstanceOf(NativeKeyHoldOutcomeUnknownError)
    tab.dialogCloses()
    await vi.waitFor(() => expect(keysSent()).toEqual([['rawKeyDown', 'KeyA', 0], ['keyUp', 'KeyA', 0]]))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(tab.unconfirmed()).toBe(true)
    // Each key-up goes once: closing the second dialog sends nothing more.
    tab.dialogCloses()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(keysSent()).toHaveLength(2)
  })

  it('sends nothing more to a tab closed while its dialog showed', async () => {
    const tab = shownTab()
    page.answer = async command => {
      if (command.type === 'rawKeyDown') tab.dialogReported()
      return {}
    }
    await expect(tab.play([{ atMs: 0, type: 'down', key: 'a' }, { atMs: 50, type: 'up', key: 'a' }]))
      .rejects.toBeInstanceOf(NativeKeyHoldOutcomeUnknownError)
    tab.destroy()
    await new Promise(resolve => setImmediate(resolve))
    expect(keysSent()).toEqual([['rawKeyDown', 'KeyA', 0]])
    expect(tab.unconfirmed()).toBe(false)
  })

  // A first event at 500 ms idled 500 ms, and sentAtMs was taken before the input barrier's round trip, so a late send
  // looked on time.
  it('sends the first event at once and reports each send from the first, as its raw command goes out', async () => {
    const tab = shownTab()
    page.beforeAttempt = async command => {
      if (command.type === 'keyUp') await new Promise(resolve => setTimeout(resolve, 40))
    }
    const before = Date.now()
    const result = await tab.play([{ atMs: 500, type: 'down', key: 'a' }, { atMs: 530, type: 'up', key: 'a' }]) as {
      status: string; release: string; startEpochMs: number; sentAtMs: number[]; maxLateMs: number
    }
    expect(Date.now() - before).toBeLessThan(400)
    expect(result.startEpochMs).toBeGreaterThanOrEqual(before)
    expect(result.sentAtMs[0]).toBe(0)
    expect(result.sentAtMs[1]).toBeGreaterThanOrEqual(70)
    expect(result.maxLateMs).toBeGreaterThanOrEqual(40)
    expect(result).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED', release: 'ACKNOWLEDGED' })
  })

  // Reading the destroyed page's debugger threw "Object has been destroyed" in place of the error, and left the window's
  // listeners behind.
  it.each(['sequence', 'hold'] as const)('keeps the %s error and removes its listeners when the tab closes meanwhile', async kind => {
    const tab = shownTab()
    page.answer = async command => {
      if (command.type === 'rawKeyDown') tab.destroy()
      throw new Error('Render frame was disposed before the request completed')
    }
    const call = kind === 'sequence'
      ? tab.play([{ atMs: 0, type: 'down', key: 'a' }, { atMs: 10, type: 'up', key: 'a' }])
      : holdKey(tab.browser as never, { tabId: 'tab', key: 'a', durationMs: 10 }, () => undefined, () => undefined)
    await expect(call).rejects.toBeInstanceOf(NativeKeyHoldOutcomeUnknownError)
    expect(tab.window.listenerCount('hide') + tab.window.listenerCount('minimize') + tab.view.listenerCount('bounds-changed')).toBe(0)
    expect(tab.browser.activeNativeKeyHolds.size).toBe(0)
    expect(tab.unconfirmed()).toBe(false)
  })
})
