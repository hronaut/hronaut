import { describe, expect, it, vi } from 'vitest'

// A screenshot is encoded as PNG in a worker. The tab is not held for it meanwhile: holding it keeps its other captures
// waiting, and a tab in the background its hidden window shown, for as long as the encoder takes.

const order = vi.hoisted(() => [] as string[])
vi.mock('electron', () => ({
  session: {}, WebContentsView: class {}, shell: {}, app: { getPath: () => '/tmp' },
  nativeImage: { createFromBitmap: () => ({ name: 'annotated' }) }
}))
vi.mock('../src/main/browser/renderable-tab/renderable-tab.js', () => ({
  withRenderableTab: async (_browser: unknown, _tab: unknown, run: () => Promise<unknown>) => {
    order.push('tab held')
    try {
      return await run()
    } finally {
      order.push('tab let go')
    }
  }
}))
vi.mock('../src/main/browser/agent-pointer/agent-pointer.js', () => ({ dismissAgentPointer: async () => undefined }))
vi.mock('../src/main/browser/visual-compare/visual-capture.js', () => ({
  visualCompareContext: async () => ({ viewportWidth: 2, viewportHeight: 1, devicePixelRatio: 1, scrollX: 0, scrollY: 0, zoomFactor: 1 })
}))
vi.mock('../src/shared/screenshot-annotations.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/shared/screenshot-annotations.js')>(),
  screenshotAnnotationScript: (_id: string, refs?: string[], cleanup = false) => cleanup ? 'marks off' : refs ? 'marks on' : 'read marks',
  annotateScreenshotBitmap: () => ({ annotated: [] })
}))
vi.mock('../src/main/browser/screenshots/png-encoder.js', () => ({
  encodePng: async (image: { name: string }) => {
    order.push(`encode ${image.name}`)
    return { data: Buffer.from('png'), pixels: { digest: 'digest', width: 2, height: 1 } }
  }
}))
import { Browser } from '../src/main/browser/browser.js'
import { screenshot } from '../src/main/browser/screenshots/screenshots.js'

function fixture() {
  order.length = 0
  const context = { tabId: 'tab-1', workspaceId: null, navigationGeneration: 1, observationGeneration: 0, humanInteractionGeneration: 0, snapshotFormatVersion: 1 }
  const webContents = {
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    executeJavaScriptInIsolatedWorld: async (_world: number, sources: Array<{ code: string }>) => {
      order.push(sources[0]!.code)
      return []
    },
    capturePage: async () => {
      order.push('capture')
      return { name: 'viewport', isEmpty: () => false, getSize: () => ({ width: 2, height: 1 }), toBitmap: () => Buffer.alloc(8) }
    }
  }
  const tab = { id: 'tab-1', loading: false, navigationGeneration: 1, webContents }
  return Object.assign(Object.create(Browser.prototype), {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    cssStatePreview: { active: () => false },
    snapshotDeltaContext: () => context
  }) as unknown as Browser
}

describe('a screenshot encoded as PNG', () => {
  it('is encoded once its tab is let go', async () => {
    const shot = await screenshot(fixture(), { tabId: 'tab-1' })
    expect(shot).toEqual({ data: Buffer.from('png'), mimeType: 'image/png', pixels: { digest: 'digest', width: 2, height: 1 } })
    expect(order).toEqual(['tab held', 'capture', 'tab let go', 'encode viewport'])
  })

  it('with snapshot refs marked is encoded once the marks are off the page and its tab is let go', async () => {
    const shot = await screenshot(fixture(), { tabId: 'tab-1', annotateRefs: ['e1'] })
    expect(shot).toEqual({ data: Buffer.from('png'), mimeType: 'image/png', annotations: { annotated: [] } })
    expect(order).toEqual(['tab held', 'marks on', 'capture', 'read marks', 'marks off', 'tab let go', 'encode annotated'])
  })
})
