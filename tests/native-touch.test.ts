import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentTouchAccess, AgentTouchTab } from '../src/main/browser/agent-touch/agent-touch-access.js'
import { nativeTouchInput, NativeTouchOutcomeUnknownError, touch, type NativeTouchProgress } from '../src/main/browser/agent-touch/agent-touch.js'
import { McpCapabilityAuthorizationError } from '../src/main/mcp/capability-profile-store.js'
import { nativeTouchUnknownResult, touchSettlement } from '../src/main/mcp/tools/browser-touch/touch-settlement.js'

type Command = { method: string; params?: Record<string, unknown> }
type TouchType = 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel'

/**
 * A touch-emulated page in an unlocked, visible tab. Its debugger records commands and keeps Chromium's record of
 * the finger: a start or move puts it down, and taking an end or cancel lifts it before the page acknowledges.
 */
function touchPage(options: {
  onTouch?: (command: Command, page: ReturnType<typeof touchPage>) => void
  /** Events Chromium takes but the page never acknowledges. */
  unacknowledged?: (type: TouchType) => boolean
  /** A rejection of the cancel before Chromium takes it. */
  cancelRejection?: Error
} = {}) {
  const commands: Command[] = []
  const debuggerEvents = new EventEmitter()
  let held = false
  const webContents = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    getZoomFactor: () => 1,
    mainFrame: { framesInSubtree: [{}] },
    debugger: Object.assign(debuggerEvents, {
      sendCommand: vi.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 390, clientHeight: 600, scale: 1, offsetX: 0, offsetY: 0 } }
        commands.push({ method, params })
        const type = params?.type as TouchType
        if (type === 'touchCancel' && options.cancelRejection) throw options.cancelRejection
        if (type !== 'touchStart' && !held) throw new Error('Must send a TouchStart first to start a new touch.')
        held = type === 'touchStart' || type === 'touchMove'
        options.onTouch?.({ method, params }, page)
        if (options.unacknowledged?.(type)) return new Promise(() => undefined)
        return {}
      })
    })
  })
  const view = Object.assign(new EventEmitter(), { getBounds: () => ({ x: 0, y: 0, width: 800, height: 700 }), getVisible: () => true })
  const tab: AgentTouchTab = {
    id: 'tab-1',
    webContents: webContents as never,
    view: view as never,
    nativeInputEnvironmentGeneration: 0,
    sleeping: false,
    pageLifecycleState: 'active',
    emulation: { viewport: { width: 390, height: 600, deviceScaleFactor: 2, mobile: true, touch: true, orientation: 'portrait' } } as never,
    emulationApplication: 'confirmed'
  }
  const window = Object.assign(new EventEmitter(), { isVisible: () => true, isMinimized: () => false, contentView: { children: [view] } })
  let locked = false
  let lockChanges = 0
  let authorityCurrent = true
  const unconfirmed = new WeakSet<object>()
  const access: AgentTouchAccess<AgentTouchTab> = {
    getTab: () => tab,
    tabSelectionGeneration: () => 0,
    splitViewGeneration: () => 0,
    splitView: () => null,
    window: () => window as never,
    activeTabId: () => tab.id,
    browserContentOccluded: () => false,
    nativeInputLockMutations: () => lockChanges,
    isHumanInteractionLocked: () => locked,
    screenshotAreaSessions: () => new Map(),
    elementPickerSessions: () => new Map(),
    devToolsOpening: () => new Set(),
    nativeInputAuthority: (_tab, validateInput) => ({
      validate: () => {
        // The real authority also fails once the page navigated, within the document too.
        if (!authorityCurrent) throw new Error('Native input authority changed')
        validateInput?.(() => undefined)
      },
      dispose: () => undefined
    }),
    withAgentInput: (_webContents, operation) => operation(),
    withDebugger: (_webContents, operation) => operation(),
    unconfirmedTouchContacts: () => unconfirmed as never
  }
  const page = {
    access, tab, view, window, webContents, debuggerEvents, commands,
    lock: () => { locked = true },
    beginLockChange: () => { lockChanges += 1 },
    revokeAuthority: () => { authorityCurrent = false },
    restoreAuthority: () => { authorityCurrent = true },
    blocked: () => unconfirmed.has(webContents)
  }
  return page
}

