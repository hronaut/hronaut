import { nativeImage, type WebContents } from 'electron'
import { z } from 'zod'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { getTab } from '../browser-core.js'
import { subscribePageScreencast, type ScreencastSettings } from '../page-screencast/page-screencast.js'
import { videoJpegDimensions } from '../video-inspection-frames.js'

export const FRAME_STREAM_LIMITS = { maxWidth: 1280, maxHeight: 720, bufferFrames: 30, readFrames: 4, waitMs: 2000, idleMs: 60_000 } as const
const DEFAULTS = { maxWidth: 640, maxHeight: 360, quality: 60, everyNthFrame: 1, bufferFrames: 10 } as const

export const frameStreamFields = {
  action: z.enum(['start', 'read', 'stop']),
  maxWidth: z.number().int().min(64).max(FRAME_STREAM_LIMITS.maxWidth).optional(),
  maxHeight: z.number().int().min(64).max(FRAME_STREAM_LIMITS.maxHeight).optional(),
  quality: z.number().int().min(1).max(100).optional(),
  everyNthFrame: z.number().int().min(1).max(10).optional(),
  bufferFrames: z.number().int().min(1).max(FRAME_STREAM_LIMITS.bufferFrames).optional(),
  after: z.number().int().min(0).optional(),
  maxFrames: z.number().int().min(1).max(FRAME_STREAM_LIMITS.readFrames).optional(),
  waitMs: z.number().int().min(0).max(FRAME_STREAM_LIMITS.waitMs).optional()
}
const frameStreamInputSchema = z.object({ tabId: z.string().min(1), ...frameStreamFields }).strict()
export type FrameStreamInput = z.infer<typeof frameStreamInputSchema>

const START_OPTIONS = ['maxWidth', 'maxHeight', 'quality', 'everyNthFrame', 'bufferFrames'] as const
const READ_OPTIONS = ['after', 'maxFrames', 'waitMs'] as const

interface StreamFrame { sequence: number; epochMs: number; data: string }

interface FrameStream {
  settings: ScreencastSettings
  frames: StreamFrame[]
  capacity: number
  sequence: number
  startEpochMs: number
  stopped?: string
  idleTimer: ReturnType<typeof setTimeout>
  waiters: Set<() => void>
  dispose: () => void
}

// One stream per page; it shares the page's one screencast with a video recording of it. A stopped stream stays until
// the next start, so a read says why it stopped.
const streams = new WeakMap<WebContents, FrameStream>()

export interface FrameStreamImage { data: string; mimeType: 'image/jpeg' }

/** Whether the person could see the page now; Chromium sends no frames for a page it does not draw. */
function pageVisible(browser: Browser, tab: BrowserTab): boolean {
  return browser.activeTabId === tab.id && browser.window.isVisible() && !browser.window.isMinimized()
    && tab.view.getVisible() && !tab.sleeping
}

function stopStream(stream: FrameStream, reason: string): void {
  if (stream.stopped) return
  stream.stopped = reason
  stream.frames = []
  stream.dispose()
  for (const wake of stream.waiters) wake()
  stream.waiters.clear()
}

function keepAlive(stream: FrameStream): void {
  clearTimeout(stream.idleTimer)
  stream.idleTimer = setTimeout(() => stopStream(stream, 'idle'), FRAME_STREAM_LIMITS.idleMs)
}

/**
 * The frame at the size and quality the stream asked for. The page's one screencast runs at the largest size any of
 * its readers asked for, such as a recording's, so a larger frame is scaled down here, for the few frames a read returns.
 */
function streamImage(data: string, settings: ScreencastSettings): string {
  const bytes = Buffer.from(data, 'base64')
  let size: { width: number; height: number }
  try {
    size = videoJpegDimensions(bytes)
  } catch {
    // A frame whose header the bounded preflight does not read is passed on as Chromium drew it.
    return data
  }
  const scale = Math.min(settings.maxWidth / size.width, settings.maxHeight / size.height)
  if (scale >= 1) return data
  const image = nativeImage.createFromBuffer(bytes)
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))
  return image.resize({ width, height, quality: 'good' }).toJPEG(settings.quality).toString('base64')
}

async function startStream(browser: Browser, tab: BrowserTab, input: FrameStreamInput, validate: () => void): Promise<unknown> {
  const webContents = tab.webContents
  if (tab.sleeping || tab.pageLifecycleState !== 'active') throw new Error('Frame streams need an awake page; this call never wakes a tab')
  const previous = streams.get(webContents)
  if (previous) stopStream(previous, 'restarted')
  const options = {
    maxWidth: input.maxWidth ?? DEFAULTS.maxWidth,
    maxHeight: input.maxHeight ?? DEFAULTS.maxHeight,
    quality: input.quality ?? DEFAULTS.quality,
    everyNthFrame: input.everyNthFrame ?? DEFAULTS.everyNthFrame
  }
  const stream: FrameStream = {
    settings: options, frames: [], capacity: input.bufferFrames ?? DEFAULTS.bufferFrames, sequence: 0, startEpochMs: Date.now(),
    idleTimer: setTimeout(() => undefined, 0), waiters: new Set(), dispose: () => undefined
  }
  let unsubscribe: (() => void) | undefined
  stream.dispose = () => {
    clearTimeout(stream.idleTimer)
    unsubscribe?.()
  }
  streams.set(webContents, stream)
  keepAlive(stream)
  try {
    unsubscribe = await subscribePageScreencast(browser, webContents, options, {
      frame: frame => {
        if (stream.stopped) return
        stream.sequence += 1
        stream.frames.push({ sequence: stream.sequence, epochMs: frame.epochMs, data: frame.data })
        if (stream.frames.length > stream.capacity) stream.frames.shift()
        for (const wake of stream.waiters) wake()
        stream.waiters.clear()
      },
      stopped: reason => stopStream(stream, reason)
    }, validate)
    if (stream.stopped) unsubscribe()
    validate()
  } catch (error) {
    stopStream(stream, 'start-failed')
    throw error
  }
  if (stream.stopped) return { status: 'STOPPED', stopped: stream.stopped, pageVisible: pageVisible(browser, tab) }
  return { status: 'STREAMING', cursor: 0, startEpochMs: stream.startEpochMs, ...options, bufferFrames: stream.capacity, pageVisible: pageVisible(browser, tab),
    note: 'Read frames with action read and after set to the last cursor. Frames arrive only when the page draws, and none while it is hidden. '
      + `The stream stops after ${FRAME_STREAM_LIMITS.idleMs / 1000} s without a read.` }
}

