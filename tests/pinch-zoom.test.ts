import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ browserState: () => ({}), publishChange: () => undefined }))
const { setZoom, setZoomForAgent } = await import('../src/main/browser/page-zoom/page-zoom.js')
const { allowPinchZoom, PINCH_ZOOM_MAXIMUM } = await import('../src/main/browser/page-zoom/pinch-zoom.js')

const HOME = 'hronaut://home/'

/**
 * A tab whose page records the pinch limits it is given and can be sent to another address; `fails` makes giving them
 * fail, as for a page that is gone, `held` keeps each from settling until `settle` is called, and `pinched` is whether
 * its page reports a pinch.
 */
function tab(options: { fails?: boolean; held?: boolean; url?: string; mobile?: boolean; pinched?: boolean; sleeping?: boolean } = {}) {
  const limits: Array<[number, number]> = []
  const waiting: Array<() => void> = []
  const navigated: Array<(event: unknown, url: string) => void> = []
  let url = options.url ?? 'https://example.com/'
  const webContents = {
    getZoomFactor: () => 1.25,
    getURL: () => url,
    executeJavaScript: vi.fn(async () => options.pinched ?? true),
    setZoomFactor: vi.fn(),
    on: vi.fn((name: string, listener: (event: unknown, url: string) => void) => {
      if (name === 'did-navigate') navigated.push(listener)
      return webContents
    }),
    setVisualZoomLevelLimits: vi.fn(async (minimum: number, maximum: number) => {
      limits.push([minimum, maximum])
      if (options.held) await new Promise<void>(resolve => waiting.push(resolve))
      if (options.fails) throw new Error('Render frame was disposed')
    })
  }
  const emulation = options.mobile ? { viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true } } : {}
  const site = { id: 'site', nativeInputEnvironmentGeneration: 0, webContents, emulation, sleeping: options.sleeping === true }
  const browser = { activeTabId: 'site', tabs: new Map([['site', site]]) }
  const navigate = (to: string): void => {
    url = to
    for (const listener of navigated) listener({}, to)
  }
  const settle = (): void => { for (const resolve of waiting.splice(0)) resolve() }
  const keepsOwnScale = (): boolean => site.emulation.viewport?.mobile === true
  return { browser: browser as never, webContents, limits, navigate, settle, keepsOwnScale }
}

