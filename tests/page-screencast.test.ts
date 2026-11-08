import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { Browser } from '../src/main/browser/browser.js'
import {
  SCREENCAST_ACK_INTERVAL_MS,
  combinedScreencastSettings,
  screencastCovers,
  subscribePageScreencast,
  type ScreencastFrame,
  type ScreencastSettings
} from '../src/main/browser/page-screencast/page-screencast.js'

const SMALL: ScreencastSettings = { maxWidth: 640, maxHeight: 360, quality: 60, everyNthFrame: 1 }
const LARGE: ScreencastSettings = { maxWidth: 1280, maxHeight: 720, quality: 80, everyNthFrame: 1 }

/** A page whose attached debugger records each command and can hold one until the test lets it answer. */
function fakePage() {
  const commands: { method: string; params?: Record<string, unknown> }[] = []
  const held = new Map<string, { release: () => void; fail: (error: Error) => void }>()
  const holding = new Set<string>()
  const failing = new Set<string>()
  const debuggerEmitter = Object.assign(new EventEmitter(), {
    isAttached: () => true,
    sendCommand: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      commands.push({ method, ...(params ? { params } : {}) })
      if (holding.has(method)) {
        holding.delete(method)
        await new Promise<void>((resolve, reject) => { held.set(method, { release: resolve, fail: reject }) })
      }
      if (failing.has(method)) throw new Error(`${method} failed`)
      return {}
    })
  })
  const webContents = Object.assign(new EventEmitter(), {
    id: 7,
    debugger: debuggerEmitter,
    isDestroyed: () => false,
    isDevToolsOpened: () => false
  })
  const browser = { devToolsOpening: new Set<number>() } as unknown as Browser
  let frameNumber = 0
  return {
    browser,
    webContents: webContents as unknown as WebContents,
    commands,
    methods: () => commands.map(command => command.method).filter(method => method !== 'Page.screencastFrameAck'),
    acks: () => commands.filter(command => command.method === 'Page.screencastFrameAck').map(command => command.params?.sessionId),
    hold: (method: string) => holding.add(method),
    fail: (method: string) => failing.add(method),
    release: (method: string) => { held.get(method)!.release(); held.delete(method) },
    isHeld: (method: string) => held.has(method),
    frame: (data = `frame-${frameNumber + 1}`) => {
      frameNumber += 1
      debuggerEmitter.emit('message', {}, 'Page.screencastFrame', { data, sessionId: frameNumber, metadata: { timestamp: 1, deviceWidth: 800, deviceHeight: 600 } })
    },
    detach: () => debuggerEmitter.emit('detach')
  }
}

