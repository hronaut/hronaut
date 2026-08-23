import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
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
  const controller = useSiteStorageController({
    activeTab,
    open,
    locale: ref('en-US'),
    browser,
    translate: (key) => key,
    copyText: async () => true,
    confirm,
    keepsSeparatePanelOpen: () => false
  })
  return { activeTab, open, confirm, browser, controller }
}

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
})
