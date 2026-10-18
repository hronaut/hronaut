import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

// The decoded image is the PNG bytes themselves here, so two captures differ exactly when their bytes do.
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: (data: Buffer) => ({ getSize: () => ({ width: 4, height: 2 }), toBitmap: () => data })
  }
}))

const { trackedViewportScreenshot } = await import('../src/main/browser/screenshot-observations/tracked-screenshot.js')
type Access = Parameters<typeof trackedViewportScreenshot>[0]

const CONTEXT = { tabId: 'tab-1', workspaceId: 'workspace-1', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0, snapshotFormatVersion: 1 }

/** A tab whose page answers each geometry read with the next entry, and whose capture runs the given hook. */
function fakeTab(geometries: number[][], duringCapture?: (state: { context: typeof CONTEXT; preview: boolean }) => void) {
  const scripts: Array<{ world: number }> = []
  const webContents = {
    isDestroyed: () => false,
    getZoomFactor: () => 1,
    executeJavaScriptInIsolatedWorld: async (world: number) => {
      scripts.push({ world })
      return geometries.shift()
    }
  } as unknown as WebContents
  const tab = { id: 'tab-1', webContents }
  const state = { context: CONTEXT, preview: false }
  const captures: unknown[] = []
  const access: Access = {
    getTab: () => tab,
    findTab: () => tab,
    snapshotDeltaContext: () => state.context,
    cssStatePreviewActive: () => state.preview,
    captureViewport: async (options) => {
      captures.push(options)
      duringCapture?.(state)
      return { data: Buffer.from('pixels'), mimeType: 'image/png' }
    }
  }
  return { access, scripts, captures }
}

const STILL = [1280, 720, 1, 0, 0, 1, 0, 0]

describe('trackedViewportScreenshot', () => {
  it('captures the resolved tab with the given options and fingerprints the decoded pixels in the observation world', async () => {
    const { access, scripts, captures } = fakeTab([STILL, STILL])
    const capture = await trackedViewportScreenshot(access, { format: 'jpeg', quality: 70, maxWidth: 800 })
    expect(captures).toEqual([{ format: 'jpeg', quality: 70, maxWidth: 800, tabId: 'tab-1' }])
    expect(scripts.map(script => script.world)).toEqual([1027, 1027])
    expect(capture).toMatchObject({ tabId: 'tab-1', mimeType: 'image/png', pixels: { width: 4, height: 2, digest: expect.stringMatching(/^[0-9a-f]{64}$/) } })
    expect(JSON.parse(capture.comparable!)).toMatchObject({ context: CONTEXT, preview: false, options: { format: 'jpeg', quality: 70, maxWidth: 800 } })
    const again = await trackedViewportScreenshot(fakeTab([STILL, STILL]).access, { format: 'jpeg', quality: 70, maxWidth: 800 })
    expect(again.comparable).toBe(capture.comparable)
    expect(again.pixels.digest).toBe(capture.pixels.digest)
  })

  it('cannot be compared when the page scrolled, navigated or changed its forced CSS state during the capture', async () => {
    const scrolled = await trackedViewportScreenshot(fakeTab([STILL, [1280, 720, 1, 0, 40, 1, 0, 0]]).access, {})
    expect(scrolled.comparable).toBeUndefined()
    const navigated = await trackedViewportScreenshot(fakeTab([STILL, STILL], state => { state.context = { ...CONTEXT, navigationGeneration: 2 } }).access, {})
    expect(navigated.comparable).toBeUndefined()
    const previewed = await trackedViewportScreenshot(fakeTab([STILL, STILL], state => { state.preview = true }).access, {})
    expect(previewed.comparable).toBeUndefined()
  })

  it('fails when the viewport geometry cannot be read', async () => {
    await expect(trackedViewportScreenshot(fakeTab([[1280, Number.NaN]]).access, {})).rejects.toThrow(/viewport geometry/)
  })
})
