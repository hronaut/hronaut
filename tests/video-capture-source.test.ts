import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScreencastListener } from '../src/main/browser/page-screencast/page-screencast.js'

const screencast = vi.hoisted(() => ({ listener: undefined as ScreencastListener | undefined, subscribed: 0 }))

vi.mock('../src/main/browser/page-screencast/page-screencast.js', () => ({
  subscribePageScreencast: async (_browser: unknown, _page: unknown, _settings: unknown, listener: ScreencastListener) => {
    screencast.listener = listener
    screencast.subscribed += 1
    return () => { if (screencast.listener === listener) screencast.listener = undefined }
  }
}))
vi.mock('../src/main/browser/renderable-tab/renderable-tab.js', () => ({
  withRenderableTab: (_browser: unknown, _tab: unknown, operation: () => Promise<unknown>) => operation()
}))
vi.mock('../src/main/browser/browser-core.js', () => ({
  findTab: (browser: { tabs: Map<string, unknown> }, id: string) => browser.tabs.get(id)
}))

const { videoCaptureSource } = await import('../src/main/browser/video-recording/video-capture-source.js')

/** The smallest baseline JPEG header the recording's size check reads: a frame header and a scan. */
function jpeg(width: number, height: number, mark = 0): string {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, mark,
    0xff, 0xd9
  ]).toString('base64')
}

/** A shown, awake tab at https://a.test whose copies the test answers. */
function page() {
  const state = { loading: false, active: true, copySize: { width: 1280, height: 720 }, copies: 0 }
  const tab = {
    id: 'tab', url: 'https://a.test/', mcpGroupId: undefined, sleeping: false, pageLifecycleState: 'active', navigationGeneration: 1,
    view: { getVisible: () => true },
    webContents: {
      isDestroyed: () => false,
      isCrashed: () => false,
      isLoadingMainFrame: () => state.loading,
      capturePage: async () => {
        state.copies += 1
        return {
          getSize: () => state.copySize,
          resize: () => ({ toJPEG: () => Buffer.from(`copy-${state.copies}`) })
        }
      }
    }
  }
  const browser = {
    destroyed: false, browserContentOccluded: false,
    tabs: new Map([['tab', tab]]),
    get activeTabId() { return state.active ? 'tab' : 'other' },
    window: { isVisible: () => true, isMinimized: () => false }
  }
  return { state, tab, browser }
}

const frame = (data: string, viewportWidth = 800, viewportHeight = 600) =>
  screencast.listener!.frame({ data, epochMs: 1, viewportWidth, viewportHeight })

describe('video capture source', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['performance'] }) })
  afterEach(() => {
    vi.useRealTimers()
    screencast.listener = undefined
    screencast.subscribed = 0
  })

  const source = (fake: ReturnType<typeof page>) =>
    videoCaptureSource(fake.browser as never, fake.tab as never, 'https://a.test', undefined, () => undefined)

  it('copies a new document that drew nothing since it loaded instead of repeating the page it replaced', async () => {
    const fake = page()
    const capture = source(fake)
    // Until the screencast runs, the page is copied.
    expect(await capture()).toMatchObject({ width: 1280, height: 720 })
    await Promise.resolve()
    frame(jpeg(1280, 720, 1))
    expect(await capture()).toMatchObject({ width: 1280, height: 720 })
    expect(await capture()).toBe('unchanged')
    fake.tab.navigationGeneration = 2
    fake.state.loading = true
    expect(await capture()).toBeNull()
    // Drawn while the new page loads, so possibly still the old one.
    frame(jpeg(1280, 720, 2))
    expect(await capture()).toBeNull()
    fake.state.loading = false
    vi.advanceTimersByTime(100)
    const copies = fake.state.copies
    const result = await capture()
    expect(result).not.toBe('unchanged')
    expect(result).toMatchObject({ width: 1280, height: 720 })
    expect(fake.state.copies).toBe(copies + 1)
    // The copy shows the new document, so it repeats until the page draws again.
    expect(await capture()).toBe('unchanged')
  })

  it('gives no frame between copies once a copy found the page loading', async () => {
    const fake = page()
    fake.state.active = false
    const capture = source(fake)
    expect(await capture()).toMatchObject({ width: 1280, height: 720 })
    vi.advanceTimersByTime(10)
    expect(await capture()).toBe('unchanged')
    vi.advanceTimersByTime(100)
    fake.state.loading = true
    expect(await capture()).toBeNull()
    vi.advanceTimersByTime(30)
    fake.state.loading = false
    // The copy that found the page loading was 30 ms ago, so this sample makes no copy and has no frame to repeat.
    expect(await capture()).toBeNull()
    expect(screencast.subscribed).toBe(0)
  })

  it('checks a resumed recording against the viewport and copy size it started with', async () => {
    const fake = page()
    const first = source(fake)
    await first()
    await Promise.resolve()
    frame(jpeg(1280, 720, 1), 1600, 900)
    expect(await first()).toMatchObject({ width: 1280, height: 720 })
    first.release?.()
    const resumed = source(fake)
    resumed.continueFrom?.(first)
    fake.state.copySize = { width: 1920, height: 1080 }
    // The copy at the new size meets the size the recording started with.
    await expect(resumed()).rejects.toThrow('Restore the original viewport size before resuming')
    fake.state.copySize = { width: 1280, height: 720 }
    vi.advanceTimersByTime(100)
    await resumed()
    await Promise.resolve()
    frame(jpeg(1280, 720, 3), 1920, 1080)
    await expect(resumed()).rejects.toThrow('Restore the original viewport size before resuming')
  })
})
