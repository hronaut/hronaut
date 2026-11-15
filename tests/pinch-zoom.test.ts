import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ browserState: () => ({}), publishChange: () => undefined }))
const { setZoom, setZoomForAgent } = await import('../src/main/browser/page-zoom/page-zoom.js')
const { allowPinchZoom, PINCH_ZOOM_MAXIMUM } = await import('../src/main/browser/page-zoom/pinch-zoom.js')

const HOME = 'hronaut://home/'

/**
 * A tab whose page records the pinch limits it is given, and each time it is asked whether it is pinched, in `events`,
 * and can be sent to another address; `fails` makes giving limits fail, as for a page that is gone, `held` keeps each
 * from settling until `settle` is called, and `pinched` is whether its page reports a pinch. Narrowed limits show the
 * page at its normal scale at its next layout: by the next time it is asked, or, for a busy page, after `lateLooks`
 * more. Once its limits are narrowed, `silent` keeps the page from answering, `lookFails` makes asking it fail, and
 * `loads` has it open another document.
 */
function tab(options: {
  fails?: boolean; held?: boolean; url?: string; mobile?: boolean; pinched?: boolean; sleeping?: boolean
  lateLooks?: number; silent?: boolean; lookFails?: boolean; loads?: boolean
} = {}) {
  const limits: Array<[number, number]> = []
  const events: string[] = []
  let pinched = options.pinched ?? true
  let narrowed = false
  let lateLooks = options.lateLooks ?? 0
  const look = async (): Promise<boolean> => {
    if (narrowed && options.silent) return await new Promise<boolean>(() => undefined)
    if (narrowed && options.lookFails) throw new Error('Render frame was disposed')
    if (narrowed && pinched && lateLooks-- <= 0) pinched = false
    events.push(`look ${pinched}`)
    return pinched
  }
  const waiting: Array<() => void> = []
  const navigated: Array<(event: unknown, url: string) => void> = []
  let url = options.url ?? 'https://example.com/'
  const webContents = {
    getZoomFactor: () => 1.25,
    getURL: () => url,
    // A page's source refuses page scripts, as Hronaut's source view guard does; its main frame's own call answers.
    isLoadingMainFrame: () => narrowed && options.loads === true,
    executeJavaScript: vi.fn(async () => {
      if (url.startsWith('view-source:')) throw new Error('SourceViewError')
      return await look()
    }),
    mainFrame: { executeJavaScript: vi.fn(look) },
    setZoomFactor: vi.fn(),
    on: vi.fn((name: string, listener: (event: unknown, url: string) => void) => {
      if (name === 'did-navigate') navigated.push(listener)
      return webContents
    }),
    setVisualZoomLevelLimits: vi.fn(async (minimum: number, maximum: number) => {
      limits.push([minimum, maximum])
      events.push(`limits ${minimum}-${maximum}`)
      if (options.held) await new Promise<void>(resolve => waiting.push(resolve))
      if (options.fails) throw new Error('Render frame was disposed')
      if (maximum === 1) narrowed = true
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
  return { browser: browser as never, webContents, limits, events, navigate, settle, keepsOwnScale }
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

  // A page's source runs no page script, so it could not say it was pinched, and neither a reset nor Ctrl/Cmd+0 undid
  // a pinch there, while an agent's native input on it was refused until a reset.
  it('asks a page source through its main frame whether it is pinched when its zoom is reset', async () => {
    const source = tab({ url: 'view-source:https://example.com/' })
    await setZoomForAgent(source.browser, { action: 'reset' })
    expect(source.webContents.executeJavaScript).not.toHaveBeenCalled()
    // Once to see the pinch, and once to see it undone.
    expect(source.webContents.mainFrame.executeJavaScript).toHaveBeenCalledTimes(2)
    expect(source.limits).toEqual([[1, 1], [1, PINCH_ZOOM_MAXIMUM]])
    const unpinched = tab({ url: 'view-source:https://example.com/', pinched: false })
    await setZoomForAgent(unpinched.browser, { action: 'reset' })
    expect(unpinched.limits).toEqual([])
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

  // A busy page took the narrowed limits only at a later layout and until then still reported its pinch, which the
  // agent's next read of the page found right after its reset answered (seen in the 3.14.16 release rehearsal).
  it('shows the page at its normal scale by the time a reset answers, and only then widens the limits again', async () => {
    const page = tab({ lateLooks: 3 })
    await setZoomForAgent(page.browser, { action: 'reset' })
    expect(page.events).toEqual(['look true', 'limits 1-1', 'look true', 'look true', 'look true', 'look false', 'limits 1-4'])
    expect(await page.webContents.executeJavaScript()).toBe(false)
  })

  it('widens the limits again after about a second when the page keeps showing its pinch, or stops answering', async () => {
    vi.useFakeTimers()
    try {
      const busy = tab({ lateLooks: Number.POSITIVE_INFINITY })
      const silent = tab({ silent: true })
      setZoom(busy.browser, { action: 'reset' })
      setZoom(silent.browser, { action: 'reset' })
      await vi.advanceTimersByTimeAsync(999)
      expect(busy.limits).toEqual([[1, 1]])
      expect(silent.limits).toEqual([[1, 1]])
      await vi.advanceTimersByTimeAsync(1)
      expect(silent.limits).toEqual([[1, 1], [1, PINCH_ZOOM_MAXIMUM]])
      await vi.advanceTimersByTimeAsync(16)
      expect(busy.limits).toEqual([[1, 1], [1, PINCH_ZOOM_MAXIMUM]])
    } finally {
      vi.useRealTimers()
    }
  })

  it('widens the limits again at once when asking the page fails or it opens another document', async () => {
    const failing = tab({ lookFails: true })
    await setZoomForAgent(failing.browser, { action: 'reset' })
    expect(failing.limits).toEqual([[1, 1], [1, PINCH_ZOOM_MAXIMUM]])
    const loading = tab({ loads: true })
    await setZoomForAgent(loading.browser, { action: 'reset' })
    expect(loading.events).toEqual(['look true', 'limits 1-1', 'limits 1-4'])
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
