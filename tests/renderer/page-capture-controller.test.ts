import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePageCaptureController } from '../../src/renderer/src/composables/usePageCaptureController.js'
import type {
  BrowserAreaCaptureResult,
  BrowserElementCaptureResult,
  BrowserElementSelection,
  BrowserPageCaptureResult,
  BrowserTabState
} from '../../src/shared/types.js'

function tab(url = 'https://example.test/start', id = 'tab-1'): BrowserTabState {
  return { id, title: 'Example', url } as BrowserTabState
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function createController() {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const browser = {
    pickElement: vi.fn(async (): Promise<BrowserElementSelection> => ({ canceled: false, copied: true })),
    captureElement: vi.fn(async (): Promise<BrowserElementCaptureResult> => ({ canceled: false, copied: true })),
    cancelElementPicker: vi.fn(async () => true),
    captureArea: vi.fn(async (): Promise<BrowserAreaCaptureResult> => ({ canceled: false, copied: true })),
    cancelAreaCapture: vi.fn(async () => true),
    capturePage: vi.fn(async (): Promise<BrowserPageCaptureResult> => ({ copied: true, width: 100, height: 80 }))
  }
  const onElementCopied = vi.fn()
  const onElementFailed = vi.fn()
  const onCaptureCopied = vi.fn()
  const onCaptureFailed = vi.fn(() => 'capture failed')
  const controller = usePageCaptureController({
    activeTab,
    browser,
    onElementCopied,
    onElementFailed,
    onCaptureCopied,
    onCaptureFailed
  })
  return {
    activeTab,
    browser,
    controller,
    onElementCopied,
    onElementFailed,
    onCaptureCopied,
    onCaptureFailed
  }
}

describe('page capture controller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not let an old copied-state timer reset a newly started element picker', async () => {
    const pending = deferred<BrowserElementSelection>()
    const { browser, controller } = createController()

    await controller.toggleElementPicker()
    expect(controller.elementState.value).toBe('copied')

    browser.pickElement.mockImplementationOnce(() => pending.promise)
    const pickingAgain = controller.toggleElementPicker()
    expect(controller.elementState.value).toBe('picking')

    await vi.advanceTimersByTimeAsync(1_500)
    expect(controller.elementState.value).toBe('picking')

    pending.resolve({ canceled: true, copied: false })
    await pickingAgain
    expect(controller.elementState.value).toBe('idle')
    controller.dispose()
  })

  it('returns a canceled screenshot picker to the neutral context mode', async () => {
    const { browser, controller } = createController()
    browser.captureElement.mockResolvedValueOnce({ canceled: true, copied: false })

    await controller.toggleElementPicker('screenshot')

    expect(controller.elementState.value).toBe('idle')
    expect(controller.elementMode.value).toBe('context')
    controller.dispose()
  })

  it('cancels interactive capture and ignores late results when the active tab changes', async () => {
    const pendingElement = deferred<BrowserElementSelection>()
    const { activeTab, browser, controller, onElementCopied } = createController()
    browser.pickElement.mockImplementationOnce(() => pendingElement.promise)

    const picking = controller.toggleElementPicker()
    activeTab.value = tab('https://example.test/next', 'tab-2')
    await nextTick()

    expect(browser.cancelElementPicker).toHaveBeenCalledWith('tab-1')
    expect(controller.elementState.value).toBe('idle')

    pendingElement.resolve({ canceled: false, copied: true })
    await picking
    expect(controller.elementState.value).toBe('idle')
    expect(onElementCopied).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('accepts an area capture that finishes while its tab navigates', async () => {
    const pendingArea = deferred<BrowserAreaCaptureResult>()
    const { activeTab, browser, controller, onCaptureCopied } = createController()
    browser.captureArea.mockImplementationOnce(() => pendingArea.promise)

    const capturing = controller.toggleAreaCapture()
    activeTab.value = tab('https://example.test/changed-during-selection')
    await nextTick()
    pendingArea.resolve({ canceled: false, copied: true, width: 80, height: 40 })
    await capturing

    expect(browser.cancelAreaCapture).not.toHaveBeenCalled()
    expect(controller.captureState.value).toBe('copied')
    expect(onCaptureCopied).toHaveBeenCalledWith('area')
    controller.dispose()
  })

  it('keeps a new screenshot capture authoritative over an older reset timer', async () => {
    const pending = deferred<BrowserPageCaptureResult>()
    const { browser, controller, onCaptureCopied } = createController()

    await controller.toggleAreaCapture()
    expect(controller.captureState.value).toBe('copied')

    browser.capturePage.mockImplementationOnce(() => pending.promise)
    const capturing = controller.capturePage('full-page')
    expect(controller.captureState.value).toBe('capturing')

    await vi.advanceTimersByTimeAsync(2_400)
    expect(controller.captureState.value).toBe('capturing')

    pending.resolve({ copied: true, width: 120, height: 500 })
    await capturing
    expect(controller.captureState.value).toBe('copied')
    expect(onCaptureCopied).toHaveBeenLastCalledWith('full-page')
    controller.dispose()
  })

  it('cancels a native area picker during disposal', async () => {
    const pending = deferred<BrowserAreaCaptureResult>()
    const { browser, controller } = createController()
    browser.captureArea.mockImplementationOnce(() => pending.promise)

    const capturing = controller.toggleAreaCapture()
    controller.dispose()
    expect(browser.cancelAreaCapture).toHaveBeenCalledWith('tab-1')

    pending.resolve({ canceled: false, copied: true })
    await capturing
    expect(controller.captureState.value).toBe('idle')
  })
})
