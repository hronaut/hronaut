import { describe, expect, it, vi } from 'vitest'

// A screenshot is encoded as PNG in a worker, as is the picture for Home it gives of a tab in the background. The tab is
// not held for them meanwhile: holding it keeps its other captures waiting, and a tab in the background its hidden window
// shown, for as long as the encoder takes.

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
const PNG = { data: Buffer.from('png'), pixels: { digest: 'digest', width: 2, height: 1 } }
const PREVIEW = { jpeg: Buffer.from('preview'), width: 480, height: 300 }
vi.mock('../src/main/browser/screenshots/image-encoder.js', () => ({
  encodePng: async (image: { name: string }) => {
    order.push(`encode ${image.name}`)
    return PNG
  },
  encodePngAndPreview: (image: { name: string }, previewSize?: unknown) => {
    order.push(`encode ${image.name}${previewSize ? ' and its preview' : ''}`)
    return { png: Promise.resolve(PNG), preview: Promise.resolve(previewSize ? PREVIEW : undefined) }
  },
  encodePreview: async (image: { name: string }) => {
    order.push(`preview of ${image.name}`)
    return PREVIEW
  }
}))
vi.mock('../src/main/browser/tab-overview-previews/tab-overview-previews.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-overview-previews/tab-overview-previews.js')>(),
  keepBackgroundTabOverviewPreview: async (_browser: unknown, _tab: unknown, preview: Promise<unknown>) => {
    order.push(`keep ${(await preview) === PREVIEW ? 'preview' : 'nothing'}`)
  }
}))
import { Browser } from '../src/main/browser/browser.js'
import { screenshot } from '../src/main/browser/screenshots/screenshots.js'

/** A tab in view, or in the background, whose page has settled and whose viewport captures at the given size. */
function fixture({ background = false, width = 2, height = 1 } = {}) {
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
      return {
        name: 'viewport',
        isEmpty: () => false,
        getSize: () => ({ width, height }),
        toBitmap: () => Buffer.alloc(width * height * 4),
        toJPEG: () => Buffer.from('jpeg'),
        resize: (size: { width: number; height: number }) => ({ name: 'scaled', getSize: () => size, toJPEG: () => Buffer.from('jpeg') })
      }
    }
  }
  const tab = { id: 'tab-1', loading: false, navigationGeneration: 1, overviewPreviewSequence: 1, webContents }
  return Object.assign(Object.create(Browser.prototype), {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: background ? 'tab-2' : tab.id,
    splitViewContains: () => false,
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

  it('of a tab in the background gives its picture for Home from the PNG\'s own pixels, once the tab is let go', async () => {
    const shot = await screenshot(fixture({ background: true, width: 1280, height: 800 }), { tabId: 'tab-1' })
    expect(shot).toEqual({ data: Buffer.from('png'), mimeType: 'image/png', pixels: PNG.pixels })
    expect(order).toEqual(['tab held', 'capture', 'tab let go', 'encode viewport and its preview', 'keep preview'])
  })

  it('of a tab in the background, made smaller than its picture, gives the picture from the capture itself', async () => {
    await screenshot(fixture({ background: true, width: 1280, height: 800 }), { tabId: 'tab-1', maxWidth: 64 })
    expect(order).toEqual(['tab held', 'capture', 'tab let go', 'encode scaled', 'preview of viewport', 'keep preview'])
  })

  it('as JPEG of a tab in the background gives its picture once the tab is let go', async () => {
    const shot = await screenshot(fixture({ background: true, width: 1280, height: 800 }), { tabId: 'tab-1', format: 'jpeg' })
    expect(shot).toEqual({ data: Buffer.from('jpeg'), mimeType: 'image/jpeg' })
    expect(order).toEqual(['tab held', 'capture', 'tab let go', 'preview of viewport', 'keep preview'])
  })
})
