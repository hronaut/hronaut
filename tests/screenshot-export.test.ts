import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { ScreenshotExportAccess, ScreenshotExportTab } from '../src/main/browser/screenshot-export/screenshot-export-access.js'
import { saveScreenshot, SCREENSHOT_EXPORT_MAX_BYTES, SCREENSHOT_EXPORT_MAX_CONCURRENT } from '../src/main/browser/screenshot-export/screenshot-export.js'

/** A captured image of the given size whose PNG has the given number of bytes. */
function image(width: number, height: number, pngBytes = 100) {
  const self = {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: ({ width: w, height: h }: { width: number; height: number }) => image(w, h, pngBytes),
    toPNG: () => Buffer.alloc(pngBytes)
  }
  return self
}

function exportPage(options: { view?: { width: number; height: number }; ratio?: number; capture?: () => Promise<unknown> } = {}) {
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    capturePage: vi.fn(options.capture ?? (async () => image(800, 600)))
  })
  const tab: ScreenshotExportTab = {
    id: 'tab-1',
    title: 'Checkout',
    navigationGeneration: 1,
    webContents: webContents as never,
    view: { getBounds: () => ({ x: 0, y: 0, ...(options.view ?? { width: 800, height: 600 }) }) } as never
  }
  const written: Array<{ filename: string; bytes: number }> = []
  const access: ScreenshotExportAccess<ScreenshotExportTab> = {
    getTab: () => tab,
    findTab: () => tab,
    findWorkspace: () => undefined,
    inspectionPermission: () => 0,
    isDestroyed: () => false,
    withRenderableTab: (_tab, operation) => operation(),
    dismissAgentPointer: async () => undefined,
    screenshotPixelRatio: () => options.ratio ?? 1,
    writeUniqueDownload: vi.fn(async (filename: string, data: Buffer, validate?: () => void) => {
      validate?.()
      written.push({ filename, bytes: data.length })
      return `/downloads/${filename}`
    }),
    screenshotFilename: (requested, title) => `${requested ?? title}.png`
  }
  return { access, tab, webContents, written }
}

describe('screenshot export', () => {
  it('writes the viewport PNG and returns only its metadata', async () => {
    const page = exportPage()
    const saved = await saveScreenshot(page.access, { filename: 'record' })
    expect(saved).toMatchObject({ filename: 'record.png', path: '/downloads/record.png', mimeType: 'image/png', width: 800, height: 600, bytes: 100 })
    expect(Number.isNaN(Date.parse(saved.capturedAt))).toBe(false)
    expect(page.written).toEqual([{ filename: 'record.png', bytes: 100 }])
  })

  it('scales the saved image to maxWidth and maxHeight', async () => {
    const saved = await saveScreenshot(exportPage().access, { maxWidth: 400, maxHeight: 400 })
    expect({ width: saved.width, height: saved.height }).toEqual({ width: 400, height: 300 })
  })

  it('refuses a viewport over an 8K frame before capturing it', async () => {
    const page = exportPage({ view: { width: 4000, height: 3000 }, ratio: 2 })
    await expect(saveScreenshot(page.access)).rejects.toThrow('larger than an 8K frame')
    expect(page.webContents.capturePage).not.toHaveBeenCalled()
    expect(page.written).toEqual([])
  })

  it('refuses a PNG over the byte limit before writing it', async () => {
    const page = exportPage({ capture: async () => image(800, 600, SCREENSHOT_EXPORT_MAX_BYTES + 1) })
    await expect(saveScreenshot(page.access)).rejects.toThrow('larger than 64 MiB')
    expect(page.written).toEqual([])
  })

  it('writes nothing when the page navigates during the capture', async () => {
    const page = exportPage({
      capture: async () => {
        page.webContents.emit('did-navigate')
        return image(800, 600)
      }
    })
    await expect(saveScreenshot(page.access, {}, () => undefined)).rejects.toThrow('page changed')
    expect(page.written).toEqual([])
    expect(page.webContents.listenerCount('did-navigate')).toBe(0)
  })

  it('writes nothing when the call is cancelled during the capture', async () => {
    let cancelled = false
    const page = exportPage({
      capture: async () => {
        cancelled = true
        return image(800, 600)
      }
    })
    await expect(saveScreenshot(page.access, {}, () => { if (cancelled) throw new Error('Screenshot export cancelled') })).rejects.toThrow('cancelled')
    expect(page.written).toEqual([])
  })

  it(`saves at most ${SCREENSHOT_EXPORT_MAX_CONCURRENT} screenshots at once`, async () => {
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const page = exportPage({ capture: async () => { await held; return image(800, 600) } })
    const running = Array.from({ length: SCREENSHOT_EXPORT_MAX_CONCURRENT }, () => saveScreenshot(page.access))
    await vi.waitFor(() => expect(page.webContents.capturePage).toHaveBeenCalledTimes(SCREENSHOT_EXPORT_MAX_CONCURRENT))
    await expect(saveScreenshot(page.access)).rejects.toThrow('already being saved')
    release()
    await Promise.all(running)
    await expect(saveScreenshot(page.access)).resolves.toMatchObject({ filename: 'Checkout.png' })
  })

  it('keeps the document check for the caller to publish when deferred', async () => {
    const page = exportPage()
    let pending: { assertCurrent(): void; discard(): void } | undefined
    await saveScreenshot(page.access, {}, () => undefined, deferred => { pending = deferred })
    expect(page.webContents.listenerCount('did-navigate')).toBe(1)
    page.webContents.emit('did-navigate')
    expect(() => pending!.assertCurrent()).toThrow('page changed')
    pending!.discard()
    expect(page.webContents.listenerCount('did-navigate')).toBe(0)
  })
})
