import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ nativeImage: {} }))

const { NativePreviewCapture } = await import('../src/main/browser/native-preview-capture.js')
const { performTabOverviewPreviewCapture } = await import('../src/main/browser/tab-overview-previews/tab-overview-previews.js')
type Access = Parameters<typeof performTabOverviewPreviewCapture>[0]
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
  const scheduleTabOverviewPreview = vi.fn()
  const access = {
    isDestroyed: () => false,
    window: () => ({ isDestroyed: () => false, isVisible: () => true, isFocused: () => true }),
    findTab: (id: string) => id === tab.id ? tab : undefined,
    browserContentOccluded: () => false,
    activeTabId: () => tab.id,
    splitViewContains: () => false,
    nativePreviewCapture: () => nativePreviewCapture,
    scheduleTabOverviewPreview,
    tabOverviewPreviewableTabs: () => new Set<string>()
  } as unknown as Access
  // Such as the picture of an agent's step, which shares the page's capture.
  const other = deferred()
  void nativePreviewCapture.run(tab.webContents, () => other.promise, () => undefined, () => undefined)
  return { tab, access, capturePage, scheduleTabOverviewPreview, finishOther: () => other.resolve({}) }
}

describe('tab overview preview capture', () => {
  it('tries again once another capture of the page is done', async () => {
    // The tab's capture got nothing while an agent step's picture of the page was being taken, and nothing tried
    // again, so the tab had no overview preview.
    const { tab, access, capturePage, scheduleTabOverviewPreview, finishOther } = busyTab()
    await performTabOverviewPreviewCapture(access, tab, 1, 'visible')
    expect(capturePage).not.toHaveBeenCalled()
    expect(scheduleTabOverviewPreview).not.toHaveBeenCalled()
    finishOther()
    await vi.waitFor(() => expect(scheduleTabOverviewPreview).toHaveBeenCalledWith(tab))
  })

  it('leaves it to a newer capture that took over meanwhile', async () => {
    const { tab, access, scheduleTabOverviewPreview, finishOther } = busyTab()
    await performTabOverviewPreviewCapture(access, tab, 1, 'visible')
    tab.overviewPreviewSequence = 2
    finishOther()
    await new Promise(resolve => setImmediate(resolve))
    expect(scheduleTabOverviewPreview).not.toHaveBeenCalled()
  })
})