const types = (commands: Command[]): unknown[] => commands.map(command => command.params?.type)
const tap = { tabId: 'tab-1', gesture: 'tap', x: 20, y: 20 } as const
const swipe = (durationMs: number) => ({ tabId: 'tab-1', gesture: 'swipe', x: 10, y: 10, endX: 200, endY: 10, durationMs }) as const
/** Reacts to the page taking its nth touchMove. */
const onMove = (n: number, react: (page: ReturnType<typeof touchPage>) => void) => (command: Command, page: ReturnType<typeof touchPage>): void => {
  if (command.params?.type === 'touchMove' && page.commands.filter(sent => sent.params?.type === 'touchMove').length === n) react(page)
}

afterEach(() => { vi.useRealTimers() })

describe('browser_touch input', () => {
  it('accepts a tap at a point and a swipe to another point', () => {
    expect(nativeTouchInput.safeParse({ tabId: 't', gesture: 'tap', x: 0, y: 16384 }).success).toBe(true)
    expect(nativeTouchInput.safeParse({ tabId: 't', gesture: 'swipe', x: 10, y: 10, endX: 10, endY: 200 }).success).toBe(true)
    expect(nativeTouchInput.safeParse({ tabId: 't', gesture: 'swipe', x: 10, y: 10, endX: 300, endY: 10, durationMs: 2000 }).success).toBe(true)
  })

  it.each([
    { gesture: 'tap', x: 10, y: 10, endX: 20, endY: 20 },
    { gesture: 'tap', x: 10, y: 10, durationMs: 100 },
    { gesture: 'swipe', x: 10, y: 10 },
    { gesture: 'swipe', x: 10, y: 10, endX: 20 },
    { gesture: 'swipe', x: 10, y: 10, endX: 10, endY: 10 },
    { gesture: 'swipe', x: 10, y: 10, endX: 20, endY: 20, durationMs: 49 },
    { gesture: 'swipe', x: 10, y: 10, endX: 20, endY: 20, durationMs: 2001 },
    { gesture: 'swipe', x: 10, y: 10, endX: 20, endY: 20, durationMs: 100.5 },
    { gesture: 'pinch', x: 10, y: 10 },
    { gesture: 'tap', x: -1, y: 10 },
    { gesture: 'tap', x: 10, y: Number.NaN },
    { gesture: 'tap', x: 16385, y: 10 },
    { gesture: 'tap', x: 10, y: 10, modifiers: ['Shift'] }
  ])('rejects %j', input => {
    expect(nativeTouchInput.safeParse({ tabId: 't', ...input }).success).toBe(false)
  })
})

