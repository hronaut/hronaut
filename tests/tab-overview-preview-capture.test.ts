import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'

vi.mock('electron', () => ({ nativeImage: {} }))

const { NativePreviewCapture } = await import('../src/main/browser/native-preview-capture.js')
const { performTabOverviewPreviewCapture } = await import('../src/main/browser/tab-overview-previews/tab-overview-previews.js')
type Tab = Parameters<typeof performTabOverviewPreviewCapture>[1]

function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise<unknown>((done) => { resolve = done })
  return { promise, resolve }
}

/** An active, loaded tab in a focused window, in view or behind the overview, whose page another capture is still reading. */
function busyTab(overviewOpen = false) {
  const capturePage = vi.fn(async () => ({ isEmpty: () => true }))
  const tab = {
    id: 'tab-1', url: 'https://example.test/', loading: false, sleeping: false, navigationGeneration: 1, overviewPreviewSequence: 1,
    view: { getVisible: () => true }, webContents: { isDestroyed: () => false, capturePage }
  } as unknown as Tab
  const nativePreviewCapture = new NativePreviewCapture(2_000)
  const browser = {
    destroyed: false,
    window: { isDestroyed: () => false, isVisible: () => true, isFocused: () => true },
    tabs: new Map([[tab.id, tab]]),
    browserContentOccluded: overviewOpen,
    activeTabId: tab.id,
    splitViewContains: () => false,
    nativePreviewCapture,
    tabOverviewPreviewTimers: new Map<string, NodeJS.Timeout>(),
    tabOverviewPreviewableTabs: new Set<string>([tab.id])
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
    await performTabOverviewPreviewCapture(browser, tab, 1, 'visible')
    expect(capturePage).not.toHaveBeenCalled()
    expect(scheduled()).toBe(false)
    finishOther()
    await vi.waitFor(() => expect(scheduled()).toBe(true))
    clearTimeout(browser.tabOverviewPreviewTimers.get(tab.id))
  })

  it('leaves the open overview to refresh its own frames', async () => {
    const { tab, browser, capturePage, scheduled, finishOther } = busyTab(true)
    await performTabOverviewPreviewCapture(browser, tab, 1, 'overview')
    finishOther()
    await new Promise(resolve => setImmediate(resolve))
    expect(capturePage).not.toHaveBeenCalled()
    expect(scheduled()).toBe(false)
  })

  it('leaves it to a newer capture that took over meanwhile', async () => {
    const { tab, browser, scheduled, finishOther } = busyTab()
    await performTabOverviewPreviewCapture(browser, tab, 1, 'visible')
    tab.overviewPreviewSequence = 2
    finishOther()
    await new Promise(resolve => setImmediate(resolve))
    expect(scheduled()).toBe(false)
  })
})
