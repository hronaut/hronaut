import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSiteStorageController } from '../../src/renderer/src/composables/useSiteStorageController.js'
import type {
  BrowserIndexedDbReport,
  BrowserPwaReport,
  BrowserStorageChangesReport,
  BrowserStorageResult,
  BrowserStorageUsageReport,
  BrowserTabState
} from '../../src/shared/types.js'

function tab(id = 'tab-1'): BrowserTabState {
  return {
    id,
    title: 'Example',
    url: 'https://example.test/app',
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false
  }
}

function storageResult(tabId = 'tab-1'): BrowserStorageResult {
  return {
    tabId,
    url: 'https://example.test/app',
    origin: 'https://example.test',
    kind: 'local-storage',
    action: 'list',
    itemCount: 1,
    items: [{ key: 'theme', value: 'dark', valueBytes: 4 }]
  }
}

function usageReport(): BrowserStorageUsageReport {
  return {
    tabId: 'tab-1',
    url: 'https://example.test/app',
    origin: 'https://example.test',
    capturedAt: '2026-08-21T12:00:00.000Z',
    source: 'chromium-quota',
    usage: 1_536,
    quota: 10_240,
    available: 8_704,
    usagePercent: 15,
    overrideActive: false,
    breakdown: [{ storageType: 'indexeddb', usage: 1_536 }],
    breakdownAvailable: true,
    caveats: []
  }
}

function indexedDbReport(): BrowserIndexedDbReport {
  return {
    tabId: 'tab-1', url: 'https://example.test/app', origin: 'https://example.test',
    databases: [{ name: 'private-database', version: 1 }], selectedObjectStore: 'settings',
    offset: 50, limit: 50, hasMore: true, valuesIncluded: true, truncated: true, caveats: ['private-caveat'],
    entries: [
      { key: 'theme', primaryKey: 'display-1', keyType: 'String', valueType: 'Object', valuePreview: 'dark preview', valueTruncated: true },
      { key: 'accent', primaryKey: 'display-2', keyType: 'String', valueType: 'Object', valuePreview: 'blue' },
      { key: 'omitted', primaryKey: 'display-3', keyType: 'String', valueType: 'Object', valueTruncated: true }
    ]
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => (resolve = next))
  return { promise, resolve }
}

