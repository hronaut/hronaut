import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useDetachedPanelRefreshController } from '../../src/renderer/src/composables/useDetachedPanelRefreshController.js'
import type { DetachablePanelId } from '../../src/shared/types.js'

function createHarness(detachedWindow = true) {
  const activePanelId = ref<DetachablePanelId | null>('network')
  const tabId = ref<string | null>('tab-1')
  const url = ref('https://example.test/one')
  const loading = ref(true)
  const refresh = vi.fn(async (): Promise<void> => undefined)
  const activate = vi.fn((panel: DetachablePanelId) => { activePanelId.value = panel })
  const onError = vi.fn()
  const controller = useDetachedPanelRefreshController({
    detachedWindow,
    activePanelId,
    context: () => ({ tabId: tabId.value, url: url.value, loading: loading.value }),
    activate,
    refresh,
    onError,
    waitForPresentationTurn: () => nextTick()
  })
  return { activate, activePanelId, controller, loading, onError, refresh, tabId, url }
}

function deferred<Value = void>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, reject, resolve }
}

describe('detached panel refresh controller', () => {
  it('refreshes only the newest panel when requests overlap before rendering', async () => {
    const harness = createHarness()

    const first = harness.controller.show('network')
    const second = harness.controller.show('console')
    await Promise.all([first, second])

    expect(harness.activate).toHaveBeenCalledOnce()
    expect(harness.activate).toHaveBeenCalledWith('console')
    expect(harness.refresh).toHaveBeenCalledOnce()
    expect(harness.refresh).toHaveBeenCalledWith('console')
    harness.controller.dispose()
  })

  it('does not run a queued panel refresh after disposal', async () => {
    const harness = createHarness()

    const showing = harness.controller.show('console')
    harness.controller.dispose()
    await showing

    expect(harness.activate).not.toHaveBeenCalled()
    expect(harness.refresh).not.toHaveBeenCalled()
  })

  it('does not let a tab context change cancel a newer panel presentation', async () => {
    const presentationTurn = deferred()
    const harness = createHarness()
    harness.controller.dispose()
    const controller = useDetachedPanelRefreshController({
      detachedWindow: true,
      activePanelId: harness.activePanelId,
      context: () => ({
        tabId: harness.tabId.value,
        url: harness.url.value,
        loading: harness.loading.value
      }),
      activate: harness.activate,
      refresh: harness.refresh,
      onError: harness.onError,
      waitForPresentationTurn: () => presentationTurn.promise
    })

    const showing = controller.show('console')
    harness.loading.value = false
    await nextTick()
    presentationTurn.resolve()
    await showing

    expect(harness.activate).toHaveBeenCalledWith('console')
    expect(harness.activePanelId.value).toBe('console')
    expect(harness.refresh).toHaveBeenLastCalledWith('console')
    controller.dispose()
  })

  it('ignores a refresh failure from a panel request superseded after presentation', async () => {
    const staleRefresh = deferred()
    const harness = createHarness()
    harness.refresh
      .mockImplementationOnce(() => staleRefresh.promise)
      .mockResolvedValueOnce(undefined)

    const stale = harness.controller.show('network')
    await vi.waitFor(() => expect(harness.refresh).toHaveBeenCalledWith('network'))
    const current = harness.controller.show('console')
    await current
    staleRefresh.reject(new Error('stale network refresh'))
    await stale

    expect(harness.activePanelId.value).toBe('console')
    expect(harness.onError).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('reports a refresh failure from the currently presented panel', async () => {
    const harness = createHarness()
    const failure = new Error('current console refresh')
    harness.refresh.mockRejectedValueOnce(failure)

    await harness.controller.show('console')

    expect(harness.activePanelId.value).toBe('console')
    expect(harness.onError).toHaveBeenCalledWith(failure)
    harness.controller.dispose()
  })

  it('refreshes the active panel when a detached tab finishes loading or changes context', async () => {
    const harness = createHarness()
    harness.loading.value = false
    await nextTick()
    expect(harness.refresh).toHaveBeenCalledWith('network')

    harness.tabId.value = 'tab-2'
    harness.url.value = 'https://example.test/two'
    await nextTick()
    expect(harness.refresh).toHaveBeenLastCalledWith('network')
    expect(harness.refresh).toHaveBeenCalledTimes(2)
    harness.controller.dispose()
  })

  it('does not refresh main windows, Home, loading tabs, or a missing panel', async () => {
    const mainWindow = createHarness(false)
    mainWindow.loading.value = false
    await nextTick()
    expect(mainWindow.refresh).not.toHaveBeenCalled()
    mainWindow.controller.dispose()

    const detached = createHarness()
    detached.url.value = 'hronaut://home'
    detached.loading.value = false
    await nextTick()
    detached.tabId.value = 'tab-2'
    await nextTick()
    detached.url.value = 'https://example.test/two'
    detached.activePanelId.value = null
    await nextTick()
    expect(detached.refresh).not.toHaveBeenCalled()
    detached.controller.dispose()
  })

  it('reports only the current refresh failure', async () => {
    const harness = createHarness()
    let rejectFirst = (_error: Error): void => undefined
    harness.refresh.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    }))
    harness.loading.value = false
    await nextTick()

    harness.tabId.value = 'tab-2'
    await nextTick()
    rejectFirst(new Error('stale tab refresh'))
    await Promise.resolve()
    expect(harness.onError).not.toHaveBeenCalled()

    const currentFailure = new Error('current tab refresh')
    harness.refresh.mockRejectedValueOnce(currentFailure)
    harness.url.value = 'https://example.test/two'
    await nextTick()
    await Promise.resolve()
    expect(harness.onError).toHaveBeenCalledWith(currentFailure)
    harness.controller.dispose()
  })

  it('contains synchronous failures and ignores pending failures after disposal', async () => {
    const harness = createHarness()
    const synchronousFailure = new Error('refresh threw')
    harness.refresh.mockImplementationOnce(() => { throw synchronousFailure })
    harness.loading.value = false
    await nextTick()
    expect(harness.onError).toHaveBeenCalledWith(synchronousFailure)

    let rejectPending = (_error: Error): void => undefined
    harness.refresh.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectPending = reject
    }))
    harness.tabId.value = 'tab-2'
    await nextTick()
    harness.controller.dispose()
    rejectPending(new Error('late refresh failure'))
    await Promise.resolve()
    expect(harness.onError).toHaveBeenCalledTimes(1)

    harness.tabId.value = 'tab-3'
    await nextTick()
    expect(harness.refresh).toHaveBeenCalledTimes(2)
  })
})
