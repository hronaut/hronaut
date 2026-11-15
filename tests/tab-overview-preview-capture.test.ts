import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'

vi.mock('electron', () => ({ nativeImage: {} }))
/** The worker's encoding of a frame, which each test answers when it likes. */
const encoder = vi.hoisted(() => ({ encodePreview: (() => Promise.resolve(undefined)) as (...args: unknown[]) => Promise<unknown> }))
vi.mock('../src/main/browser/screenshots/image-encoder.js', () => ({ encodePreview: (...args: unknown[]) => encoder.encodePreview(...args) }))

const { NativePreviewCapture } = await import('../src/main/browser/native-preview-capture.js')
const { keepBackgroundTabOverviewPreview, performTabOverviewPreviewCapture, scheduleTabOverviewPreview, storeTabOverviewPreview } =
  await import('../src/main/browser/tab-overview-previews/tab-overview-previews.js')
type Tab = Parameters<typeof performTabOverviewPreviewCapture>[1]

function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise<unknown>((done) => { resolve = done })
  return { promise, resolve }
}

/** An active, loaded tab in view in a focused window, whose page another capture is still reading. */
function busyTab() {
  const capturePage = vi.fn(async () => ({ isEmpty: () => true }))
  const tab = {
    id: 'tab-1', url: 'https://example.test/', loading: false, sleeping: false, navigationGeneration: 1, overviewPreviewSequence: 1,
    view: { getVisible: () => true }, webContents: { isDestroyed: () => false, capturePage }
  } as unknown as Tab
  const nativePreviewCapture = new NativePreviewCapture(2_000)
  const browser = {
    destroyed: false,
    window: { isDestroyed: () => false, isVisible: () => true, isFocused: () => true, isMinimized: () => false },
    tabs: new Map([[tab.id, tab]]),
    browserContentOccluded: false,
    activeTabId: tab.id,
    splitViewContains: () => false,
    nativePreviewCapture,
    tabOverviewPreviewTimers: new Map<string, NodeJS.Timeout>()
  } as unknown as Browser
  // Such as the picture of an agent's step, which shares the page's capture.
  const other = deferred()
  void nativePreviewCapture.run(tab.webContents, () => other.promise, () => undefined, () => undefined)
  // Trying again schedules the tab's next preview capture on a timer.
  const scheduled = () => browser.tabOverviewPreviewTimers.has(tab.id)
  return { tab, browser, capturePage, scheduled, finishOther: () => other.resolve({}) }
}

