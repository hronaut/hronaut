import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { VIDEO_LIMITS, videoSourceTime, videoFrameTiming, type VideoFrame, type VideoRenderPlan } from '../../shared/video.js'

/** An isolated trusted renderer encodes pixels. No Node, preload bridge, page scripts or network. */
export async function renderBrowserVideo(plan: VideoRenderPlan, frames: readonly VideoFrame[], signal: AbortSignal, validate: () => void): Promise<Uint8Array> {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: `video-export-${crypto.randomUUID()}` } })
  const stop = (): void => { if (!window.isDestroyed()) window.destroy() }
  signal.addEventListener('abort', stop, { once: true })
  const timer = setTimeout(stop, 5 * 60_000)
  const assertCurrent = (): void => { if (signal.aborted || window.isDestroyed()) throw new Error('Video export cancelled or timed out'); validate() }
  const call = async (method: 'begin' | 'frame' | 'finish', args: unknown[] = []): Promise<unknown> => {
    assertCurrent()
    const result: unknown = await window.webContents.executeJavaScript(`window.hronautVideoExport.${method}(...${JSON.stringify(args)})`)
    assertCurrent()
    return result
  }
  try {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    assertCurrent()
    if (process.env.ELECTRON_RENDERER_URL) {
      await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/video-export.html`)
    } else await window.loadFile(join(__dirname, '../renderer/video-export.html'))
    await call('begin', [plan])
    const { frameCount, frameDurationMs } = videoFrameTiming(plan.clips)
    let frameIndex = 0
    for (let index = 0; index < frameCount; index += 1) {
      const outputMs = index * frameDurationMs
      const sourceMs = videoSourceTime(plan.clips, outputMs)
      while (frameIndex + 1 < frames.length && frames[frameIndex + 1]!.timeMs <= sourceMs) frameIndex += 1
      const frame = frames[frameIndex]
      if (!frame) throw new Error('Recorded frame is unavailable')
      await call('frame', [`data:image/jpeg;base64,${Buffer.from(frame.data).toString('base64')}`, sourceMs, outputMs, frameDurationMs])
    }
    const encoded = await call('finish')
    if (typeof encoded !== 'string' || !encoded.startsWith('data:video/webm;base64,')) throw new Error('Invalid video export')
    const data = Buffer.from(encoded.slice('data:video/webm;base64,'.length), 'base64')
    if (!data.length || data.length > VIDEO_LIMITS.bytes) throw new Error('Invalid video export size')
    return data
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
    stop()
  }
}
