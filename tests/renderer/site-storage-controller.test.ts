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
})
