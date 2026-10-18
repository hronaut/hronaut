import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { ScreenshotExportAccess, ScreenshotExportTab } from '../src/main/browser/screenshot-export/screenshot-export-access.js'
import { saveScreenshot, SCREENSHOT_EXPORT_MAX_BYTES, SCREENSHOT_EXPORT_MAX_CONCURRENT, type PendingScreenshotExport } from '../src/main/browser/screenshot-export/screenshot-export.js'
import { screenshotExportSettlement } from '../src/main/mcp/tools/browser-screenshot-save/screenshot-save-settlement.js'

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

function exportPage(options: {
  view?: { width: number; height: number }
  emulated?: { width: number; height: number }
  scale?: number
  capture?: () => Promise<unknown>
  /** Stands in for the tab's render queue, which runs the capture in the tab's turn. */
  render?: <T>(operation: () => Promise<T>) => Promise<T>
  /** Runs once the file's bytes are written, before the writer's last checks. */
  onWritten?: () => void
} = {}) {
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    capturePage: vi.fn(options.capture ?? (async () => image(800, 600)))
  })
  const tab: ScreenshotExportTab = {
    id: 'tab-1',
    title: 'Checkout',
    navigationGeneration: 1,
    mcpGroupId: 'workspace-1',
    webContents: webContents as never,
    view: { getBounds: () => ({ x: 0, y: 0, ...(options.view ?? { width: 800, height: 600 }) }) } as never,
    emulation: options.emulated ? { viewport: { ...options.emulated, deviceScaleFactor: 3, mobile: true, touch: false, orientation: 'portrait' } } as never : {} as never,
    ...(options.emulated ? { emulationViewSize: options.emulated } : {})
  }
  const written: Array<{ filename: string; bytes: number }> = []
  const workspaces = new Map<string, object>([['workspace-1', {}]])
  let tabOpen = true
  const access: ScreenshotExportAccess<ScreenshotExportTab> = {
    getTab: () => tab,
    findTab: () => tabOpen ? tab : undefined,
    findWorkspace: id => workspaces.get(id),
    inspectionPermission: () => 0,
    isDestroyed: () => false,
    withRenderableTab: (_tab, operation) => options.render ? options.render(operation) : operation(),
    dismissAgentPointer: async () => undefined,
    captureScale: () => options.scale ?? 1,
    writeUniqueDownload: vi.fn(async (filename: string, data: Buffer, validate?: () => void) => {
      validate?.()
      options.onWritten?.()
      // Like the real writer, check again once the bytes are on disk and remove the file when that fails.
      validate?.()
      written.push({ filename, bytes: data.length })
      return `/downloads/${filename}`
    }),
    screenshotFilename: (requested, title) => `${requested ?? title}.png`
  }
  return {
    access, tab, webContents, written,
    revokeWorkspace: () => { workspaces.set('workspace-1', {}) },
    closeTab: () => { tabOpen = false }
  }
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
    const page = exportPage({ view: { width: 4000, height: 3000 }, scale: 2 })
    await expect(saveScreenshot(page.access)).rejects.toThrow('more pixels than an 8K frame')
    expect(page.webContents.capturePage).not.toHaveBeenCalled()
    expect(page.written).toEqual([])
  })

  it('bounds an emulated viewport larger than the view showing it before capturing it', async () => {
    const page = exportPage({ view: { width: 940, height: 390 }, emulated: { width: 3840, height: 3840 }, scale: 2 })
    await expect(saveScreenshot(page.access)).rejects.toThrow('more pixels than an 8K frame')
    expect(page.webContents.capturePage).not.toHaveBeenCalled()
  })

  it('does not count the emulated pixel ratio, which does not change the capture size', async () => {
    // At the emulated ratio of 3 this would be 36.9 million pixels, over the bound; the capture has 4.1 million.
    const page = exportPage({ view: { width: 2560, height: 1600 }, emulated: { width: 2560, height: 1600 }, capture: async () => image(2560, 1600) })
    await expect(saveScreenshot(page.access)).resolves.toMatchObject({ width: 2560, height: 1600 })
  })

  it('refuses a capture that came back larger than its bound', async () => {
    const page = exportPage({ capture: async () => image(7681, 4320) })
    await expect(saveScreenshot(page.access)).rejects.toThrow('could not capture a bounded image')
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

  it('fails the write when the page navigates while the file is being written', async () => {
    const page = exportPage({ onWritten: () => { page.webContents.emit('did-navigate') } })
    await expect(saveScreenshot(page.access, {}, () => undefined)).rejects.toThrow('page changed')
    expect(page.written).toEqual([])
  })

  it('writes nothing when the workspace\'s access changes or the tab closes during the capture', async () => {
    const revoked = exportPage({ capture: async () => { revoked.revokeWorkspace(); return image(800, 600) } })
    await expect(saveScreenshot(revoked.access, {}, () => undefined)).rejects.toThrow('Workspace access changed')
    const closed = exportPage({ capture: async () => { closed.closeTab(); return image(800, 600) } })
    await expect(saveScreenshot(closed.access, {}, () => undefined)).rejects.toThrow('tab closed')
    expect([...revoked.written, ...closed.written]).toEqual([])
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

  it('holds no slot while waiting for the tab\'s turn to render, nor after failing before it', async () => {
    const gates: Array<() => void> = []
    const queued = exportPage({ render: async operation => { await new Promise<void>(resolve => { gates.push(resolve) }); return operation() } })
    const waiting = Array.from({ length: SCREENSHOT_EXPORT_MAX_CONCURRENT }, () => saveScreenshot(queued.access))
    await vi.waitFor(() => expect(gates).toHaveLength(SCREENSHOT_EXPORT_MAX_CONCURRENT))
    // Exports still waiting for their render turn leave the slots free.
    await expect(saveScreenshot(exportPage().access)).resolves.toMatchObject({ filename: 'Checkout.png' })
    for (const release of gates) release()
    await Promise.all(waiting)
    // An export whose render turn fails before it starts gives back no slot it never took.
    const failed = exportPage({ render: async () => { throw new Error('The tab closed while rendering its page.') } })
    await expect(saveScreenshot(failed.access)).rejects.toThrow('tab closed')
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const busy = exportPage({ capture: async () => { await held; return image(800, 600) } })
    const running = Array.from({ length: SCREENSHOT_EXPORT_MAX_CONCURRENT }, () => saveScreenshot(busy.access))
    await vi.waitFor(() => expect(busy.webContents.capturePage).toHaveBeenCalledTimes(SCREENSHOT_EXPORT_MAX_CONCURRENT))
    await expect(saveScreenshot(busy.access)).rejects.toThrow('already being saved')
    release()
    await Promise.all(running)
  })

  it('hands the caller only an authority check once the file is complete', async () => {
    const page = exportPage()
    let pending: PendingScreenshotExport | undefined
    await saveScreenshot(page.access, {}, () => undefined, deferred => { pending = deferred })
    expect(page.webContents.listenerCount('did-navigate')).toBe(0)
    // A later navigation does not change the saved file. The export itself
    // ignores a closed tab too; the tool's own validation refuses it.
    page.webContents.emit('did-navigate')
    page.closeTab()
    expect(() => pending!.assertAuthority()).not.toThrow()
    page.revokeWorkspace()
    expect(() => pending!.assertAuthority()).toThrow('Workspace access changed')
  })
})

describe('screenshot save settlement', () => {
  const saved = { content: [{ type: 'text' as const, text: JSON.stringify({ filename: 'Checkout.png', path: '/downloads/Checkout.png' }) }] }
  const failed = { isError: true, content: [{ type: 'text' as const, text: 'The workspace context changed while this tool was running.' }] }
  const activity = { readOnly: false, dispatched: true, invalidatedOutcome: undefined }
  const withheld = (result: { structuredContent?: Record<string, unknown>; content: Array<{ type: string; text?: string }> } | undefined) => {
    expect(result?.structuredContent).toMatchObject({ status: 'SAVED_UNCONFIRMED', effects: 'file-written', retrySafe: false })
    expect(JSON.stringify(result)).not.toContain('Checkout')
    expect(JSON.stringify(result)).not.toContain('/downloads')
  }

  it('leaves failures before the file was written to the shared handling', () => {
    const settlement = screenshotExportSettlement()
    expect(settlement.publish(failed)).toBeUndefined()
    expect(settlement.settleError()).toBeUndefined()
    expect(settlement.publicationRevoked()).toBeUndefined()
    expect(settlement.effectsPossible()).toBe(false)
    expect(settlement.classifyActivity(activity)).toMatchObject({ dispatched: false })
  })

  it('publishes the file only while the call still has its authority', () => {
    const settlement = screenshotExportSettlement()
    settlement.retain({ assertAuthority: () => undefined })
    expect(settlement.publish(saved)).toBe(saved)
    const revoked = screenshotExportSettlement()
    revoked.retain({ assertAuthority: () => { throw new Error('Agents are paused for this target.') } })
    const result = revoked.publish(saved)
    withheld(result)
    expect(JSON.stringify(result)).not.toContain('paused')
  })

  it('says a file was saved, without where, whenever the call fails after the write', () => {
    const settlement = screenshotExportSettlement()
    settlement.retain({ assertAuthority: () => undefined })
    withheld(settlement.publish(failed))
    withheld(settlement.settleError())
    withheld(settlement.publicationRevoked())
    expect(settlement.effectsPossible()).toBe(true)
    expect(settlement.classifyActivity(activity)).toMatchObject({ dispatched: true })
  })
})
