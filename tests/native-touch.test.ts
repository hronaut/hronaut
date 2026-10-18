import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { AgentTouchAccess, AgentTouchTab } from '../src/main/browser/agent-touch/agent-touch-access.js'
import { nativeTouchInput, NativeTouchOutcomeUnknownError, touch, type NativeTouchProgress } from '../src/main/browser/agent-touch/agent-touch.js'
import { nativeTouchUnknownResult } from '../src/main/mcp/tools/browser-touch/touch-settlement.js'

type Command = { method: string; params?: Record<string, unknown> }

/** A touch-emulated page in an unlocked, visible tab, whose debugger records commands and can change the page mid-gesture. */
function touchPage(onTouch?: (command: Command, page: ReturnType<typeof touchPage>) => void) {
  const commands: Command[] = []
  const debuggerEvents = new EventEmitter()
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
        if (params?.type === 'touchCancel' && !commands.some(command => command.params?.type === 'touchStart')) throw new Error('Must send a TouchStart first to start a new touch.')
        onTouch?.({ method, params }, page)
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
  const unconfirmed = new WeakSet<object>()
  const access: AgentTouchAccess<AgentTouchTab> = {
    getTab: () => tab,
    tabSelectionGeneration: () => 0,
    splitViewGeneration: () => 0,
    splitView: () => null,
    window: () => window as never,
    activeTabId: () => tab.id,
    browserContentOccluded: () => false,
    nativeInputLockMutations: () => 0,
    isHumanInteractionLocked: () => locked,
    screenshotAreaSessions: () => new Map(),
    elementPickerSessions: () => new Map(),
    devToolsOpening: () => new Set(),
    nativeInputAuthority: (_tab, validateInput) => ({ validate: () => validateInput?.(() => undefined), dispose: () => undefined }),
    withAgentInput: (_webContents, operation) => operation(),
    withDebugger: (_webContents, operation) => operation(),
    unconfirmedTouchContacts: () => unconfirmed as never
  }
  const page = { access, tab, webContents, debuggerEvents, commands, lock: () => { locked = true } }
  return page
}

