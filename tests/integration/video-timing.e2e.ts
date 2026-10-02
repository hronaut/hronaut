import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserVideoState } from '../../src/shared/video.js'
import { expect, test, text } from './capability-fixtures.js'

test('observes delayed capture and transport without claiming pixel timing, and invalidates old recording segments', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const video = async (action: string): Promise<BrowserVideoState> => {
    const result = await client.callTool({ name: 'browser_video', arguments: { tabId, action } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as BrowserVideoState
  }
  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
    const original = page.capturePage.bind(page)
    const probe = globalThis as typeof globalThis & { videoTimingHeld?: boolean; releaseVideoTiming?: () => void; restoreVideoTiming?: () => void }
    probe.videoTimingHeld = false
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    probe.releaseVideoTiming = release
    probe.restoreVideoTiming = () => { page.capturePage = original; release() }
    page.capturePage = async (...args: Parameters<Electron.WebContents['capturePage']>) => {
      // Only instrument the recorder's stayHidden/stayAwake request, not thumbnails.
      if (!args[1]?.stayHidden || !args[1]?.stayAwake) return original(...args)
      page.capturePage = original
      const image = await original(...args)
      probe.videoTimingHeld = true
      await gate
      return image
    }
  }, fixtureUrl)
  const pending = video('start')
  try {
    await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { videoTimingHeld?: boolean }).videoTimingHeld)).toBe(true)
    const capturing = await video('get')
    expect(capturing.frameCount).toBe(0)
    expect(capturing.timing?.lastFrame).toBeUndefined()
    // Intentional transport/capture delay is the behavior under test, not a paint wait.
    await new Promise(resolve => setTimeout(resolve, 300))
    await electronApp.evaluate(() => (globalThis as typeof globalThis & { releaseVideoTiming?: () => void }).releaseVideoTiming?.())
    const started = await pending
    expect(started.timing).toMatchObject({ clock: 'recording-monotonic', pixelTime: 'unknown', revision: 0, lastFrame: { sequence: 1, sourceTimeMs: 0, revision: 0 } })
    const frame = started.timing!.lastFrame!
    expect(frame.captureCompletedAtMs - frame.captureStartedAtMs).toBeGreaterThanOrEqual(300)
    expect(started.timing!.observedAtMs).toBeGreaterThanOrEqual(frame.captureCompletedAtMs)
    expect(started.durationMs).toBe(started.timing!.sourceTimeMs)
    await new Promise(resolve => setTimeout(resolve, 250))
    const receipt = await video('get')
    expect(receipt.recordingId).toBe(started.recordingId)
    expect(receipt.timing!.observedAtMs - started.timing!.observedAtMs).toBeGreaterThanOrEqual(250)
    const paused = await video('pause')
    await new Promise(resolve => setTimeout(resolve, 200))
    const stillPaused = await video('get')
    expect(stillPaused.durationMs).toBe(paused.durationMs)
    expect(stillPaused.timing!.observedAtMs).toBeGreaterThan(paused.timing!.observedAtMs)
    expect(stillPaused.timing!.revision).toBeGreaterThan(started.timing!.revision)
    const resumed = await video('resume')
    expect(resumed.timing!.revision).toBeGreaterThan(paused.timing!.revision)
    await expect.poll(async () => (await video('get')).frameCount).toBeGreaterThan(paused.frameCount)
    const stopped = await video('stop')
    expect(stopped.timing!.revision).toBeGreaterThan(resumed.timing!.revision)
    expect(stopped.timing!.lastFrame!.revision).toBe(resumed.timing!.revision)
    const cleared = await video('clear')
    expect(cleared.timing).toBeUndefined()
    expect((await video('start')).recordingId).not.toBe(started.recordingId)
  } finally {
    await electronApp.evaluate(() => (globalThis as typeof globalThis & { restoreVideoTiming?: () => void }).restoreVideoTiming?.())
    await pending.catch(() => undefined)
    await video('clear')
  }
})
