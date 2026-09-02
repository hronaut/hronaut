import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { usePanelWindowSyncController } from '../../src/renderer/src/composables/usePanelWindowSyncController.js'
import type { DetachablePanelId, PanelDock } from '../../src/shared/types.js'

function createHarness(detachedWindow = false) {
  const panelDock = ref<PanelDock>('right')
  const activePanelId = ref<DetachablePanelId | null>(null)
  const syncingMainPanelState = ref(false)
  const api = {
    open: vi.fn(async (): Promise<void> => undefined),
    close: vi.fn(async (): Promise<void> => undefined),
    setActive: vi.fn(async (): Promise<void> => undefined),
    redock: vi.fn(async (): Promise<void> => undefined)
  }
  const persistDock = vi.fn()
  const onError = vi.fn()
  const controller = usePanelWindowSyncController({
    api,
    detachedWindow,
    panelDock,
    activePanelId,
    syncingMainPanelState,
    persistDock,
    onError
  })
  return {
    activePanelId,
    api,
    controller,
    onError,
    panelDock,
    persistDock,
    syncingMainPanelState
  }
}

describe('panel window sync controller', () => {
  it('persists main-window docks and mirrors active panels only in window mode', async () => {
    const harness = createHarness()
    harness.activePanelId.value = 'network'
    await nextTick()
    expect(harness.api.open).not.toHaveBeenCalled()

    harness.panelDock.value = 'window'
    await nextTick()
    expect(harness.persistDock).toHaveBeenCalledWith('window')
    expect(harness.api.open).toHaveBeenCalledWith('network')

    harness.activePanelId.value = 'console'
    await nextTick()
    expect(harness.api.open).toHaveBeenLastCalledWith('console')

    harness.activePanelId.value = null
    await nextTick()
    expect(harness.api.close).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('does not echo an active-panel event received from the detached window', async () => {
    const harness = createHarness()
    harness.panelDock.value = 'window'
    await nextTick()
    harness.syncingMainPanelState.value = true
    harness.activePanelId.value = 'network'
    await nextTick()

    expect(harness.api.open).not.toHaveBeenCalled()
    expect(harness.api.close).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

  it('redocks and changes the active panel from a detached renderer', async () => {
    const harness = createHarness(true)
    harness.activePanelId.value = 'network'
    await nextTick()
    expect(harness.api.setActive).toHaveBeenCalledWith('network')

    harness.panelDock.value = 'left'
    await nextTick()
    expect(harness.api.redock).toHaveBeenCalledWith('network', 'left')
    expect(harness.persistDock).not.toHaveBeenCalled()

    harness.activePanelId.value = null
    await nextTick()
    expect(harness.api.close).toHaveBeenCalledOnce()
    harness.controller.dispose()
  })

  it('contains synchronous and asynchronous IPC failures', async () => {
    const harness = createHarness()
    const rejected = new Error('panel open rejected')
    const thrown = new Error('panel close threw')
    harness.activePanelId.value = 'network'
    await nextTick()
    harness.api.open.mockRejectedValueOnce(rejected)
    harness.api.close.mockImplementationOnce(() => { throw thrown })
    harness.panelDock.value = 'window'
    await nextTick()
    await Promise.resolve()
    await nextTick()
    expect(harness.panelDock.value).toBe('right')

    harness.panelDock.value = 'window'
    await nextTick()
    harness.activePanelId.value = null
    await nextTick()

    expect(harness.onError).toHaveBeenCalledWith(rejected)
    expect(harness.onError).toHaveBeenCalledWith(thrown)
    harness.controller.dispose()
  })

  it('does not let an older open failure overwrite a newer dock choice', async () => {
    const harness = createHarness()
    let rejectOpen = (_error: Error): void => undefined
    harness.activePanelId.value = 'network'
    await nextTick()
    harness.api.open.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectOpen = reject
    }))
    harness.panelDock.value = 'window'
    await nextTick()
    harness.panelDock.value = 'bottom'
    await nextTick()
    rejectOpen(new Error('stale panel open failure'))
    await Promise.resolve()
    await nextTick()

    expect(harness.panelDock.value).toBe('bottom')
    expect(harness.persistDock).toHaveBeenLastCalledWith('bottom')
    expect(harness.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'stale panel open failure' }))
    harness.controller.dispose()
  })

  it('does not let an older panel-open failure redock a newer panel choice', async () => {
    const harness = createHarness()
    let rejectOpen = (_error: Error): void => undefined
    harness.activePanelId.value = 'network'
    await nextTick()
    harness.api.open.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectOpen = reject
    }))
    harness.panelDock.value = 'window'
    await nextTick()
    expect(harness.api.open).toHaveBeenCalledWith('network')

    harness.activePanelId.value = 'console'
    await nextTick()
    expect(harness.api.open).toHaveBeenLastCalledWith('console')

    rejectOpen(new Error('obsolete network panel failure'))
    await Promise.resolve()
    await nextTick()

    expect(harness.panelDock.value).toBe('window')
    expect(harness.persistDock).toHaveBeenLastCalledWith('window')
    expect(harness.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'obsolete network panel failure' }))
    harness.controller.dispose()
  })

  it('contains dock persistence failures without changing the live dock', async () => {
    const harness = createHarness()
    const failure = new Error('dock storage unavailable')
    harness.persistDock.mockImplementationOnce(() => { throw failure })
    harness.panelDock.value = 'bottom'
    await nextTick()

    expect(harness.panelDock.value).toBe('bottom')
    expect(harness.onError).toHaveBeenCalledWith(failure)
    harness.controller.dispose()
  })

  it('stops mirroring changes and silently contains pending failures after disposal', async () => {
    const harness = createHarness()
    let rejectOpen = (_error: Error): void => undefined
    harness.activePanelId.value = 'network'
    await nextTick()
    harness.api.open.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectOpen = reject
    }))
    harness.panelDock.value = 'window'
    await nextTick()
    harness.controller.dispose()
    rejectOpen(new Error('late panel failure'))
    await Promise.resolve()

    harness.panelDock.value = 'bottom'
    harness.activePanelId.value = 'console'
    await nextTick()
    expect(harness.onError).not.toHaveBeenCalled()
    expect(harness.persistDock).toHaveBeenCalledTimes(1)
    expect(harness.api.open).toHaveBeenCalledTimes(1)
  })
})
