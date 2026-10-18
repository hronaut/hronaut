import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

// The decoded image is the PNG bytes themselves here, so two captures differ exactly when their bytes do.
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (data: Buffer) => ({ isEmpty: () => data.length === 0, getSize: () => ({ width: 4, height: 2 }), toBitmap: () => data })
  }
}))

const { TRACKED_SCREENSHOT_GEOMETRY_TIMEOUT_MS, trackedViewportScreenshot } = await import('../src/main/browser/screenshot-observations/tracked-screenshot.js')
type Access = Parameters<typeof trackedViewportScreenshot>[0]
type Preview = ReturnType<Access['cssStatePreview']>

const CONTEXT = { tabId: 'tab-1', workspaceId: 'workspace-1', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0, snapshotFormatVersion: 1 }
const HOVER: Preview = { states: ['hover'], selector: '#a', startedAt: '2026-10-18T18:00:00.000Z' }

/** A tab whose page answers each geometry read with the next entry (a function entry is called), and whose capture runs the given hook. */
function fakeTab(geometries: Array<number[] | (() => Promise<unknown>)>, duringCapture?: (state: { context: typeof CONTEXT; preview: Preview }) => void, pixels = 'pixels') {
  const scripts: Array<{ world: number }> = []
  const webContents = {
    isDestroyed: () => false,
    getZoomFactor: () => 1,
    executeJavaScriptInIsolatedWorld: async (world: number) => {
      scripts.push({ world })
      const next = geometries.shift()
      return typeof next === 'function' ? next() : next
    }
  } as unknown as WebContents
  const tab = { id: 'tab-1', webContents }
  const state: { context: typeof CONTEXT; preview: Preview } = { context: CONTEXT, preview: undefined }
  const captures: unknown[] = []
  const access: Access = {
    getTab: () => tab,
    findTab: () => tab,
    snapshotDeltaContext: () => state.context,
    cssStatePreview: () => state.preview,
    captureViewport: async (options) => {
      captures.push(options)
      duringCapture?.(state)
      return { data: Buffer.from(pixels), mimeType: 'image/png' }
    }
  }
  return { access, scripts, captures, state }
}

const STILL = [1280, 720, 1, 0, 0, 1, 0, 0]

afterEach(() => { vi.useRealTimers() })

describe('trackedViewportScreenshot', () => {
  it('captures the resolved tab with the given options and fingerprints the decoded pixels in the observation world', async () => {
    const { access, scripts, captures } = fakeTab([STILL, STILL])
    const capture = await trackedViewportScreenshot(access, { format: 'jpeg', quality: 70, maxWidth: 800 })
    expect(captures).toEqual([{ format: 'jpeg', quality: 70, maxWidth: 800, tabId: 'tab-1' }])
    expect(scripts.map(script => script.world)).toEqual([1027, 1027])
    expect(capture).toMatchObject({ tabId: 'tab-1', mimeType: 'image/png', pixels: { width: 4, height: 2, digest: expect.stringMatching(/^[0-9a-f]{64}$/) } })
    expect(capture.untracked).toBeUndefined()
    expect(JSON.parse(capture.comparable!)).toMatchObject({ context: CONTEXT, preview: 'null', options: { format: 'jpeg', quality: 70, maxWidth: 800 } })
    const again = await trackedViewportScreenshot(fakeTab([STILL, STILL]).access, { format: 'jpeg', quality: 70, maxWidth: 800 })
    expect(again.comparable).toBe(capture.comparable)
    expect(again.pixels.digest).toBe(capture.pixels.digest)
  })

  it('compares an omitted default like the same value given, and other options or forced states never', async () => {
    const key = async (options: Parameters<typeof trackedViewportScreenshot>[1], preview?: Preview) => {
      const tab = fakeTab([STILL, STILL])
      tab.state.preview = preview
      return (await trackedViewportScreenshot(tab.access, options)).comparable
    }
    expect(await key({})).toBe(await key({ format: 'png' }))
    expect(await key({ format: 'jpeg' })).toBe(await key({ format: 'jpeg', quality: 80 }))
    expect(await key({ format: 'jpeg', quality: 70 })).not.toBe(await key({ format: 'jpeg' }))
    expect(await key({ maxHeight: 400 })).not.toBe(await key({}))
    expect(await key({}, HOVER)).not.toBe(await key({}))
    expect(await key({}, HOVER)).not.toBe(await key({}, { ...HOVER, selector: '#b' }))
    expect(await key({}, HOVER)).not.toBe(await key({}, { ...HOVER, states: ['active'] }))
  })

  it('cannot be compared when the page scrolled, navigated or changed its forced CSS state during the capture', async () => {
    const scrolled = await trackedViewportScreenshot(fakeTab([STILL, [1280, 720, 1, 0, 40, 1, 0, 0]]).access, {})
    expect(scrolled).toMatchObject({ untracked: 'changed-during-capture' })
    expect(scrolled.comparable).toBeUndefined()
    const navigated = await trackedViewportScreenshot(fakeTab([STILL, STILL], state => { state.context = { ...CONTEXT, navigationGeneration: 2 } }).access, {})
    expect(navigated).toMatchObject({ untracked: 'changed-during-capture' })
    const replaced = fakeTab([STILL, STILL], state => { state.preview = { ...HOVER, selector: '#b' } })
    replaced.state.preview = HOVER
    expect(await trackedViewportScreenshot(replaced.access, {})).toMatchObject({ untracked: 'changed-during-capture' })
  })

  it('still returns the screenshot, without a comparison, when the page cannot report its geometry', async () => {
    const invalid = await trackedViewportScreenshot(fakeTab([[1280, Number.NaN], STILL]).access, {})
    expect(invalid).toMatchObject({ untracked: 'geometry-unavailable', data: Buffer.from('pixels') })
    expect(invalid.comparable).toBeUndefined()
    const destroyed = await trackedViewportScreenshot(fakeTab([STILL, async () => { throw new Error('Execution context was destroyed') }]).access, {})
    expect(destroyed).toMatchObject({ untracked: 'geometry-unavailable' })
  })

  it('stops waiting for a page that never answers, such as one held by a dialog, and does not ask it again', async () => {
    vi.useFakeTimers()
    const blocked = fakeTab([() => new Promise(() => undefined), STILL])
    const pending = trackedViewportScreenshot(blocked.access, {})
    await vi.advanceTimersByTimeAsync(TRACKED_SCREENSHOT_GEOMETRY_TIMEOUT_MS)
    const capture = await pending
    expect(capture).toMatchObject({ untracked: 'geometry-unavailable', data: Buffer.from('pixels') })
    expect(blocked.scripts).toHaveLength(1)
    expect(blocked.captures).toHaveLength(1)
  })

  it('never compares an empty capture', async () => {
    const empty = await trackedViewportScreenshot(fakeTab([STILL, STILL], undefined, '').access, {})
    expect(empty).toMatchObject({ untracked: 'empty-capture', pixels: { width: 0, height: 0 } })
    expect(empty.comparable).toBeUndefined()
  })
})