describe('touch gestures', () => {
  it('taps with one touchStart and one touchEnd at the point and leaves no listeners behind', async () => {
    const page = touchPage()
    const progress: NativeTouchProgress[] = []
    const result = await touch(page.access, { tabId: 'tab-1', gesture: 'tap', x: 100.5, y: 120 }, check => check(), next => progress.push(next))
    expect(page.commands).toEqual([
      { method: 'Input.dispatchTouchEvent', params: { type: 'touchStart', touchPoints: [{ x: 100.5, y: 120 }], modifiers: 0 } },
      { method: 'Input.dispatchTouchEvent', params: { type: 'touchEnd', touchPoints: [], modifiers: 0 } }
    ])
    expect(result).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED', gesture: 'tap', x: 100.5, y: 120, contact: 'ENDED' })
    expect(progress.at(-1)).toMatchObject({ startAttempted: true, endAcknowledged: true, cancelAttempted: false })
    for (const emitter of [page.webContents, page.view, page.window, page.debuggerEvents]) {
      expect(emitter.eventNames().filter(name => emitter.listenerCount(name) > 0)).toEqual([])
    }
  })

  it('swipes in ten even moves that end at the end point', async () => {
    const page = touchPage()
    const result = await touch(page.access, { tabId: 'tab-1', gesture: 'swipe', x: 300, y: 100, endX: 100, endY: 300, durationMs: 50 }, check => check(), () => undefined)
    expect(types(page.commands)).toEqual(['touchStart', ...Array(10).fill('touchMove'), 'touchEnd'])
    expect(page.commands[1]!.params!.touchPoints).toEqual([{ x: 280, y: 120 }])
    expect(page.commands[10]!.params!.touchPoints).toEqual([{ x: 100, y: 300 }])
    expect(result).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED', endX: 100, endY: 300, durationMs: 50, moves: 10 })
  })

  it('sends nothing without touch emulation, on a locked page, during a lock change, or outside the viewport', async () => {
    const noEmulation = touchPage()
    noEmulation.tab.emulation = {} as never
    await expect(touch(noEmulation.access, tap, check => check(), () => undefined)).rejects.toThrow('touch emulation')
    const locked = touchPage()
    locked.lock()
    await expect(touch(locked.access, tap, check => check(), () => undefined)).rejects.toThrow('requires an unlocked page')
    const lockChanging = touchPage()
    lockChanging.beginLockChange()
    await expect(touch(lockChanging.access, tap, check => check(), () => undefined)).rejects.toThrow('lock is changing')
    const outside = touchPage()
    await expect(touch(outside.access, { tabId: 'tab-1', gesture: 'swipe', x: 10, y: 10, endX: 390, endY: 10 }, check => check(), () => undefined)).rejects.toThrow('inside the visible CSS viewport')
    expect([...noEmulation.commands, ...locked.commands, ...lockChanging.commands, ...outside.commands]).toEqual([])
  })

  it('cancels the contact when a change stops the swipe, and a fresh gesture then works', async () => {
    const page = touchPage({ onTouch: onMove(3, current => { current.tab.nativeInputEnvironmentGeneration += 1 }) })
    const progress: NativeTouchProgress[] = []
    await expect(touch(page.access, swipe(200), check => check(), next => progress.push(next))).rejects.toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchMove', 'touchMove', 'touchMove', 'touchCancel'])
    expect(progress.at(-1)).toMatchObject({ movesAcknowledged: 3, endAcknowledged: false, cancelAcknowledged: true })
    expect(nativeTouchUnknownResult(progress.at(-1)!).structuredContent).toMatchObject({ contact: 'CANCELLED', moves: 3 })
    page.tab.nativeInputEnvironmentGeneration = 0
    await expect(touch(page.access, tap, check => check(), () => undefined)).resolves.toMatchObject({ contact: 'ENDED' })
  })

  it('checks again before the end, so a change during the last move cancels instead of ending', async () => {
    const page = touchPage({ onTouch: onMove(10, current => { current.tab.nativeInputEnvironmentGeneration += 1 }) })
    await expect(touch(page.access, swipe(50), check => check(), () => undefined)).rejects.toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', ...Array(10).fill('touchMove'), 'touchCancel'])
  })

  it('checks the environment while a swipe waits between moves', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const page = touchPage()
    const stopped = touch(page.access, swipe(2000), check => check(), () => undefined).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(40)
    expect(types(page.commands)).toEqual(['touchStart'])
    page.view.emit('bounds-changed')
    // The first move is due at 200 ms; the change is noticed well before it.
    await vi.advanceTimersByTimeAsync(40)
    expect(types(page.commands)).toEqual(['touchStart', 'touchCancel'])
    expect(await stopped).toBeInstanceOf(NativeTouchOutcomeUnknownError)
  })

  it('stops a swipe and cancels its contact when the page navigates within the document', async () => {
    const page = touchPage({ onTouch: onMove(2, current => {
      current.revokeAuthority()
      current.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    }) })
    const progress: NativeTouchProgress[] = []
    await expect(touch(page.access, swipe(200), check => check(), next => progress.push(next))).rejects.toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchMove', 'touchMove', 'touchCancel'])
    expect(nativeTouchUnknownResult(progress.at(-1)!).structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', contact: 'CANCELLED', moves: 2, retrySafe: false })
  })

  it('cancels the contact after a navigation to another document starts, so the tab keeps working', async () => {
    const page = touchPage({ onTouch: onMove(2, current => {
      current.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    }) })
    await expect(touch(page.access, swipe(200), check => check(), () => undefined)).rejects.toThrow(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchMove', 'touchMove', 'touchCancel'])
    expect(page.blocked()).toBe(false)
    await expect(touch(page.access, tap, check => check(), () => undefined)).resolves.toMatchObject({ contact: 'ENDED' })
  })

  it('cancels the contact when the person locks the page mid-swipe', async () => {
    const page = touchPage({ onTouch: onMove(1, current => { current.lock() }) })
    const progress: NativeTouchProgress[] = []
    await expect(touch(page.access, swipe(50), check => check(), next => progress.push(next))).rejects.toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchMove', 'touchCancel'])
    expect(progress.at(-1)).toMatchObject({ cancelAcknowledged: true })
    expect(page.blocked()).toBe(false)
  })

  it('cancels the contact when a lock changes on any tab mid-swipe', async () => {
    const page = touchPage({ onTouch: onMove(1, current => { current.beginLockChange() }) })
    await expect(touch(page.access, swipe(50), check => check(), () => undefined)).rejects.toThrow(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchMove', 'touchCancel'])
    expect(page.blocked()).toBe(false)
  })

  it('treats an end the page never acknowledges as cleared once Chromium reports no contact', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const page = touchPage({ unacknowledged: type => type === 'touchEnd' })
    const progress: NativeTouchProgress[] = []
    const stopped = touch(page.access, tap, check => check(), next => progress.push(next)).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(types(page.commands)).toEqual(['touchStart', 'touchEnd'])
    await vi.advanceTimersByTimeAsync(1)
    expect(await stopped).toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchEnd', 'touchCancel'])
    expect(progress.at(-1)).toMatchObject({ endAcknowledged: false, cancelAttempted: true, cancelAcknowledged: false, contactCleared: true })
    expect(nativeTouchUnknownResult(progress.at(-1)!).structuredContent).toMatchObject({ contact: 'CLEARED' })
    expect(page.blocked()).toBe(false)
  })

  it('treats a cancel Chromium took but the page never acknowledged as cleared', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const page = touchPage({
      onTouch: onMove(1, current => { current.tab.nativeInputEnvironmentGeneration += 1 }),
      unacknowledged: type => type === 'touchCancel'
    })
    const progress: NativeTouchProgress[] = []
    const stopped = touch(page.access, swipe(50), check => check(), next => progress.push(next)).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(5_100)
    expect(await stopped).toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchMove', 'touchCancel'])
    expect(progress.at(-1)).toMatchObject({ cancelAcknowledged: false, contactCleared: true })
    expect(page.blocked()).toBe(false)
  })

  it('refuses later gestures until the debugger resets when the cancel is rejected', async () => {
    const page = touchPage({
      onTouch: onMove(1, current => { current.tab.nativeInputEnvironmentGeneration += 1 }),
      cancelRejection: new Error('Internal error')
    })
    const progress: NativeTouchProgress[] = []
    await expect(touch(page.access, swipe(50), check => check(), next => progress.push(next))).rejects.toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(nativeTouchUnknownResult(progress.at(-1)!).structuredContent).toMatchObject({ contact: 'UNCONFIRMED', nextAction: expect.stringContaining('Close this tab') })
    page.tab.nativeInputEnvironmentGeneration = 0
    await expect(touch(page.access, tap, check => check(), () => undefined)).rejects.toThrow('close this tab')
    expect(types(page.commands)).toEqual(['touchStart', 'touchMove', 'touchCancel'])
    // Detaching the debugger clears Chromium's record of the contact.
    page.debuggerEvents.emit('detach')
    expect(page.debuggerEvents.listenerCount('detach')).toBe(0)
    await expect(touch(page.access, tap, check => check(), () => undefined)).resolves.toMatchObject({ contact: 'ENDED' })
  })

  it('sends no cancel once the debugger detached, which already cleared the contact', async () => {
    const page = touchPage({ onTouch: onMove(2, current => { current.debuggerEvents.emit('detach') }) })
    const progress: NativeTouchProgress[] = []
    await expect(touch(page.access, swipe(200), check => check(), next => progress.push(next))).rejects.toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchMove', 'touchMove'])
    expect(progress.at(-1)).toMatchObject({ cancelAttempted: false, contactCleared: true })
    expect(nativeTouchUnknownResult(progress.at(-1)!).structuredContent).toMatchObject({ contact: 'CLEARED', nextAction: expect.not.stringContaining('Close this tab') })
    expect(page.blocked()).toBe(false)
  })

  it('reports an unknown outcome when the call loses its authority after the end', async () => {
    const page = touchPage({ onTouch: command => { if (command.params?.type === 'touchEnd') page.revokeAuthority() } })
    const progress: NativeTouchProgress[] = []
    await expect(touch(page.access, tap, check => check(), next => progress.push(next))).rejects.toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchEnd'])
    expect(nativeTouchUnknownResult(progress.at(-1)!).structuredContent).toMatchObject({ contact: 'ENDED' })
  })

  it('stops between moves when the call is cancelled', async () => {
    const abort = new AbortController()
    const page = touchPage({ onTouch: command => { if (command.params?.type === 'touchStart') abort.abort() } })
    await expect(touch(page.access, swipe(200), check => check(), () => undefined, abort.signal))
      .rejects.toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchCancel'])
  })
})