describe('tab overview preview capture', () => {
  it('tries again once another capture of the page is done', async () => {
    // The tab's capture got nothing while an agent step's picture of the page was being taken, and nothing tried
    // again, so the tab had no overview preview.
    const { tab, browser, capturePage, scheduled, finishOther } = busyTab()
    await performTabOverviewPreviewCapture(browser, tab, 1)
    expect(capturePage).not.toHaveBeenCalled()
    expect(scheduled()).toBe(false)
    finishOther()
    await vi.waitFor(() => expect(scheduled()).toBe(true))
    clearTimeout(browser.tabOverviewPreviewTimers.get(tab.id))
  })

  it('leaves it to a newer capture that took over meanwhile', async () => {
    const { tab, browser, scheduled, finishOther } = busyTab()
    await performTabOverviewPreviewCapture(browser, tab, 1)
    tab.overviewPreviewSequence = 2
    finishOther()
    await new Promise(resolve => setImmediate(resolve))
    expect(scheduled()).toBe(false)
  })

  it('never pictures Home, which lists the other tabs', () => {
    const { tab, browser, scheduled } = busyTab()
    tab.url = 'hronaut://home/'
    scheduleTabOverviewPreview(browser, tab)
    expect(scheduled()).toBe(false)
    tab.url = 'https://example.test/'
    scheduleTabOverviewPreview(browser, tab)
    expect(scheduled()).toBe(true)
    clearTimeout(browser.tabOverviewPreviewTimers.get(tab.id))
  })

  it('gives each stored frame a newer revision, so Home knows to read it again', () => {
    const { tab, browser } = busyTab()
    const previews = new Map<string, { revision?: number }>()
    Object.assign(browser, { tabOverviewPreviews: previews })
    const preview = { jpeg: Buffer.from('jpeg'), width: 480, height: 300 }
    storeTabOverviewPreview(browser, tab, preview, 1)
    const first = previews.get(tab.id)?.revision
    storeTabOverviewPreview(browser, tab, preview, 1)
    const second = previews.get(tab.id)?.revision
    expect(first).toEqual(expect.any(Number))
    expect(second).toBeGreaterThan(first!)
  })

  describe('made from an agent\'s screenshot of a tab in the background', () => {
    /** The tab in the background of the busy fixture, its stored previews, and its frame when the screenshot was taken. */
    function backgroundTab() {
      const { tab, browser } = busyTab()
      const previews = new Map<string, { dataUrl: string; width: number; height: number }>()
      const sleepPreviews = new Map<string, { dataUrl: string }>()
      Object.assign(browser, { activeTabId: 'other-tab', tabOverviewPreviews: previews, tabOverviewSleepPreviews: sleepPreviews })
      const frame = { navigationGeneration: 1, overviewPreviewSequence: tab.overviewPreviewSequence }
      const encoded = deferred()
      const keep = () => keepBackgroundTabOverviewPreview(browser, tab, encoded.promise as never, frame)
      const encode = async () => {
        encoded.resolve({ jpeg: Buffer.from('jpeg'), width: 480, height: 300 })
        await new Promise(resolve => setImmediate(resolve))
      }
      return { tab, browser, previews, sleepPreviews, keep, encode }
    }

    it('is kept as its picture once encoded, which happens after the agent has its screenshot', async () => {
      const { tab, previews, keep, encode } = backgroundTab()
      keep()
      expect(previews.size).toBe(0)
      await encode()
      expect(previews.get(tab.id)).toMatchObject({ dataUrl: `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`, width: 480, height: 300 })
    })

    it.each([
      ['came into view, whose own capture is newer', (fixture: ReturnType<typeof backgroundTab>) => {
        Object.assign(fixture.browser, { activeTabId: fixture.tab.id })
      }],
      ['was in view and back in the background meanwhile', (fixture: ReturnType<typeof backgroundTab>) => {
        fixture.tab.overviewPreviewSequence += 1
      }],
      ['navigated', (fixture: ReturnType<typeof backgroundTab>) => {
        fixture.tab.navigationGeneration += 1
      }]
    ])('is dropped when the tab %s while it was encoded', async (_, change) => {
      const fixture = backgroundTab()
      fixture.keep()
      change(fixture)
      await fixture.encode()
      expect(fixture.previews.size).toBe(0)
      expect(fixture.sleepPreviews.size).toBe(0)
    })

    it('is what Home shows of the tab while it sleeps when the tab went to sleep while it was encoded', async () => {
      // Sleep keeps the picture the tab had then, which this newer one replaces.
      const fixture = backgroundTab()
      fixture.sleepPreviews.set(fixture.tab.id, { dataUrl: 'data:image/jpeg;base64,b2xkZXI=' })
      fixture.keep()
      fixture.tab.sleeping = true
      await fixture.encode()
      expect(fixture.previews.size).toBe(0)
      expect(fixture.sleepPreviews.get(fixture.tab.id)).toMatchObject({ dataUrl: `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}` })
    })

    it('tells an open Home to read its tabs again once it is kept', async () => {
      const fixture = backgroundTab()
      const send = vi.fn()
      fixture.browser.tabs.set('home', { id: 'home', url: 'hronaut://home/', webContents: { isDestroyed: () => false, send } } as unknown as Tab)
      fixture.keep()
      expect(send).not.toHaveBeenCalled()
      await fixture.encode()
      expect(send).toHaveBeenCalledExactlyOnceWith('hronaut-home:tabs-changed')
    })
  })

  describe('of the tab in view', () => {
    /** An active, loaded tab in view in a focused window, whose capture gives a frame the worker encodes when told. */
    function shownTab() {
      const { tab, browser } = busyTab()
      const nativePreviewCapture = new NativePreviewCapture(2_000)
      const previews = new Map<string, { dataUrl: string }>()
      Object.assign(browser, { nativePreviewCapture, tabOverviewPreviews: previews, tabOverviewSleepPreviews: new Map() })
      Object.assign(tab.webContents, { capturePage: async () => ({ isEmpty: () => false }) })
      const encoded = deferred()
      const encodePreview = vi.fn(() => encoded.promise)
      encoder.encodePreview = encodePreview
      const encoding = () => vi.waitFor(() => expect(encodePreview).toHaveBeenCalledOnce())
      const encode = () => encoded.resolve({ jpeg: Buffer.from('jpeg'), width: 480, height: 300 })
      return { tab, browser, previews, encoding, encode }
    }

    it('is kept when the person leaves the tab while its frame is encoded, such as for Home\'s Tabs view', async () => {
      // The frame was the tab's in view when it was captured; it was dropped, and Home showed an older picture or none.
      const { tab, browser, previews, encoding, encode } = shownTab()
      const capture = performTabOverviewPreviewCapture(browser, tab, 1)
      await encoding()
      Object.assign(browser, { activeTabId: 'home' })
      Object.assign(browser.window, { isFocused: () => false })
      encode()
      await capture
      expect(previews.get(tab.id)).toMatchObject({ dataUrl: `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}` })
    })

    it('is not taken while the window is minimized, though another capture holds its page in view', async () => {
      // An agent's screenshot of a minimized window on Windows shows the page in its capture host meanwhile; the
      // preview captured it then, a frame the window never showed, and its capture got in the screenshot's way.
      const { tab, browser, previews } = shownTab()
      const capturePage = vi.fn(async () => ({ isEmpty: () => false }))
      Object.assign(tab.webContents, { capturePage })
      Object.assign(browser.window, { isMinimized: () => true })
      await performTabOverviewPreviewCapture(browser, tab, 1)
      expect(capturePage).not.toHaveBeenCalled()
      expect(previews.size).toBe(0)
    })

    it('is dropped when a newer capture of the tab took over while its frame was encoded', async () => {
      const { tab, browser, previews, encoding, encode } = shownTab()
      const capture = performTabOverviewPreviewCapture(browser, tab, 1)
      await encoding()
      tab.overviewPreviewSequence = 2
      encode()
      await capture
      expect(previews.size).toBe(0)
    })
  })
})