describe('pinch zoom', () => {
  // Electron turns pinch zoom off, so a pinch did nothing to a page.
  it('lets a page be pinched up to Chrome\'s limit, 3 times its size on macOS and 4 times elsewhere', async () => {
    expect(PINCH_ZOOM_MAXIMUM).toBe(process.platform === 'darwin' ? 3 : 4)
    const page = tab()
    allowPinchZoom(page.webContents as unknown as WebContents, page.webContents.getURL(), page.keepsOwnScale)
    expect(page.limits).toEqual([[1, PINCH_ZOOM_MAXIMUM]])
    // A page with no renderer keeps the limits for later, and nothing is thrown.
    const asleep = tab({ fails: true })
    allowPinchZoom(asleep.webContents as unknown as WebContents, asleep.webContents.getURL(), asleep.keepsOwnScale)
    await vi.waitFor(() => expect(asleep.limits).toEqual([[1, PINCH_ZOOM_MAXIMUM]]))
  })

  // Home opens at its normal size and has no zoom to reset, so a pinch there could not be undone.
  it('keeps Hronaut Home at its normal scale, also in a tab that goes to and from websites', async () => {
    const page = tab({ url: HOME, pinched: false })
    allowPinchZoom(page.webContents as unknown as WebContents, HOME, page.keepsOwnScale)
    page.navigate('https://example.com/')
    page.navigate(HOME)
    expect(page.limits).toEqual([[1, 1], [1, PINCH_ZOOM_MAXIMUM], [1, 1]])
    // Home is never pinched, so its reset leaves the limits as they are.
    await setZoomForAgent(page.browser, { action: 'reset' })
    expect(page.limits).toHaveLength(3)
  })

  // Setting the limits applies all of the tab's preferences again, over the scale a phone viewport an agent emulates
  // sets for itself, so a wide page was no longer shown smaller to fit.
  it('sets the limits again only when the tab goes to or from Home, and leaves an emulated phone\'s scale alone', async () => {
    const page = tab()
    allowPinchZoom(page.webContents as unknown as WebContents, 'https://example.com/', page.keepsOwnScale)
    page.navigate('https://example.com/next')
    page.navigate('https://example.org/')
    expect(page.limits).toEqual([[1, PINCH_ZOOM_MAXIMUM]])
    const phone = tab({ mobile: true })
    allowPinchZoom(phone.webContents as unknown as WebContents, 'https://example.com/', phone.keepsOwnScale)
    // Home in an emulated phone viewport waits for its next change of address, which sets them once it ends.
    phone.navigate(HOME)
    phone.navigate('https://example.com/')
    expect(phone.limits).toEqual([[1, PINCH_ZOOM_MAXIMUM]])
    await setZoomForAgent(phone.browser, { action: 'reset' })
    expect(phone.webContents.setZoomFactor).toHaveBeenCalledExactlyOnceWith(1)
    expect(phone.limits).toEqual([[1, PINCH_ZOOM_MAXIMUM]])
  })

  // Setting the limits also undid the scale of a phone viewport emulated in Developer Tools, which Hronaut does not know.
  it('leaves the limits of a page that is not pinched, or of a tab asleep, as they are when the zoom is reset', async () => {
    const page = tab({ pinched: false })
    await setZoomForAgent(page.browser, { action: 'reset' })
    expect(page.webContents.setZoomFactor).toHaveBeenCalledExactlyOnceWith(1)
    expect(page.webContents.executeJavaScript).toHaveBeenCalledOnce()
    expect(page.limits).toEqual([])
    const asleep = tab({ sleeping: true })
    await setZoomForAgent(asleep.browser, { action: 'reset' })
    expect(asleep.webContents.executeJavaScript).not.toHaveBeenCalled()
    expect(asleep.limits).toEqual([])
  })

  it('shows a pinched page at its normal scale again when its zoom is reset, as Chrome does', async () => {
    const page = tab()
    setZoom(page.browser, { action: 'reset' })
    expect(page.webContents.setZoomFactor).toHaveBeenCalledExactlyOnceWith(1)
    await vi.waitFor(() => expect(page.limits).toEqual([[1, 1], [1, PINCH_ZOOM_MAXIMUM]]))
  })

  // The agent's next native input refuses a pinched page, so the agent is answered once the pinch is undone.
  it('answers an agent\'s reset once the pinch is undone', async () => {
    const page = tab({ held: true })
    let answered = false
    const reset = setZoomForAgent(page.browser, { action: 'reset' }).then(() => { answered = true })
    await vi.waitFor(() => expect(page.limits).toEqual([[1, 1]]))
    page.settle()
    await vi.waitFor(() => expect(page.limits).toEqual([[1, 1], [1, PINCH_ZOOM_MAXIMUM]]))
    expect(answered).toBe(false)
    page.settle()
    await reset
    expect(answered).toBe(true)
    // A step needs no pinch undone, so it is answered at once.
    await setZoomForAgent(page.browser, { action: 'in' })
    expect(page.limits).toHaveLength(2)
  })

  it('answers an agent\'s reset after 2 seconds when the page never does', async () => {
    vi.useFakeTimers()
    try {
      const page = tab({ held: true })
      let answered = false
      const reset = setZoomForAgent(page.browser, { action: 'reset' }).then(() => { answered = true })
      await vi.advanceTimersByTimeAsync(1_999)
      expect(answered).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await reset
      expect(answered).toBe(true)
      // The page answers later, and the limits are widened again.
      page.settle()
      await vi.advanceTimersByTimeAsync(0)
      expect(page.limits).toEqual([[1, 1], [1, PINCH_ZOOM_MAXIMUM]])
      page.settle()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the pinch when the zoom only steps or is set', async () => {
    const page = tab()
    setZoom(page.browser, { action: 'in' })
    setZoom(page.browser, { action: 'out' })
    setZoom(page.browser, { action: 'set', percent: 150 })
    await Promise.resolve()
    expect(page.limits).toEqual([])
  })

  it('widens the limits again even when narrowing them fails', async () => {
    const page = tab({ fails: true })
    setZoom(page.browser, { action: 'reset' })
    await vi.waitFor(() => expect(page.limits).toEqual([[1, 1], [1, PINCH_ZOOM_MAXIMUM]]))
  })
})