const types = (commands: Command[]): unknown[] => commands.map(command => command.params?.type)

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
  it('taps with one touchStart and one touchEnd at the point', async () => {
    const page = touchPage()
    const progress: NativeTouchProgress[] = []
    const result = await touch(page.access, { tabId: 'tab-1', gesture: 'tap', x: 100.5, y: 120 }, check => check(), next => progress.push(next))
    expect(page.commands).toEqual([
      { method: 'Input.dispatchTouchEvent', params: { type: 'touchStart', touchPoints: [{ x: 100.5, y: 120 }], modifiers: 0 } },
      { method: 'Input.dispatchTouchEvent', params: { type: 'touchEnd', touchPoints: [], modifiers: 0 } }
    ])
    expect(result).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED', gesture: 'tap', x: 100.5, y: 120, contact: 'ENDED' })
    expect(progress.at(-1)).toMatchObject({ startAttempted: true, endAcknowledged: true, cancelAttempted: false })
  })

  it('swipes in ten even moves that end at the end point', async () => {
    const page = touchPage()
    const result = await touch(page.access, { tabId: 'tab-1', gesture: 'swipe', x: 300, y: 100, endX: 100, endY: 300, durationMs: 50 }, check => check(), () => undefined)
    expect(types(page.commands)).toEqual(['touchStart', ...Array(10).fill('touchMove'), 'touchEnd'])
    expect(page.commands[1]!.params!.touchPoints).toEqual([{ x: 280, y: 120 }])
    expect(page.commands[10]!.params!.touchPoints).toEqual([{ x: 100, y: 300 }])
    expect(result).toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED', endX: 100, endY: 300, durationMs: 50, moves: 10 })
  })

  it('sends nothing without touch emulation, on a locked page, or outside the viewport', async () => {
    const noEmulation = touchPage()
    noEmulation.tab.emulation = {} as never
    await expect(touch(noEmulation.access, { tabId: 'tab-1', gesture: 'tap', x: 10, y: 10 }, check => check(), () => undefined)).rejects.toThrow('touch emulation')
    const locked = touchPage()
    locked.lock()
    await expect(touch(locked.access, { tabId: 'tab-1', gesture: 'tap', x: 10, y: 10 }, check => check(), () => undefined)).rejects.toThrow('unlocked')
    const outside = touchPage()
    await expect(touch(outside.access, { tabId: 'tab-1', gesture: 'swipe', x: 10, y: 10, endX: 390, endY: 10 }, check => check(), () => undefined)).rejects.toThrow('inside the visible CSS viewport')
    expect([...noEmulation.commands, ...locked.commands, ...outside.commands]).toEqual([])
  })

  it('cancels the contact in the same page when a change stops the swipe, and a fresh gesture then works', async () => {
    const page = touchPage((command, current) => {
      if (command.params?.type === 'touchMove' && current.commands.filter(sent => sent.params?.type === 'touchMove').length === 3) current.tab.nativeInputEnvironmentGeneration += 1
    })
    const progress: NativeTouchProgress[] = []
    const stopped = touch(page.access, { tabId: 'tab-1', gesture: 'swipe', x: 10, y: 10, endX: 200, endY: 10, durationMs: 200 }, check => check(), next => progress.push(next))
    await expect(stopped).rejects.toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchMove', 'touchMove', 'touchMove', 'touchCancel'])
    expect(progress.at(-1)).toMatchObject({ movesAcknowledged: 3, endAcknowledged: false, cancelAcknowledged: true })
    page.tab.nativeInputEnvironmentGeneration = 0
    await expect(touch(page.access, { tabId: 'tab-1', gesture: 'tap', x: 20, y: 20 }, check => check(), () => undefined)).resolves.toMatchObject({ contact: 'ENDED' })
  })

  it('keeps a swipe going through a same-document navigation', async () => {
    const page = touchPage((command, current) => {
      if (command.params?.type === 'touchMove' && current.commands.filter(sent => sent.params?.type === 'touchMove').length === 2) {
        current.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
      }
    })
    await expect(touch(page.access, { tabId: 'tab-1', gesture: 'swipe', x: 10, y: 10, endX: 200, endY: 10, durationMs: 50 }, check => check(), () => undefined))
      .resolves.toMatchObject({ status: 'DISPATCH_ACKNOWLEDGED' })
  })

  it('sends no end or cancel into a replacement document and refuses later gestures until the debugger is reset', async () => {
    const page = touchPage((command, current) => {
      if (command.params?.type === 'touchMove' && current.commands.filter(sent => sent.params?.type === 'touchMove').length === 2) {
        current.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
      }
    })
    const progress: NativeTouchProgress[] = []
    await expect(touch(page.access, { tabId: 'tab-1', gesture: 'swipe', x: 10, y: 10, endX: 200, endY: 10, durationMs: 200 }, check => check(), next => progress.push(next)))
      .rejects.toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchMove', 'touchMove'])
    expect(progress.at(-1)).toMatchObject({ cancelAttempted: false, cancelAcknowledged: false })
    expect(nativeTouchUnknownResult(progress.at(-1)!).structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', contact: 'UNCONFIRMED', moves: 2, retrySafe: false })
    await expect(touch(page.access, { tabId: 'tab-1', gesture: 'tap', x: 20, y: 20 }, check => check(), () => undefined)).rejects.toThrow('close this tab')
    expect(page.commands).toHaveLength(3)
    // Detaching the debugger clears Chromium's record of the contact.
    page.debuggerEvents.emit('detach')
    await expect(touch(page.access, { tabId: 'tab-1', gesture: 'tap', x: 20, y: 20 }, check => check(), () => undefined)).resolves.toMatchObject({ contact: 'ENDED' })
  })

  it('leaves the contact unconfirmed when the person locks the page mid-swipe', async () => {
    const page = touchPage((command, current) => {
      if (command.params?.type === 'touchMove') current.lock()
    })
    await expect(touch(page.access, { tabId: 'tab-1', gesture: 'swipe', x: 10, y: 10, endX: 200, endY: 10, durationMs: 50 }, check => check(), () => undefined))
      .rejects.toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchMove'])
    expect(page.access.unconfirmedTouchContacts().has(page.webContents as never)).toBe(true)
  })

  it('stops between moves when the call is cancelled', async () => {
    const abort = new AbortController()
    const page = touchPage(command => { if (command.params?.type === 'touchStart') abort.abort() })
    await expect(touch(page.access, { tabId: 'tab-1', gesture: 'swipe', x: 10, y: 10, endX: 200, endY: 10, durationMs: 200 }, check => check(), () => undefined, abort.signal))
      .rejects.toBeInstanceOf(NativeTouchOutcomeUnknownError)
    expect(types(page.commands)).toEqual(['touchStart', 'touchCancel'])
  })
})
