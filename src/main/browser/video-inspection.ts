import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { VIDEO_INSPECTION_LIMITS as LIMITS } from '../../shared/video-inspection.js'
import type { SelectedVideoFrame } from './video-inspection-frames.js'

// A quarantined job deliberately retains its pins and admission until application exit.
let activeJob: { frames: readonly SelectedVideoFrame[]; quarantined: boolean } | undefined

/** One transient sandboxed compositor; no queue, page access, file exports or persistent image cache. */
export async function inspectVideoFrames(frames: readonly SelectedVideoFrame[], signal: AbortSignal, validate: () => void): Promise<Uint8Array> {
  if (activeJob) throw new Error(activeJob.quarantined ? 'Video inspection cleanup is uncertain; restart Hronaut before inspecting again' : 'A video inspection is already running; wait for it to finish')
  if (!frames.length || frames.length > LIMITS.frames || frames.reduce((sum, frame) => sum + frame.data.byteLength, 0) > LIMITS.selectedBytes) throw new Error('Video inspection exceeds its frame or byte limit')
  validate()
  if (signal.aborted) throw new Error('Video inspection cancelled')
  const job = { frames, quarantined: false }
  activeJob = job
  let window: BrowserWindow | undefined
  let pid = 0
  let loading = false
  let failure: Error | undefined
  let reject!: (error: Error) => void
  const interrupted = new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise })
  void interrupted.catch(() => undefined)
  const interrupt = (error = new Error('Video inspection cancelled')): void => {
    failure ??= error
    reject(failure)
    if (window && !window.isDestroyed()) {
      pid ||= window.webContents.getOSProcessId()
      window.destroy()
    }
  }
  const abort = (): void => interrupt()
  const assertCurrent = (): void => {
    if (failure) throw failure
    if (signal.aborted) throw new Error('Video inspection cancelled')
    validate()
  }
  const deadline = setTimeout(() => interrupt(new Error('Video inspection exceeded its five-second processing deadline')), LIMITS.deadlineMs)
  const validity = setInterval(() => { try { assertCurrent() } catch { interrupt(new Error('Video inspection source or authority changed')) } }, 50)
  signal.addEventListener('abort', abort, { once: true })
  const cleanup = async (): Promise<void> => {
    // Preserve admission and JPEG pins during teardown. A destroy request alone is not exit proof.
    try {
      if (window && !window.isDestroyed()) { pid ||= window.webContents.getOSProcessId(); window.destroy() }
      const start = performance.now()
      while (pid && app.getAppMetrics().some(metric => metric.pid === pid) && performance.now() - start < LIMITS.exitWaitMs) await delay(10)
      if ((loading && !pid) || (pid && app.getAppMetrics().some(metric => metric.pid === pid))) throw new Error('Renderer exit unconfirmed')
      activeJob = undefined
    } catch {
      job.quarantined = true
      throw new Error('Video inspection cleanup is uncertain; restart Hronaut before inspecting again')
    }
  }
  try {
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: `video-inspection-${crypto.randomUUID()}` } })
    const contents = window.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', event => event.preventDefault())
    contents.on('render-process-gone', () => interrupt(new Error('Video inspection renderer stopped')))
    contents.on('dom-ready', () => { if (!contents.isDestroyed()) pid ||= contents.getOSProcessId() })
    const call = async (method: 'begin' | 'frame' | 'finish', args: unknown[] = []): Promise<unknown> => {
      assertCurrent()
      const result: unknown = await Promise.race([contents.executeJavaScript(`window.hronautVideoInspection.${method}(...${JSON.stringify(args)})`), interrupted])
      assertCurrent()
      return result
    }
    assertCurrent()
    loading = true
    await Promise.race([process.env.ELECTRON_RENDERER_URL
      ? window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/video-inspection.html`)
      : window.loadFile(join(__dirname, '../renderer/video-inspection.html')), interrupted])
    pid ||= contents.getOSProcessId()
    await call('begin', [frames.length])
    // Only one JPEG string/transport and one decoded bitmap at a time.
    for (const [index, frame] of frames.entries()) {
      await call('frame', [Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength).toString('base64'), index, frame.sequence, frame.sourceTimeMs, frame.width, frame.height])
    }
    const encoded = await call('finish')
    if (typeof encoded !== 'string' || encoded.length > Math.ceil(LIMITS.pngBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw new Error('Invalid video inspection image')
    const image = Buffer.from(encoded, 'base64')
    if (image.byteLength > LIMITS.pngBytes) throw new Error('Video inspection PNG exceeds 4 MiB')
    const width = Math.min(frames.length, LIMITS.columns) * LIMITS.tileWidth
    const height = Math.ceil(frames.length / LIMITS.columns) * (LIMITS.tileHeight + LIMITS.labelHeight)
    if (image.length < 33 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || image.readUInt32BE(8) !== 13 || image.toString('ascii', 12, 16) !== 'IHDR'
      || image.readUInt32BE(16) !== width || image.readUInt32BE(20) !== height) throw new Error('Invalid video inspection PNG dimensions')
    assertCurrent()
    return image
  } finally {
    clearTimeout(deadline)
    clearInterval(validity)
    signal.removeEventListener('abort', abort)
    await cleanup()
  }
}
