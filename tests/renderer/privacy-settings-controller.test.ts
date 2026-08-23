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
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
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
})