function waitForFrame(stream: FrameStream, after: number, waitMs: number, validate: () => void, signal?: AbortSignal): Promise<void> {
  if (waitMs === 0 || stream.stopped || stream.sequence > after) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = performance.now() + waitMs
    const finish = (error?: unknown): void => {
      clearTimeout(timer)
      stream.waiters.delete(wake)
      signal?.removeEventListener('abort', aborted)
      if (error) reject(error)
      else resolve()
    }
    const wake = (): void => finish()
    const aborted = (): void => finish(new Error('Frame read cancelled'))
    // Rechecks the call while it waits, as other waits do, so a pause or a lost target ends it.
    const tick = (): void => {
      try { validate() } catch (error) { return finish(error) }
      const remaining = deadline - performance.now()
      if (remaining <= 0) return finish()
      timer = setTimeout(tick, Math.min(50, remaining))
    }
    stream.waiters.add(wake)
    signal?.addEventListener('abort', aborted, { once: true })
    tick()
  })
}

async function readStream(browser: Browser, tab: BrowserTab, input: FrameStreamInput, validate: () => void, signal?: AbortSignal)
  : Promise<{ report: unknown; images: FrameStreamImage[] }> {
  const webContents = tab.webContents
  const stream = streams.get(webContents)
  if (!stream) throw new Error('No frame stream runs for this tab; start one with action start')
  if (!stream.stopped) keepAlive(stream)
  const maxFrames = input.maxFrames ?? 1
  // Without a cursor, the newest frames are the ones wanted.
  const after = input.after ?? Math.max(0, stream.sequence - maxFrames)
  if (after > stream.sequence) {
    throw new Error(`Cursor ${after} is ahead of this stream (newest frame ${stream.sequence}); a restarted stream starts again at 0`)
  }
  await waitForFrame(stream, after, input.waitMs ?? 0, validate, signal)
  validate()
  const newer = stream.frames.filter(frame => frame.sequence > after)
  const returned = newer.slice(-maxFrames)
  const skipped = stream.sequence - after - returned.length
  const report = {
    status: returned.length ? 'FRAMES' : stream.stopped ? 'STOPPED' : 'NO_NEW_FRAME',
    cursor: Math.max(after, stream.sequence),
    frames: returned.map(frame => ({ sequence: frame.sequence, epochMs: frame.epochMs })),
    skipped,
    pageVisible: pageVisible(browser, tab),
    ...(stream.stopped ? { stopped: stream.stopped } : {}),
    note: 'epochMs is when Chromium drew the frame, on the same clock as browser_key_sequence startEpochMs. '
      + 'skipped counts newer frames not returned (dropped from the buffer or past maxFrames); a missing frame is not proof that nothing changed.'
  }
  return { report, images: returned.map(frame => ({ data: streamImage(frame.data, stream.settings), mimeType: 'image/jpeg' })) }
}

/**
 * Starts, reads or stops a live low-resolution JPEG frame stream of one page, for agents that must watch a page change
 * as it plays, such as a game. Frames come from Chromium's screencast of the page alone, never of Hronaut or other
 * windows, into a small buffer that keeps only the newest frames; nothing is written to disk.
 */
export async function frameStream(browser: Browser, input: FrameStreamInput, validate: () => void, signal?: AbortSignal)
  : Promise<{ report: unknown; images: FrameStreamImage[] }> {
  const options = frameStreamInputSchema.parse(input)
  const misplaced = (options.action === 'start' ? READ_OPTIONS : options.action === 'read' ? START_OPTIONS : [...START_OPTIONS, ...READ_OPTIONS])
    .filter(name => options[name] !== undefined)
  if (misplaced.length) throw new TypeError(`Action ${options.action} does not take ${misplaced.join(', ')}`)
  const tab = getTab(browser, options.tabId)
  if (options.action === 'start') return { report: await startStream(browser, tab, options, validate), images: [] }
  if (options.action === 'read') return readStream(browser, tab, options, validate, signal)
  const stream = streams.get(tab.webContents)
  if (!stream) return { report: { status: 'STOPPED', stopped: 'not-running' }, images: [] }
  stopStream(stream, 'stopped')
  return { report: { status: 'STOPPED', stopped: stream.stopped, frames: stream.sequence }, images: [] }
}
