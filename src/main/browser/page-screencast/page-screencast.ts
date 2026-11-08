import type { WebContents } from 'electron'
import type { Browser } from '../browser.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'

export interface ScreencastSettings { maxWidth: number; maxHeight: number; quality: number; everyNthFrame: number }

/** One frame as Chromium drew it: base64 JPEG, when it drew it, and the viewport it came from in CSS pixels. */
export interface ScreencastFrame { data: string; epochMs: number; viewportWidth: number; viewportHeight: number }

export interface ScreencastListener {
  frame(frame: ScreencastFrame): void
  stopped(reason: string): void
}

interface Subscriber { settings: ScreencastSettings; listener: ScreencastListener; frames: number }

interface Hub {
  subscribers: Set<Subscriber>
  /** The settings Chromium runs the screencast with, once it confirmed them; unset while it starts again. */
  running?: ScreencastSettings
  /** When the next frame may be acknowledged; every frame is, once, or Chromium stops sending them. */
  nextAckAt: number
  dispose: () => void
}

// Chromium runs one screencast per debugger session, so every reader of a page's frames shares this one.
const hubs = new WeakMap<WebContents, Hub>()
// Starts and stops of a page's screencast, one after another, also across a hub that ended and the next one.
const changes = new WeakMap<WebContents, Promise<void>>()

/**
 * Chromium sends a frame only after the one before was acknowledged, so acknowledging no sooner than this after the
 * last one keeps the screencast at about 40 frames a second, enough for a 30 fps recording, instead of the display's
 * 60 to 144, each of them encoded and passed through the main process.
 */
export const SCREENCAST_ACK_INTERVAL_MS = 25

const gcd = (left: number, right: number): number => right ? gcd(right, left % right) : left

/** The largest size and quality any reader asked for, and frames often enough that each reader's every nth is one of them. */
export function combinedScreencastSettings(all: readonly ScreencastSettings[]): ScreencastSettings {
  return {
    maxWidth: Math.max(...all.map(item => item.maxWidth)),
    maxHeight: Math.max(...all.map(item => item.maxHeight)),
    quality: Math.max(...all.map(item => item.quality)),
    everyNthFrame: all.map(item => item.everyNthFrame).reduce(gcd)
  }
}

/** Whether frames of a screencast running with these settings are what the reader asked for, or larger and better. */
export function screencastCovers(running: ScreencastSettings, wanted: ScreencastSettings): boolean {
  return running.maxWidth >= wanted.maxWidth && running.maxHeight >= wanted.maxHeight && running.quality >= wanted.quality
    && wanted.everyNthFrame % running.everyNthFrame === 0
}

const sameSettings = (left: ScreencastSettings | undefined, right: ScreencastSettings): boolean =>
  !!left && left.maxWidth === right.maxWidth && left.maxHeight === right.maxHeight
  && left.quality === right.quality && left.everyNthFrame === right.everyNthFrame

/** Queues a start or stop of the page's screencast after the ones before it; one that fails does not stop the next. */
function change<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T> {
  const run = (changes.get(webContents) ?? Promise.resolve()).then(operation)
  changes.set(webContents, run.then(() => undefined, () => undefined))
  return run
}

/**
 * Runs a screencast command on the attached debugger at once, so a long debugger operation on the page, such as a key
 * sequence, does not hold a recording's frames back; a debugger not yet attached is attached in the page's turn.
 */
function onDebugger(browser: Browser, webContents: WebContents, operation: () => Promise<void>): Promise<void> {
  if (webContents.debugger.isAttached() && !browser.devToolsOpening.has(webContents.id) && !webContents.isDevToolsOpened()) return operation()
  return withDebugger(browser, webContents, operation)
}

function endHub(webContents: WebContents, hub: Hub, reason: string): void {
  if (hubs.get(webContents) !== hub) return
  hub.dispose()
  const subscribers = [...hub.subscribers]
  hub.subscribers.clear()
  for (const subscriber of subscribers) subscriber.listener.stopped(reason)
}

