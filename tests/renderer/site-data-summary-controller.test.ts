import { describe, expect, it } from 'vitest'
import { useSiteDataSummaryController, type SiteDataSummaryContext } from '../../src/renderer/src/features/site-controls/useSiteDataSummaryController.js'
import type { BrowsingDataSiteSummary } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function siteSummary(origin: string, cookieCount: number): BrowsingDataSiteSummary {
  return { origin, cookieCount, historyEntries: 0, historyVisits: 0 }
}

describe('site data summary controller', () => {
  it('keeps a newer workspace result when an older request for the same URL resolves last', async () => {
    const first = deferred<BrowsingDataSiteSummary>()
    const second = deferred<BrowsingDataSiteSummary>()
    let current: SiteDataSummaryContext | null = { tabId: 'workspace-a', url: 'https://example.test/page' }
    const controller = useSiteDataSummaryController({
      current: () => current,
      load: ({ tabId }) => tabId === 'workspace-a' ? first.promise : second.promise,
      clear: () => Promise.reject(new Error('Not used')),
      translate: key => key
    })

    const loadingFirst = controller.refresh()
    current = { tabId: 'workspace-b', url: 'https://example.test/page' }
    controller.reset()
    const loadingSecond = controller.refresh()
    second.resolve(siteSummary('https://example.test', 1))
    await loadingSecond
    first.resolve(siteSummary('https://example.test', 7))
    await loadingFirst

    expect(controller.summary.value).toEqual(siteSummary('https://example.test', 1))
    expect(controller.state.value).toBe('idle')
  })

  it('does not surface a late failure after the panel context resets', async () => {
    const pending = deferred<BrowsingDataSiteSummary>()
    let current: SiteDataSummaryContext | null = { tabId: 'workspace-a', url: 'https://example.test/' }
    const controller = useSiteDataSummaryController({ current: () => current, load: () => pending.promise, clear: () => pending.promise, translate: key => key })
    const loading = controller.refresh()

    current = null
    controller.reset()
    pending.reject(new Error('late summary failure'))
    await loading

    expect(controller.summary.value).toBeNull()
    expect(controller.state.value).toBe('idle')
    expect(controller.message.value).toBe('')
  })

  it('shows a main-process failure in its own words, without Electron\'s IPC wrapper', async () => {
    const context = { tabId: 'workspace-a', url: 'https://example.test/' }
    const failure = new Error("Error invoking remote method 'browsing-data:site-summary': Error: Site data is unavailable.")
    const controller = useSiteDataSummaryController({ current: () => context, load: () => Promise.reject(failure), clear: () => Promise.reject(failure), translate: key => `t:${key}` })

    await controller.refresh()
    expect(controller.state.value).toBe('error')
    expect(controller.message.value).toBe('Site data is unavailable.')

    const silent = useSiteDataSummaryController({ current: () => context, load: () => Promise.reject(new Error('')), clear: () => Promise.reject(new Error('')), translate: key => `t:${key}` })
    await silent.refresh()
    expect(silent.message.value).toBe('t:runtime.toast.actionFailed')
  })
  it('clears the website\'s data for the tab and shows what it keeps after', async () => {
    const context = { tabId: 'workspace-a', url: 'https://example.test/' }
    const cleared: SiteDataSummaryContext[] = []
    const controller = useSiteDataSummaryController({
      current: () => context,
      load: async () => siteSummary('https://example.test', 4),
      clear: async (target) => { cleared.push(target); return siteSummary('https://example.test', 0) },
      translate: key => key
    })
    await controller.refresh()
    expect(controller.summary.value?.cookieCount).toBe(4)

    await controller.clearData()
    expect(cleared).toEqual([context])
    expect(controller.summary.value).toEqual(siteSummary('https://example.test', 0))
    expect(controller.state.value).toBe('idle')
  })
})
