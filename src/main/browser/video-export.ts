import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { LocalizedError } from '../localized-error.js'
import { VIDEO_LIMITS, videoSourceTime, videoFrameTiming, type VideoFrame, type VideoRenderPlan } from '../../shared/video.js'

/** An export may take this long, or longer for a long video: see exportDeadlineMs. */
const EXPORT_MIN_DEADLINE_MS = 5 * 60_000
/** Several times what decoding, drawing and encoding a 1280 × 720 frame takes on a slow machine. */
const EXPORT_MS_PER_FRAME = 150

/** How long an export of this many frames may take before it is given up as stuck. */
export function exportDeadlineMs(frameCount: number): number {
  return Math.max(EXPORT_MIN_DEADLINE_MS, frameCount * EXPORT_MS_PER_FRAME)
}

/**
 * An isolated trusted renderer encodes pixels. No Node, preload bridge, page scripts or network. Every export shares one
 * in-memory session, since Electron keeps each session it creates until Hronaut quits.
 */
export async function renderBrowserVideo(plan: VideoRenderPlan, frames: readonly VideoFrame[], signal: AbortSignal, validate: () => void, assets: readonly { id: string; data: Uint8Array }[] = []): Promise<Uint8Array> {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'video-export' } })
  const stop = (): void => { if (!window.isDestroyed()) window.destroy() }
  const { frameCount, frameDurationMs } = videoFrameTiming(plan.clips)
  // Electron may leave load/executeJavaScript promises pending when their window
  // is destroyed. Cancellation must settle our caller independently of Electron.
  let failure: Error | undefined
  let reject!: (error: Error) => void
  const interrupted = new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise })
  const interrupt = (error: Error = new LocalizedError('video.errors.exportTimeout')): void => {
    failure ??= error
    reject(failure)
    stop()
  }
  void interrupted.catch(() => undefined)
  const abort = (): void => interrupt()
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, exportDeadlineMs(frameCount))
  const assertCurrent = (): void => {
    if (failure) throw failure
    if (signal.aborted || window.isDestroyed()) throw new LocalizedError('video.errors.exportTimeout')
    validate()
  }
  const call = async (method: 'begin' | 'frame' | 'finish', args: unknown[] = []): Promise<unknown> => {
    assertCurrent()
    const result: unknown = await Promise.race([window.webContents.executeJavaScript(`window.hronautVideoExport.${method}(...${JSON.stringify(args)})`), interrupted])
    assertCurrent()
    return result
  }
  try {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    // A renderer that crashed or was killed answers nothing more, so the export ends at once rather than at its deadline.
    window.webContents.on('render-process-gone', () => interrupt(new LocalizedError('video.errors.exportStopped')))
    assertCurrent()
    if (process.env.ELECTRON_RENDERER_URL) {
      await Promise.race([window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/video-export.html`), interrupted])
    } else await Promise.race([window.loadFile(join(__dirname, '../renderer/video-export.html')), interrupted])
    await call('begin', [plan, assets.map(asset => ({ id: asset.id, base64: Buffer.from(asset.data).toString('base64') }))])
    let frameIndex = 0
    let sent: Uint8Array | undefined
    for (let index = 0; index < frameCount; index += 1) {
      const outputMs = index * frameDurationMs
      const sourceMs = videoSourceTime(plan.clips, outputMs)
      while (frameIndex + 1 < frames.length && frames[frameIndex + 1]!.timeMs <= sourceMs) frameIndex += 1
      const frame = frames[frameIndex]
      if (!frame) throw new Error('Recorded frame is unavailable')
      // A repeated frame shares its bytes with the one before, which the encoder still holds decoded.
      const image = frame.data === sent ? null : `data:image/jpeg;base64,${Buffer.from(frame.data).toString('base64')}`
      sent = frame.data
      await call('frame', [image, sourceMs, outputMs, frameDurationMs])
    }
    const encoded = await call('finish')
    if (typeof encoded !== 'string' || !encoded.startsWith('data:video/webm;base64,')) throw new Error('Invalid video export')
    const data = Buffer.from(encoded.slice('data:video/webm;base64,'.length), 'base64')
    if (!data.length || data.length > VIDEO_LIMITS.bytes) throw new Error('Invalid video export size')
    return data
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    stop()
  }
}
