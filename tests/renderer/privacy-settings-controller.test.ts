import { describe, expect, it, vi } from 'vitest'
import { usePrivacySettingsController } from '../../src/renderer/src/composables/usePrivacySettingsController.js'
import type { BrowsingDataSummary, BrowsingDataWebsiteSummary } from '../../src/shared/types.js'

function summary(historyEntries: number): BrowsingDataSummary {
  return {
    cookieCount: 0,
    cacheBytes: 0,
    historyEntries,
    historyVisits: historyEntries,
    bookmarkCount: 0,
    savedPasswordCount: 0,
    permissionDecisionCount: 0
  }
}

function website(hostname: string): BrowsingDataWebsiteSummary {
  return {
    origin: `https://${hostname}`,
    hostname,
    title: hostname,
    cookieCount: 0,
    historyEntries: 0,
    historyVisits: 0,
    bookmarkCount: 0,
    savedPasswordCount: 0,
    permissionDecisionCount: 0,
    openTabCount: 0
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function createController() {
  const api = {
    summary: vi.fn(async () => summary(1)),
    websites: vi.fn(async () => [website('current.test')]),
    clear: vi.fn(async () => summary(0))
  }
  const confirm = vi.fn(() => true)
  const controller = usePrivacySettingsController({
    api,
    confirm,
    formatNumber: String,
    translate: (key, parameters) => parameters ? `${key}:${JSON.stringify(parameters)}` : key
  })
  return { api, confirm, controller }
}

describe('privacy settings controller', () => {
  it('ignores an older website refresh that finishes after a newer refresh', async () => {
    const first = deferred<BrowsingDataWebsiteSummary[]>()
    const { api, controller } = createController()
    api.websites.mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce([website('newer.test')])

    const olderRefresh = controller.refreshWebsites()
    await controller.refreshWebsites()
    first.resolve([website('older.test')])
    await olderRefresh

    expect(controller.websites.value.map((site) => site.hostname)).toEqual(['newer.test'])
    expect(controller.websiteState.value).toBe('idle')
    controller.dispose()
  })

  it('does not let an in-flight summary refresh overwrite a completed clear', async () => {
    const staleSummary = deferred<BrowsingDataSummary>()
    const { api, controller } = createController()
    api.summary.mockImplementationOnce(() => staleSummary.promise)
    api.websites.mockResolvedValueOnce([])

    const refreshing = controller.refreshSummary()
    await controller.clearSelected()
    staleSummary.resolve(summary(99))
    await refreshing

    expect(controller.summary.value?.historyEntries).toBe(0)
    expect(controller.summaryState.value).toBe('cleared')
    expect(api.clear).toHaveBeenCalledWith({ history: true, cookiesAndSiteData: false, cache: true })
    controller.dispose()
  })

  it('rejects refresh work while a clear operation is pending', async () => {
    const pendingClear = deferred<BrowsingDataSummary>()
    const { api, controller } = createController()
    api.clear.mockImplementationOnce(() => pendingClear.promise)

    const clearing = controller.clearSelected()
    await controller.refreshSummary()
    await controller.refreshWebsites()
    controller.resetSelection()

    expect(controller.clearing.value).toBe(true)
    expect(controller.summaryState.value).toBe('clearing')
    expect(api.summary).not.toHaveBeenCalled()
    expect(api.websites).not.toHaveBeenCalled()
    pendingClear.resolve(summary(0))
    await clearing
    controller.dispose()
  })

  it('keeps a completed global clear authoritative when refreshing the website list fails', async () => {
    const { api, controller } = createController()
    controller.summary.value = summary(12)
    controller.websites.value = [website('stale.test')]
    api.websites.mockRejectedValueOnce(new Error('Website inventory unavailable'))

    await controller.clearSelected()

    expect(api.clear).toHaveBeenCalledOnce()
    expect(controller.summary.value?.historyEntries).toBe(0)
    expect(controller.summaryState.value).toBe('cleared')
    expect(controller.summaryMessage.value).toContain('runtime.browsingData.cleared')
    expect(controller.websites.value.map((site) => site.hostname)).toEqual(['stale.test'])
    expect(controller.websiteState.value).toBe('error')
    expect(controller.websiteMessage.value).toBe('Website inventory unavailable')
    controller.dispose()
  })

  it('keeps the global clear busy until its website inventory refresh settles', async () => {
    const { api, controller } = createController()
    const inventory = deferred<BrowsingDataWebsiteSummary[]>()
    api.websites.mockReturnValueOnce(inventory.promise)

    const clearing = controller.clearSelected()
    await vi.waitFor(() => expect(api.websites).toHaveBeenCalledOnce())

    expect(controller.summary.value?.historyEntries).toBe(0)
    expect(controller.summaryState.value).toBe('clearing')
    expect(controller.clearing.value).toBe(true)
    await controller.clearSelected()
    expect(api.clear).toHaveBeenCalledOnce()

    inventory.resolve([])
    await clearing
    expect(controller.summaryState.value).toBe('cleared')
    expect(controller.clearing.value).toBe(false)
    controller.dispose()
  })

  it('reports a stale website list without misreporting a completed site clear', async () => {
    const { api, controller } = createController()
    const target = website('target.test')
    controller.summary.value = summary(8)
    controller.websites.value = [target]
    api.websites.mockRejectedValueOnce(new Error('Website inventory unavailable'))

    await controller.clearWebsite(target)

    expect(api.clear).toHaveBeenCalledWith({
      history: true,
      cookiesAndSiteData: false,
      cache: true,
      origin: target.origin
    })
    expect(controller.summary.value?.historyEntries).toBe(0)
    expect(controller.websites.value).toEqual([target])
    expect(controller.websiteState.value).toBe('error')
    expect(controller.websiteMessage.value).toContain('privacyActions.clearedSite')
    expect(controller.websiteMessage.value).toContain('Website inventory unavailable')
    expect(controller.clearingOrigin.value).toBeNull()
    controller.dispose()
  })

  it('releases the selected site when its clear operation fails', async () => {
    const { api, controller } = createController()
    const target = website('target.test')
    api.clear.mockRejectedValueOnce(new Error('Clear unavailable'))

    await controller.clearWebsite(target)

    expect(api.websites).not.toHaveBeenCalled()
    expect(controller.websiteState.value).toBe('error')
    expect(controller.websiteMessage.value).toBe('Clear unavailable')
    expect(controller.clearingOrigin.value).toBeNull()
    expect(controller.clearing.value).toBe(false)
    controller.dispose()
  })
})
