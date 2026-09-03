import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useDiagnosticLogPreservationController } from '../../src/renderer/src/composables/useDiagnosticLogPreservationController.js'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'

function tab(preserveDiagnosticLogs = false): BrowserTabState {
  return {
    id: 'tab-1',
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
    preserveDiagnosticLogs,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false
  }
}

function state(preserveDiagnosticLogs: boolean): BrowserState {
  const activeTab = tab(preserveDiagnosticLogs)
  return {
    tabs: [activeTab],
    closedTabs: [],
    activeTabId: activeTab.id,
    allHumanInteractionLocked: false,
    mcpUrl: '',
    profilePath: '/profile',
    mcpTabGroups: [],
    savedTabGroups: []
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

function createHarness() {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const browser = {
    setDiagnosticLogPreservation: vi.fn(async (_tabId: string, preserve: boolean) => state(preserve))
  }
  const syncState = vi.fn(async (operation: Promise<BrowserState>) => {
    const next = await operation
    activeTab.value = next.tabs.find((candidate) => candidate.id === next.activeTabId)
    return next
  })
  const onError = vi.fn()
  const controller = useDiagnosticLogPreservationController({ activeTab, browser, syncState, onError })
  return { activeTab, browser, syncState, onError, controller }
}

function input(checked: boolean): HTMLInputElement {
  const element = document.createElement('input')
  element.type = 'checkbox'
  element.checked = checked
  return element
}

function changeEvent(element: HTMLInputElement): Event {
  return { currentTarget: element } as unknown as Event
}

describe('diagnostic log preservation controller', () => {
  it('publishes the latest choice through the lifecycle-aware browser store operation', async () => {
    const { activeTab, browser, syncState, controller } = createHarness()
    const checkbox = input(true)

    await expect(controller.update(changeEvent(checkbox))).resolves.toBe(true)

    expect(browser.setDiagnosticLogPreservation).toHaveBeenCalledWith('tab-1', true)
    expect(syncState).toHaveBeenCalledOnce()
    expect(activeTab.value?.preserveDiagnosticLogs).toBe(true)
    expect(controller.busy.value).toBe(false)
    controller.dispose()
  })

  it('contains a rejected change, restores the authoritative checkbox, and reports it', async () => {
    const { browser, onError, controller } = createHarness()
    const failure = new Error('diagnostic settings unavailable')
    browser.setDiagnosticLogPreservation.mockRejectedValueOnce(failure)
    const checkbox = input(true)

    await expect(controller.update(changeEvent(checkbox))).resolves.toBe(false)

    expect(checkbox.checked).toBe(false)
    expect(onError).toHaveBeenCalledWith(failure)
    expect(controller.busy.value).toBe(false)
    controller.dispose()
  })

  it('does not let an older rejected toggle undo or report over a newer choice', async () => {
    const { browser, onError, controller } = createHarness()
    const older = deferred<BrowserState>()
    browser.setDiagnosticLogPreservation
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValueOnce(state(false))
    const checkbox = input(true)

    const olderUpdate = controller.update(changeEvent(checkbox))
    checkbox.checked = false
    await expect(controller.update(changeEvent(checkbox))).resolves.toBe(true)
    older.reject(new Error('stale failure'))
    await expect(olderUpdate).resolves.toBe(false)

    expect(checkbox.checked).toBe(false)
    expect(onError).not.toHaveBeenCalled()
    expect(controller.busy.value).toBe(false)
    controller.dispose()
  })

  it('contains a delayed failure after its renderer owner is disposed', async () => {
    const { browser, onError, controller } = createHarness()
    const pending = deferred<BrowserState>()
    browser.setDiagnosticLogPreservation.mockImplementationOnce(() => pending.promise)
    const updating = controller.update(changeEvent(input(true)))

    controller.dispose()
    pending.reject(new Error('late failure'))

    await expect(updating).resolves.toBe(false)
    expect(onError).not.toHaveBeenCalled()
    expect(controller.busy.value).toBe(false)
  })
})