function createController(manageStorage = vi.fn(async () => storageResult())) {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const open = ref(true)
  const confirm = vi.fn(() => true)
  const browser = {
    manageStorage,
    inspectStorageUsage: vi.fn(async () => null as unknown as BrowserStorageUsageReport),
    inspectIndexedDb: vi.fn(async () => null as unknown as BrowserIndexedDbReport),
    inspectPwa: vi.fn(async () => null as unknown as BrowserPwaReport),
    storageChanges: vi.fn(async () => null as unknown as BrowserStorageChangesReport)
  }
  const copyText = vi.fn(async () => true)
  const controller = useSiteStorageController({
    activeTab,
    open,
    locale: ref('en-US'),
    browser,
    translate: (key) => key,
    copyText,
    confirm,
    keepsSeparatePanelOpen: () => false
  })
  return { activeTab, open, confirm, browser, controller, copyText }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('site-storage controller', () => {
  it.each(['partial preview', undefined])('does not load a truncated value into the editor (%s)', value => {
    const { controller } = createController()
    controller.key.value = 'draft-key'
    controller.value.value = 'complete draft'
    controller.editItem({ key: 'large-value', value, valueBytes: 18_000, valueTruncated: true })
    expect(controller.key.value).toBe('draft-key')
    expect(controller.value.value).toBe('complete draft')
  })

  it.each([
    { kind: 'local-storage' as const, key: '' },
    { kind: 'local-storage' as const, key: '   ' },
    { kind: 'session-storage' as const, key: '' },
    { kind: 'session-storage' as const, key: '   ' }
  ])('saves the exact $kind key "$key"', async ({ kind, key }) => {
    const { browser, controller } = createController()
    controller.kind.value = kind
    controller.editItem({ key, value: 'before', valueBytes: 6 })
    controller.value.value = 'after'
    await controller.saveItem()
    expect(browser.manageStorage).toHaveBeenCalledWith({
      tabId: 'tab-1', kind, action: 'set', key, value: 'after', includeValues: true
    })
  })

  it('continues to reject blank cookie names in the editor', async () => {
    const { browser, controller } = createController()
    controller.kind.value = 'cookies'
    controller.key.value = '   '
    controller.value.value = 'value'
    await controller.saveItem()
    expect(browser.manageStorage).not.toHaveBeenCalled()
  })

  it('invalidates an in-flight result when the view resets on the same tab', async () => {
    const pending = deferred<BrowserStorageResult>()
    const { controller } = createController(vi.fn(() => pending.promise))

    const loading = controller.refresh()
    controller.reset()
    pending.resolve(storageResult())
    await loading

    expect(controller.result.value).toBeNull()
    expect(controller.state.value).toBe('idle')
  })

  it('ignores an old-tab response after the active tab changes', async () => {
    const pending = deferred<BrowserStorageResult>()
    const { activeTab, controller } = createController(vi.fn(() => pending.promise))

    const loading = controller.refresh()
    activeTab.value = tab('tab-2')
    pending.resolve(storageResult('tab-1'))
    await loading

    expect(controller.result.value).toBeNull()
    expect(controller.state.value).toBe('loading')
  })

  it('does not mutate protected entries and honors clear confirmation', async () => {
    const { browser, confirm, controller } = createController()
    controller.result.value = storageResult()

    await controller.deleteItem({ key: 'secret', valueBytes: 0, protected: true })
    expect(browser.manageStorage).not.toHaveBeenCalled()

    confirm.mockReturnValue(false)
    await controller.clearKind()
    expect(confirm).toHaveBeenCalledOnce()
    expect(browser.manageStorage).not.toHaveBeenCalled()
  })

  it('does not start another storage mutation while persistence is pending', async () => {
    const pending = deferred<BrowserStorageResult>()
    const manageStorage = vi.fn(() => pending.promise)
    const { browser, controller } = createController(manageStorage)
    controller.result.value = storageResult()

    const firstDelete = controller.deleteItem({ key: 'first', value: '1', valueBytes: 1 })
    controller.editItem({ key: 'draft', value: 'new', valueBytes: 3 })
    const refresh = controller.refresh()
    const changeKind = controller.selectKind('cookies')
    const secondDelete = controller.deleteItem({ key: 'second', value: '2', valueBytes: 1 })

    expect(controller.state.value).toBe('saving')
    expect(controller.key.value).toBe('')
    expect(controller.kind.value).toBe('local-storage')
    expect(browser.manageStorage).toHaveBeenCalledOnce()
    pending.resolve({ ...storageResult(), itemCount: 0, items: [], action: 'delete', changed: true })
    await Promise.all([firstDelete, refresh, changeKind, secondDelete])
    expect(controller.state.value).toBe('idle')
  })

  it.each((['usage', 'changes', 'indexedDb', 'pwa'] as const).flatMap(view =>
    [true, false].map(succeeded => ({ view, succeeded }))
  ))('clears previous $view success while a later copy is pending (success: $succeeded)', async ({ view, succeeded }) => {
    vi.useFakeTimers()
    const pending = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.usageReport.value = usageReport()
    controller.changesReport.value = { status: 'compared' } as BrowserStorageChangesReport
    controller.indexedDbReport.value = { entries: [], offset: 0 } as unknown as BrowserIndexedDbReport
    controller.pwaReport.value = { caches: [] } as unknown as BrowserPwaReport
    controller[`${view}Open`].value = true
    const copy = {
      usage: controller.copyUsage, changes: controller.copyChanges,
      indexedDb: controller.copyIndexedDb, pwa: controller.copyPwa
    }[view]
    await copy()
    expect(controller[`${view}Copied`].value).toBe(true)
    const firstPayload = copyText.mock.calls[0]
    await vi.advanceTimersByTimeAsync(1_000)
    copyText.mockImplementationOnce(() => pending.promise)
    const operation = copy()
    expect(controller[`${view}Copied`].value).toBe(false)
    expect(copyText.mock.calls[1]).toEqual(firstPayload)
    pending.resolve(succeeded)
    await operation
    expect(controller[`${view}Copied`].value).toBe(succeeded)
    // The old timer must not shorten the new success indicator.
    await vi.advanceTimersByTimeAsync(600)
    expect(controller[`${view}Copied`].value).toBe(succeeded)
    await vi.advanceTimersByTimeAsync(900)
    expect(controller[`${view}Copied`].value).toBe(false)
    controller.dispose()
  })

  it('restarts copied feedback when the same storage report is copied again', async () => {
    vi.useFakeTimers()
    const { controller } = createController()
    controller.usageReport.value = usageReport()
    controller.usageOpen.value = true

    await controller.copyUsage()
    await vi.advanceTimersByTimeAsync(1_000)
    await controller.copyUsage()
    await vi.advanceTimersByTimeAsync(600)

    expect(controller.usageCopied.value).toBe(true)
    await vi.advanceTimersByTimeAsync(900)
    expect(controller.usageCopied.value).toBe(false)
    controller.dispose()
  })

  it('does not restore storage copy feedback after a context reset during clipboard write', async () => {
    const copying = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.usageReport.value = usageReport()
    controller.usageOpen.value = true
    copyText.mockImplementationOnce(() => copying.promise)

    const operation = controller.copyUsage()
    controller.reset()
    copying.resolve(true)
    await operation

    expect(controller.usageCopied.value).toBe(false)
    controller.dispose()
  })

  it('does not show usage copy feedback after another storage view is selected', async () => {
    const copying = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.usageReport.value = usageReport()
    controller.usageOpen.value = true
    copyText.mockImplementationOnce(() => copying.promise)

    const operation = controller.copyUsage()
    await controller.selectChanges()
    copying.resolve(true)
    await operation

    expect(controller.changesOpen.value).toBe(true)
    expect(controller.usageCopied.value).toBe(false)
    controller.dispose()
  })
  it.each(['usage', 'changes', 'indexedDb', 'pwa'] as const)(
    'invalidates pending %s clipboard feedback when refreshing the report', async (view) => {
      const copying = deferred<boolean>()
      const loading = deferred<void>()
      const { controller, browser, copyText } = createController()
      const reports = {
        usage: usageReport(),
        changes: { status: 'compared' } as BrowserStorageChangesReport,
        indexedDb: { entries: [], offset: 0 } as unknown as BrowserIndexedDbReport,
        pwa: { caches: [] } as unknown as BrowserPwaReport
      }
      controller.usageReport.value = reports.usage
      controller.changesReport.value = reports.changes
      controller.indexedDbReport.value = reports.indexedDb
      controller.pwaReport.value = reports.pwa
      controller[`${view}Open`].value = true
      const copy = {
        usage: controller.copyUsage, changes: controller.copyChanges,
        indexedDb: controller.copyIndexedDb, pwa: controller.copyPwa
      }[view]
      browser.inspectStorageUsage.mockImplementation(async () => { await loading.promise; return reports.usage })
      browser.storageChanges.mockImplementation(async () => { await loading.promise; return reports.changes })
      browser.inspectIndexedDb.mockImplementation(async () => { await loading.promise; return reports.indexedDb })
      browser.inspectPwa.mockImplementation(async () => { await loading.promise; return reports.pwa })
      copyText.mockImplementationOnce(() => copying.promise)

      const operation = copy()
      const refresh = controller.refreshActiveView()
      await copy()
      expect(copyText).toHaveBeenCalledOnce()
      // Finish the old clipboard write after the refreshed report arrives.
      loading.resolve()
      await refresh
      copying.resolve(true)
      await operation
      expect(controller[`${view}Copied`].value).toBe(false)
      await copy()
      expect(controller[`${view}Copied`].value).toBe(true)
      controller.dispose()
    }
  )

})

describe('retained site-storage search terms', () => {
  it.each(['THEME dark', 'dark   theme', '  theme\tdark  '])('matches key and value together: %s', query => {
    const { controller, browser } = createController()
    const retained = { ...storageResult(), itemCount: 2, items: [
      { key: 'theme', value: 'dark', valueBytes: 4 },
      { key: 'accent', value: 'blue', valueBytes: 4 }
    ] }
    controller.result.value = retained
    controller.search.value = query
    expect(controller.filteredItems.value).toEqual([retained.items[0]])
    expect(controller.result.value).toEqual(retained)
    expect(browser.manageStorage).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('combines cookie names, retained values and domains without searching path or protected values', () => {
    const { controller, browser } = createController()
    controller.kind.value = 'cookies'
    controller.result.value = { ...storageResult(), kind: 'cookies', itemCount: 2, items: [
      { key: 'theme', value: 'dark', domain: 'example.test', path: '/hidden-path', valueBytes: 4 },
      { key: 'session', domain: 'example.test', path: '/', valueBytes: 12, protected: true }
    ] }
    controller.search.value = 'EXAMPLE dark theme'
    expect(controller.filteredItems.value.map(item => item.key)).toEqual(['theme'])
    controller.search.value = 'session example'
    expect(controller.filteredItems.value).toEqual([expect.objectContaining({ key: 'session', protected: true })])
    controller.search.value = 'hidden-path'
    expect(controller.filteredItems.value).toEqual([])
    controller.search.value = 'session dark'
    expect(controller.filteredItems.value).toEqual([])
    expect(browser.manageStorage).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('never combines terms from separate entries and restores retained order for whitespace', () => {
    const { controller } = createController()
    const items = [{ key: 'theme', value: 'dark', valueBytes: 4 }, { key: 'accent', value: 'blue', valueBytes: 4 }]
    controller.result.value = { ...storageResult(), itemCount: 2, items }
    controller.search.value = 'theme blue'
    expect(controller.filteredItems.value).toEqual([])
    controller.search.value = ' \t '
    expect(controller.filteredItems.value).toEqual(items)
    controller.dispose()
  })

  it('uses only retained truncated previews and refreshes matching results without extra reads', () => {
    const { controller, browser } = createController()
    controller.result.value = { ...storageResult(), items: [{ key: 'large', value: 'visible preview', valueBytes: 20000, valueTruncated: true }] }
    controller.search.value = 'large preview'
    expect(controller.filteredItems.value).toHaveLength(1)
    controller.search.value = 'large hidden-tail'
    expect(controller.filteredItems.value).toEqual([])
    controller.result.value = { ...storageResult(), items: [{ key: 'large', value: 'hidden-tail', valueBytes: 11 }] }
    expect(controller.filteredItems.value).toHaveLength(1)
    expect(browser.manageStorage).not.toHaveBeenCalled()
    controller.dispose()
  })
})

describe('retained IndexedDB search terms', () => {
  it('clears completed copy feedback immediately when the filter changes', async () => {
    vi.useFakeTimers()
    const { controller, copyText, browser } = createController()
    controller.indexedDbOpen.value = true
    controller.indexedDbReport.value = indexedDbReport()
    controller.indexedDbSearch.value = 'theme'
    await controller.copyIndexedDb()
    expect(controller.indexedDbCopied.value).toBe(true)
    controller.indexedDbSearch.value = 'accent'
    expect(controller.indexedDbCopied.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(copyText).toHaveBeenCalledOnce()
    expect(browser.inspectIndexedDb).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('does not revive feedback from a copy after the filter changes away and back', async () => {
    const pending = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.indexedDbOpen.value = true
    controller.indexedDbReport.value = indexedDbReport()
    controller.indexedDbSearch.value = 'theme'
    copyText.mockImplementationOnce(() => pending.promise)
    const operation = controller.copyIndexedDb()
    controller.indexedDbSearch.value = 'accent'
    controller.indexedDbSearch.value = 'theme'
    pending.resolve(true)
    await operation
    expect(controller.indexedDbCopied.value).toBe(false)
    await controller.copyIndexedDb()
    expect(controller.indexedDbCopied.value).toBe(true)
    controller.dispose()
  })

  it('keeps newer filtered copy feedback when an earlier clipboard write finishes', async () => {
    vi.useFakeTimers()
    const pending = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.indexedDbOpen.value = true
    controller.indexedDbReport.value = indexedDbReport()
    controller.indexedDbSearch.value = 'theme'
    copyText.mockImplementationOnce(() => pending.promise)
    const first = controller.copyIndexedDb()
    controller.indexedDbSearch.value = 'accent'
    await controller.copyIndexedDb()
    expect(controller.indexedDbCopied.value).toBe(true)
    pending.resolve(true)
    await first
    expect(controller.indexedDbCopied.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(controller.indexedDbCopied.value).toBe(false)
    controller.dispose()
  })

  it.each(['THEME dark', 'dark   theme', '  theme\tdark  ', 'display-1 OBJECT dark'])('combines fields within one loaded record: %s', query => {
    const { controller, browser } = createController()
    const report = indexedDbReport()
    controller.indexedDbReport.value = report
    controller.indexedDbSearch.value = query
    expect(controller.filteredIndexedDbEntries.value).toEqual([report.entries[0]])
    expect(controller.indexedDbReport.value).toEqual(report)
    expect(browser.inspectIndexedDb).not.toHaveBeenCalled()
    expect(browser.manageStorage).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('requires every term in the same entry and restores retained order for blank search', () => {
    const { controller } = createController()
    const report = indexedDbReport()
    controller.indexedDbReport.value = report
    controller.indexedDbSearch.value = 'theme blue'
    expect(controller.filteredIndexedDbEntries.value).toEqual([])
    controller.indexedDbSearch.value = ' \t '
    expect(controller.filteredIndexedDbEntries.value).toEqual(report.entries)
    controller.dispose()
  })

  it('searches only existing fields and retained previews without acquiring omitted data', () => {
    const { controller, browser } = createController()
    controller.indexedDbReport.value = indexedDbReport()
    controller.indexedDbSearch.value = 'omitted object'
    expect(controller.filteredIndexedDbEntries.value.map(entry => entry.key)).toEqual(['omitted'])
    for (const query of ['theme hidden-tail', 'private-database', 'private-caveat', 'String']) {
      controller.indexedDbSearch.value = query
      expect(controller.filteredIndexedDbEntries.value).toEqual([])
    }
    controller.indexedDbSearch.value = 'theme hidden-tail'
    controller.indexedDbReport.value = { ...indexedDbReport(), entries: [
      { key: 'theme', primaryKey: 'display-1', keyType: 'String', valueType: 'Object', valuePreview: 'hidden-tail' }
    ] }
    expect(controller.filteredIndexedDbEntries.value).toHaveLength(1)
    expect(browser.inspectIndexedDb).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('copies only matching loaded entries while preserving report bounds and metadata', async () => {
    const { controller, browser, copyText } = createController()
    const report = indexedDbReport()
    controller.indexedDbOpen.value = true
    controller.indexedDbReport.value = report
    controller.indexedDbSearch.value = 'theme dark'
    await controller.copyIndexedDb()
    expect(copyText).toHaveBeenCalledWith(JSON.stringify({ ...report, entries: [report.entries[0]] }, null, 2))
    expect(controller.indexedDbReport.value).toEqual(report)
    expect(browser.inspectIndexedDb).not.toHaveBeenCalled()
    expect(browser.manageStorage).not.toHaveBeenCalled()
    controller.dispose()
  })
})