describe('touch settlement', () => {
  const failure = { isError: true, content: [{ type: 'text' as const, text: 'Touch requires touch emulation; turn it on with browser_emulate viewport.touch first' }] }
  const success = { content: [{ type: 'text' as const, text: '{}' }] }
  const activity = { readOnly: false, dispatched: true, invalidatedOutcome: undefined }
  const started = (settlement: ReturnType<typeof touchSettlement>): void => {
    settlement.beforeDispatch()
    settlement.recordProgress({ startAttempted: true, movesAcknowledged: 4, endAcknowledged: false, cancelAttempted: true, cancelAcknowledged: true, contactCleared: false })
  }
  const call = (rejection?: string) => ({ signal: undefined, requireCurrentTarget: () => undefined, authorityRejection: () => rejection }) as never

  it('reports a failure before the first touch event as not dispatched', () => {
    const settlement = touchSettlement()
    settlement.beforeDispatch()
    settlement.prepare(call('NAVIGATION_CHANGED'))
    expect(() => settlement.recheckAfterDispatch()).not.toThrow()
    expect(settlement.effectsPossible()).toBe(false)
    expect(settlement.publish(failure)?.structuredContent).toMatchObject({
      status: 'NOT_DISPATCHED', reason: 'TOUCH_NOT_DISPATCHED', effects: 'none', detail: expect.stringContaining('touch emulation')
    })
    expect(settlement.settleError(new Error('Touch requires default zoom'))?.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED' })
    expect(settlement.settleDenied(failure, {})?.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED' })
    expect(settlement.classifyActivity(activity, true)).toMatchObject({ dispatched: false })
  })

  it('leaves a call that was never admitted to the shared handling', () => {
    const settlement = touchSettlement()
    expect(settlement.publish(failure)).toBeUndefined()
    expect(settlement.settleError(new Error('no'))).toBeUndefined()
    expect(settlement.classifyActivity(activity, true)).toBe(activity)
  })

  it('reports any failure after the first touch event as an unknown outcome with its progress', () => {
    const settlement = touchSettlement()
    started(settlement)
    expect(settlement.effectsPossible()).toBe(true)
    expect(settlement.publish(failure)?.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false, effects: 'possible', moves: 4, contact: 'CANCELLED' })
    expect(settlement.settleError(new Error('lost'))?.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', contact: 'CANCELLED' })
    const denial = new McpCapabilityAuthorizationError({ reasonCode: 'TOOL_DENIED', firstDenyingRule: 'rule' } as never)
    expect(settlement.settleError(denial)?.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', permission: 'denied' })
    expect(settlement.settleDenied(failure, { permission: 'denied', policyDecision: { reasonCode: 'TOOL_DENIED' } })?.structuredContent)
      .toMatchObject({ status: 'OUTCOME_UNKNOWN', permission: 'denied' })
    expect(settlement.classifyActivity(activity, true)).toMatchObject({ dispatched: true, invalidatedOutcome: 'outcome-unknown' })
  })

  it('publishes a gesture only while the call still holds its target and authority', () => {
    const current = touchSettlement()
    started(current)
    current.prepare(call())
    expect(() => current.recheckAfterDispatch()).not.toThrow()
    expect(current.publish(success)).toBe(success)
    const changed = touchSettlement()
    started(changed)
    changed.prepare(call('NAVIGATION_CHANGED'))
    expect(() => changed.recheckAfterDispatch()).toThrow('authority changed')
    expect(() => changed.publish(success)).toThrow('authority changed')
  })
})