const reader = () => {
  const frames: string[] = []
  const stopped: string[] = []
  return { frames, stopped, listener: { frame: (frame: ScreencastFrame) => frames.push(frame.data), stopped: (reason: string) => stopped.push(reason) } }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

describe('shared page screencast', () => {
  afterEach(() => { vi.useRealTimers() })

  it('runs at the largest size and quality, often enough for every reader', () => {
    expect(combinedScreencastSettings([{ ...SMALL, everyNthFrame: 3 }, LARGE])).toEqual(LARGE)
    expect(combinedScreencastSettings([{ ...SMALL, everyNthFrame: 2 }, { ...SMALL, everyNthFrame: 3 }]).everyNthFrame).toBe(1)
    expect(combinedScreencastSettings([{ ...SMALL, everyNthFrame: 4 }, { ...SMALL, everyNthFrame: 6 }]).everyNthFrame).toBe(2)
    expect(screencastCovers(LARGE, SMALL)).toBe(true)
    expect(screencastCovers(SMALL, LARGE)).toBe(false)
    expect(screencastCovers({ ...SMALL, everyNthFrame: 2 }, { ...SMALL, everyNthFrame: 3 })).toBe(false)
  })

  it('stops any screencast left running before starting one', async () => {
    const page = fakePage()
    const remove = await subscribePageScreencast(page.browser, page.webContents, SMALL, reader().listener)
    expect(page.commands).toEqual([{ method: 'Page.stopScreencast' }, { method: 'Page.startScreencast', params: { format: 'jpeg', ...SMALL } }])
    remove()
    await settle()
    expect(page.methods().at(-1)).toBe('Page.stopScreencast')
  })

  it('hands a new reader frames only once the screencast runs with its settings', async () => {
    const page = fakePage()
    const small = reader()
    const large = reader()
    const removeSmall = await subscribePageScreencast(page.browser, page.webContents, SMALL, small.listener)
    page.hold('Page.startScreencast')
    const subscribing = subscribePageScreencast(page.browser, page.webContents, LARGE, large.listener)
    await settle()
    // Restarting: the old screencast stopped and the new one has not answered, so nobody gets the frame in between.
    expect(page.isHeld('Page.startScreencast')).toBe(true)
    page.frame('between')
    page.release('Page.startScreencast')
    const removeLarge = await subscribing
    page.frame('after')
    expect(small.frames).toEqual(['after'])
    expect(large.frames).toEqual(['after'])
    removeLarge()
    removeSmall()
  })

  it('does not hand a new reader frames of the screencast still at a smaller reader\'s settings', async () => {
    const page = fakePage()
    const small = reader()
    const large = reader()
    const removeSmall = await subscribePageScreencast(page.browser, page.webContents, SMALL, small.listener)
    page.hold('Page.stopScreencast')
    const subscribing = subscribePageScreencast(page.browser, page.webContents, LARGE, large.listener)
    await settle()
    page.frame('small-size')
    expect(small.frames).toEqual(['small-size'])
    expect(large.frames).toEqual([])
    page.release('Page.stopScreencast')
    const removeLarge = await subscribing
    removeLarge()
    removeSmall()
  })

  it('gives each reader its every nth frame once', async () => {
    const page = fakePage()
    const lone = reader()
    const removeLone = await subscribePageScreencast(page.browser, page.webContents, { ...SMALL, everyNthFrame: 3 }, lone.listener)
    expect(page.commands.at(-1)?.params?.everyNthFrame).toBe(3)
    for (let index = 0; index < 3; index += 1) page.frame()
    // Chromium already sends every third paint, so each of its frames is this reader's.
    expect(lone.frames).toEqual(['frame-1', 'frame-2', 'frame-3'])
    const second = reader()
    const removeSecond = await subscribePageScreencast(page.browser, page.webContents, { ...SMALL, everyNthFrame: 2 }, second.listener)
    expect(page.commands.at(-1)?.params?.everyNthFrame).toBe(1)
    lone.frames.length = 0
    for (let index = 0; index < 6; index += 1) page.frame(`paint-${index + 1}`)
    expect(lone.frames).toEqual(['paint-1', 'paint-4'])
    expect(second.frames).toEqual(['paint-1', 'paint-3', 'paint-5'])
    removeSecond()
    removeLone()
  })

  it('stops a screencast whose start answered after the debugger detached, and refuses the reader', async () => {
    const page = fakePage()
    const first = reader()
    page.hold('Page.startScreencast')
    const subscribing = subscribePageScreencast(page.browser, page.webContents, SMALL, first.listener)
    await settle()
    page.detach()
    expect(first.stopped).toEqual(['debugger-detached'])
    page.release('Page.startScreencast')
    await expect(subscribing).rejects.toThrow('ended before it started')
    await settle()
    expect(page.methods().at(-1)).toBe('Page.stopScreencast')
    // The next reader starts a fresh screencast instead of meeting one already active.
    const next = await subscribePageScreencast(page.browser, page.webContents, SMALL, reader().listener)
    expect(page.methods().slice(-2)).toEqual(['Page.stopScreencast', 'Page.startScreencast'])
    next()
  })

  it('ends the remaining readers when the screencast cannot start again for them', async () => {
    const page = fakePage()
    const small = reader()
    await subscribePageScreencast(page.browser, page.webContents, SMALL, small.listener)
    const removeLarge = await subscribePageScreencast(page.browser, page.webContents, LARGE, reader().listener)
    page.fail('Page.startScreencast')
    removeLarge()
    await settle()
    await settle()
    expect(small.stopped).toEqual(['screencast-failed'])
  })

  it('acknowledges every frame once, no sooner than the interval after the last', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const page = fakePage()
    const remove = await subscribePageScreencast(page.browser, page.webContents, SMALL, reader().listener)
    page.frame()
    page.frame()
    page.frame()
    expect(page.acks()).toEqual([1])
    await vi.advanceTimersByTimeAsync(SCREENCAST_ACK_INTERVAL_MS)
    expect(page.acks()).toEqual([1, 2])
    await vi.advanceTimersByTimeAsync(SCREENCAST_ACK_INTERVAL_MS)
    expect(page.acks()).toEqual([1, 2, 3])
    remove()
  })
})
