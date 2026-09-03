import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useConsoleController } from '../../src/renderer/src/composables/useConsoleController.js'
import type { BrowserConsoleMessage, BrowserTabState } from '../../src/shared/types.js'

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

function message(text: string): BrowserConsoleMessage {
  return {
    timestamp: '2026-08-21T12:00:00.000Z',
    level: 'error',
    message: text,
    lineNumber: 12,
    sourceId: 'https://example.test/app.js'
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => (resolve = next))
  return { promise, resolve }
}

function createController() {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const open = ref(false)
  const browser = {
    listConsoleMessages: vi.fn(async () => [] as BrowserConsoleMessage[])
  }
  const copyText = vi.fn(async () => true)
  const controller = useConsoleController({
    activeTab,
    open,
    browser,
    translate: (key) => key,
    copyText,
    keepsSeparatePanelOpen: () => false
  })
  return { activeTab, open, browser, controller, copyText }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('console controller', () => {
  it('invalidates an in-flight refresh when reset on the same tab', async () => {
    const pending = deferred<BrowserConsoleMessage[]>()
    const { browser, controller } = createController()
    browser.listConsoleMessages.mockImplementationOnce(() => pending.promise)

    const loading = controller.refresh()
    controller.reset()
    pending.resolve([message('stale')])
    await loading

    expect(controller.messages.value).toEqual([])
    expect(controller.state.value).toBe('idle')
    controller.dispose()
  })

  it('ignores a response from the previously active tab', async () => {
    const pending = deferred<BrowserConsoleMessage[]>()
    const { activeTab, browser, controller } = createController()
    browser.listConsoleMessages.mockImplementationOnce(() => pending.promise)

    const loading = controller.refresh()
    activeTab.value = tab('tab-2')
    pending.resolve([message('old tab')])
    await loading

    expect(controller.messages.value).toEqual([])
    expect(controller.state.value).toBe('loading')
    controller.dispose()
  })

  it('restarts copied feedback when the same console scope is copied again', async () => {
    vi.useFakeTimers()
    const { controller } = createController()
    controller.messages.value = [message('copied twice')]

    await controller.copyAll()
    await vi.advanceTimersByTimeAsync(1_000)
    await controller.copyAll()
    await vi.advanceTimersByTimeAsync(600)

    expect(controller.copied.value).toBe('all')
    await vi.advanceTimersByTimeAsync(900)
    expect(controller.copied.value).toBeNull()
    controller.dispose()
  })

  it('does not restore copied feedback after the console context resets during clipboard write', async () => {
    const copying = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.messages.value = [message('stale copy')]
    copyText.mockImplementationOnce(() => copying.promise)

    const operation = controller.copyAll()
    controller.reset()
    copying.resolve(true)
    await operation

    expect(controller.copied.value).toBeNull()
    controller.dispose()
  })

  it('keeps the newest console copy scope when clipboard writes finish out of order', async () => {
    const older = deferred<boolean>()
    const newer = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.messages.value = [message('copy order')]
    controller.search.value = 'copy'
    copyText
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)

    const copyAll = controller.copyAll()
    const copyFiltered = controller.copyFiltered()
    newer.resolve(true)
    await copyFiltered
    older.resolve(true)
    await copyAll

    expect(controller.copied.value).toBe('filtered')
    controller.dispose()
  })

})
