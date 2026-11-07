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
  running?: ScreencastSettings
  dispose: () => void
}

// Chromium runs one screencast per debugger session, so every reader of a page's frames shares this one.
const hubs = new WeakMap<WebContents, Hub>()

/** The largest size and quality and the most frequent frames that any reader asked for. */
export function combinedScreencastSettings(all: readonly ScreencastSettings[]): ScreencastSettings {
  return {
    maxWidth: Math.max(...all.map(item => item.maxWidth)),
    maxHeight: Math.max(...all.map(item => item.maxHeight)),
    quality: Math.max(...all.map(item => item.quality)),
    everyNthFrame: Math.min(...all.map(item => item.everyNthFrame))
  }
}

const sameSettings = (left: ScreencastSettings | undefined, right: ScreencastSettings): boolean =>
  !!left && left.maxWidth === right.maxWidth && left.maxHeight === right.maxHeight
  && left.quality === right.quality && left.everyNthFrame === right.everyNthFrame

function endHub(webContents: WebContents, hub: Hub, reason: string): void {
  if (hubs.get(webContents) !== hub) return
  hub.dispose()
  const subscribers = [...hub.subscribers]
  hub.subscribers.clear()
  for (const subscriber of subscribers) subscriber.listener.stopped(reason)
}

function createHub(webContents: WebContents): Hub {
  const hub: Hub = { subscribers: new Set(), dispose: () => undefined }
  const message = (_event: unknown, method: string, params: Record<string, unknown>): void => {
    if (method !== 'Page.screencastFrame' || hubs.get(webContents) !== hub) return
    // Chromium sends the next frame only after this one is acknowledged, so the acknowledgement paces the stream.
    webContents.debugger.sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => undefined)
    const metadata = params.metadata as { timestamp?: number; deviceWidth?: number; deviceHeight?: number } | undefined
    const frame: ScreencastFrame = {
      data: String(params.data),
      epochMs: Math.round((metadata?.timestamp ?? Date.now() / 1000) * 1000),
      viewportWidth: Math.round(metadata?.deviceWidth ?? 0),
      viewportHeight: Math.round(metadata?.deviceHeight ?? 0)
    }
    for (const subscriber of [...hub.subscribers]) {
      subscriber.frames += 1
      // A reader that asked for every nth frame still gets every nth one when another reader asks for more.
      if ((subscriber.frames - 1) % subscriber.settings.everyNthFrame === 0) subscriber.listener.frame(frame)
    }
  }
  const detached = (): void => endHub(webContents, hub, 'debugger-detached')
  const destroyed = (): void => endHub(webContents, hub, 'tab-closed')
  hub.dispose = () => {
    if (hubs.get(webContents) === hub) hubs.delete(webContents)
    if (webContents.isDestroyed()) return
    webContents.debugger.removeListener('message', message)
    webContents.debugger.removeListener('detach', detached)
    webContents.removeListener('destroyed', destroyed)
    if (webContents.debugger.isAttached()) webContents.debugger.sendCommand('Page.stopScreencast').catch(() => undefined)
  }
  webContents.debugger.on('message', message)
  webContents.debugger.on('detach', detached)
  webContents.once('destroyed', destroyed)
  return hub
}

async function applySettings(browser: Browser, webContents: WebContents, hub: Hub, validate?: () => void): Promise<void> {
  const wanted = combinedScreencastSettings([...hub.subscribers].map(subscriber => subscriber.settings))
  if (sameSettings(hub.running, wanted)) return
  await withDebugger(browser, webContents, async () => {
    validate?.()
    // Chromium refuses a second start, so new settings stop the running screencast first.
    if (hub.running) {
      hub.running = undefined
      await webContents.debugger.sendCommand('Page.stopScreencast')
    }
    await webContents.debugger.sendCommand('Page.startScreencast', { format: 'jpeg', ...wanted })
    hub.running = wanted
  })
}

/**
 * Adds a reader of the page's screencast and returns how to remove it. The screencast starts with the first reader,
 * runs at the largest size and quality any reader asked for, and stops with the last one; a closed page or a detached
 * debugger ends every reader with that reason.
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
    else void applySettings(browser, webContents, own).catch(() => undefined)
  }
  try {
    await applySettings(browser, webContents, own, validate)
  } catch (error) {
    unsubscribe()
    throw error
  }
  return unsubscribe
}
