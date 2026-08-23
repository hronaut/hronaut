import { describe, expect, it } from 'vitest'
import { useSiteDataSummaryController, type SiteDataSummaryContext } from '../../src/renderer/src/composables/useSiteDataSummaryController.js'
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
      load: ({ tabId }) => tabId === 'workspace-a' ? first.promise : second.promise
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
    const controller = useSiteDataSummaryController({ current: () => current, load: () => pending.promise })
    const loading = controller.refresh()

    current = null
    controller.reset()
    pending.reject(new Error('late summary failure'))
    await loading

    expect(controller.summary.value).toBeNull()
    expect(controller.state.value).toBe('idle')
    expect(controller.message.value).toBe('')
  })
})