function createHub(webContents: WebContents): Hub {
  const hub: Hub = { subscribers: new Set(), nextAckAt: -Infinity, dispose: () => undefined }
  const message = (_event: unknown, method: string, params: Record<string, unknown>): void => {
    if (method !== 'Page.screencastFrame' || hubs.get(webContents) !== hub) return
    const ack = (): void => {
      if (!webContents.isDestroyed()) webContents.debugger.sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => undefined)
    }
    const now = performance.now()
    const ackAt = Math.max(now, hub.nextAckAt)
    hub.nextAckAt = ackAt + SCREENCAST_ACK_INTERVAL_MS
    // An acknowledgement that comes after the hub ended is for a screencast that stopped, and Chromium ignores it.
    if (ackAt > now) setTimeout(ack, ackAt - now)
    else ack()
    const running = hub.running
    // Frames of a screencast that is starting again, or still at another reader's smaller settings, are not handed on.
    if (!running) return
    const metadata = params.metadata as { timestamp?: number; deviceWidth?: number; deviceHeight?: number } | undefined
    const frame: ScreencastFrame = {
      data: String(params.data),
      epochMs: Math.round((metadata?.timestamp ?? Date.now() / 1000) * 1000),
      viewportWidth: Math.round(metadata?.deviceWidth ?? 0),
      viewportHeight: Math.round(metadata?.deviceHeight ?? 0)
    }
    for (const subscriber of [...hub.subscribers]) {
      if (!screencastCovers(running, subscriber.settings)) continue
      subscriber.frames += 1
      // Chromium sends every nth frame for the most frequent reader; a reader that asked for fewer gets every nth of those.
      if ((subscriber.frames - 1) % (subscriber.settings.everyNthFrame / running.everyNthFrame) === 0) subscriber.listener.frame(frame)
    }
  }
  const detached = (): void => endHub(webContents, hub, 'debugger-detached')
  const destroyed = (): void => endHub(webContents, hub, 'tab-closed')
  hub.dispose = () => {
    if (hubs.get(webContents) === hub) hubs.delete(webContents)
    hub.running = undefined
    if (webContents.isDestroyed()) return
    webContents.debugger.removeListener('message', message)
    webContents.debugger.removeListener('detach', detached)
    webContents.removeListener('destroyed', destroyed)
    // After any start still on its way, so it cannot leave a screencast running that nobody reads.
    void change(webContents, async () => {
      if (!webContents.isDestroyed() && webContents.debugger.isAttached()) await webContents.debugger.sendCommand('Page.stopScreencast')
    }).catch(() => undefined)
  }
  webContents.debugger.on('message', message)
  webContents.debugger.on('detach', detached)
  webContents.once('destroyed', destroyed)
  return hub
}

/** Starts the screencast with what its readers now ask for, in its turn; a hub that ended or has no reader by then is left. */
function applySettings(browser: Browser, webContents: WebContents, hub: Hub, validate?: () => void): Promise<void> {
  const wanted = (): ScreencastSettings => combinedScreencastSettings([...hub.subscribers].map(subscriber => subscriber.settings))
  return change(webContents, async () => {
    if (hubs.get(webContents) !== hub || !hub.subscribers.size) return
    // Settings that stay the same need no debugger, so a page whose Developer Tools are opening keeps its readers.
    if (sameSettings(hub.running, wanted())) {
      validate?.()
      return
    }
    await onDebugger(browser, webContents, async () => {
      validate?.()
      if (hubs.get(webContents) !== hub || !hub.subscribers.size) return
      const settings = wanted()
      if (sameSettings(hub.running, settings)) return
      // Chromium refuses a second start, also of a screencast a renderer that went away left running, so stop it first.
      // Frames until the stop answers are the old screencast's; none is handed on until the new one answers.
      await webContents.debugger.sendCommand('Page.stopScreencast')
      hub.running = undefined
      await webContents.debugger.sendCommand('Page.startScreencast', { format: 'jpeg', ...settings })
      if (hubs.get(webContents) === hub) hub.running = settings
      else await webContents.debugger.sendCommand('Page.stopScreencast').catch(() => undefined)
    })
  })
}

/**
 * Adds a reader of the page's screencast and returns how to remove it. The screencast starts with the first reader,
 * runs at the largest size and quality any reader asked for, and stops with the last one; a reader gets frames only
 * once the screencast runs with its settings. A closed page, a detached debugger or a screencast that fails to start
 * again for the others ends every reader with that reason.
 */
export async function subscribePageScreencast(browser: Browser, webContents: WebContents, settings: ScreencastSettings,
  listener: ScreencastListener, validate?: () => void): Promise<() => void> {
  if (webContents.isDestroyed()) throw new Error('The page is closed')
  let hub = hubs.get(webContents)
  if (!hub) {
    hub = createHub(webContents)
    hubs.set(webContents, hub)
  }
  const subscriber: Subscriber = { settings: { ...settings }, listener, frames: 0 }
  hub.subscribers.add(subscriber)
  const own = hub
  let removed = false
  const unsubscribe = (): void => {
    if (removed) return
    removed = true
    if (!own.subscribers.delete(subscriber) || hubs.get(webContents) !== own) return
    if (!own.subscribers.size) own.dispose()
    else void applySettings(browser, webContents, own).catch(() => endHub(webContents, own, 'screencast-failed'))
  }
  try {
    await applySettings(browser, webContents, own, validate)
    // The hub ended while the screencast started, as when the debugger detached; the reader was told why.
    if (hubs.get(webContents) !== own || !own.running) throw new Error('The page screencast ended before it started')
  } catch (error) {
    unsubscribe()
    throw error
  }
  return unsubscribe
}
